const mongoose = require('mongoose');
const Category = require('../models/Category');
const User = require('../models/User');
const { HttpError } = require('../utils/httpResponses');
const { ROLES, roleFor, canEdit, canView, isOwner, idOf, findEditableCategory } = require('./permissions');

/**
 * Every database operation on collections. Routes parse the request, call one
 * of these, and respond; permission checks live here so a new route cannot
 * forget one. Failures the user caused are thrown as HttpError.
 */

const DEFAULT_CATEGORY_NAME = 'All Listings';
const MEMBER_ROLES = [ROLES.VIEWER, ROLES.EDITOR];

// Populated User documents reach templates. Only the fields a template shows —
// a bare populate() used to carry every bcrypt hash into the render.
const USER_FIELDS = 'username email';

/** Populate a category query for rendering item grids. */
function withItems(query, { members = false } = {}) {
  const populated = query.populate('items.item').populate('items.addedBy', USER_FIELDS);
  return members ? populated.populate('usersAdded.user', USER_FIELDS) : populated;
}

function assertId(id, message = 'Collection not found.') {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, message);
}

// --- Reads ---

/**
 * Ensure the user's catch-all category exists. Atomic upsert rather than
 * find-then-save: the old read-modify-write raced itself on concurrent loads.
 */
async function ensureDefaultCategory(userId) {
  return Category.findOneAndUpdate(
    { user: userId, isDefault: true },
    { $setOnInsert: { name: DEFAULT_CATEGORY_NAME, user: userId, isDefault: true, items: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/** The user's own categories and the ones shared with them, populated. */
async function loadCollectionsFor(userId) {
  const [mine, shared] = await Promise.all([
    withItems(Category.find({ user: userId })),
    withItems(Category.find({ 'usersAdded.user': userId }), { members: true }),
  ]);
  return { mine, shared, defaultCategory: mine.find(c => c.isDefault) || null };
}

/** One collection plus the viewer's role on it. Throws 404 / 403. */
async function loadCategoryForViewer(categoryId, userId) {
  assertId(categoryId);
  const category = await withItems(Category.findById(categoryId), { members: true });
  if (!category) throw new HttpError(404, 'Collection not found.');

  const role = roleFor(category, userId);
  if (!canView(role)) throw new HttpError(403, 'You do not have permission to view this collection.');
  return { category, role, canEdit: canEdit(role), isOwner: isOwner(role) };
}

// --- Item membership ---

/**
 * Add an item to a category, at most once.
 *
 * `Category.items` is an array of subdocuments, and Mongoose gives every
 * subdocument its own `_id` — so `$addToSet` compares `{item, addedBy, _id}`
 * and never matches an existing entry. The dedupe has to live in the query
 * filter instead: if the item is already present the filter matches no
 * document and the write is a no-op. This is atomic, unlike a read-then-push.
 *
 * Does NOT check permissions. Callers outside this module go through
 * addItemForUser or saveItemForUser.
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

/** Add to a category the user owns or edits. Throws 403 otherwise. */
async function addItemForUser(categoryId, itemId, userId) {
  const category = await findEditableCategory(categoryId, userId);
  if (!category) throw new HttpError(403, 'You do not have permission to add items to that collection.');
  return addItemToCategory(category._id, itemId, userId);
}

/**
 * Save an item for a user: always into their default collection, plus an
 * optional extra one they may edit. The default is resolved here, never taken
 * from the form — a posted `defaultCategoryId` used to let a client name
 * anyone's collection.
 */
async function saveItemForUser(userId, itemId, extraCategoryId) {
  const defaultCategory = await ensureDefaultCategory(userId);
  await addItemToCategory(defaultCategory._id, itemId, userId);

  if (extraCategoryId && String(extraCategoryId) !== String(defaultCategory._id)) {
    await addItemForUser(extraCategoryId, itemId, userId);
  }
  return defaultCategory;
}

/**
 * Make `categoryIds` the exact set of the user's own non-default collections
 * holding the item. Ids that are not the user's are ignored, not trusted.
 */
async function assignItemToOwnCategories(userId, itemId, categoryIds) {
  if (!mongoose.isValidObjectId(itemId)) throw new HttpError(404, 'Item not found.');
  const wanted = new Set([].concat(categoryIds || []).filter(Boolean).map(String));
  const own = await Category.find({ user: userId, isDefault: { $ne: true } }).select('_id');

  await Promise.all(own.map(cat => (
    wanted.has(String(cat._id))
      ? addItemToCategory(cat._id, itemId, userId)
      : Category.updateOne({ _id: cat._id }, { $pull: { items: { item: itemId } } })
  )));
}

/** The owner removes anything; an editor removes only what they added. */
async function removeItemFromCategory(categoryId, userId, itemId) {
  assertId(categoryId);
  if (!mongoose.isValidObjectId(itemId)) throw new HttpError(404, 'That item is not in this collection.');

  const category = await Category.findById(categoryId);
  const role = roleFor(category, userId);
  const entry = category?.items.find(e => idOf(e.item) === String(itemId));
  const addedByUser = Boolean(entry) && idOf(entry.addedBy) === String(userId);

  if (!isOwner(role) && !(role === ROLES.EDITOR && addedByUser)) {
    throw new HttpError(403, 'Not authorized to remove this item.');
  }
  return Category.updateOne({ _id: categoryId }, { $pull: { items: { item: itemId } } });
}

/** Unsave: drop the item from the user's default collection only. */
async function unsaveItem(userId, itemId) {
  if (!mongoose.isValidObjectId(itemId)) return false;
  const result = await Category.updateOne(
    { user: userId, isDefault: true, 'items.item': itemId },
    { $pull: { items: { item: itemId } } }
  );
  return result.modifiedCount > 0;
}

// --- Collection management (owner only) ---

function duplicateName(err, name) {
  return err.code === 11000 ? new HttpError(409, `You already have a collection called "${name}".`) : err;
}

async function createCategory(userId, name) {
  try {
    return await Category.create({ name, user: userId, items: [], usersAdded: [] });
  } catch (err) {
    throw duplicateName(err, name);
  }
}

/** A viewer or editor matches no document and changes nothing. */
async function renameCategory(categoryId, userId, name) {
  assertId(categoryId);
  let updated;
  try {
    updated = await Category.findOneAndUpdate(
      { _id: categoryId, user: userId },
      { name },
      { new: true, runValidators: true }
    );
  } catch (err) {
    throw duplicateName(err, name);
  }
  if (!updated) throw new HttpError(403, 'Not authorized to rename this collection.');
  return updated;
}

async function deleteCategory(categoryId, userId) {
  assertId(categoryId);
  // The default collection is every saved item; deleting it would strand them.
  return Category.findOneAndDelete({ _id: categoryId, user: userId, isDefault: { $ne: true } });
}

async function findOwnedCategory(categoryId, userId) {
  assertId(categoryId);
  const category = await Category.findOne({ _id: categoryId, user: userId });
  if (!category) throw new HttpError(403, 'Not authorized to manage this collection.');
  return category;
}

async function shareCategory(categoryId, ownerId, email, role) {
  if (!MEMBER_ROLES.includes(role)) throw new HttpError(400, 'Choose viewer or editor access.');
  const category = await findOwnedCategory(categoryId, ownerId);

  const userToAdd = await User.findOne({ email: String(email || '').trim().toLowerCase() }).select('_id');
  if (!userToAdd) throw new HttpError(404, 'No account uses that email.');
  if (String(userToAdd._id) === String(ownerId)) throw new HttpError(400, 'You already own this collection.');

  if (!category.usersAdded.some(entry => idOf(entry.user) === String(userToAdd._id))) {
    category.usersAdded.push({ user: userToAdd._id, role });
    await category.save();
  }
  return category;
}

async function updateMemberRole(categoryId, ownerId, memberId, role) {
  if (!MEMBER_ROLES.includes(role)) throw new HttpError(400, 'Choose viewer or editor access.');
  const category = await findOwnedCategory(categoryId, ownerId);
  const entry = category.usersAdded.find(e => idOf(e.user) === String(memberId));
  if (entry) {
    entry.role = role;
    await category.save();
  }
  return category;
}

async function removeMember(categoryId, ownerId, memberId) {
  const category = await findOwnedCategory(categoryId, ownerId);
  category.usersAdded = category.usersAdded.filter(e => idOf(e.user) !== String(memberId));
  await category.save();
  return category;
}

async function setVisibility(categoryId, ownerId, isPublic) {
  const category = await findOwnedCategory(categoryId, ownerId);
  category.isPublic = Boolean(isPublic);
  await category.save();
  return category;
}

module.exports = {
  DEFAULT_CATEGORY_NAME,
  USER_FIELDS,
  ensureDefaultCategory,
  loadCollectionsFor,
  loadCategoryForViewer,
  addItemToCategory,
  addItemForUser,
  saveItemForUser,
  assignItemToOwnCategories,
  removeItemFromCategory,
  unsaveItem,
  createCategory,
  renameCategory,
  deleteCategory,
  shareCategory,
  updateMemberRole,
  removeMember,
  setVisibility,
};
