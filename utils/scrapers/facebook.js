const { getBrowser } = require('../browser');
const logger = require('../logger');

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

function extractCandidatesFromScripts({ scripts, listingId }) {
  const candidates = [];

  const idNeedle1 = `"id":"${listingId}"`;
  const idNeedle2 = `"share_uri":"https:\\/\\/www.facebook.com\\/marketplace\\/item\\/${listingId}\\/`;

  for (const text of scripts) {
    // Only process scripts that reference this listing
    if (!text.includes(idNeedle1) && !text.includes(idNeedle2) && !text.includes(listingId)) continue;

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

  // Longer payloads often include more fields
  if (c._len > 200000) s += 1;

  return s;
}

function mergeCandidates(primary, others) {
  const out = { ...primary };

  for (const c of others) {
    if (!out.title && c.title) out.title = c.title;
    if ((out.price == null || out.price === 0) && c.price != null) out.price = c.price;
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
    throw new Error('Could not extract listing ID from Facebook URL');
  }
  logger.debug('Facebook: Listing ID:', listingId);

  const browser = await getBrowser();
  const ctx = await browser.createBrowserContext();

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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

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

    // Build result from best candidate or meta fallback
    let result;

    if (best) {
      logger.debug('Facebook: Using __bbox data -', best.title);
      result = {
        title: best.title || meta.title || 'Untitled',
        price: best.price || parseFloat(meta.price) || 0,
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
        price: parseFloat(meta.price) || 0,
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
      throw new Error('Could not extract listing data from Facebook Marketplace');
    }

    logger.debug('Facebook: Scrape complete -', result.title);
    return result;

  } catch (err) {
    logger.error('Facebook scraper error:', err.message);
    throw new Error('Failed to scrape Facebook Marketplace listing: ' + err.message);
  } finally {
    await ctx.close();
  }
}

module.exports = { scrape };
