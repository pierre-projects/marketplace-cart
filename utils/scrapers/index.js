const offerupScraper = require('./offerup');
const facebookScraper = require('./facebook');

const scrapers = [
  { pattern: /offerup\.com\/item/, scraper: offerupScraper },
  { pattern: /facebook\.com\/marketplace/, scraper: facebookScraper },
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
  const platform = scrapers.find(s => s.pattern.test(url))?.pattern.source || 'unknown';
  const label = `Scrape [${platform}]`;
  console.time(label);
  const result = await scraper.scrape(url);
  console.timeEnd(label);
  return result;
}

module.exports = { scrapeItem, getScraper, isSupported };
