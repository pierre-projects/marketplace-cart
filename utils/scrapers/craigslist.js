const cheerio = require('cheerio');
const logger = require('../logger');
const { ScrapeError, CODES, asScrapeError } = require('./errors');
const { fetchHtml, parsePrice, cleanImages, metaReader, metaImages, squash } = require('./structured');

/**
 * Craigslist Scraper
 *
 * Postings are server-rendered and publish no Product JSON-LD, but the markup
 * has been stable for years: #titletextonly, .price, #postingbody, and an
 * .attrgroup of "label: value" spans.
 */

// Craigslist keeps the page up after removal and swaps the body for a notice.
const REMOVED = /This posting has (been deleted|expired|been flagged for removal)/i;

function readAttr($, label) {
  const want = `${label.toLowerCase()}:`;
  let value = null;
  $('.attrgroup span, .attrgroup .attr').each((i, el) => {
    const text = squash($(el).text()).toLowerCase();
    if (text.startsWith(want)) {
      value = squash($(el).text()).slice(want.length).trim();
      return false;
    }
    return undefined;
  });
  return value;
}

function extract(html, url) {
  const $ = cheerio.load(html);
  const meta = metaReader($);

  const title = squash($('#titletextonly').first().text()) || meta('og:title');

  const body = $('#postingbody').first().clone();
  body.find('.print-information, .print-qrcode-container').remove();
  const description = squash(body.text().replace(/QR Code Link to This Post/i, '')) || meta('og:description') || null;

  // Thumbnails link to the full-size image; the gallery holds the first one.
  const images = cleanImages([
    ...$('#thumbs a').map((i, el) => $(el).attr('href')).get(),
    ...$('.gallery img, .swipe img').map((i, el) => $(el).attr('src')).get(),
    ...metaImages($),
  ], url);

  const location = squash($('.postingtitletext small').first().text()).replace(/^\((.*)\)$/, '$1')
    || meta('geo.placename');

  return {
    title,
    price: parsePrice($('.postingtitletext .price, .price').first().text()),
    description,
    condition: readAttr($, 'condition'),
    location,
    imageLinks: images,
    available: !REMOVED.test(html),
  };
}

async function scrape(url) {
  const html = await fetchHtml(url, 'Craigslist');
  try {
    const item = extract(html, url);
    logger.debug('Scraped Craigslist Item:', item);
    if (!item.title) {
      if (!item.available) throw new ScrapeError(CODES.NOT_FOUND);
      throw new ScrapeError(CODES.PARSE_FAILED, 'No title found in Craigslist posting.');
    }
    return item;
  } catch (err) {
    const scrapeErr = asScrapeError(err);
    logger.error(`Craigslist parse failed [${scrapeErr.code}]:`, err.message);
    throw scrapeErr;
  }
}

module.exports = { scrape, _internals: { extract } };
