const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const collections = require('../services/categoryService');
const {
  computeItemStats,
  buildItemCategoryIndex,
  computePlatformBreakdown,
  sortEntriesByNewest,
  buildCardStats
} = require('../services/categoryStats');
const { asyncHandler } = require('../utils/httpResponses');

// GET /
router.get('/', (req, res) => {
  res.render('index', { user: req.user, title: 'Marketplace Cart' });
});

// GET /dashboard
router.get('/dashboard', ensureAuthenticated, asyncHandler(async (req, res) => {
  await collections.ensureDefaultCategory(req.user._id);
  const { mine, shared, defaultCategory } = await collections.loadCollectionsFor(req.user._id);

  const allItems = defaultCategory ? defaultCategory.items : [];

  res.render('dashboard', {
    title: 'Dashboard',
    currentPage: 'dashboard',
    user: req.user,
    categories: mine,
    // Sorted here rather than derived in the template: the preview shows only
    // the first few, so "which items" depends on the order being right.
    savedItems: sortEntriesByNewest(allItems),
    // Feeds the shared stats panel's per-marketplace rows.
    breakdown: computePlatformBreakdown(allItems),
    // The dashboard renders the same collection cards, so it needs the same
    // per-collection numbers; without this every card would read $0.00.
    cardStats: buildCardStats([...mine, ...shared]),
    sharedCategories: shared,
    itemCategoryIndex: buildItemCategoryIndex(mine),
    stats: {
      ...computeItemStats(allItems),
      categoryCount: mine.filter(c => !c.isDefault).length
    }
  });
}));

module.exports = router;
