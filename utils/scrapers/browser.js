const fs = require('fs');
const puppeteer = require('puppeteer');
const logger = require('../logger');
const { ScrapeError, CODES } = require('./errors');

// Chromium is heavy; bound how many browser contexts can be live at once.
const MAX_CONCURRENT_CONTEXTS = 2;

// --- Browser resolution ---
//
// puppeteer.launch() with no options uses puppeteer.executablePath(), which
// returns a path whether or not anything is actually there. On a machine where
// `npx puppeteer browsers install chrome` was never run, that meant every
// Facebook scrape failed at LAUNCH with "Could not find Chrome (ver. …)" —
// reported to the user as a network problem, and retried three times.
//
// Resolve up front instead, and prefer a browser that exists:
//   1. PUPPETEER_EXECUTABLE_PATH — explicit override.
//   2. Puppeteer's own pinned download, only if the file is really on disk.
//   3. channel: 'chrome' — the system install.
// Failing all three is a distinct, non-retryable condition, not a network blip.

let resolvedLaunchOptions = null;

function fileExists(p) {
  try {
    return !!p && fs.statSync(p).isFile();
  } catch (err) {
    return false;
  }
}

/** Locate a usable Chrome. Memoized — the answer cannot change mid-process. */
function resolveLaunchOptions() {
  if (resolvedLaunchOptions) return resolvedLaunchOptions;

  const override = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (override) {
    if (fileExists(override)) {
      logger.info('Browser: using PUPPETEER_EXECUTABLE_PATH', override);
      resolvedLaunchOptions = { executablePath: override };
      return resolvedLaunchOptions;
    }
    // Fall through rather than throw: a stale env var should not take down
    // scraping when a perfectly good Chrome is installed.
    logger.error('Browser: PUPPETEER_EXECUTABLE_PATH does not point at a file, ignoring:', override);
  }

  let bundled = null;
  try {
    bundled = puppeteer.executablePath();
  } catch (err) {
    bundled = null;
  }
  if (fileExists(bundled)) {
    logger.info('Browser: using Puppeteer-managed Chrome', bundled);
    resolvedLaunchOptions = { executablePath: bundled };
    return resolvedLaunchOptions;
  }

  const systemChrome = findSystemChrome();
  if (systemChrome) {
    logger.info('Browser: using system Chrome', systemChrome);
    resolvedLaunchOptions = { executablePath: systemChrome };
    return resolvedLaunchOptions;
  }

  throw new ScrapeError(
    CODES.BROWSER_UNAVAILABLE,
    'No Chrome found. Install one with `npx puppeteer browsers install chrome`, ' +
    'or point PUPPETEER_EXECUTABLE_PATH at an existing Chrome binary.'
  );
}

/**
 * Look for an installed Chrome. Puppeteer's own `channel: 'chrome'` does this,
 * but it throws from inside launch() rather than letting us probe first — and
 * probing is the whole point here.
 */
function findSystemChrome() {
  const candidates = process.platform === 'win32'
    ? [
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];

  return candidates.find(fileExists) || null;
}

// The launch PROMISE is memoized, not the resolved browser. Memoizing the
// resolved value left a window where two concurrent callers both saw `null`,
// both called launch(), and the second assignment orphaned the first Chromium
// beyond the reach of closeBrowser().
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.isConnected()) return existing;
    } catch (err) {
      // Fall through and relaunch below.
    }
    browserPromise = null;
  }

  // Resolve BEFORE launching so a missing browser fails as BROWSER_UNAVAILABLE
  // with an actionable message, rather than as an opaque launch error.
  // Synchronous throw is intentional: it propagates to the caller's catch.
  const launchOptions = resolveLaunchOptions();

  browserPromise = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...launchOptions
  });

  // Clear the memo on failure so a transient launch error doesn't poison every
  // subsequent call with the same rejected promise.
  browserPromise.catch(() => { browserPromise = null; });

  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;

  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch (err) {
    logger.error('Error closing browser:', err.message);
  }
}

// --- Context slot semaphore ---

let activeContexts = 0;
const waiting = [];

/**
 * Reserve a browser-context slot. Resolves to a release function that must be
 * called exactly once — callers do so in a `finally`.
 */
function acquireContextSlot() {
  if (activeContexts < MAX_CONCURRENT_CONTEXTS) {
    activeContexts++;
    return Promise.resolve(makeRelease());
  }
  return new Promise(resolve => waiting.push(() => resolve(makeRelease())));
}

function makeRelease() {
  let released = false;
  return function release() {
    if (released) return;
    released = true;

    const next = waiting.shift();
    if (next) {
      // Hand the slot straight to the next waiter without decrementing.
      next();
    } else {
      activeContexts--;
    }
  };
}

module.exports = {
  getBrowser,
  closeBrowser,
  acquireContextSlot,
  // Exposed for the harness: resolution has four branches but only one is live
  // on any given machine, so they have to be exercised directly.
  _internals: {
    resolveLaunchOptions,
    findSystemChrome,
    fileExists,
    resetResolution: () => { resolvedLaunchOptions = null; },
  },
};
