const offerupScraper = require('./offerup');

const scrapers = [
  { pattern: /offerup\.com\/item/, scraper: offerupScraper },
  // Future scrapers:
  // { pattern: /ebay\.com\/itm/, scraper: require('./ebay') },
  // { pattern: /mercari\.com\//, scraper: require('./mercari') },
];

function getScraper(url) {
  const match = scrapers.find(s => s.pattern.test(url));
  return match ? match.scraper : null;
}

function isSupported(url) {
  return scrapers.some(s => s.pattern.test(url));
}

async function scrapeItem(url) {
  const scraper = getScraper(url);
  if (!scraper) {
    throw new Error('Unsupported marketplace');
  }
  return scraper.scrape(url);
}

module.exports = { scrapeItem, getScraper, isSupported };
