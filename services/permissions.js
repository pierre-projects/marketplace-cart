const mongoose = require('mongoose');
const Category = require('../models/Category');

/**
 * Who may do what to a collection. This check used to be written out by hand
 * in three routes, and missing entirely from the two that add items — so any
 * signed-in user could post another user's collection id and write into it.
 */

const ROLES = Object.freeze({ OWNER: 'owner', EDITOR: 'editor', VIEWER: 'viewer', PUBLIC: 'public' });

/** An id from either a bare ObjectId or a populated document. */
function idOf(ref) {
  if (!ref) return null;
  return String(ref._id ?? ref);
}

/**
 * The user's role on a category: 'owner' | 'editor' | 'viewer' | 'public' | null.
 * 'public' means "may view because the collection is public". Works on
 * populated and unpopulated documents alike.
 */
function roleFor(category, userId) {
  if (!category) return null;
  const uid = userId ? String(userId) : null;

  if (uid) {
    if (idOf(category.user) === uid) return ROLES.OWNER;
    const entry = (category.usersAdded || []).find(e => idOf(e.user) === uid);
    if (entry && (entry.role === ROLES.EDITOR || entry.role === ROLES.VIEWER)) return entry.role;
  }
  return category.isPublic ? ROLES.PUBLIC : null;
}

const canView = (role) => role !== null;
const canEdit = (role) => role === ROLES.OWNER || role === ROLES.EDITOR;
const isOwner = (role) => role === ROLES.OWNER;

/**
 * Load a category only if the user may add to or remove from it. Returns null
 * otherwise, so a forged id is indistinguishable from a missing one.
 */
async function findEditableCategory(categoryId, userId) {
  if (!mongoose.isValidObjectId(categoryId) || !userId) return null;
  const category = await Category.findById(categoryId);
  return canEdit(roleFor(category, userId)) ? category : null;
}

module.exports = { ROLES, idOf, roleFor, canView, canEdit, isOwner, findEditableCategory };
