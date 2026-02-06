const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');

// GET /listings - all listings from "All Listings" category
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    // Load All Listings with nested item/add info
    const allListingsCategory = await Category.findOne({
      name: 'All Listings',
      user: req.user._id
    }).populate('items.item').populate('items.addedBy');

    // Load all categories for tag display and dropdowns
    const categories = await Category.find({ user: req.user._id })
      .populate('items.item')
      .populate('items.addedBy');

    res.render('listings/index', {
      listings: allListingsCategory ? allListingsCategory.items : [],
      categories,
      user: req.user,
      isOwner: true
    });
  } catch (err) {
    console.error('Failed to load listings:', err);
    res.status(500).send('Error loading listings');
  }
});

module.exports = router;
