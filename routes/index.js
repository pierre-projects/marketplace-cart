const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');

// GET /
router.get('/', (req, res) => {
    res.render('index', { user: req.user });
  });
  
// GET /dashboard
router.get('/dashboard', ensureAuthenticated, async (req, res) => {
  try {
    // Ensure default category exists
    let defaultCategory = await Category.findOne({ user: req.user._id, name: 'All Listings' });
    if (!defaultCategory) {
      defaultCategory = new Category({ name: 'All Listings', user: req.user._id, items: [] });
      await defaultCategory.save();
    }

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

    // Compute dashboard stats
    const allListings = myCategories.find(c => c.name === 'All Listings');
    const allItems = allListings ? allListings.items : [];
    let totalValue = 0;
    let availableCount = 0;
    allItems.forEach(entry => {
      const item = entry.item;
      if (item) {
        totalValue += (typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0);
        if (item.available) availableCount++;
      }
    });

    res.render('dashboard', {
      user: req.user,
      categories: myCategories,
      sharedCategories,
      stats: {
        totalItems: allItems.length,
        totalValue,
        availableCount,
        categoryCount: myCategories.filter(c => c.name !== 'All Listings').length
      }
    });
  } catch (err) {
    console.error('Dashboard load error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});

module.exports = router;
