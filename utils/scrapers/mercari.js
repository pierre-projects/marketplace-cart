const logger = require('../logger');
const { ScrapeError, CODES, asScrapeError } = require('./errors');
const { renderPage } = require('./browser');
const { collectPageMetadata, fromPageMetadata } = require('./structured');

/**
 * Mercari Scraper
 *
 * Item pages are rendered client-side behind Cloudflare, so a plain GET gets a
 * shell or a challenge. Puppeteer loads the page; the listing is then read
 * from the Product JSON-LD and meta tags the app injects for sharing.
 */

const PAGE_OPTIONS = {
  soldSelectors: ['[data-testid="ItemSoldBanner"]', '[data-testid="SoldOutBanner"]'],
  soldText: ['This item is sold', 'This item has been sold'],
};

// JSON-LD images carry width=200&height=200; without them the CDN serves full size.
function fullSize(src) {
  // Edit the query by hand: URLSearchParams would rewrite the bare cache-buster
  // "?1792713096" as "?1792713096=".
  const [base, query] = String(src).split('?');
  if (query === undefined) return src;
  const kept = query.split('&').filter(part => !/^(width|height)=/.test(part));
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

function extract(pageData, url) {
  const item = fromPageMetadata(pageData, url, { titleSuffix: /\s*\|\s*Mercari.*$/i });
  item.imageLinks = [...new Set(item.imageLinks.map(fullSize))];
  return item;
}

async function scrape(url) {
  try {
    const pageData = await renderPage(url, collectPageMetadata, PAGE_OPTIONS, {
      waitFor: 'script[type="application/ld+json"]',
    });
    const item = extract(pageData, url);
    logger.debug('Scraped Mercari Item:', item);
    // A Cloudflare challenge that never cleared renders as its own "listing".
    if (/^Just a moment/i.test(item.title)) throw new ScrapeError(CODES.BLOCKED);
    if (!item.title) throw new ScrapeError(CODES.PARSE_FAILED, 'No title found in Mercari listing.');
    return item;
  } catch (err) {
    const scrapeErr = asScrapeError(err);
    logger.error(`Mercari scrape failed [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  }
}

module.exports = { scrape, _internals: { extract } };
