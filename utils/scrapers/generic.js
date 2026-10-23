const cheerio = require('cheerio');
const logger = require('../logger');
const { safeGet } = require('../safeFetch');
const { normalizeCondition } = require('../conditionMap');

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

function findProductJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    let data;
    try {
      data = JSON.parse($(scripts[i]).contents().text());
    } catch (err) {
      continue;
    }
    const nodes = Array.isArray(data) ? data : (Array.isArray(data?.['@graph']) ? data['@graph'] : [data]);
    for (const node of nodes) {
      const types = [].concat(node?.['@type'] || []);
      if (types.includes('Product') || types.includes('Offer')) return node;
    }
  }
  return null;
}

function parsePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Only absolute http(s) image URLs, resolved against the page. */
function cleanImages(urls, base) {
  const out = [];
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const u = new URL(String(raw).trim(), base);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !out.includes(u.href)) out.push(u.href);
    } catch (err) { /* skip unparseable */ }
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

/** Pure extraction from HTML, separated from the fetch so it can be tested. */
function extractPrefill(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = (key) => $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content')?.trim() || '';
  const product = findProductJsonLd($);
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;

  const title = (typeof product?.name === 'string' && product.name)
    || meta('og:title') || meta('twitter:title') || $('title').first().text().trim();

  const price = parsePrice(offer?.price ?? offer?.lowPrice)
    ?? parsePrice(meta('product:price:amount'))
    ?? parsePrice(meta('og:price:amount'))
    ?? parsePrice($('[itemprop="price"]').first().attr('content'));

  const description = (typeof product?.description === 'string' && product.description)
    || meta('og:description') || meta('twitter:description') || meta('description');

  const productImages = [].concat(product?.image || []).map(img => (typeof img === 'string' ? img : img?.url));
  const ogImages = $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"]')
    .map((i, el) => $(el).attr('content')).get();

  const rawCondition = typeof offer?.itemCondition === 'string'
    ? offer.itemCondition.split('/').pop().replace(/Condition$/, '')
    : meta('product:condition');

  return {
    title: title.slice(0, 300),
    price,
    description: description.slice(0, 5000),
    imageLinks: cleanImages([...productImages, ...ogImages], pageUrl),
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
