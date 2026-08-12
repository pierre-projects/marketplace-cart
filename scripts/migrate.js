#!/usr/bin/env node
/**
 * One-shot migration for the Phase 1-3 schema changes.
 *
 *   node scripts/migrate.js            # dry run — reports, writes nothing
 *   node scripts/migrate.js --apply    # perform the migration
 *
 * The new unique indexes (Item.link, Category{user,name}) cannot build over
 * existing duplicates, so the data has to be reconciled before syncIndexes runs.
 * Every step is idempotent: running this twice is safe.
 *
 * No transactions are used, so this works against a standalone mongod as well
 * as a replica set.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Item = require('../models/Items');
const Category = require('../models/Category');
const { CONDITIONS, normalizeCondition } = require('../utils/conditionMap');

const APPLY = process.argv.includes('--apply');
const MONGO_URI = process.env.MONGO_URI;

const summary = [];
function report(step, count, detail = '') {
  summary.push({ step, count, detail });
  const verb = APPLY ? 'changed' : 'would change';
  console.log(`  ${count === 0 ? '·' : '→'} ${step}: ${count} ${verb}${detail ? ` (${detail})` : ''}`);
}

// ---------------------------------------------------------------------------

/**
 * Item.link is now unique. Merge duplicate links onto one survivor and repoint
 * every category reference at it before the index is built.
 */
