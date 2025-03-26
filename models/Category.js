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

module.exports = mongoose.model('Category', categorySchema);
