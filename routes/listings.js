const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');
const { buildItemCategoryIndex, sortEntriesByNewest } = require('../services/categoryService');
const { renderHtmlError } = require('../utils/httpResponses');

// GET /listings - every item in the user's default category
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const defaultCategory = await Category.findOne({
      isDefault: true,
      user: req.user._id
    }).populate('items.item').populate('items.addedBy');

    // Load all categories for tag display and dropdowns
    const categories = await Category.find({ user: req.user._id })
      .populate('items.item')
      .populate('items.addedBy');

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
  } catch (err) {
    console.error('Failed to load listings:', err);
    return renderHtmlError(req, res, 500, 'Error loading listings.');
  }
});

module.exports = router;
