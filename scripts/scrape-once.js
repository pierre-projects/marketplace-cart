#!/usr/bin/env node
/**
 * Scrape one listing and print the result. A debugging aid, not part of the app.
 *
 *   node scripts/scrape-once.js <listing-url>
 */
const { scrapeItem } = require('../utils/scrapers');
const { closeBrowser } = require('../utils/scrapers/browser');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/scrape-once.js <listing-url>');
  process.exit(1);
}

scrapeItem(url)
  .then(data => console.log(data))
  .catch(err => {
    console.error(`Scrape failed [${err.code || 'ERROR'}]:`, err.message);
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
