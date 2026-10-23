const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const {
  validateObjectId,
  validateCategory,
  validateShare,
  validateMemberRole,
  validateMemberId,
  validateItemId,
} = require('../middleware/validation');
const collections = require('../services/categoryService');
const { findSavableItem } = require('../services/itemService');
const {
  computeItemStats,
  buildItemCategoryIndex,
  computePlatformBreakdown,
  sortEntriesByNewest,
  buildCardStats
} = require('../services/categoryStats');
const {
  HttpError,
  asyncHandler,
  wantsJson,
  redirectWithFlashError,
  renderHtmlError,
  getSafeReturnToPath
} = require('../utils/httpResponses');
const logger = require('../utils/logger');

const pageOf = (req) => `/collections/${req.params.id}`;

/**
 * Wrap a form-posting handler: an HttpError from the service becomes a flash
 * on `fallback(req)`, anything else is logged and flashed generically.
 */
function formAction(fallback, failureMessage, handler) {
  return asyncHandler(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (!(err instanceof HttpError)) logger.error(`${failureMessage}:`, err);
      const message = err instanceof HttpError ? err.message : failureMessage;
      return redirectWithFlashError(req, res, message, fallback(req));
    }
  });
}

// GET /collections
router.get('/', ensureAuthenticated, asyncHandler(async (req, res) => {
  const { mine, shared } = await collections.loadCollectionsFor(req.user._id);

  return res.render('collections/index', {
    title: 'Collections',
    currentPage: 'collections',
    categories: mine,
    sharedCategories: shared,
    // Cards used to count items in EJS. Computing here means a card and the
    // collection page it links to cannot report different numbers.
    cardStats: buildCardStats([...mine, ...shared]),
    user: req.user
  });
}));

// POST /collections/create
router.post('/create', ensureAuthenticated, validateCategory, formAction(
  (req) => getSafeReturnToPath(req.body.returnTo, '/collections'),
  'Could not create collection right now.',
  async (req, res) => {
    await collections.createCategory(req.user._id, req.body.name);
    return res.redirect(getSafeReturnToPath(req.body.returnTo, '/collections'));
  }
));

// GET /collections/:id (view one category; public collections need no account)
router.get('/:id', validateObjectId(), asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  let view;
  try {
    view = await collections.loadCategoryForViewer(req.params.id, userId);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return renderHtmlError(req, res, err.status, err.message, {
      actionHref: '/collections',
      actionLabel: 'Back to collections'
    });
  }

  const { category } = view;
  const { mine: categories } = userId
    ? await collections.loadCollectionsFor(userId)
    : { mine: [] };

  return res.render('collections/show', {
    title: category.name,
    currentPage: 'collections',
    category,
    categories,
    // Newest first, like every other item grid. Passed separately rather than
    // reassigning category.items, which would mark the document modified.
    items: sortEntriesByNewest(category.items),
    stats: computeItemStats(category.items),
    breakdown: computePlatformBreakdown(category.items),
    itemCategoryIndex: buildItemCategoryIndex(categories),
    user: req.user,
    canEdit: view.canEdit,
    isOwner: view.isOwner
  });
}));

// POST /collections/:id/edit
router.post('/:id/edit', ensureAuthenticated, validateObjectId(), validateCategory, formAction(
  // Renaming from a collection page used to bounce you to /collections. The
  // caller says where it came from; getSafeReturnToPath refuses anything that
  // could leave this origin.
  (req) => getSafeReturnToPath(req.body.returnTo, '/collections'),
  'Could not rename collection right now.',
  async (req, res) => {
    await collections.renameCategory(req.params.id, req.user._id, req.body.name);
    return res.redirect(getSafeReturnToPath(req.body.returnTo, '/collections'));
  }
));

// DELETE /collections/:id
router.delete('/:id', ensureAuthenticated, validateObjectId(), formAction(
  () => '/collections',
  'Could not delete collection right now.',
  async (req, res) => {
    await collections.deleteCategory(req.params.id, req.user._id);
    return res.redirect('/collections');
  }
));

// POST /collections/:id/share
router.post('/:id/share', ensureAuthenticated, validateObjectId(), validateShare, formAction(
  pageOf,
  'Could not share collection right now.',
  async (req, res) => {
    await collections.shareCategory(req.params.id, req.user._id, req.body.email, req.body.access);
    req.flash('success_msg', 'Collection shared.');
    return res.redirect(pageOf(req));
  }
));

// POST /collections/:id/visibility — JSON for the toggle, redirect without JS
router.post('/:id/visibility', ensureAuthenticated, validateObjectId(), asyncHandler(async (req, res) => {
  const json = wantsJson(req);
  try {
    const category = await collections.setVisibility(req.params.id, req.user._id, req.body.isPublic === 'true' || req.body.isPublic === true);
    if (json) return res.json({ success: true, isPublic: category.isPublic });
    return res.redirect(pageOf(req));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'Server error while updating collection visibility.';
    if (status === 500) logger.error('Error updating visibility:', err);
    if (json) return res.status(status).json({ error: message });
    return redirectWithFlashError(req, res, message, pageOf(req));
  }
}));

// POST /collections/:id/remove-item
router.post('/:id/remove-item', ensureAuthenticated, validateObjectId(), validateItemId, formAction(
  pageOf,
  'Server error while removing item.',
  async (req, res) => {
    await collections.removeItemFromCategory(req.params.id, req.user._id, req.body.itemId);
    return res.redirect(pageOf(req));
  }
));

// POST /collections/:id/update-role
router.post('/:id/update-role', ensureAuthenticated, validateObjectId(), validateMemberRole, formAction(
  pageOf,
  'Could not update access right now.',
  async (req, res) => {
    await collections.updateMemberRole(req.params.id, req.user._id, req.body.userId, req.body.newRole);
    return res.redirect(pageOf(req));
  }
));

// POST /collections/:id/remove-user
router.post('/:id/remove-user', ensureAuthenticated, validateObjectId(), validateMemberId, formAction(
  pageOf,
  'Could not remove user right now.',
  async (req, res) => {
    await collections.removeMember(req.params.id, req.user._id, req.body.userId);
    return res.redirect(pageOf(req));
  }
));

// POST /collections/:id/add-item — the item already exists (scraped during
// preview, or created manually); the form only names it.
router.post('/:id/add-item', ensureAuthenticated, validateObjectId(), formAction(
  pageOf,
  'Error adding item.',
  async (req, res) => {
    const item = await findSavableItem(req.user._id, { itemId: req.body.itemId, link: req.body.link });
    if (!item) throw new HttpError(404, 'That listing is no longer available to add. Please preview it again.');

    await collections.addItemForUser(req.params.id, item._id, req.user._id);
    return res.redirect(pageOf(req));
  }
));

module.exports = router;
