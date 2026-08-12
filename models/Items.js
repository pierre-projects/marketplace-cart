const mongoose = require('mongoose');
const { CONDITIONS } = require('../utils/conditionMap');

const itemSchema = new mongoose.Schema({
  title:       { type: String },
  // null = the scraper could not read a price. Distinct from 0, which means the
  // listing really is free. Defaulting to 0 made an unreadable price look like
  // a confident "free".
  price:       { type: Number, default: null },
  condition:   { type: String, enum: [...CONDITIONS, null], default: null },
  description: { type: String },
  imageLinks:  [String],
  location:    { type: String },
  link:        { type: String, required: true, unique: true, trim: true },
  platform:    { type: String, default: 'Unknown' },
  available:   { type: Boolean, default: true },
  addedAt:     { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Item', itemSchema);
