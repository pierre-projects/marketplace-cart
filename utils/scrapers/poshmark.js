const cheerio = require('cheerio');
const logger = require('../logger');
const { ScrapeError, CODES, asScrapeError } = require('./errors');
const {
  fetchHtml, findProductJsonLd, readOffer, productImages, parsePrice, cleanImages,
  metaReader, metaImages, squash, ldText,
} = require('./structured');

/**
 * Poshmark Scraper
 *
 * Listing pages are server-rendered with schema.org Product JSON-LD. Sold
 * listings stay up with a SoldOut availability and a "Sold" badge.
 */

// Only the listing's own badge: the word "Sold" also appears in site navigation.
const SOLD = /class="[^"]*(sold-tag|not-for-sale-tag)/i;

function extract(html, url) {
  const $ = cheerio.load(html);
  const meta = metaReader($);
  const product = findProductJsonLd($);
  const offer = readOffer(product);

  const title = ldText(product?.name)
    || squash($('h1.listing__title-container, h1').first().text())
    || meta('og:title');

  const price = offer.price
    ?? parsePrice(meta('product:price:amount'))
    ?? parsePrice($('[data-test="listing-price"], .listing__price').first().text());

  const description = ldText(product?.description)
    || squash($('.listing__description').first().text())
    || meta('og:description') || null;

  // Poshmark's own wording ("NWT", "Like new") lands in a tag next to the brand.
  const condition = offer.conditionRaw
    || squash($('.condition-tag, [data-et-name="condition"]').first().text())
    || null;

  return {
    title: squash(title),
    price,
    description,
    condition,
    location: '',
    imageLinks: cleanImages([
      ...productImages(product),
      ...$('.slideshow img, .carousel img').map((i, el) => $(el).attr('data-src') || $(el).attr('src')).get(),
      ...metaImages($),
    ], url),
    available: offer.available === false ? false : !SOLD.test(html),
  };
}

async function scrape(url) {
  const html = await fetchHtml(url, 'Poshmark');
  try {
    const item = extract(html, url);
    logger.debug('Scraped Poshmark Item:', item);
    if (!item.title) throw new ScrapeError(CODES.PARSE_FAILED, 'No title found in Poshmark listing.');
    return item;
  } catch (err) {
    const scrapeErr = asScrapeError(err);
    logger.error(`Poshmark parse failed [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  }
}

module.exports = { scrape, _internals: { extract } };
