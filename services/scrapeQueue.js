const ScrapeJob = require('../models/ScrapeJob');
const logger = require('../utils/logger');
const { scrapeItem } = require('../utils/scrapers');
const { asScrapeError } = require('../utils/scrapers/errors');
const { upsertItemByLink, normalizeItemData, detectPlatform } = require('./itemService');

/**
 * In-process scrape queue.
 *
 * Scraping used to run inline in the request: a Facebook listing meant a
 * Puppeteer page load held open on an HTTP connection. Jobs now live in Mongo
 * and a worker in this process drains them, so the request returns instantly
 * and the client polls.
 *
 * Deliberately not Redis/BullMQ — a single Node process serving one user does
 * not need a broker, and it would be the heaviest dependency in the project.
 */

const MAX_CONCURRENT_JOBS = 2;
const MAX_ATTEMPTS = 3;
const IDLE_POLL_MS = 1500;
// A job still 'running' after this long belongs to a dead process.
const STALE_RUNNING_MS = 5 * 60 * 1000;

let running = false;
let activeJobs = 0;
let timer = null;
let kickPending = false;

// --- Public API ---

/**
 * Queue a scrape, reusing an in-flight job for the same link. Two tabs
 * previewing the same URL cost one scrape.
 */
async function enqueue(link, userId) {
  const existing = await ScrapeJob.findOne({
    link,
    user: userId,
    status: { $in: ['queued', 'running'] }
  });

  if (existing) {
    logger.debug('Scrape queue: reusing in-flight job for', link);
    kick();
    return existing;
  }

  const job = await ScrapeJob.create({ link, user: userId });
  logger.debug('Scrape queue: enqueued', job._id.toString(), link);
  kick();
  return job;
}

function start() {
  if (running) return;
  running = true;
  logger.debug('Scrape queue: worker started');

  reclaimStaleJobs()
    .catch(err => logger.error('Scrape queue: reclaim failed:', err.message))
    .finally(() => schedule(0));
}

/** Stop accepting new work and wait for in-flight jobs to finish. */
async function stop() {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  while (activeJobs > 0) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  logger.debug('Scrape queue: worker stopped');
}

/**
 * Jobs left 'running' when a previous process died would otherwise strand the
 * client polling forever. Put them back in the queue on boot.
 */
async function reclaimStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const res = await ScrapeJob.updateMany(
    { status: 'running', $or: [{ startedAt: { $lt: cutoff } }, { startedAt: null }] },
    { $set: { status: 'queued', startedAt: null, nextAttemptAt: new Date() } }
  );
  if (res.modifiedCount > 0) {
    logger.debug(`Scrape queue: reclaimed ${res.modifiedCount} stale job(s)`);
  }
  return res.modifiedCount;
}

// --- Worker loop ---

function kick() {
  if (!running || kickPending) return;
  kickPending = true;
  schedule(0);
}

function schedule(delay) {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    kickPending = false;
    tick().catch(err => logger.error('Scrape queue: tick failed:', err.message));
  }, delay);
}

async function tick() {
  if (!running) return;

  let claimedAny = false;
  while (running && activeJobs < MAX_CONCURRENT_JOBS) {
    const job = await claimNext();
    if (!job) break;

    claimedAny = true;
    activeJobs++;
    // Intentionally not awaited — the loop keeps claiming up to the cap.
    runJob(job)
      .catch(err => logger.error('Scrape queue: job crashed:', err.message))
      .finally(() => {
        activeJobs--;
        schedule(0);
      });
  }

  schedule(claimedAny ? 0 : IDLE_POLL_MS);
}

/**
 * Claim exactly one job. The guard lives in the filter, so two workers (or two
 * ticks) can never claim the same document — the same atomic-claim pattern as
 * addItemToCategory.
 */
async function claimNext() {
  return ScrapeJob.findOneAndUpdate(
    { status: 'queued', nextAttemptAt: { $lte: new Date() } },
    { $set: { status: 'running', startedAt: new Date() }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } }
  );
}

async function runJob(job) {
  const started = Date.now();
  logger.debug(`Scrape queue: running ${job._id} (attempt ${job.attempts})`);

  try {
    const scraped = await scrapeItem(job.link);
    const itemData = normalizeItemData(scraped);
    // job.createdAt is when the user hit save. It survives retries untouched —
    // claimNext only sets status/startedAt and increments attempts — so a link
    // that failed twice before succeeding still carries its original date.
    const item = await upsertItemByLink(
      job.link, itemData, detectPlatform(job.link), job.createdAt
    );

    await ScrapeJob.updateOne(
      { _id: job._id },
      { $set: { status: 'done', item: item._id, error: { code: null, message: null } } }
    );
    logger.debug(`Scrape queue: ${job._id} done in ${Date.now() - started}ms`);
  } catch (err) {
    await handleFailure(job, err);
  }
}

async function handleFailure(job, err) {
  const scrapeErr = asScrapeError(err);
  const canRetry = scrapeErr.retryable && job.attempts < MAX_ATTEMPTS;

  if (canRetry) {
    // Exponential backoff: 2s, 4s, 8s.
    const delayMs = 2000 * Math.pow(2, job.attempts - 1);
    await ScrapeJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'queued',
          startedAt: null,
          nextAttemptAt: new Date(Date.now() + delayMs),
          error: { code: scrapeErr.code, message: scrapeErr.userMessage }
        }
      }
    );
    logger.debug(`Scrape queue: ${job._id} retrying in ${delayMs}ms [${scrapeErr.code}]`);
    return;
  }

  await ScrapeJob.updateOne(
    { _id: job._id },
    { $set: { status: 'failed', error: { code: scrapeErr.code, message: scrapeErr.userMessage } } }
  );
  // The user-facing message is deliberately generic, so logging only that left
  // the real fault invisible: a missing Chrome surfaced in the log as "Could not
  // reach the marketplace." Append the root cause — the server log is the one
  // place the underlying error belongs.
  const rootCause = scrapeErr.cause?.message;
  const detail = rootCause && rootCause !== scrapeErr.message ? ` — cause: ${rootCause}` : '';
  logger.error(`Scrape queue: ${job._id} failed [${scrapeErr.code}] ${scrapeErr.message}${detail}`);
}

module.exports = {
  enqueue,
  start,
  stop,
  reclaimStaleJobs,
  // exported for tests
  _internals: { claimNext, runJob, handleFailure, MAX_ATTEMPTS }
};
