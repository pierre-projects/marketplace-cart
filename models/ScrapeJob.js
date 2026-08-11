const mongoose = require('mongoose');

const JOB_STATUSES = ['queued', 'running', 'done', 'failed'];

// Finished jobs are only needed until the client stops polling.
const JOB_TTL_SECONDS = 60 * 60 * 24;

const scrapeJobSchema = new mongoose.Schema({
  link:      { type: String, required: true },
  status:    { type: String, enum: JOB_STATUSES, default: 'queued', required: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  item:      { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  error:     {
    code:    { type: String, default: null },
    message: { type: String, default: null }
  },
  attempts:  { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  // Backoff gate: a retried job is queued again but not claimable until this
  // passes, so a failing link doesn't spin the worker.
  nextAttemptAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Claim query: findOneAndUpdate({ status: 'queued', nextAttemptAt: {$lte} }, ...).
scrapeJobSchema.index({ status: 1, nextAttemptAt: 1 });

// Dedupe query: is there already a queued/running job for this link?
scrapeJobSchema.index({ link: 1, status: 1 });

// Jobs are transient state, not history — let Mongo expire them.
scrapeJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: JOB_TTL_SECONDS });

module.exports = mongoose.model('ScrapeJob', scrapeJobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
