const Item = require('../models/Items');
const { isSupported, detectPlatform } = require('../utils/scrapers');
const logger = require('../utils/logger');
const { normalizeCondition } = require('../utils/conditionMap');

/**
 * Normalize scraper output to the shapes the Item schema expects.
 *
 * This used to also accept `cached*` fields posted back from the browser. That
 * path is gone: the client no longer supplies item content at all, so there is
 * exactly one input shape here — whatever a scraper returned.
 */
/** A number, or null when there is no readable price. Never NaN. */
function normalizePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeItemData(data) {
  return {
    title: data.title || '',
    // `parseFloat(x) || 0` turned both "free" and "unreadable" into 0. Keep
    // null when the scraper reported no price at all.
    price: normalizePrice(data.price),
    condition: normalizeCondition(data.condition) || null,
    description: data.description || null,
    location: data.location || '',
    imageLinks: Array.isArray(data.imageLinks) ? data.imageLinks : [],
    available: data.available === true || data.available === 'true'
  };
}

/**
 * Upsert an Item by link. Item.link is unique, so re-scraping a URL refreshes
 * the existing document (price, availability, title) rather than creating a
 * second copy. addedAt is preserved on refresh; updatedAt records the refresh.
 *
 * `addedAt` is the moment the user ASKED to save the link, which the caller
 * must supply — it is not the same as now. This used to default to the current
 * time, so a link whose scrape was slow, retried, or failed and later succeeded
 * was dated by when the scrape finished. "Date saved" then sorted by scrape
 * completion, which is not what the label promises.
 */
async function upsertItemByLink(link, itemData, platform, addedAt = new Date()) {
  const write = () => Item.findOneAndUpdate(
    { link },
    {
      // `link` is applied automatically from the filter on insert — naming it
      // here as well would be an update-path conflict.
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

module.exports = {
  upsertItemByLink,
  normalizeItemData,
  detectPlatform,
  isSupported
};
