const express = require('express');
const router = express.Router();
const Item = require('../models/Items');
const Category = require('../models/Category');
const { scrapeOfferUp } = require('../utils/scraper');

// POST /items/preview — AJAX preview scraper
router.post('/preview', async (req, res) => {
  const { link } = req.body;

  if (!link.includes('offerup.com/item/detail')) {
    return res.status(400).json({ error: 'Only OfferUp links are supported.' });
  }

  try {
    const data = await scrapeOfferUp(link);
    if (!data || !data.title) {
      return res.status(500).json({ error: 'Could not scrape item.' });
    }
    res.json(data);
  } catch (err) {
    console.error('Preview scrape failed:', err);
    res.status(500).json({ error: 'Server error scraping item.' });
  }
});

// POST /items/add — Save listing to default and optional category
router.post('/add', async (req, res) => {
  const { link, category, defaultCategoryId } = req.body;

  try {
    const scrapedData = await scrapeOfferUp(link);
    if (!scrapedData || !scrapedData.title) {
      return res.status(400).send('Failed to scrape item data.');
    }

    const platform = link.includes('offerup.com') ? 'OfferUp' : 'Unknown';

    const newItem = new Item({
      ...scrapedData,
      link,
      platform,
    });

    await newItem.save();

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
router.delete('/:id', async (req, res) => {
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
router.post('/:id/assign-categories', async (req, res) => {
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
