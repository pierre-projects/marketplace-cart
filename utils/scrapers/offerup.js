const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../logger');

async function scrape(url) {
  try {
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim();

    const priceText = $('p.MuiTypography-h4').first().text().trim();
    const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

    const description = $('h2.MuiTypography-h5')
      .filter((i, el) => $(el).text().trim() === 'Description')
      .parent()
      .next()
      .find('p.MuiTypography-body1')
      .first()
      .text()
      .replace(/\s*\n\s*/g, ' ')
      .trim() || null;

    const conditionText = $('p.MuiTypography-body1')
      .filter((i, el) => $(el).text().includes('Condition:'))
      .first()
      .text()
      .replace('Condition: ', '')
      .trim();

    const location = $('span.MuiTypography-body1')
      .filter((i, el) => $(el).text().trim().match(/^in /))
      .first()
      .text()
      .replace(/^in /, '')
      .trim();

    const imageLinks = [];
    const allImages = [];

    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('offerup.com')) {
        allImages.push(src);
      }
    });
    if (allImages.length === 1) {
      imageLinks.push(allImages[0]);
    } else if (allImages.length > 1) {
      imageLinks.push(...allImages.slice(1));
    }

    const available = !html.includes('This item is no longer available');

    const item = {
      title,
      price,
      description,
      condition: conditionText || null,
      location,
      imageLinks,
      available,
    };

    logger.debug('Scraped OfferUp Item:', item);
    return item;
  } catch (err) {
    logger.error('OfferUp scraping error:', err.message);
    return null;
  }
}

module.exports = { scrape };
