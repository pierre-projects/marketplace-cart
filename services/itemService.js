const Item = require('../models/Items');
const { scrapeItem, isSupported } = require('../utils/scrapers');
const logger = require('../utils/logger');

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
    condition: data.condition || data.cachedCondition || null,
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
    throw new Error('Unsupported marketplace. Currently only OfferUp is supported.');
  }
  const data = await scrapeItem(link);
  if (!data || !data.title) {
    throw new Error('Could not scrape item data.');
  }
  return data;
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
      throw new Error('Unsupported marketplace. Currently only OfferUp is supported.');
    }
    itemData = await scrapeItem(link);
    if (!itemData || !itemData.title) {
      throw new Error('Failed to scrape item data.');
    }
    logger.debug('Scraped fresh data for item creation');
  }

  const platform = detectPlatform(link);

  const newItem = new Item({
    ...itemData,
    link,
    platform,
  });

  await newItem.save();
  logger.debug('Created item:', newItem._id);

  return newItem;
}

module.exports = {
  createItem,
  previewItem,
  normalizeItemData,
  detectPlatform,
  isSupported
};
