const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name:     { type: String, required: true },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // creator
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
// bootstrap in routes/index.js safe against concurrent requests creating
// duplicates — the upsert there relies on this index to serialize.
categorySchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
