const { getBrowser, acquireContextSlot } = require('../browser');
const logger = require('../logger');
const { ScrapeError, CODES, asScrapeError } = require('./errors');

const NAVIGATION_TIMEOUT_MS = 25000;

/**
 * Facebook Marketplace Scraper
 *
 * Uses Puppeteer to load the public listing page, dismiss the login modal,
 * and extract listing data from embedded __bbox JSON or OG meta tags.
 * No login or authentication — only publicly visible data.
 *
 * Uses multi-candidate scoring: Facebook splits listing data across multiple
 * __bbox Relay payloads. We extract all candidates, score them, and merge
 * fields from the top matches.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- Utility functions ---

function safeDecode(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\u2019/g, '\u2019')
    .replace(/\\u201c/g, '\u201c')
    .replace(/\\u201d/g, '\u201d');
}

function pick(text, re) {
  const m = text.match(re);
  return m?.[1] ?? null;
}

function normalizePriceRaw(priceRaw) {
  if (!priceRaw) return null;
  const n = parseFloat(String(priceRaw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// --- Multi-candidate extraction ---

// How far either side of the listing's anchor to read its fields. A Marketplace
// listing object serialises well inside this; the related-items rail begins far
// outside it.
const ANCHOR_WINDOW = 6000;

/**
 * Every offset in `text` where this listing identifies itself.
 *
 * Without this the field regexes ran against the whole script and `pick`
 * returned the FIRST match — and a Marketplace page embeds dozens of
 * `listing_price` nodes for the related-items rail. The stored price was
 * therefore whichever listing happened to serialise first, which is how a
 * pressure washer ended up recorded at $0 on a page carrying $20/$30/$350.
 */
function anchorOffsets(text, listingId) {
  const offsets = [];
  for (const needle of [`"id":"${listingId}"`, `/marketplace\\/item\\/${listingId}`, listingId]) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      offsets.push(at);
      from = at + needle.length;
      if (offsets.length > 40) break;   // pathological page; scoring sorts it out
    }
    if (offsets.length) break;          // most specific needle that matched wins
  }
  return offsets;
}

function extractCandidatesFromScripts({ scripts, listingId }) {
  const candidates = [];

  for (const script of scripts) {
    // One candidate per anchor, each read from a window around that anchor,
    // so a candidate always describes THIS listing rather than a neighbour.
    for (const at of anchorOffsets(script, listingId)) {
      const text = script.slice(
        Math.max(0, at - ANCHOR_WINDOW),
        at + ANCHOR_WINDOW
      );

      const title =
        pick(text, /"marketplace_listing_title":"([^"]+)"/) ||
        pick(text, /"base_marketplace_listing_title":"([^"]+)"/);

      const priceRaw =
        pick(text, /"listing_price":\{[^}]*"amount":"([^"]+)"/) ||
        pick(text, /"formatted_amount_zeros_stripped":"([^"]+)"/);

      const location = pick(text, /"location_text":\{"text":"([^"]+)"/);

      const description =
        pick(text, /"redacted_description":\{"text":"([\s\S]*?)"\}/) ||
        pick(text, /"description":\{"text":"([\s\S]*?)"\}/);

      const isLive = pick(text, /"is_live":(true|false)/);
      const isSold = pick(text, /"is_sold":(true|false)/);
      const isPending = pick(text, /"is_pending":(true|false)/);

      const condition = pick(text, /"attribute_name":"Condition"[^}]*"label":"([^"]+)"/);
      const shareUri = pick(text, /"share_uri":"([^"]+)"/);

      // Only keep candidates with at least something useful
      if (!title && !priceRaw && !location && !description && !condition) continue;

      candidates.push({
        title: title ? safeDecode(title) : null,
        priceRaw: priceRaw ? safeDecode(priceRaw) : null,
        // null means "no price node in this listing's window" — distinct from a
        // listing Facebook really prices at $0. Collapsing both to 0 is how a
        // failed extraction became an item confidently labelled free.
        price: normalizePriceRaw(priceRaw),
        location: location ? safeDecode(location) : null,
        description: description ? safeDecode(description) : null,
        condition: condition ? safeDecode(condition) : null,
        isLive: isLive === 'true' ? true : isLive === 'false' ? false : null,
        isSold: isSold === 'true' ? true : isSold === 'false' ? false : null,
        isPending: isPending === 'true' ? true : isPending === 'false' ? false : null,
        shareUri: shareUri ? safeDecode(shareUri) : null,
        _len: text.length,
      });
    }
  }

  return candidates;
}

