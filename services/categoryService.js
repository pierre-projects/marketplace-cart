const Category = require('../models/Category');

/**
 * Add an item to a category, at most once.
 *
 * `Category.items` is an array of subdocuments, and Mongoose gives every
 * subdocument its own `_id` — so `$addToSet` compares `{item, addedBy, _id}`
 * and never matches an existing entry. The dedupe has to live in the query
 * filter instead: if the item is already present the filter matches no
 * document and the write is a no-op. This is atomic, unlike a read-then-push.
 *
 * @returns {Promise<Object>} the raw updateOne result; `modifiedCount === 0`
 *   means the item was already in the category.
 */
async function addItemToCategory(categoryId, itemId, userId) {
  return Category.updateOne(
    { _id: categoryId, 'items.item': { $ne: itemId } },
    { $push: { items: { item: itemId, addedBy: userId } } }
  );
}

/**
 * Aggregate a category's item entries.
 *
 * Accepts either `{ item, addedBy }` wrappers or bare Item documents, and skips
 * entries whose item failed to populate. This lived in two places — correctly in
 * the dashboard controller and again, in EJS, in categories/show.
 *
 * @returns {{ totalItems: number, totalValue: number, availableCount: number }}
 */
function computeItemStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let totalValue = 0;
  let availableCount = 0;
  let totalItems = 0;

  for (const entry of list) {
    const item = entry && entry.item !== undefined ? entry.item : entry;
    if (!item) continue;

    totalItems++;
    totalValue += typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    if (item.available) availableCount++;
  }

  return { totalItems, totalValue, availableCount };
}

/**
 * Map every item to the non-default categories containing it.
 *
 * item-card.ejs answered this question with a nested `.some()` over every
 * category's items — three separate times per card, once for the labels, once
 * for the count, once for the checkbox state. Building it once per request
 * turns O(categories x items) per card into a lookup.
 *
 * @returns {Object<string, string[]>} itemId -> category id strings
 */
function buildItemCategoryIndex(categories) {
  const index = Object.create(null);
  const list = Array.isArray(categories) ? categories : [];

  for (const category of list) {
    if (!category || category.isDefault) continue;

    const categoryId = String(category._id);
    for (const entry of category.items || []) {
      const item = entry && entry.item !== undefined ? entry.item : entry;
      if (!item || !item._id) continue;

      const itemId = String(item._id);
      (index[itemId] || (index[itemId] = [])).push(categoryId);
    }
  }

  return index;
}

/**
 * Group a category's items by marketplace with subtotals.
 *
 * This used to run in the browser (public/js/totals.js), which required
 * serializing the entire populated items array into a <script> tag — including
 * populated `addedBy` User documents, bcrypt hashes and all. Computing it here
 * means nothing but the numbers reaches the page.
 *
 * @returns {{ platforms: Array<{platform, subtotal, items: Array<{title, price}>}>, total: number }}
 */
function computePlatformBreakdown(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const groups = new Map();
  let total = 0;

  for (const entry of list) {
    const item = entry && entry.item !== undefined ? entry.item : entry;
    if (!item || !item.link) continue;

    const price = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    if (price === 0) continue;

    const platform = item.platform || 'Unknown';
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform).push({ title: item.title || 'Untitled', price });
    total += price;
  }

  const platforms = [...groups.entries()].map(([platform, items]) => ({
    platform,
    items,
    subtotal: items.reduce((sum, i) => sum + i.price, 0)
  }));

  return { platforms, total };
}

/**
 * Newest first, by the date the item was saved.
 *
 * Ordering used to be positional: routes rendered the category's items array in
 * push order and `item-list.ejs` reversed it. That only approximated "newest
 * first" — it broke as soon as a save was dated by anything other than its
 * insert position, and it silently cancelled out the moment a route sorted
 * properly. Order is decided here, from the data, once.
 *
 * Accepts either shape the item list renders: bare Item docs, or
 * `{ item, addedBy }` wrappers. Entries whose `item` populated to null sort
 * last instead of throwing.
 *
 * @param {Array} entries
 * @returns {Array} a new array — the caller's array is not mutated
 */
function sortEntriesByNewest(entries) {
  const list = Array.isArray(entries) ? entries : [];

  const when = (entry) => {
    const item = entry && entry.item !== undefined ? entry.item : entry;
    const t = item && item.addedAt ? new Date(item.addedAt).getTime() : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };

  return list.slice().sort((a, b) => when(b) - when(a));
}

module.exports = {
  addItemToCategory,
  computeItemStats,
  buildItemCategoryIndex,
  computePlatformBreakdown,
  sortEntriesByNewest
};
