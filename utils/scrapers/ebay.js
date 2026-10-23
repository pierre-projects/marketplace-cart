const cheerio = require('cheerio');
const logger = require('../logger');
const { ScrapeError, CODES, asScrapeError } = require('./errors');
const {
  fetchHtml, findProductJsonLd, readOffer, productImages, parsePrice, cleanImages,
  metaReader, metaImages, squash, ldText,
} = require('./structured');

/**
 * eBay Scraper
 *
 * Item pages (/itm/<id>) embed schema.org Product JSON-LD with price,
 * condition, availability and the full image set. The visible markup
 * (x-item-title, x-price-primary) is the fallback.
 */

const ENDED = /This listing (has ended|was ended)|This item is out of stock/i;

function extract(html, url) {
  const $ = cheerio.load(html);
  const meta = metaReader($);
  const product = findProductJsonLd($);
  const offer = readOffer(product);

  const title = ldText(product?.name)
    || squash($('h1.x-item-title__mainTitle, .x-item-title h1').first().text())
    // og:title carries a " | eBay" suffix.
    || meta('og:title').replace(/\s*\|\s*eBay\s*$/i, '');

  const price = offer.price
    ?? parsePrice($('.x-price-primary [itemprop="price"]').attr('content'))
    ?? parsePrice($('.x-price-primary').first().text());

  const condition = offer.conditionRaw
    || squash($('.x-item-condition-text .ux-textspans, .x-item-condition-value .ux-textspans').first().text())
    || null;

  const description = ldText(product?.description)
    || meta('og:description') || null;

  const location = squash($('.ux-labels-values--itemLocation .ux-labels-values__values').first().text())
    .replace(/^Located in:\s*/i, '');

  const pageSaysEnded = ENDED.test(html);
  return {
    title: squash(title),
    price,
    description,
    condition,
    location,
    imageLinks: cleanImages([
      ...productImages(product),
      ...$('.ux-image-carousel-item img').map((i, el) => $(el).attr('data-zoom-src') || $(el).attr('src')).get(),
      ...metaImages($),
    ], url),
    available: offer.available === false ? false : !pageSaysEnded,
  };
}

async function scrape(url) {
  const html = await fetchHtml(url, 'eBay');
  try {
    const item = extract(html, url);
    logger.debug('Scraped eBay Item:', item);
    if (!item.title) throw new ScrapeError(CODES.PARSE_FAILED, 'No title found in eBay listing.');
    return item;
  } catch (err) {
    const scrapeErr = asScrapeError(err);
    logger.error(`eBay parse failed [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  }
}

module.exports = { scrape, _internals: { extract } };
