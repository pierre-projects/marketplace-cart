const mongoose = require('mongoose');
const { CONDITIONS } = require('../utils/conditionMap');

const ITEM_SOURCES = ['scraped', 'manual'];

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
  // Required for scraped items, optional for manual ones: a listing seen in a
  // shop window or a group chat has no URL to save.
  link:        {
    type: String,
    trim: true,
    required() { return this.source !== 'manual'; },
  },
  platform:    { type: String, default: 'Unknown' },
  available:   { type: Boolean, default: true },
  addedAt:     { type: Date, default: Date.now },

  // Scraped items are shared: one document per link, refreshed by every
  // re-scrape, so its content is whatever the marketplace says. Manual items
  // hold content a user typed, so each belongs to that user alone and only they
  // can edit it — otherwise one person's edit would rewrite everyone's copy.
  source:      { type: String, enum: ITEM_SOURCES, default: 'scraped', required: true },
  owner:       {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    required() { return this.source === 'manual'; },
  },
  notes:       { type: String, default: '' },
}, { timestamps: true });

// One shared document per scraped link. Manual items are exempt, so two users
// can each save the same Craigslist URL with their own details. Replaces the
// old global `link` unique index; scripts/migrate.js backfills `source` first.
itemSchema.index(
  { link: 1 },
  { unique: true, name: 'link_scraped_unique', partialFilterExpression: { source: 'scraped' } }
);
itemSchema.index({ owner: 1 }, { sparse: true });

module.exports = mongoose.model('Item', itemSchema);
module.exports.ITEM_SOURCES = ITEM_SOURCES;
