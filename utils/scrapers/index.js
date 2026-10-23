const logger = require('../logger');
const { ScrapeError, CODES } = require('./errors');
const offerupScraper = require('./offerup');
const facebookScraper = require('./facebook');
const craigslistScraper = require('./craigslist');
const ebayScraper = require('./ebay');
const poshmarkScraper = require('./poshmark');
const mercariScraper = require('./mercari');
const depopScraper = require('./depop');

// Single source of truth for which marketplaces are scraped and what they are
// called. A URL matches on its parsed hostname (exactly, or a subdomain of it)
// and then its path. These used to be unanchored regexes tested against the
// whole string, so `http://169.254.169.254/?facebook.com/marketplace/` counted
// as Facebook and the server fetched it.
const scrapers = [
  { hosts: ['offerup.com'], path: /^\/item\//, platform: 'OfferUp', scraper: offerupScraper },
  { hosts: ['facebook.com'], path: /^\/marketplace\//, platform: 'Facebook Marketplace', scraper: facebookScraper },
  // Postings only, in both URL shapes: the regional /<area>/<cat>/d/<slug>/<id>.html
  // and the newer www.craigslist.org/view/d/<slug>/<token>. Search pages don't match.
  { hosts: ['craigslist.org'], path: /^\/view\/d\/[^/]+\/[^/]+\/?$|\/\d+\.html$/, platform: 'Craigslist', scraper: craigslistScraper },
  { hosts: ['ebay.com', 'ebay.ca', 'ebay.co.uk'], path: /^\/itm\//, platform: 'eBay', scraper: ebayScraper },
  { hosts: ['poshmark.com', 'poshmark.ca'], path: /^\/listing\//, platform: 'Poshmark', scraper: poshmarkScraper },
  { hosts: ['mercari.com'], path: /^\/(us\/)?item\//, platform: 'Mercari', scraper: mercariScraper },
  { hosts: ['depop.com'], path: /^\/products\//, platform: 'Depop', scraper: depopScraper },
  // Future scrapers: add the entry here and detectPlatform picks it up too.
];

// Display names for sites that are saved manually rather than scraped, so the
// marketplace breakdown reads "eBay" instead of "www.ebay.com".
const KNOWN_SITES = [
  [['ebay.com', 'ebay.ca', 'ebay.co.uk'], 'eBay'],
  [['craigslist.org'], 'Craigslist'],
  [['mercari.com'], 'Mercari'],
  [['poshmark.com', 'poshmark.ca'], 'Poshmark'],
  [['depop.com'], 'Depop'],
  [['etsy.com'], 'Etsy'],
  [['amazon.com', 'amazon.ca', 'amazon.co.uk'], 'Amazon'],
  [['nextdoor.com'], 'Nextdoor'],
  [['kijiji.ca'], 'Kijiji'],
  [['vinted.com', 'vinted.co.uk'], 'Vinted'],
  [['walmart.com'], 'Walmart'],
  [['ikea.com'], 'IKEA'],
  [['wayfair.com'], 'Wayfair'],
  [['offerup.com'], 'OfferUp'],
  [['facebook.com'], 'Facebook Marketplace'],
];

/** A parsed http(s) URL, or null. Credentials in the URL are refused. */
function parseListingUrl(raw) {
  if (typeof raw !== 'string' && !(raw instanceof URL)) return null;
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch (err) {
    return null;
  }
}

function hostMatches(hostname, host) {
  const h = hostname.toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}

function findEntry(raw) {
  const url = parseListingUrl(raw);
  if (!url) return null;
  return scrapers.find(s => s.hosts.some(h => hostMatches(url.hostname, h)) && s.path.test(url.pathname)) || null;
}

function isSupported(url) {
  return findEntry(url) !== null;
}

/**
 * Display name for a link: the scraper's name when there is one, else a known
 * site name, else the bare hostname. 'Unknown' only when there is no usable URL.
 */
function detectPlatform(raw) {
  const entry = findEntry(raw);
  if (entry) return entry.platform;

  const url = parseListingUrl(raw);
  if (!url) return 'Unknown';
  const known = KNOWN_SITES.find(([hosts]) => hosts.some(h => hostMatches(url.hostname, h)));
  return known ? known[1] : url.hostname.replace(/^www\./, '');
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

module.exports = { scrapeItem, isSupported, detectPlatform, parseListingUrl };
