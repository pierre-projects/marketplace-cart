const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { createItem, previewItem } = require('../services/itemService');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { validateItemLink } = require('../middleware/validation');

// POST /items/preview — AJAX preview scraper
router.post('/preview', ensureAuthenticated, validateItemLink, async (req, res) => {
  try {
    const data = await previewItem(req.body.link);
    res.json(data);
  } catch (err) {
    console.error('Preview scrape failed:', err);
    res.status(400).json({ error: err.message });
  }
});

// POST /items/add — Save listing to default and optional category
router.post('/add', ensureAuthenticated, validateItemLink, async (req, res) => {
  const { link, category, defaultCategoryId, ...cachedFields } = req.body;

  try {
    // Pass cached fields if they exist (from preview)
    const cachedData = cachedFields.cachedTitle ? cachedFields : null;
    const newItem = await createItem(link, cachedData);

    // Add to All Listings
    await Category.findByIdAndUpdate(defaultCategoryId, {
      $addToSet: {
        items: {
          item: newItem._id,
          addedBy: req.user._id
        }
      }
    });

    // Add to optional category if different
    if (category && category !== defaultCategoryId) {
      await Category.findByIdAndUpdate(category, {
        $addToSet: {
          items: {
            item: newItem._id,
            addedBy: req.user._id
          }
        }
      });
    }

    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Error adding item:', err);
    res.status(500).send('Something went wrong.');
  }
});

// DELETE /items/:id — Remove item from DB and clean from all categories
router.delete('/:id', ensureAuthenticated, async (req, res) => {
  try {
    const itemId = req.params.id;

    await Item.findByIdAndDelete(itemId);

    // Remove from all categories
    await Category.updateMany(
      { 'items.item': itemId },
      { $pull: { items: { item: itemId } } }
    );

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error deleting item:', err);
    res.status(500).send('Failed to delete item.');
  }
});

// POST /items/:id/assign-categories — Reassign item to selected categories
router.post('/:id/assign-categories', ensureAuthenticated, async (req, res) => {
  const itemId = req.params.id;
  const { categoryIds } = req.body;

  try {
    const userCategories = await Category.find({ user: req.user._id, name: { $ne: 'All Listings' } });

    // Remove from all non-default categories
    await Promise.all(userCategories.map(cat =>
      Category.findByIdAndUpdate(cat._id, {
        $pull: { items: { item: itemId } }
      })
    ));

    // Add to selected categories
    await Promise.all(categoryIds.map(catId =>
      Category.findByIdAndUpdate(catId, {
        $addToSet: {
          items: {
            item: itemId,
            addedBy: req.user._id
          }
        }
      })
    ));

    res.json({ success: true });
  } catch (err) {
    console.error('Error assigning categories:', err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
