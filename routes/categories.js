const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const Category = require('../models/Category');
const {
  computeItemStats,
  buildItemCategoryIndex,
  computePlatformBreakdown,
  sortEntriesByNewest
} = require('../services/categoryService');
const User = require('../models/User');
const { redirectWithFlashError, renderHtmlError, getSafeReturnToPath } = require('../utils/httpResponses');

// GET /categories
// GET /categories
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
      const myCategories = await Category.find({ user: req.user._id })
        .populate('items.item')
        .populate('items.addedBy');

      const sharedCategories = await Category.find({
        'usersAdded.user': req.user._id
      })
        .populate('items.item')
        .populate('items.addedBy')
        .populate('usersAdded.user');

      return res.render('categories/index', {
        title: 'My Categories',
        currentPage: 'categories',
        categories: myCategories,
        sharedCategories,
        user: req.user
      });
    } catch (err) {
      console.error('Error loading categories index:', err);
      return renderHtmlError(req, res, 500, 'Could not load categories right now.');
    }
  });
  

// POST /categories/create
router.post('/create', ensureAuthenticated, async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return redirectWithFlashError(req, res, 'Category name is required.', '/categories');

    await Category.create({
      name,
      user: req.user._id,
      items: [],
      usersAdded: []
    });

    return res.redirect('/categories');
  } catch (err) {
    if (err.code === 11000) {
      return redirectWithFlashError(req, res, `You already have a category called "${req.body.name?.trim()}".`, '/categories');
    }
    console.error('Error creating category:', err);
    return redirectWithFlashError(req, res, 'Could not create category right now.', '/categories');
  }
});

// GET /categories/:id (view one category)
router.get('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('items.item')
      .populate('items.addedBy')
      .populate('usersAdded.user');

    if (!category) {
      return renderHtmlError(req, res, 404, 'Category not found.', {
        actionHref: '/categories',
        actionLabel: 'Back to Categories'
      });
    }

    const isOwner = req.user && category.user.equals(req.user._id);
    const isEditor = req.user && category.usersAdded.some(
      entry => entry.user.equals(req.user._id) && entry.role === 'editor'
    );
    const isViewer = req.user && category.usersAdded.some(
      entry => entry.user.equals(req.user._id) && entry.role === 'viewer'
    );
    const isPublic = category.isPublic;

    if (!isOwner && !isEditor && !isViewer && !isPublic) {
      return renderHtmlError(req, res, 403, 'You do not have permission to view this category.', {
        actionHref: '/categories',
        actionLabel: 'Back to Categories'
      });
    }

    const categories = req.user
      ? await Category.find({ user: req.user._id }).populate('items.item')
      : [];

    return res.render('categories/show', {
      title: category.name,
      currentPage: 'categories',
      category,
      categories,
      // Newest first, like every other item grid. Passed separately rather than
      // reassigning category.items, which would mark the document modified.
      items: sortEntriesByNewest(category.items),
      // Computed here rather than in the template, which used to recompute the
      // same three numbers in EJS with its own price-coercion branch.
      stats: computeItemStats(category.items),
      breakdown: computePlatformBreakdown(category.items),
      itemCategoryIndex: buildItemCategoryIndex(categories),
      user: req.user,
      canEdit: isOwner || isEditor,
      isOwner
    });
  } catch (err) {
    console.error('Error loading category:', err);
    return renderHtmlError(req, res, 500, 'Could not load this category right now.', {
      actionHref: '/categories',
      actionLabel: 'Back to Categories'
    });
  }
});

// POST /categories/:id/edit
router.post('/:id/edit', ensureAuthenticated, async (req, res) => {
  // Renaming from a collection page used to bounce you to /categories. The
  // caller says where it came from; getSafeReturnToPath refuses anything that
  // could leave this origin.
  const back = getSafeReturnToPath(req.body.returnTo, '/categories');

  try {
    const newName = req.body.name?.trim();
    if (!newName) return redirectWithFlashError(req, res, 'Collection name is required.', back);

    // Scoped to the owner: a viewer or editor posting this directly matches no
    // document and changes nothing.
    const updated = await Category.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name: newName },
      { new: true, runValidators: true }
    );
    if (!updated) {
      return redirectWithFlashError(req, res, 'Not authorized to rename this collection.', back);
    }

    return res.redirect(back);
  } catch (err) {
    if (err.code === 11000) {
      return redirectWithFlashError(req, res, `You already have a collection called "${req.body.name?.trim()}".`, back);
    }
    console.error('Error renaming category:', err);
    return redirectWithFlashError(req, res, 'Could not rename collection right now.', back);
  }
});

// DELETE /categories/:id
router.delete('/:id', ensureAuthenticated, async (req, res) => {
  try {
    await Category.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    return res.redirect('/categories');
  } catch (err) {
    console.error('Error deleting category:', err);
    return redirectWithFlashError(req, res, 'Could not delete category right now.', '/categories');
  }
});

