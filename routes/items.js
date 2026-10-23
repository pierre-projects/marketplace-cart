const express = require('express');
const router = express.Router();
const ScrapeJob = require('../models/ScrapeJob');
const { isSupported } = require('../utils/scrapers');
const { prefill } = require('../utils/scrapers/generic');
const { CONDITIONS } = require('../utils/conditionMap');
const collections = require('../services/categoryService');
const items = require('../services/itemService');
const scrapeQueue = require('../services/scrapeQueue');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { validateItemLink, validateManualItem, validateObjectId } = require('../middleware/validation');
const { scrapeLimiter } = require('../middleware/rateLimit');
const {
  HttpError,
  asyncHandler,
  wantsJson,
  redirectWithFlashError,
  getSafeReturnToPath
} = require('../utils/httpResponses');
const logger = require('../utils/logger');

/** Shape an Item for the preview card. Only fields the modal renders. */
function toPreviewPayload(item) {
  if (!item) return null;
  return {
    _id: item._id,
    title: item.title,
    price: item.price,
    condition: item.condition,
    description: item.description,
    location: item.location,
    imageLinks: item.imageLinks,
    available: item.available,
    platform: item.platform
  };
}

/** Respond to a JSON or form caller with an error from a service. */
function failWith(req, res, err, fallbackMessage, redirectPath) {
  const known = err instanceof HttpError;
  if (!known) logger.error(`${fallbackMessage}:`, err);
  const message = known ? err.message : fallbackMessage;
  if (wantsJson(req)) return res.status(known ? err.status : 500).json({ error: message });
  return redirectWithFlashError(req, res, message, redirectPath);
}

// POST /items/preview — queue a scrape, return immediately
router.post('/preview', ensureAuthenticated, scrapeLimiter, validateItemLink, asyncHandler(async (req, res) => {
  const { link } = req.body;

  // Reject unsupported sites at the door rather than spending a worker slot
  // discovering it. The code tells the modal to offer the manual form instead.
  if (!isSupported(link)) {
    return res.status(400).json({
      code: 'UNSUPPORTED',
      error: 'We can not fetch that site automatically, but you can add it manually.'
    });
  }

  try {
    const job = await scrapeQueue.enqueue(link, req.user._id);
    return res.status(202).json({ jobId: job._id });
  } catch (err) {
    logger.error('Failed to enqueue scrape job:', err);
    return res.status(500).json({ error: 'Could not start the preview. Please try again.' });
  }
}));

// POST /items/prefill — best-effort details for the manual form. Never fails
// on an unreadable page: the form just starts emptier.
router.post('/prefill', ensureAuthenticated, scrapeLimiter, validateItemLink, asyncHandler(async (req, res) => {
  const data = await prefill(req.body.link);
  return res.json({ prefill: { ...data, link: req.body.link } });
}));

// GET /items/jobs/:id — poll a queued scrape
router.get('/jobs/:id', ensureAuthenticated, validateObjectId(), asyncHandler(async (req, res) => {
  // Scoped to the requesting user so a job id is not readable across accounts.
  const job = await ScrapeJob.findOne({ _id: req.params.id, user: req.user._id }).populate('item');
  if (!job) return res.status(404).json({ error: 'Preview job not found.' });

  if (job.status === 'done') {
    return res.json({ status: 'done', item: toPreviewPayload(job.item) });
  }
  if (job.status === 'failed') {
    return res.json({
      status: 'failed',
      error: job.error?.message || 'Could not fetch that listing.'
    });
  }
  return res.json({ status: job.status });
}));