function scoreCandidate(c, listingId) {
  let s = 0;
  if (!c) return -999;

  // Strongest anchor: share_uri contains this listing's ID
  if (c.shareUri && c.shareUri.includes(listingId)) s += 6;

  // Core fields
  if (c.title) s += 3;
  if (c.price != null) s += 3;
  if (c.location) s += 2;
  if (c.condition) s += 1;

  // Prefer deeper descriptions
  const dlen = c.description?.length ?? 0;
  if (dlen > 120) s += 2;
  else if (dlen > 40) s += 1;

  // Availability sanity
  if (c.isLive === true) s += 2;
  if (c.isSold === true) s -= 6;
  if (c.isPending === true) s -= 3;

  // Candidates are now fixed-size windows around an anchor, so the old
  // "longer payload wins" tiebreak no longer discriminates and was removed.

  return s;
}

function mergeCandidates(primary, others) {
  const out = { ...primary };

  for (const c of others) {
    if (!out.title && c.title) out.title = c.title;
    // Only fill an UNKNOWN price. Treating 0 as fillable would let a
    // neighbouring listing's price overwrite a genuine "$0 / Free".
    if (out.price == null && c.price != null) out.price = c.price;
    if (!out.location && c.location) out.location = c.location;
    if (!out.condition && c.condition) out.condition = c.condition;
    if (!out.description && c.description) out.description = c.description;

    // Prefer longer description if current is short
    if (out.description && c.description && c.description.length > out.description.length + 30) {
      out.description = c.description;
    }

    // Flags: prefer explicit values
    if (out.isLive == null && c.isLive != null) out.isLive = c.isLive;
    if (out.isSold == null && c.isSold != null) out.isSold = c.isSold;
    if (out.isPending == null && c.isPending != null) out.isPending = c.isPending;
    if (!out.shareUri && c.shareUri) out.shareUri = c.shareUri;
  }

  return out;
}