async function dedupeItemsByLink() {
  const groups = await Item.aggregate([
    { $group: { _id: '$link', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  let removed = 0;
  let repointed = 0;

  for (const group of groups) {
    // Keep the most recently updated copy — it has the freshest scrape.
    const docs = await Item.find({ _id: { $in: group.ids } }).sort({ updatedAt: -1, addedAt: -1 });
    const survivor = docs[0];
    const losers = docs.slice(1).map(d => d._id);

    // Preserve the earliest addedAt: the item was first saved then, even if a
    // later duplicate carries the newer scrape.
    const earliest = docs.reduce((min, d) => (d.addedAt && d.addedAt < min ? d.addedAt : min), survivor.addedAt);

    if (APPLY) {
      if (earliest && String(earliest) !== String(survivor.addedAt)) {
        await Item.updateOne({ _id: survivor._id }, { $set: { addedAt: earliest } });
      }
      const res = await Category.updateMany(
        { 'items.item': { $in: losers } },
        { $set: { 'items.$[entry].item': survivor._id } },
        { arrayFilters: [{ 'entry.item': { $in: losers } }] }
      );
      repointed += res.modifiedCount;
      await Item.deleteMany({ _id: { $in: losers } });
    }
    removed += losers.length;
  }

  report('Duplicate items merged by link', removed, `${groups.length} link(s), ${repointed} category doc(s) repointed`);
  return removed;
}

/**
 * $addToSet never deduped subdocuments, so the same item can appear many times
 * in one category. Collapse each category's items to one entry per item,
 * keeping the earliest (its original addedBy).
 */
async function dedupeCategoryItems() {
  const categories = await Category.find({}).select('_id items');
  let cleaned = 0;
  let entriesRemoved = 0;

  for (const category of categories) {
    const seen = new Set();
    const kept = [];

    for (const entry of category.items || []) {
      const key = entry.item ? String(entry.item) : null;
      if (key === null) continue;            // drop dangling entries
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(entry);
    }

    if (kept.length !== (category.items || []).length) {
      entriesRemoved += (category.items || []).length - kept.length;
      cleaned++;
      if (APPLY) {
        await Category.updateOne({ _id: category._id }, { $set: { items: kept } });
      }
    }
  }

  report('Categories with duplicate/dangling item entries', cleaned, `${entriesRemoved} entr(ies) removed`);
  return cleaned;
}

/**
 * Item.condition is now enum-constrained. Anything the scrapers wrote raw
 * ("Used", "Reconditioned") has to be normalized or nulled, or every future
 * save of that document fails validation.
 */
async function normalizeConditions() {
  const invalid = await Item.find({
    condition: { $nin: [...CONDITIONS, null] }
  }).select('_id condition');

  const changes = new Map();
  for (const item of invalid) {
    changes.set(String(item._id), normalizeCondition(item.condition) || null);
  }

  if (APPLY) {
    for (const [id, value] of changes) {
      await Item.updateOne({ _id: id }, { $set: { condition: value } });
    }
  }

  const samples = [...new Set(invalid.map(i => i.condition))].slice(0, 4).join(', ');
  report('Items with out-of-enum condition', changes.size, samples);
  return changes.size;
}

/**
 * Category now carries an explicit isDefault flag instead of being identified
 * by the literal name 'All Listings'.
 */
async function backfillIsDefault() {
  const filter = { name: 'All Listings', isDefault: { $ne: true } };
  const count = await Category.countDocuments(filter);
  if (APPLY && count > 0) {
    await Category.updateMany(filter, { $set: { isDefault: true } });
  }
  report('Categories backfilled with isDefault', count);
  return count;
}

/**
 * A user should have exactly one default category. The old lazy bootstrap could
 * race and create more than one before the unique index existed.
 */
async function dedupeDefaultCategories() {
  const groups = await Category.aggregate([
    { $match: { isDefault: true } },
    { $group: { _id: '$user', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  let demoted = 0;
  for (const group of groups) {
    const docs = await Category.find({ _id: { $in: group.ids } }).sort({ _id: 1 });
    const survivor = docs[0];
    const losers = docs.slice(1);

    for (const loser of losers) {
      if (APPLY) {
        // Fold the loser's items into the survivor, skipping ones already there.
        const existing = new Set((survivor.items || []).map(e => String(e.item)));
        const merged = (loser.items || []).filter(e => e.item && !existing.has(String(e.item)));
        if (merged.length) {
          await Category.updateOne({ _id: survivor._id }, { $push: { items: { $each: merged } } });
        }
        await Category.deleteOne({ _id: loser._id });
      }
      demoted++;
    }
  }

  report('Extra default categories merged', demoted, `${groups.length} user(s) affected`);
  return demoted;
}

/**
 * {user, name} is now unique. Rename collisions rather than deleting anyone's
 * data — a duplicate name is a naming problem, not a garbage record.
 */
async function dedupeCategoryNames() {
  const groups = await Category.aggregate([
    { $group: { _id: { user: '$user', name: '$name' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  let renamed = 0;
  for (const group of groups) {
    const docs = await Category.find({ _id: { $in: group.ids } }).sort({ _id: 1 });
    for (let i = 1; i < docs.length; i++) {
      const newName = `${docs[i].name} (${i + 1})`;
      if (APPLY) {
        await Category.updateOne({ _id: docs[i]._id }, { $set: { name: newName } });
      }
      renamed++;
    }
  }

  report('Duplicate category names renamed', renamed, `${groups.length} collision group(s)`);
  return renamed;
}

/** Build the new indexes once the data can satisfy them. */
async function syncIndexes() {
  if (!APPLY) {
    console.log('  · Index sync: skipped in dry run');
    return;
  }
  for (const model of [Item, Category, require('../models/ScrapeJob'), require('../models/User')]) {
    await model.syncIndexes();
    console.log(`  → Indexes synced: ${model.modelName}`);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!MONGO_URI) {
    console.error('MONGO_URI is not set. Check your .env file.');
    process.exit(1);
  }

  console.log(`\nMarketplaceCart migration — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`Target: ${MONGO_URI.replace(/\/\/[^@]*@/, '//<credentials>@')}\n`);

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to database "${mongoose.connection.name}"`);
  console.log(`Items: ${await Item.countDocuments()}   Categories: ${await Category.countDocuments()}\n`);

  // Order matters: item-level dedupe must finish before category entries are
  // collapsed, and everything must settle before the unique indexes are built.
  await dedupeItemsByLink();
  await dedupeCategoryItems();
  await normalizeConditions();
  await backfillIsDefault();
  await dedupeDefaultCategories();
  await dedupeCategoryNames();
  await syncIndexes();

  const total = summary.reduce((n, s) => n + s.count, 0);
  console.log(`\n${total} record(s) ${APPLY ? 'migrated' : 'would be migrated'}.`);
  if (!APPLY) {
    if (total > 0) console.log('Re-run with --apply to perform the migration.');
    console.log('Note: indexes are only built with --apply.');
    console.log('Note: dry-run counts are per-step against the current data, so the');
    console.log('      total may exceed the applied total — earlier steps remove rows');
    console.log('      that later steps would otherwise have touched.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nMigration failed:', err.message);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
