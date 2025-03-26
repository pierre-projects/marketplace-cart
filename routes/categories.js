const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');
const Item = require('../models/Items');
const User = require('../models/User');

// GET /categories
// GET /categories
router.get('/', ensureAuthenticated, async (req, res) => {
    const myCategories = await Category.find({ user: req.user._id })
      .populate('items.item')
      .populate('items.addedBy');
  
    const sharedCategories = await Category.find({
      'usersAdded.user': req.user._id
    })
      .populate('items.item')
      .populate('items.addedBy')
      .populate('usersAdded.user');
  
    res.render('categories/index', {
      categories: myCategories,
      sharedCategories,
      user: req.user
    });
  });
  

// POST /categories/create
router.post('/create', ensureAuthenticated, async (req, res) => {
  const name = req.body.name.trim();
  if (!name) return res.redirect('/categories');

  await Category.create({
    name,
    user: req.user._id,
    items: [],
    usersAdded: []
  });

  res.redirect('/categories');
});

// GET /categories/:id (view one category)
router.get('/:id', async (req, res) => {
  const category = await Category.findById(req.params.id)
    .populate('items.item')
    .populate('items.addedBy')
    .populate('usersAdded.user');


  const isOwner = req.user && category.user.equals(req.user._id);
  const isEditor = req.user && category.usersAdded.some(
    entry => entry.user.equals(req.user._id) && entry.role === 'editor'
  );
  const isViewer = req.user && category.usersAdded.some(
    entry => entry.user.equals(req.user._id) && entry.role === 'viewer'
  );
  const isPublic = category.isPublic;

  if (!isOwner && !isEditor && !isViewer && !isPublic) {
    return res.status(403).send('You do not have permission to view this category.');
  }

  const categories = req.user
    ? await Category.find({ user: req.user._id }).populate('items.item')
    : [];

  res.render('categories/show', {
    category,
    categories,
    user: req.user,
    canEdit: isOwner || isEditor,
    isOwner
  });
});

// POST /categories/:id/edit
router.post('/:id/edit', ensureAuthenticated, async (req, res) => {
  const newName = req.body.name.trim();
  if (!newName) return res.redirect('/categories');

  await Category.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { name: newName });
  res.redirect('/categories');
});

// DELETE /categories/:id
router.delete('/:id', ensureAuthenticated, async (req, res) => {
  await Category.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  res.redirect('/categories');
});

// POST /categories/:id/share
router.post('/:id/share', ensureAuthenticated, async (req, res) => {
  const { email, access } = req.body;
  const category = await Category.findById(req.params.id);
  if (!category || !category.user.equals(req.user._id)) {
    return res.status(403).send('Not authorized to share this category');
  }

  const userToAdd = await User.findOne({ email });
  if (!userToAdd) return res.status(404).send('User not found');

  const alreadyExists = category.usersAdded.some(
    entry => entry.user.equals(userToAdd._id)
  );

  if (!alreadyExists) {
    category.usersAdded.push({ user: userToAdd._id, role: access });
    await category.save();
  }

  res.redirect('/categories/' + category._id);
});

// POST /categories/:id/visibility
router.post('/:id/visibility', ensureAuthenticated, async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, user: req.user._id });
    if (!category) return res.status(404).send('Category not found');

    category.isPublic = req.body.isPublic === 'true';
    await category.save();

    res.redirect('/categories/' + category._id);
  } catch (err) {
    console.error('Error updating visibility:', err);
    res.status(500).send('Server error');
  }
});

// POST /categories/:id/remove-item
router.post('/:id/remove-item', ensureAuthenticated, async (req, res) => {
  try {
    const { itemId } = req.body;
    const category = await Category.findById(req.params.id)
      .populate('items.item')
      .populate('items.addedBy');

    const entry = category.items.find(e => e.item._id.toString() === itemId);
    const isOwner = req.user && category.user.equals(req.user._id);
    const isEditor = req.user && category.usersAdded.some(
      entry => entry.user.equals(req.user._id) && entry.role === 'editor'
    );
    const isTheirItem = entry && entry.addedBy._id.toString() === req.user._id.toString();

    if (!isOwner && !(isEditor && isTheirItem)) {
      return res.status(403).send('Not authorized to remove this item.');
    }

    await Category.updateOne(
      { _id: req.params.id },
      { $pull: { items: { item: itemId } } }
    );

    res.redirect(`/categories/${req.params.id}`);
  } catch (err) {
    console.error('Error removing item from category:', err);
    res.status(500).send('Server error while removing item.');
  }
});
router.post('/:id/update-role', ensureAuthenticated, async (req, res) => {
    const { userId, newRole } = req.body;
  
    const category = await Category.findById(req.params.id);
    if (!category || !category.user.equals(req.user._id)) {
      return res.status(403).send('Not authorized');
    }
  
    const entry = category.usersAdded.find(e => e.user.toString() === userId);
    if (entry) {
      entry.role = newRole;
      await category.save();
    }
  
    res.redirect(`/categories/${category._id}`);
  });
  router.post('/:id/remove-user', ensureAuthenticated, async (req, res) => {
    const { userId } = req.body;
  
    const category = await Category.findById(req.params.id);
    if (!category || !category.user.equals(req.user._id)) {
      return res.status(403).send('Not authorized');
    }
  
    category.usersAdded = category.usersAdded.filter(e => e.user.toString() !== userId);
    await category.save();
  
    res.redirect(`/categories/${category._id}`);
  });
  


  //code is almost duplicate of whats used in items.js 
  const { scrapeOfferUp } = require('../utils/scraper');
router.post('/:id/add-item', ensureAuthenticated, async (req, res) => {
  const { link } = req.body;
  const category = await Category.findById(req.params.id);

  if (!category) return res.status(404).send('Category not found');

  const isOwner = category.user.equals(req.user._id);
  const isEditor = category.usersAdded.some(
    e => e.user.equals(req.user._id) && e.role === 'editor'
  );

  if (!isOwner && !isEditor) {
    return res.status(403).send('You do not have permission to add items.');
  }

  try {
    const scraped = await scrapeOfferUp(link);
    if (!scraped || !scraped.title) {
      return res.status(400).send('Failed to scrape data.');
    }

    const platform = link.includes('offerup.com') ? 'OfferUp' : 'Unknown';

    const newItem = new Item({
      ...scraped,
      link,
      platform
    });

    await newItem.save();

    category.items.push({ item: newItem._id, addedBy: req.user._id });
    await category.save();

    res.redirect(`/categories/${category._id}`);
  } catch (err) {
    console.error('Error adding item to shared category:', err);
    res.status(500).send('Error adding item');
  }
});

module.exports = router;