// POST /categories/:id/share
router.post('/:id/share', ensureAuthenticated, async (req, res) => {
  try {
    const { email, access } = req.body;
    const category = await Category.findById(req.params.id);
    if (!category || !category.user.equals(req.user._id)) {
      return redirectWithFlashError(req, res, 'Not authorized to share this category.', `/categories/${req.params.id}`);
    }

    const userToAdd = await User.findOne({ email });
    if (!userToAdd) return redirectWithFlashError(req, res, 'User not found.', `/categories/${req.params.id}`);

    const alreadyExists = category.usersAdded.some(
      entry => entry.user.equals(userToAdd._id)
    );

    if (!alreadyExists) {
      category.usersAdded.push({ user: userToAdd._id, role: access });
      await category.save();
    }

    return res.redirect('/categories/' + category._id);
  } catch (err) {
    console.error('Error sharing category:', err);
    return redirectWithFlashError(req, res, 'Could not share category right now.', `/categories/${req.params.id}`);
  }
});

// POST /categories/:id/visibility
router.post('/:id/visibility', ensureAuthenticated, async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, user: req.user._id });
    if (!category) {
      return redirectWithFlashError(req, res, 'Category not found.', '/categories');
    }

    category.isPublic = req.body.isPublic === 'true';
    await category.save();

    res.redirect('/categories/' + category._id);
  } catch (err) {
    console.error('Error updating visibility:', err);
    return redirectWithFlashError(req, res, 'Server error while updating category visibility.', `/categories/${req.params.id}`);
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
      return redirectWithFlashError(req, res, 'Not authorized to remove this item.', `/categories/${req.params.id}`);
    }

    await Category.updateOne(
      { _id: req.params.id },
      { $pull: { items: { item: itemId } } }
    );

    res.redirect(`/categories/${req.params.id}`);
  } catch (err) {
    console.error('Error removing item from category:', err);
    return redirectWithFlashError(req, res, 'Server error while removing item.', `/categories/${req.params.id}`);
  }
});
router.post('/:id/update-role', ensureAuthenticated, async (req, res) => {
    try {
      const { userId, newRole } = req.body;

      const category = await Category.findById(req.params.id);
      if (!category || !category.user.equals(req.user._id)) {
        return redirectWithFlashError(req, res, 'Not authorized.', `/categories/${req.params.id}`);
      }

      const entry = category.usersAdded.find(e => e.user.toString() === userId);
      if (entry) {
        entry.role = newRole;
        await category.save();
      }

      return res.redirect(`/categories/${category._id}`);
    } catch (err) {
      console.error('Error updating shared user role:', err);
      return redirectWithFlashError(req, res, 'Could not update access right now.', `/categories/${req.params.id}`);
    }
  });
  router.post('/:id/remove-user', ensureAuthenticated, async (req, res) => {
    try {
      const { userId } = req.body;

      const category = await Category.findById(req.params.id);
      if (!category || !category.user.equals(req.user._id)) {
        return redirectWithFlashError(req, res, 'Not authorized.', `/categories/${req.params.id}`);
      }

      category.usersAdded = category.usersAdded.filter(e => e.user.toString() !== userId);
      await category.save();

      return res.redirect(`/categories/${category._id}`);
    } catch (err) {
      console.error('Error removing shared user:', err);
      return redirectWithFlashError(req, res, 'Could not remove user right now.', `/categories/${req.params.id}`);
    }
  });
  


// Add item to category. The item is already in the DB — written by the scrape
// worker during preview — so this route never scrapes and never accepts
// listing content from the browser.
const Item = require('../models/Items');
const { addItemToCategory } = require('../services/categoryService');

router.post('/:id/add-item', ensureAuthenticated, async (req, res) => {
  const { itemId, link } = req.body;
  const category = await Category.findById(req.params.id);

  if (!category) return redirectWithFlashError(req, res, 'Category not found.', '/categories');

  const isOwner = category.user.equals(req.user._id);
  const isEditor = category.usersAdded.some(
    e => e.user.equals(req.user._id) && e.role === 'editor'
  );

  if (!isOwner && !isEditor) {
    return redirectWithFlashError(req, res, 'You do not have permission to add items.', `/categories/${req.params.id}`);
  }

  try {
    const item = itemId
      ? await Item.findById(itemId)
      : (link ? await Item.findOne({ link }) : null);

    if (!item) {
      return redirectWithFlashError(req, res, 'That listing is no longer available to add. Please preview it again.', `/categories/${req.params.id}`);
    }

    await addItemToCategory(category._id, item._id, req.user._id);

    res.redirect(`/categories/${category._id}`);
  } catch (err) {
    console.error('Error adding item to shared category:', err);
    return redirectWithFlashError(req, res, 'Error adding item', `/categories/${req.params.id}`);
  }
});

module.exports = router;
