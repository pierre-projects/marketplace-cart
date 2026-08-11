const logger = require('../logger');
const { ScrapeError, CODES } = require('./errors');
const offerupScraper = require('./offerup');
const facebookScraper = require('./facebook');

// Single source of truth for which marketplaces are supported and what they
// are called. detectPlatform used to keep its own list, which claimed eBay and
// Mercari support that no scraper here could deliver.
const scrapers = [
  { pattern: /offerup\.com\/item/, platform: 'OfferUp', scraper: offerupScraper },
  { pattern: /facebook\.com\/marketplace/, platform: 'Facebook Marketplace', scraper: facebookScraper },
  // Future scrapers: add the entry here and detectPlatform picks it up too.
  // { pattern: /ebay\.com\/itm/, platform: 'eBay', scraper: require('./ebay') },
  // { pattern: /mercari\.com\//, platform: 'Mercari', scraper: require('./mercari') },
];

function findEntry(url) {
  return scrapers.find(s => s.pattern.test(url)) || null;
}

function getScraper(url) {
  return findEntry(url)?.scraper || null;
}

function isSupported(url) {
  return findEntry(url) !== null;
}

/** Display name for a link, derived from the same registry that scrapes it. */
function detectPlatform(url) {
  return findEntry(url)?.platform || 'Unknown';
}

async function scrapeItem(url) {
  const entry = findEntry(url);
  if (!entry) {
    throw new ScrapeError(CODES.UNSUPPORTED);
  }

  // console.time derived its label from the regex source, so concurrent scrapes
  // of the same platform collided on the label and Node warned.
  const started = Date.now();
  try {
    return await entry.scraper.scrape(url);
  } finally {
    logger.debug(`Scrape [${entry.platform}] took ${Date.now() - started}ms`);
  }
}

module.exports = { scrapeItem, getScraper, isSupported, detectPlatform };
