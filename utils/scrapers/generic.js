const cheerio = require('cheerio');
const logger = require('../logger');
const { safeGet } = require('../safeFetch');
const { normalizeCondition } = require('../conditionMap');
const {
  findProductJsonLd, parsePrice, cleanImages, readOffer, productImages, metaReader, metaImages,
} = require('./structured');

/**
 * Best-effort details for a link from any site, used only to prefill the
 * manual-listing form. It is deliberately not in the scraper registry: nothing
 * it returns is trusted or stored without the user seeing and editing it, and a
 * failure is not an error — the form just starts empty.
 *
 * Reads the metadata most listing sites publish for link previews: OpenGraph,
 * Twitter cards, and schema.org Product JSON-LD.
 */

const PREFILL_TIMEOUT_MS = 8000;
const MAX_IMAGES = 6;

const EMPTY = Object.freeze({
  title: '', price: null, description: '', imageLinks: [], location: '', condition: null,
});

/** Pure extraction from HTML, separated from the fetch so it can be tested. */
function extractPrefill(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = metaReader($);
  const product = findProductJsonLd($);
  const offer = readOffer(product);

  const title = (typeof product?.name === 'string' && product.name)
    || meta('og:title') || meta('twitter:title') || $('title').first().text().trim();

  const price = offer.price
    ?? parsePrice(meta('product:price:amount'))
    ?? parsePrice(meta('og:price:amount'))
    ?? parsePrice($('[itemprop="price"]').first().attr('content'));

  const description = (typeof product?.description === 'string' && product.description)
    || meta('og:description') || meta('twitter:description') || meta('description');

  const rawCondition = offer.conditionRaw || meta('product:condition');

  return {
    title: title.slice(0, 300),
    price,
    description: description.slice(0, 5000),
    imageLinks: cleanImages([...productImages(product), ...metaImages($)], pageUrl, MAX_IMAGES),
    location: '',
    condition: normalizeCondition(rawCondition) || null,
  };
}

/** Never rejects: an unreachable or unreadable page yields an empty prefill. */
async function prefill(url) {
  try {
    const res = await safeGet(url, { timeout: PREFILL_TIMEOUT_MS });
    if (typeof res.data !== 'string') return { ...EMPTY };
    return extractPrefill(res.data, url);
  } catch (err) {
    logger.debug(`Prefill failed for ${url}: ${err.code || ''} ${err.message}`);
    return { ...EMPTY };
  }
}

module.exports = { prefill, extractPrefill };
