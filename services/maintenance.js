const Item = require('../models/Items');
const Category = require('../models/Category');
const logger = require('../utils/logger');

// Preview writes the scraped Item through to the database before the user has
// decided to keep it. Previews that are never added leave Items that no
// Category references — harmless individually, unbounded over time.
const ORPHAN_GRACE_MS = 60 * 60 * 1000; // don't touch anything from the last hour
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let timer = null;

/**
 * Delete Items older than the grace period that no Category references.
 * @returns {Promise<number>} how many were removed
 */
async function sweepOrphanItems() {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);

  // Every item id currently referenced by any category.
  const referenced = await Category.distinct('items.item');

  const result = await Item.deleteMany({
    _id: { $nin: referenced },
    createdAt: { $lt: cutoff }
  });

  if (result.deletedCount > 0) {
    logger.debug(`Maintenance: removed ${result.deletedCount} orphaned item(s)`);
  }
  return result.deletedCount;
}

function start() {
  if (timer) return;

  const run = () => sweepOrphanItems().catch(err =>
    logger.error('Maintenance: orphan sweep failed:', err.message)
  );

  run();
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  // Don't hold the event loop open on shutdown.
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, sweepOrphanItems };
