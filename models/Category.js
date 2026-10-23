const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name:     { type: String, required: true },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // creator
  // The auto-created catch-all category. Identity used to be inferred by
  // matching the literal name 'All Listings' in 20 places, which broke the UI
  // if a user happened to name a category that.
  isDefault: { type: Boolean, default: false },
  items: [{
    item:    { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  isPublic: { type: Boolean, default: false },

  // ✅ Replace viewers/editors with unified structure
  usersAdded: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['viewer', 'editor'], required: true }
  }]
});

// One category name per owner. This is what makes the lazy "All Listings"
// bootstrap in categoryService.ensureDefaultCategory safe against concurrent requests creating
// duplicates — the upsert there relies on this index to serialize.
categorySchema.index({ user: 1, name: 1 }, { unique: true });

// "Which collections hold this item" — the orphan sweep and item access checks.
categorySchema.index({ 'items.item': 1 });
categorySchema.index({ 'usersAdded.user': 1 });

module.exports = mongoose.model('Category', categorySchema);
