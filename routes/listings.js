const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');
const { buildItemCategoryIndex } = require('../services/categoryService');
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

    res.render('listings/index', {
      title: 'My Listings',
      currentPage: 'listings',
      listings: defaultCategory ? defaultCategory.items : [],
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
