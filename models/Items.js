const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  title:       { type: String },
  price:       { type: String },
  condition: { type: String },
  description: { type: String },
  imageLinks:  [String],
  location:    { type: String },
  link:        { type: String, required: true },
  platform:    { type: String, default: 'Unknown' },
  available:   { type: Boolean, default: true },
  addedAt:     { type: Date, default: Date.now },
  category:    { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
});

module.exports = mongoose.model('Item', itemSchema);