// POST /items/add — save an existing item (scraped, or the user's manual one)
router.post('/add', ensureAuthenticated, asyncHandler(async (req, res) => {
  const { itemId, link, category, returnTo } = req.body;
  const redirectPath = getSafeReturnToPath(returnTo, '/dashboard');

  try {
    const item = await items.findSavableItem(req.user._id, { itemId, link });
    if (!item) {
      return redirectWithFlashError(req, res, 'That listing is no longer available to add. Please preview it again.', redirectPath);
    }

    // The default collection is resolved server-side; a posted
    // defaultCategoryId is ignored.
    await collections.saveItemForUser(req.user._id, item._id, category);
    return res.redirect(redirectPath);
  } catch (err) {
    return failWith(req, res, err, 'Something went wrong while adding that listing', redirectPath);
  }
}));

// POST /items/manual — create a listing from the form, for sites we do not
// scrape or listings with no link at all.
router.post('/manual', ensureAuthenticated, validateManualItem, asyncHandler(async (req, res) => {
  const redirectPath = getSafeReturnToPath(req.body.returnTo, '/dashboard');

  try {
    const item = await items.createManualItem(req.user._id, req.body);
    // A collection page posts its own id as `category`; the dashboard posts
    // the select's choice. Either way the default collection gets it too.
    await collections.saveItemForUser(req.user._id, item._id, req.body.category);

    if (wantsJson(req)) return res.status(201).json({ item: toPreviewPayload(item) });
    req.flash('success_msg', 'Listing saved.');
    return res.redirect(redirectPath);
  } catch (err) {
    return failWith(req, res, err, 'Could not save that listing', redirectPath);
  }
}));

// GET /items/:id/edit — edit a manual listing you own
router.get('/:id/edit', ensureAuthenticated, validateObjectId(), asyncHandler(async (req, res) => {
  const returnTo = getSafeReturnToPath(req.query.returnTo, '/listings');
  try {
    const item = await items.findOwnedManualItem(req.user._id, req.params.id);
    return res.render('items/edit', {
      title: `Edit ${item.title || 'listing'}`,
      currentPage: 'listings',
      item,
      conditions: CONDITIONS,
      returnTo,
      user: req.user
    });
  } catch (err) {
    return failWith(req, res, err, 'Could not open that listing', returnTo);
  }
}));

// PUT /items/:id — save edits to a manual listing you own
router.put('/:id', ensureAuthenticated, validateObjectId(), validateManualItem, asyncHandler(async (req, res) => {
  const returnTo = getSafeReturnToPath(req.body.returnTo, '/listings');
  try {
    await items.updateManualItem(req.user._id, req.params.id, req.body);
    req.flash('success_msg', 'Listing updated.');
    return res.redirect(returnTo);
  } catch (err) {
    return failWith(req, res, err, 'Could not update that listing', `/items/${req.params.id}/edit`);
  }
}));

// DELETE /items/:id/saved — Unsave for this user without deleting shared data.
router.delete('/:id/saved', ensureAuthenticated, validateObjectId(), asyncHandler(async (req, res) => {
  const returnTo = getSafeReturnToPath(req.body.returnTo, '/dashboard');

  try {
    const removed = await collections.unsaveItem(req.user._id, req.params.id);
    req.flash(removed ? 'success_msg' : 'error_msg', removed ? 'Removed from Saved items.' : 'That item is not in your Saved items.');
    return res.redirect(returnTo);
  } catch (err) {
    return failWith(req, res, err, 'Failed to remove that item. Please try again', returnTo);
  }
}));

// POST /items/:id/assign-categories — set which of your collections hold it
router.post('/:id/assign-categories', ensureAuthenticated, validateObjectId(), asyncHandler(async (req, res) => {
  try {
    await items.assertItemAccessible(req.user._id, req.params.id);
    await collections.assignItemToOwnCategories(req.user._id, req.params.id, req.body.categoryIds);
    return res.json({ success: true });
  } catch (err) {
    const known = err instanceof HttpError;
    if (!known) logger.error('Error assigning categories:', err);
    return res.status(known ? err.status : 500).json({ success: false, error: known ? err.message : 'Could not update collections.' });
  }
}));

module.exports = router;
