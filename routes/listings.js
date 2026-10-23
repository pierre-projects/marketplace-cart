const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const collections = require('../services/categoryService');
const { buildItemCategoryIndex, sortEntriesByNewest } = require('../services/categoryStats');
const { asyncHandler } = require('../utils/httpResponses');

// GET /listings - every item in the user's default category
router.get('/', ensureAuthenticated, asyncHandler(async (req, res) => {
  // One query: the user's categories already include the default one. This
  // used to load and populate the default category a second time.
  const { mine: categories, defaultCategory } = await collections.loadCollectionsFor(req.user._id);

  // The category's items array is in push order. Without this the first paint
  // shows insertion order and the client JS reshuffles it a moment later —
  // and with JS off the "Sort: Date saved" control would be a lie.
  const listings = sortEntriesByNewest(defaultCategory ? defaultCategory.items : []);

  res.render('listings/index', {
    title: 'Saved items',
    currentPage: 'listings',
    listings,
    categories,
    itemCategoryIndex: buildItemCategoryIndex(categories),
    user: req.user,
    isOwner: true
  });
}));

module.exports = router;