function pickBestCandidate(candidates, listingId) {
  if (!candidates?.length) return null;

  const scored = candidates
    .map(c => ({ c, score: scoreCandidate(c, listingId) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.c;
  if (!best) return null;

  logger.debug(`Facebook: ${scored.length} candidates, top score: ${scored[0].score}`);

  // Merge with other strong candidates (within 4 points)
  const near = scored.filter(x => x.score >= (scored[0].score - 4)).map(x => x.c);
  const merged = mergeCandidates(best, near);

  merged.available = (merged.isLive !== false) && !merged.isSold && !merged.isPending;

  return merged;
}

// --- Main scrape function ---

async function scrape(url) {
  logger.debug('Facebook: Starting scrape for', url);

  // Extract listing ID from URL
  const listingId = url.match(/\/item\/(\d+)/)?.[1] || url.match(/(\d{10,})/)?.[1];
  if (!listingId) {
    throw new ScrapeError(CODES.UNSUPPORTED, 'Could not extract a listing ID from that Facebook URL.');
  }
  logger.debug('Facebook: Listing ID:', listingId);

  // Bounds live Chromium contexts independently of queue concurrency — each
  // context is a real browser profile, not a cheap handle.
  const releaseSlot = await acquireContextSlot();
  let browser;
  let ctx;
  try {
    browser = await getBrowser();
    ctx = await browser.createBrowserContext();
  } catch (err) {
    releaseSlot();
    // A browser that will not start is NOT a network failure. Classifying it as
    // one produced "Check your connection" for a missing Chrome, and — because
    // NETWORK is retryable — three attempts before giving up. asScrapeError
    // passes a real ScrapeError through, so the resolver's actionable message
    // (naming the install command) survives.
    throw asScrapeError(err, CODES.BROWSER_UNAVAILABLE);
  }

  try {
    const page = await ctx.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });

    // Block heavy resources for speed — we only need the HTML/JS
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // domcontentloaded is sufficient — __bbox data is in SSR script tags
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      throw new ScrapeError(CODES.TIMEOUT, undefined, { cause: err });
    }

    // Fire-and-forget modal dismiss — don't block extraction
    page.click('[aria-label="Close"]').catch(() => {});

    // Single evaluate: extract scripts, meta, and images in one IPC call
    // Script caps: max 10 scripts, 300KB each, skip tiny ones
    const pageData = await page.evaluate((lid) => {
      const MAX_SCRIPT_SIZE = 300000;
      const MAX_SCRIPTS = 10;

      const scripts = [];
      for (const s of document.querySelectorAll('script')) {
        const t = s.textContent;
        if (t.length < 200) continue;
        if (!t.includes('__bbox')) continue;
        if (!t.includes(lid)) continue;
        scripts.push(t.slice(0, MAX_SCRIPT_SIZE));
        if (scripts.length >= MAX_SCRIPTS) break;
      }

      // OG meta tags (fallback)
      const getMeta = (prop) => {
        const el = document.querySelector(`meta[property="${prop}"]`);
        return el ? el.getAttribute('content') : null;
      };
      const meta = {
        title: getMeta('og:title'),
        description: getMeta('og:description'),
        image: getMeta('og:image'),
        price: getMeta('product:price:amount'),
      };

      // Listing images
      const images = Array.from(document.querySelectorAll('img[data-visualcompletion="media-vc-image"]'))
        .map(img => img.src)
        .filter(src => src && src.startsWith('https') && !src.includes('emoji'));

      return { scripts, meta, images };
    }, listingId);

    // Multi-candidate extraction, scoring, and merging
    const candidates = extractCandidatesFromScripts({ scripts: pageData.scripts, listingId });
    const best = pickBestCandidate(candidates, listingId);
    const meta = pageData.meta;

    /**
     * Resolve a price without collapsing "free" into "unknown".
     * `||` cannot be used here: a genuine 0 is falsy, so it fell through to the
     * meta tag and then to 0, making both states indistinguishable downstream.
     */
    const resolvePrice = (candidatePrice) => {
      if (candidatePrice != null) return candidatePrice;
      const fromMeta = parseFloat(meta.price);
      return Number.isFinite(fromMeta) ? fromMeta : null;
    };

    // Build result from best candidate or meta fallback
    let result;

    if (best) {
      logger.debug('Facebook: Using __bbox data -', best.title);
      result = {
        title: best.title || meta.title || 'Untitled',
        price: resolvePrice(best.price),
        description: best.description || meta.description || null,
        condition: best.condition || null,
        location: best.location || null,
        available: best.available,
        imageLinks: meta.image ? [meta.image] : []
      };
    } else {
      logger.debug('Facebook: Falling back to OG meta tags only');
      result = {
        title: meta.title || 'Untitled',
        price: resolvePrice(null),
        description: meta.description || null,
        condition: null,
        location: null,
        available: true,
        imageLinks: meta.image ? [meta.image] : []
      };
    }

    if (pageData.images.length > 0) {
      result.imageLinks = pageData.images;
      logger.debug(`Facebook: Found ${pageData.images.length} images`);
    }

    if (!result.title || result.title === 'Untitled') {
      throw new ScrapeError(CODES.PARSE_FAILED, 'Could not extract listing data from Facebook Marketplace.');
    }

    logger.debug('Facebook: Scrape complete -', result.title);
    return result;

  } catch (err) {
    const scrapeErr = asScrapeError(err);
    logger.error(`Facebook scraper error [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  } finally {
    await ctx.close().catch(err => logger.error('Facebook: context close failed:', err.message));
    releaseSlot();
  }
}

module.exports = {
  scrape,
  // Exposed for the harness: the extractor is where mis-attributed fields come
  // from, and it cannot be exercised through scrape() without a live page.
  _internals: {
    anchorOffsets,
    extractCandidatesFromScripts,
    pickBestCandidate,
    scoreCandidate,
    mergeCandidates,
    normalizePriceRaw,
  },
};
