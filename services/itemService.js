const Item = require('../models/Items');
const { scrapeItem, isSupported } = require('../utils/scrapers');
const logger = require('../utils/logger');
const { normalizeCondition } = require('../utils/conditionMap');

/**
 * Normalize item data to ensure consistent types
 * Handles both fresh scraped data and cached form data
 */
function normalizeItemData(data) {
  return {
    title: data.title || data.cachedTitle || '',
    price: typeof data.price === 'number'
      ? data.price
      : parseFloat(data.price || data.cachedPrice) || 0,
    condition: normalizeCondition(data.condition || data.cachedCondition) || null,
    description: data.description || data.cachedDescription || null,
    location: data.location || data.cachedLocation || '',
    imageLinks: Array.isArray(data.imageLinks)
      ? data.imageLinks
      : (data.imageLinks || data.cachedImageLinks
          ? JSON.parse(data.imageLinks || data.cachedImageLinks)
          : []),
    available: data.available === true || data.available === 'true' || data.cachedAvailable === 'true'
  };
}

/**
 * Detect platform from URL
 */
function detectPlatform(link) {
  if (link.includes('offerup.com')) return 'OfferUp';
  if (link.includes('ebay.com')) return 'eBay';
  if (link.includes('mercari.com')) return 'Mercari';
  if (link.includes('facebook.com/marketplace')) return 'Facebook Marketplace';
  return 'Unknown';
}

/**
 * Preview item data without saving (for AJAX preview)
 */
async function previewItem(link) {
  if (!isSupported(link)) {
    throw new Error('Unsupported marketplace.');
  }
  const data = await scrapeItem(link);
  if (!data || !data.title) {
    throw new Error('Could not scrape item data.');
  }
  return data;
}

/**
 * Upsert an Item by link. Item.link is unique, so re-adding a URL refreshes the
 * existing document (price, availability, title) rather than creating a second
 * copy. addedAt is preserved on refresh; updatedAt records the refresh.
 */
async function upsertItemByLink(link, itemData, platform) {
  return Item.findOneAndUpdate(
    { link },
    {
      // `link` is applied automatically from the filter on insert — naming it
      // here as well would be an update-path conflict.
      $set: { ...itemData, platform },
      $setOnInsert: { addedAt: new Date() }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

/**
 * Scrape and create an item from a marketplace link
 * @param {string} link - The marketplace URL
 * @param {Object} cachedData - Optional cached data from preview form
 * @returns {Object} - The saved Item document
 */
async function createItem(link, cachedData = null) {
  let itemData;

  // Check if we have cached data from preview
  const hasCachedData = cachedData && (cachedData.title || cachedData.cachedTitle);

  if (hasCachedData) {
    // Use cached data from preview - no need to scrape again
    itemData = normalizeItemData(cachedData);
    logger.debug('Using cached preview data for item creation');
  } else {
    // Scrape fresh data
    if (!isSupported(link)) {
      throw new Error('Unsupported marketplace.');
    }
    const scraped = await scrapeItem(link);
    if (!scraped || !scraped.title) {
      throw new Error('Failed to scrape item data.');
    }
    // Fresh scraper output must go through the same normalizer as cached form
    // data. Scrapers return raw marketplace condition strings ("Used",
    // "Reconditioned") that match no canonical value, and Item.condition is
    // enum-constrained — unnormalized, a fresh add fails validation outright.
    itemData = normalizeItemData(scraped);
    logger.debug('Scraped fresh data for item creation');
  }

  const platform = detectPlatform(link);

  let item;
  try {
    item = await upsertItemByLink(link, itemData, platform);
  } catch (err) {
    // Two concurrent upserts of the same link can race between the lookup and
    // the insert. The recovery is simply to re-run: the second pass finds the
    // now-existing document and updates it.
    if (err.code !== 11000) throw err;
    logger.debug('Upsert raced on duplicate link, retrying:', link);
    item = await upsertItemByLink(link, itemData, platform);
  }

  logger.debug('Upserted item:', item._id);

  return item;
}

module.exports = {
  createItem,
  previewItem,
  normalizeItemData,
  detectPlatform,
  isSupported
};

