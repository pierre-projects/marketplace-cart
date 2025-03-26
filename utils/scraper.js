const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOfferUp(url) {
  try {
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim();

    const price = $('p.MuiTypography-h4').first().text().trim();

    const rawDescription = $('[data-testid="listing-description"]').text().trim();
    // Get the first p.MuiTypography-body1 that doesn't include 'Condition:' or 'in '
const description = $('h2.MuiTypography-h5')
  .filter((i, el) => $(el).text().trim() === 'Description')
  .parent()                            // div.MuiGrid-item
  .next()                              // div containing the <p> with actual description
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
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('offerup.com')) {
        imageLinks.push(src);
      }
    });

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

    console.log('Scraped OfferUp Item:', item);
    return item;
  } catch (err) {
    console.error('Scraping error:', err.message);
    return null;
  }
}

module.exports = { scrapeOfferUp };
