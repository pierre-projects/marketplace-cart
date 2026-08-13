const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const Item = require('../models/Items');
const ScrapeJob = require('../models/ScrapeJob');
const { isSupported } = require('../services/itemService');
const { addItemToCategory } = require('../services/categoryService');
const scrapeQueue = require('../services/scrapeQueue');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { validateItemLink } = require('../middleware/validation');
const { redirectWithFlashError, getSafeReturnToPath } = require('../utils/httpResponses');
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

// POST /items/preview — queue a scrape, return immediately
router.post('/preview', ensureAuthenticated, validateItemLink, async (req, res) => {
  const { link } = req.body;

  // Reject unsupported marketplaces at the door rather than spending a worker
  // slot discovering it.
  if (!isSupported(link)) {
    return res.status(400).json({ error: 'That link is not from a marketplace we support yet.' });
  }

  try {
    const job = await scrapeQueue.enqueue(link, req.user._id);
    return res.status(202).json({ jobId: job._id });
  } catch (err) {
    logger.error('Failed to enqueue scrape job:', err);
    return res.status(500).json({ error: 'Could not start the preview. Please try again.' });
  }
});

// GET /items/jobs/:id — poll a queued scrape
router.get('/jobs/:id', ensureAuthenticated, async (req, res) => {
  try {
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
  } catch (err) {
    logger.error('Failed to read scrape job:', err);
    return res.status(500).json({ error: 'Could not check the preview status.' });
  }
});

// POST /items/add — attach an already-scraped item to categories
router.post('/add', ensureAuthenticated, async (req, res) => {
  const { itemId, link, category, defaultCategoryId, returnTo } = req.body;
  const redirectPath = getSafeReturnToPath(returnTo, '/dashboard');

  try {
    // The item was written by the scrape worker; the client only names it. No
    // listing content is accepted from the browser.
    const item = itemId
      ? await Item.findById(itemId)
      : (link ? await Item.findOne({ link }) : null);

    if (!item) {
      return redirectWithFlashError(req, res, 'That listing is no longer available to add. Please preview it again.', redirectPath);
    }

    await addItemToCategory(defaultCategoryId, item._id, req.user._id);

    if (category && category !== defaultCategoryId) {
      await addItemToCategory(category, item._id, req.user._id);
    }

    return res.redirect(redirectPath);
  } catch (err) {
    logger.error('Error adding item:', err);
    return redirectWithFlashError(req, res, 'Something went wrong while adding that listing.', redirectPath);
  }
});

// DELETE /items/:id/saved — Unsave for this user without deleting shared data.
router.delete('/:id/saved', ensureAuthenticated, async (req, res) => {
  const returnTo = getSafeReturnToPath(req.body.returnTo, '/dashboard');

  try {
    const itemId = req.params.id;

    const result = await Category.updateOne(
      { user: req.user._id, isDefault: true, 'items.item': itemId },
      { $pull: { items: { item: itemId } } }
    );

    if (result.modifiedCount === 0) {
      req.flash('error_msg', 'That item is not in your Saved items.');
      return res.redirect(returnTo);
    }

    req.flash('success_msg', 'Removed from Saved items.');
    return res.redirect(returnTo);
  } catch (err) {
    logger.error('Error unsaving item:', err);
    req.flash('error_msg', 'Failed to remove that item. Please try again.');
    return res.redirect(returnTo);
  }
});

// POST /items/:id/assign-categories — Reassign item to selected categories
router.post('/:id/assign-categories', ensureAuthenticated, async (req, res) => {
  const itemId = req.params.id;
  const categoryIds = Array.isArray(req.body.categoryIds) ? req.body.categoryIds : [];

  try {
    const userCategories = await Category.find({ user: req.user._id, isDefault: { $ne: true } });

    // Remove from all non-default categories
    await Promise.all(userCategories.map(cat =>
      Category.findByIdAndUpdate(cat._id, {
        $pull: { items: { item: itemId } }
      })
    ));

    // Add to selected categories
    await Promise.all(categoryIds.map(catId =>
      addItemToCategory(catId, itemId, req.user._id)
    ));

    res.json({ success: true });
  } catch (err) {
    logger.error('Error assigning categories:', err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
