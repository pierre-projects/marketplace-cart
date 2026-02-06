const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../logger');

// ========== EXTRACTION HELPERS ==========

/**
 * Try to extract JSON-LD structured data
 */
function extractJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const data = JSON.parse($(scripts[i]).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'Offer') {
          return item;
        }
      }
    } catch (e) { /* ignore parse errors */ }
  }
  return null;
}

/**
 * Extract from Open Graph meta tags
 */
function extractMetaTags($) {
  return {
    title: $('meta[property="og:title"]').attr('content'),
    description: $('meta[property="og:description"]').attr('content'),
    image: $('meta[property="og:image"]').attr('content'),
    price: $('meta[property="product:price:amount"]').attr('content'),
    condition: $('meta[property="product:condition"]').attr('content'),
  };
}

/**
 * Parse price string to number
 */
function parsePrice(text) {
  if (!text) return 0;
  const num = parseFloat(String(text).replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * Extract price with multiple fallbacks
 */
function extractPrice($, html, jsonLd, meta) {
  // 1. JSON-LD
  if (jsonLd?.offers?.price) {
    logger.debug('Price source: JSON-LD');
    return parsePrice(jsonLd.offers.price);
  }

  // 2. Meta tag
  if (meta?.price) {
    logger.debug('Price source: meta tag');
    return parsePrice(meta.price);
  }

  // 3. Data attribute
  const dataPrice = $('[data-testid="price"], [data-qa="price"]').first().text();
  if (dataPrice) {
    logger.debug('Price source: data attribute');
    return parsePrice(dataPrice);
  }

  // 4. MUI class (current approach)
  const muiPrice = $('p.MuiTypography-h4').first().text();
  if (muiPrice) {
    logger.debug('Price source: MUI class');
    return parsePrice(muiPrice);
  }

  // 5. Regex - find first $XXX pattern
  const match = html.match(/\$[\d,]+(?:\.\d{2})?/);
  if (match) {
    logger.debug('Price source: regex pattern');
    return parsePrice(match[0]);
  }

  logger.debug('Price source: none found');
  return 0;
}

/**
 * Extract title with fallbacks
 */
function extractTitle($, jsonLd, meta) {
  if (jsonLd?.name) {
    logger.debug('Title source: JSON-LD');
    return jsonLd.name;
  }

  if (meta?.title) {
    logger.debug('Title source: meta tag');
    // og:title often has " - OfferUp" suffix
    return meta.title.split(' - ')[0].trim();
  }

  const dataTitle = $('[data-testid="listing-title"]').text().trim();
  if (dataTitle) {
    logger.debug('Title source: data attribute');
    return dataTitle;
  }

  const h1Title = $('h1').first().text().trim();
  if (h1Title) {
    logger.debug('Title source: h1 element');
    return h1Title;
  }

  logger.debug('Title source: none found');
  return '';
}

/**
 * Extract description with fallbacks
 */
function extractDescription($, jsonLd, meta) {
  if (jsonLd?.description) {
    logger.debug('Description source: JSON-LD');
    return jsonLd.description;
  }

  if (meta?.description) {
    logger.debug('Description source: meta tag');
    return meta.description;
  }

  // Try structured approach - look for "Description" heading
  const descHeading = $('h2').filter((i, el) =>
    $(el).text().trim().toLowerCase() === 'description'
  ).first();

  if (descHeading.length) {
    const desc = descHeading.parent().next().find('p').first().text().trim();
    if (desc) {
      logger.debug('Description source: h2 heading structure');
      return desc;
    }
  }

  // Current MUI approach
  const muiDesc = $('h2.MuiTypography-h5')
    .filter((i, el) => $(el).text().trim() === 'Description')
    .parent().next().find('p.MuiTypography-body1').first()
    .text().replace(/\s*\n\s*/g, ' ').trim();

  if (muiDesc) {
    logger.debug('Description source: MUI class');
    return muiDesc;
  }

  logger.debug('Description source: none found');
  return null;
}

/**
 * Extract images with fallbacks
 */
function extractImages($, jsonLd, meta) {
  const images = [];

  // 1. JSON-LD images
  if (jsonLd?.image) {
    const ldImages = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
    images.push(...ldImages);
    logger.debug('Images source: JSON-LD (' + ldImages.length + ' images)');
  }

  // 2. Meta image
  if (meta?.image && !images.includes(meta.image)) {
    images.push(meta.image);
    if (images.length === 1) {
      logger.debug('Images source: meta tag');
    }
  }

  // 3. Scrape img tags (current approach)
  if (images.length === 0) {
    const allImages = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('offerup.com')) {
        allImages.push(src);
      }
    });

    if (allImages.length === 1) {
      images.push(allImages[0]);
    } else if (allImages.length > 1) {
      // Skip first (often profile pic)
      images.push(...allImages.slice(1));
    }

    if (images.length > 0) {
      logger.debug('Images source: img scraping (' + images.length + ' images)');
    }
  }

  if (images.length === 0) {
    logger.debug('Images source: none found');
  }

  return images;
}

/**
 * Extract condition with fallbacks
 */
function extractCondition($, jsonLd, meta) {
  // 1. JSON-LD itemCondition (e.g., "https://schema.org/UsedCondition" → "Used")
  if (jsonLd?.offers?.itemCondition) {
    const schemaCondition = jsonLd.offers.itemCondition;
    const match = schemaCondition.match(/\/(\w+)Condition$/);
    if (match) {
      logger.debug('Condition source: JSON-LD');
      return match[1];  // "Used", "New", etc.
    }
  }

  // 2. Meta tag product:condition
  if (meta?.condition) {
    logger.debug('Condition source: meta tag');
    return meta.condition.charAt(0).toUpperCase() + meta.condition.slice(1).toLowerCase();
  }

  // 3. MUI class (last resort)
  const muiCondition = $('p.MuiTypography-body1')
    .filter((i, el) => $(el).text().includes('Condition:'))
    .first().text().replace('Condition: ', '').trim();

  if (muiCondition) {
    logger.debug('Condition source: MUI class');
    return muiCondition;
  }

  logger.debug('Condition source: none found');
  return null;
}

/**
 * Extract location (MUI-specific, no good fallback for this)
 */
function extractLocation($) {
  return $('span.MuiTypography-body1')
    .filter((i, el) => $(el).text().trim().match(/^in /))
    .first().text().replace(/^in /, '').trim() || '';
}

// ========== MAIN SCRAPER ==========

async function scrape(url) {
  try {
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const $ = cheerio.load(html);

    // Try structured data sources first
    const jsonLd = extractJsonLd($);
    const meta = extractMetaTags($);

    logger.debug('=== OfferUp Scraper ===');
    logger.debug('JSON-LD found:', !!jsonLd);
    logger.debug('Meta tags:', {
      hasTitle: !!meta?.title,
      hasDesc: !!meta?.description,
      hasImage: !!meta?.image,
      hasPrice: !!meta?.price
    });

    // Build item with fallback chain
    const item = {
      title: extractTitle($, jsonLd, meta),
      price: extractPrice($, html, jsonLd, meta),
      description: extractDescription($, jsonLd, meta),
      condition: extractCondition($, jsonLd, meta),
      location: extractLocation($),
      imageLinks: extractImages($, jsonLd, meta),
      available: !html.includes('This item is no longer available'),
    };

    logger.debug('=== Scrape Result ===');
    logger.debug('Scraped OfferUp Item:', item);

    return item;
  } catch (err) {
    logger.error('OfferUp scraping error:', err.message);
    return null;
  }
}

module.exports = { scrape };
