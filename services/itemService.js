const mongoose = require('mongoose');
const Item = require('../models/Items');
const Category = require('../models/Category');
const logger = require('../utils/logger');
const { normalizeCondition, CONDITIONS } = require('../utils/conditionMap');
const { detectPlatform, parseListingUrl } = require('../utils/scrapers');
const { HttpError } = require('../utils/httpResponses');
const { toPrice } = require('./categoryStats');

const MANUAL_PLATFORM = 'Other';
const MAX_IMAGES = 6;
const LIMITS = { title: 300, description: 5000, location: 200, notes: 2000, link: 2048 };

// --- Scraped items ---

/**
 * Normalize scraper output to the shapes the Item schema expects. There is
 * exactly one input shape here — whatever a scraper returned. The browser never
 * supplies content for a scraped item.
 */
function normalizeItemData(data) {
  return {
    title: data.title || '',
    // `parseFloat(x) || 0` turned both "free" and "unreadable" into 0. Keep
    // null when the scraper reported no price at all.
    price: toPrice(data.price),
    condition: normalizeCondition(data.condition) || null,
    description: data.description || null,
    location: data.location || '',
    imageLinks: Array.isArray(data.imageLinks) ? data.imageLinks : [],
    available: data.available === true || data.available === 'true'
  };
}

/**
 * Upsert a scraped Item by link. Scraped links are unique, so re-scraping a URL
 * refreshes the existing document (price, availability, title) rather than
 * creating a second copy. addedAt is preserved on refresh; updatedAt records it.
 *
 * `addedAt` is the moment the user ASKED to save the link, which the caller
 * must supply — it is not the same as now. A slow, retried scrape used to be
 * dated by when it finished, so "Date saved" sorted by scrape completion.
 */
async function upsertItemByLink(link, itemData, platform, addedAt = new Date()) {
  const write = () => Item.findOneAndUpdate(
    // `source` in the filter keeps a manual item with the same URL out of it,
    // and is applied to the document on insert.
    { link, source: 'scraped' },
    {
      $set: { ...itemData, platform },
      // setOnInsert, not set: re-saving a URL refreshes its data but must keep
      // the date it was originally saved.
      $setOnInsert: { addedAt }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  try {
    return await write();
  } catch (err) {
    // Two concurrent upserts of the same link can race between the lookup and
    // the insert. The recovery is to re-run: the second pass finds the
    // now-existing document and updates it.
    if (err.code !== 11000) throw err;
    logger.debug('Upsert raced on duplicate link, retrying:', link);
    return write();
  }
}

// --- Lookup and access ---

/**
 * May this user see the item? Scraped items are public listing data. A manual
 * item is visible to its owner and to anyone who can view a collection
 * holding it.
 */
async function canAccessItem(item, userId) {
  if (!item) return false;
  if (item.source !== 'manual') return true;
  if (userId && String(item.owner) === String(userId)) return true;

  const visibleTo = [{ isPublic: true }];
  if (userId) visibleTo.push({ user: userId }, { 'usersAdded.user': userId });
  return Boolean(await Category.exists({ 'items.item': item._id, $or: visibleTo }));
}

/** An item the user may save, by id or (for scraped items) by link. */
async function findSavableItem(userId, { itemId, link } = {}) {
  let item = null;
  if (itemId && mongoose.isValidObjectId(itemId)) {
    item = await Item.findById(itemId);
  } else if (link) {
    item = await Item.findOne({ link: String(link).trim(), source: 'scraped' });
  }
  return (await canAccessItem(item, userId)) ? item : null;
}

async function assertItemAccessible(userId, itemId) {
  const item = mongoose.isValidObjectId(itemId) ? await Item.findById(itemId) : null;
  if (!(await canAccessItem(item, userId))) throw new HttpError(404, 'Item not found.');
  return item;
}

/** A manual item the user owns, for editing. Throws 404 for anything else. */
async function findOwnedManualItem(userId, itemId) {
  const item = mongoose.isValidObjectId(itemId)
    ? await Item.findOne({ _id: itemId, source: 'manual', owner: userId })
    : null;
  if (!item) throw new HttpError(404, 'That listing cannot be edited.');
  return item;
}

// --- Manual items ---

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

/** Image URLs from a textarea (one per line) or an array. http(s) only. */
function parseImageLinks(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\r\n,]+/);
  const out = [];
  for (const candidate of list) {
    const url = parseListingUrl(String(candidate).trim());
    if (url && !out.includes(url.href)) out.push(url.href);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

/**
 * Validate and normalize the manual-listing form. Pure: returns
 * `{ data, errors }`, where errors is a list of user-facing messages.
 */
function normalizeManualInput(body = {}) {
  const errors = [];

  const title = clip(body.title, LIMITS.title);
  if (!title) errors.push('Give the listing a title.');

  let price = null;
  const rawPrice = String(body.price ?? '').replace(/[$,\s]/g, '');
  if (rawPrice !== '') {
    price = Number(rawPrice);
    if (!Number.isFinite(price) || price < 0 || price > 1e9) {
      errors.push('Price must be a number of zero or more, or left empty.');
      price = null;
    }
  }

  let link = clip(body.link, LIMITS.link);
  if (link) {
    const parsed = parseListingUrl(link);
    if (!parsed) errors.push('The link must start with http:// or https://.');
    else link = parsed.href;
  }

  const condition = CONDITIONS.includes(body.condition) ? body.condition : null;

  // A checkbox paired with a hidden "false" posts both values; the last wins.
  const rawAvailable = Array.isArray(body.available) ? body.available[body.available.length - 1] : body.available;
  const available = rawAvailable === undefined
    ? true
    : (rawAvailable === true || rawAvailable === 'true' || rawAvailable === 'on');

  return {
    errors,
    data: {
      title,
      price,
      link: link || undefined,
      condition,
      description: clip(body.description, LIMITS.description),
      location: clip(body.location, LIMITS.location),
      notes: clip(body.notes, LIMITS.notes),
      imageLinks: parseImageLinks(body.imageLinks),
      available,
      platform: link ? detectPlatform(link) : MANUAL_PLATFORM,
    },
  };
}

async function createManualItem(userId, body) {
  const { data, errors } = normalizeManualInput(body);
  if (errors.length) throw new HttpError(400, errors[0]);
  return Item.create({ ...data, source: 'manual', owner: userId, addedAt: new Date() });
}

async function updateManualItem(userId, itemId, body) {
  const item = await findOwnedManualItem(userId, itemId);
  const { data, errors } = normalizeManualInput(body);
  if (errors.length) throw new HttpError(400, errors[0]);

  item.set({ ...data, link: data.link || undefined });
  await item.save();
  return item;
}

module.exports = {
  MANUAL_PLATFORM,
  normalizeItemData,
  upsertItemByLink,
  canAccessItem,
  findSavableItem,
  assertItemAccessible,
  findOwnedManualItem,
  normalizeManualInput,
  parseImageLinks,
  createManualItem,
  updateManualItem,
};
