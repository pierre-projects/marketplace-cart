const logger = require('../logger');
const { safeGet } = require('../safeFetch');
const { ScrapeError, CODES, classifyAxiosError } = require('./errors');

/**
 * Shared pieces for scrapers that read the metadata a listing page publishes
 * for link previews and search engines: schema.org Product JSON-LD, OpenGraph
 * and Twitter cards. Pure helpers here take a cheerio root; fetchHtml is the
 * one network call.
 */

const REQUEST_TIMEOUT_MS = 15000;
// eBay item pages run past safeFetch's 2MB default.
const MAX_HTML_BYTES = 6 * 1024 * 1024;

// Bot walls answer 200 with a challenge page. Read as a listing, that page has
// no title and surfaces as PARSE_FAILED ("markup changed"), which is wrong and
// sends whoever debugs it to the extractor.
const CHALLENGE_MARKERS = [
  'Pardon Our Interruption',          // eBay / Akamai
  'Just a moment...',                 // Cloudflare
  'cf-browser-verification',
  'Attention Required! | Cloudflare',
  'px-captcha',                       // PerimeterX
];

function looksLikeChallenge(html) {
  return typeof html === 'string' && CHALLENGE_MARKERS.some(m => html.includes(m));
}

/** GET a listing page as HTML, throwing a classified ScrapeError on failure. */
async function fetchHtml(url, platform) {
  let html;
  try {
    ({ data: html } = await safeGet(url, { timeout: REQUEST_TIMEOUT_MS, maxBytes: MAX_HTML_BYTES }));
  } catch (err) {
    const scrapeErr = classifyAxiosError(err);
    logger.error(`${platform} fetch failed [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  }
  if (typeof html !== 'string') {
    throw new ScrapeError(CODES.PARSE_FAILED, `${platform} did not return an HTML page.`);
  }
  if (looksLikeChallenge(html)) {
    logger.error(`${platform} fetch failed [BLOCKED]: challenge page`);
    throw new ScrapeError(CODES.BLOCKED);
  }
  return html;
}

function hasType(node, ...wanted) {
  return [].concat(node?.['@type'] || []).some(t => wanted.includes(t));
}

/** Product nodes from one parsed JSON-LD value: a node, an array, or an @graph. */
function productNodes(data) {
  const nodes = Array.isArray(data) ? data : (Array.isArray(data?.['@graph']) ? data['@graph'] : [data]);
  const out = [];
  for (const node of nodes) {
    if (hasType(node, 'Product', 'Offer', 'IndividualProduct')) out.push(node);
    // ProductGroup (eBay variations) carries the shared name and images.
    else if (hasType(node, 'ProductGroup') && Array.isArray(node.hasVariant)) out.push({ ...node.hasVariant[0], ...node, offers: node.hasVariant[0]?.offers });
  }
  return out;
}

/** First schema.org Product (or Offer) node, from JSON-LD script texts. */
function findProductInJsonLdTexts(texts) {
  for (const text of texts) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      continue;
    }
    const found = productNodes(data)[0];
    if (found) return found;
  }
  return null;
}

/** First schema.org Product (or Offer) node on the page, or null. */
function findProductJsonLd($) {
  const texts = $('script[type="application/ld+json"]').map((i, el) => $(el).contents().text()).get();
  return findProductInJsonLdTexts(texts);
}

/** A number, or null when there is no readable price. Never collapses to 0. */
function parsePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(String(raw).replace(/,/g, '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Only absolute http(s) image URLs, resolved against the page, de-duplicated. */
function cleanImages(urls, base, max = 12) {
  const out = [];
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const u = new URL(String(raw).trim(), base);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !out.includes(u.href)) out.push(u.href);
    } catch (err) { /* skip unparseable */ }
    if (out.length >= max) break;
  }
  return out;
}

const UNAVAILABLE = /(OutOfStock|SoldOut|Discontinued)$/i;

/**
 * The parts of a Product's offer every scraper wants. `available` is null when
 * the offer does not say, so a caller can fall back to page text.
 */
function readOffer(product) {
  if (!product) return { price: null, conditionRaw: null, available: null };
  // An Offer node stands for itself; a Product carries one or more under offers.
  const offer = hasType(product, 'Offer')
    ? product
    : (Array.isArray(product.offers) ? product.offers[0] : product.offers);
  const condition = offer?.itemCondition ?? product.itemCondition;
  const availability = typeof offer?.availability === 'string' ? offer.availability : null;
  return {
    price: parsePrice(offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price),
    conditionRaw: typeof condition === 'string'
      ? condition.split('/').pop().replace(/Condition$/, '')
      : null,
    available: availability ? !UNAVAILABLE.test(availability) : null,
  };
}

/** Image URLs from a Product node (strings or ImageObjects). */
function productImages(product) {
  return [].concat(product?.image || []).map(img => (typeof img === 'string' ? img : img?.url || img?.contentUrl));
}

/** Reader for <meta property|name="…"> values; '' when absent. */
function metaReader($) {
  return (key) => $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content')?.trim() || '';
}

/** og:image and twitter:image values, in page order. */
function metaImages($) {
  return $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"]')
    .map((i, el) => $(el).attr('content')).get();
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode HTML entities. Some sites HTML-escape the strings inside their JSON-LD. */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** A string field from JSON-LD, entity-decoded; '' for anything else. */
function ldText(value) {
  return typeof value === 'string' ? decodeEntities(value).trim() : '';
}

/** Collapse runs of whitespace that HTML indentation leaves inside text. */
function squash(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Runs INSIDE the page (via renderPage), so it must be self-contained: no
 * closures, no requires. Returns the raw material the pure helpers above read.
 * `soldSelectors` are site-specific markers of a sold or removed listing.
 */
function collectPageMetadata({ soldSelectors = [], soldText = [] } = {}) {
  const meta = {};
  for (const el of document.querySelectorAll('meta[property], meta[name]')) {
    const key = el.getAttribute('property') || el.getAttribute('name');
    if (key && !(key in meta)) meta[key] = el.getAttribute('content') || '';
  }
  const bodyText = document.body ? document.body.innerText.slice(0, 20000) : '';
  return {
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent),
    meta,
    // The first h1 can be a cookie banner's ("Privacy settings"); prefer main's.
    h1: ((document.querySelector('main h1') || document.querySelector('h1'))?.textContent || '').trim(),
    sold: soldSelectors.some(sel => document.querySelector(sel))
      || soldText.some(t => bodyText.includes(t)),
  };
}

/** Item fields from collectPageMetadata's result. */
function fromPageMetadata(data, url, { titleSuffix } = {}) {
  const meta = (key) => (data?.meta?.[key] || '').trim();
  const product = findProductInJsonLdTexts(data?.jsonLd || []);
  const offer = readOffer(product);
  let name = ldText(product?.name);
  // Depop derives `name` from the description and cuts it off with "...";
  // the page heading is the real title then.
  if (/(\.\.\.|…)\s*$/.test(name) && data?.h1) name = data.h1;
  let title = name || data?.h1 || meta('og:title');
  if (titleSuffix) title = title.replace(titleSuffix, '');
  return {
    title: squash(title),
    price: offer.price ?? parsePrice(meta('product:price:amount')) ?? parsePrice(meta('og:price:amount')),
    description: ldText(product?.description) || meta('og:description') || meta('description') || null,
    condition: offer.conditionRaw || null,
    location: '',
    imageLinks: cleanImages([...productImages(product), meta('og:image'), meta('twitter:image')], url),
    available: offer.available === false ? false : !data?.sold,
  };
}

module.exports = {
  fetchHtml,
  looksLikeChallenge,
  findProductJsonLd,
  findProductInJsonLdTexts,
  parsePrice,
  cleanImages,
  readOffer,
  productImages,
  metaReader,
  metaImages,
  squash,
  ldText,
  collectPageMetadata,
  fromPageMetadata,
};
