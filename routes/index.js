const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');
const { computeItemStats, buildItemCategoryIndex } = require('../services/categoryService');
const { renderHtmlError } = require('../utils/httpResponses');

const DEFAULT_CATEGORY_NAME = 'All Listings';

// GET /
router.get('/', (req, res) => {
    res.render('index', { user: req.user, title: 'Marketplace Cart' });
  });

// GET /dashboard
router.get('/dashboard', ensureAuthenticated, async (req, res) => {
  try {
    // Ensure default category exists. Atomic upsert rather than find-then-save:
    // the old read-modify-write raced itself on concurrent dashboard loads.
    await Category.findOneAndUpdate(
      { user: req.user._id, isDefault: true },
      {
        $setOnInsert: {
          name: DEFAULT_CATEGORY_NAME,
          user: req.user._id,
          isDefault: true,
          items: []
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Load categories owned by the user
    const myCategories = await Category.find({ user: req.user._id })
      .populate('items.item')
      .populate('items.addedBy');

    // Load categories shared with the user
    const sharedCategories = await Category.find({
      'usersAdded.user': req.user._id
    })
      .populate('items.item')
      .populate('items.addedBy')
      .populate('usersAdded.user');

    const defaultCategory = myCategories.find(c => c.isDefault);
    const allItems = defaultCategory ? defaultCategory.items : [];
    const stats = computeItemStats(allItems);

    res.render('dashboard', {
      title: 'Dashboard',
      currentPage: 'dashboard',
      user: req.user,
      categories: myCategories,
      sharedCategories,
      itemCategoryIndex: buildItemCategoryIndex(myCategories),
      stats: {
        ...stats,
        categoryCount: myCategories.filter(c => !c.isDefault).length
      }
    });
  } catch (err) {
    console.error('Dashboard load error:', err);
    return renderHtmlError(req, res, 500, 'Failed to load dashboard.', {
      actionHref: '/',
      actionLabel: 'Back to Home'
    });
  }
});

module.exports = router;
