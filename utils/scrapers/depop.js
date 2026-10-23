const logger = require('../logger');
const { ScrapeError, CODES, asScrapeError } = require('./errors');
const { renderPage } = require('./browser');
const { collectPageMetadata, fromPageMetadata } = require('./structured');

/**
 * Depop Scraper
 *
 * Product pages (/products/<slug>) are a client-rendered app behind
 * Cloudflare. Puppeteer loads them and the listing is read from the injected
 * Product JSON-LD and meta tags.
 */

const PAGE_OPTIONS = {
  soldSelectors: ['[data-testid="product__sold"]', '[data-testid="soldBadge"]'],
  soldText: ['This item is sold', 'This item has sold'],
};

function extract(pageData, url) {
  return fromPageMetadata(pageData, url, { titleSuffix: /\s*\|\s*Depop.*$/i });
}

async function scrape(url) {
  try {
    const pageData = await renderPage(url, collectPageMetadata, PAGE_OPTIONS, {
      waitFor: 'script[type="application/ld+json"]',
    });
    const item = extract(pageData, url);
    logger.debug('Scraped Depop Item:', item);
    // A Cloudflare challenge that never cleared renders as its own "listing".
    if (/^Just a moment/i.test(item.title)) throw new ScrapeError(CODES.BLOCKED);
    if (!item.title) throw new ScrapeError(CODES.PARSE_FAILED, 'No title found in Depop listing.');
    return item;
  } catch (err) {
    const scrapeErr = asScrapeError(err);
    logger.error(`Depop scrape failed [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  }
}

module.exports = { scrape, _internals: { extract } };
