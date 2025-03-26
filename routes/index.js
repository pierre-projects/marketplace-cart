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

    res.render('dashboard', {
      user: req.user,
      categories: myCategories,
      sharedCategories
    });
  } catch (err) {
    console.error('Dashboard load error:', err);
    res.status(500).send('Failed to load dashboard.');
  }
});

module.exports = router;
