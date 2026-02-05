const { scrapeItem } = require('./utils/scrapers');

const testUrl = 'https://offerup.com/item/detail/2874d8e4-cd04-3f66-94f9-a019bf98715b';
scrapeItem(testUrl).then(data => console.log(data));
