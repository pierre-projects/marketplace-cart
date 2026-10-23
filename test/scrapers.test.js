const test = require('node:test');
const assert = require('node:assert/strict');
const { isSupported, detectPlatform, parseListingUrl } = require('../utils/scrapers');
const { extractPrefill } = require('../utils/scrapers/generic');

test('registry matches supported marketplaces by hostname and path', () => {
  assert.equal(isSupported('https://offerup.com/item/detail/abc-123'), true);
  assert.equal(isSupported('https://www.facebook.com/marketplace/item/1234567890/'), true);
  assert.equal(isSupported('https://m.facebook.com/marketplace/item/1234567890'), true);
  assert.equal(isSupported('https://www.facebook.com/groups/123'), false);
});

test('registry refuses look-alike and smuggled URLs', () => {
  // The old unanchored regexes accepted all of these.
  assert.equal(isSupported('http://169.254.169.254/?facebook.com/marketplace/item/1'), false);
  assert.equal(isSupported('https://evil.example/offerup.com/item/x'), false);
  assert.equal(isSupported('https://offerup.com.evil.example/item/x'), false);
  assert.equal(isSupported('https://notfacebook.com/marketplace/item/1'), false);
  assert.equal(isSupported('https://user:pw@offerup.com/item/x'), false);
  assert.equal(isSupported('javascript:alert(1)//offerup.com/item/'), false);
  assert.equal(isSupported(''), false);
  assert.equal(isSupported(null), false);
});

test('detectPlatform names scraped, known and unknown sites', () => {
  assert.equal(detectPlatform('https://offerup.com/item/detail/x'), 'OfferUp');
  assert.equal(detectPlatform('https://www.ebay.com/itm/123'), 'eBay');
  assert.equal(detectPlatform('https://sfbay.craigslist.org/sfc/fuo/d/x/1.html'), 'Craigslist');
  assert.equal(detectPlatform('https://www.example-shop.com/p/1'), 'example-shop.com');
  assert.equal(detectPlatform('not a url'), 'Unknown');
});

test('parseListingUrl only accepts http(s)', () => {
  assert.ok(parseListingUrl('https://a.example/x'));
  assert.equal(parseListingUrl('ftp://a.example/x'), null);
  assert.equal(parseListingUrl('file:///etc/passwd'), null);
});

test('extractPrefill reads JSON-LD Product data first', () => {
  const html = `<html><head>
    <meta property="og:title" content="OG title">
    <meta property="og:image" content="/img/2.jpg">
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Oak dresser',
      description: 'Six drawers', image: ['https://cdn.example/1.jpg'],
      offers: { '@type': 'Offer', price: '125.00', itemCondition: 'https://schema.org/NewCondition' },
    })}</script></head><body></body></html>`;
  const out = extractPrefill(html, 'https://shop.example/item/1');
  assert.equal(out.title, 'Oak dresser');
  assert.equal(out.price, 125);
  assert.equal(out.description, 'Six drawers');
  assert.equal(out.condition, 'New');
  assert.deepEqual(out.imageLinks, ['https://cdn.example/1.jpg', 'https://shop.example/img/2.jpg']);
});

test('extractPrefill falls back to OpenGraph and leaves unknown price null', () => {
  const html = `<html><head><title>Page</title>
    <meta property="og:title" content="Vintage lamp">
    <meta name="description" content="Works fine">
    <meta property="og:image" content="javascript:alert(1)">
  </head></html>`;
  const out = extractPrefill(html, 'https://x.example/1');
  assert.equal(out.title, 'Vintage lamp');
  assert.equal(out.description, 'Works fine');
  assert.equal(out.price, null);
  assert.deepEqual(out.imageLinks, []);
});
