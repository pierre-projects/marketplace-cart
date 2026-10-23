const Item = require('../models/Items');
const Category = require('../models/Category');
const logger = require('../utils/logger');
const { DEFAULT_CATEGORY_NAME } = require('./categoryService');

// Preview writes the scraped Item through to the database before the user has
// decided to keep it, and unsaving removes the last reference to an item.
// Items no Category references are harmless individually, unbounded over time.
const ORPHAN_GRACE_MS = 60 * 60 * 1000; // don't touch anything touched in the last hour
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;

let timer = null;

/**
 * Delete Items that no Category references and nobody has touched within the
 * grace period. Measured from updatedAt, not createdAt: re-previewing an old
 * link refreshes it, and the sweep used to delete it from under the modal.
 *
 * Done as a $lookup per item rather than a `$nin` over every referenced id,
 * which grew with the whole database. Needs MongoDB 5.0+ for the
 * localField + pipeline form.
 *
 * @returns {Promise<number>} how many were removed
 */
async function sweepOrphanItems() {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
  let removed = 0;

  for (;;) {
    const orphans = await Item.aggregate([
      { $match: { updatedAt: { $lt: cutoff } } },
      {
        $lookup: {
          from: Category.collection.collectionName,
          localField: '_id',
          foreignField: 'items.item',
          pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
          as: 'refs',
        },
      },
      { $match: { refs: { $size: 0 } } },
      { $limit: SWEEP_BATCH },
      { $project: { _id: 1 } },
    ]);
    if (!orphans.length) break;

    const result = await Item.deleteMany({ _id: { $in: orphans.map(o => o._id) }, updatedAt: { $lt: cutoff } });
    removed += result.deletedCount;
    if (orphans.length < SWEEP_BATCH) break;
  }

  if (removed > 0) logger.info(`Maintenance: removed ${removed} orphaned item(s)`);
  return removed;
}

/**
 * Idempotent data fixes the running code depends on. Cheap no-ops after the
 * first boot; `npm run migrate` remains the full repair tool.
 */
async function prepareSchema() {
  // Categories created before the isDefault flag existed.
  const defaults = await Category.updateMany(
    { name: DEFAULT_CATEGORY_NAME, isDefault: { $ne: true } },
    { $set: { isDefault: true } }
  );
  if (defaults.modifiedCount > 0) logger.info(`Backfilled isDefault on ${defaults.modifiedCount} category(ies)`);

  // Items saved before manual listings existed are all scraped. The partial
  // unique index on link only covers `source: 'scraped'`, so they must say so.
  const sources = await Item.updateMany({ source: { $exists: false } }, { $set: { source: 'scraped' } });
  if (sources.modifiedCount > 0) logger.info(`Backfilled source on ${sources.modifiedCount} item(s)`);

  // The old global unique index on link would reject a second manual item with
  // no link (both null) or the same URL as someone else's.
  const indexes = await Item.collection.indexes().catch(() => []);
  if (indexes.some(i => i.name === 'link_1')) {
    await Item.collection.dropIndex('link_1');
    logger.info('Dropped legacy unique index items.link_1');
  }
  await Item.syncIndexes();
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

module.exports = { start, stop, sweepOrphanItems, prepareSchema };
