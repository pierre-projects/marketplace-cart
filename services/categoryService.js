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

module.exports = { addItemToCategory };
