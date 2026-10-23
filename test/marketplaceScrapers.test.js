const test = require('node:test');
const assert = require('node:assert/strict');
const { isSupported, detectPlatform } = require('../utils/scrapers');
const { looksLikeChallenge, collectPageMetadata } = require('../utils/scrapers/structured');
const { normalizeCondition } = require('../utils/conditionMap');
const craigslist = require('../utils/scrapers/craigslist')._internals;
const ebay = require('../utils/scrapers/ebay')._internals;
const poshmark = require('../utils/scrapers/poshmark')._internals;
const mercari = require('../utils/scrapers/mercari')._internals;
const depop = require('../utils/scrapers/depop')._internals;

const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

test('registry routes the new marketplaces by host and listing path', () => {
  const cases = [
    ['https://sfbay.craigslist.org/sfc/fuo/d/san-francisco-oak-dresser/7712345678.html', 'Craigslist'],
    ['https://www.craigslist.org/view/d/san-jose-white-3x3-ikea-kallax-shelf/4xePze61CW4x7bHjRH967q', 'Craigslist'],
    ['https://www.ebay.com/itm/256123456789', 'eBay'],
    ['https://www.ebay.co.uk/itm/256123456789?hash=x', 'eBay'],
    ['https://poshmark.com/listing/Levis-501-6512abcdef0123456789abcd', 'Poshmark'],
    ['https://www.mercari.com/us/item/m12345678901/', 'Mercari'],
    ['https://www.depop.com/products/seller-vintage-jacket-1a2b/', 'Depop'],
  ];
  for (const [url, platform] of cases) {
    assert.equal(isSupported(url), true, url);
    assert.equal(detectPlatform(url), platform, url);
  }
});

test('registry refuses non-listing pages and look-alikes for the new sites', () => {
  assert.equal(isSupported('https://sfbay.craigslist.org/search/fua?query=dresser'), false);
  assert.equal(isSupported('https://www.craigslist.org/view/d/'), false);
  assert.equal(isSupported('https://www.ebay.com/sch/i.html?_nkw=lamp'), false);
  assert.equal(isSupported('https://ebay.com.evil.example/itm/1'), false);
  assert.equal(isSupported('https://evil.example/www.ebay.com/itm/1'), false);
  assert.equal(isSupported('https://poshmark.com/closet/someone'), false);
  assert.equal(isSupported('https://www.mercari.com/search/?keyword=lamp'), false);
  assert.equal(isSupported('https://www.depop.com/someseller/'), false);
});

test('Craigslist extracts the posting and drops the QR boilerplate', () => {
  const html = `<html><head><meta property="og:image" content="https://images.craigslist.org/og.jpg"></head><body>
    <h1 class="postingtitle"><span class="postingtitletext">
      <span id="titletextonly">Oak dresser</span> <span class="price">$1,250</span> <small> (Mission District)</small>
    </span></h1>
    <div id="thumbs"><a href="https://images.craigslist.org/a_1200x900.jpg"></a><a href="https://images.craigslist.org/b_1200x900.jpg"></a></div>
    <div class="attrgroup"><span>condition: <b>excellent</b></span><span>make / manufacturer: <b>IKEA</b></span></div>
    <section id="postingbody"><div class="print-information print-qrcode-container"><p>QR Code Link to This Post</p></div>
      Six drawers,
      solid wood.</section>
  </body></html>`;
  const item = craigslist.extract(html, 'https://sfbay.craigslist.org/sfc/fuo/d/x/7712345678.html');
  assert.equal(item.title, 'Oak dresser');
  assert.equal(item.price, 1250);
  assert.equal(item.description, 'Six drawers, solid wood.');
  assert.equal(item.location, 'Mission District');
  assert.equal(normalizeCondition(item.condition), 'Good');
  assert.deepEqual(item.imageLinks.slice(0, 2), [
    'https://images.craigslist.org/a_1200x900.jpg', 'https://images.craigslist.org/b_1200x900.jpg',
  ]);
  assert.equal(item.available, true);
});

test('Craigslist marks removed postings unavailable and keeps a missing price null', () => {
  const html = '<html><body><span id="titletextonly">Lamp</span><p>This posting has been deleted by its author.</p></body></html>';
  const item = craigslist.extract(html, 'https://x.craigslist.org/d/x/1.html');
  assert.equal(item.available, false);
  assert.equal(item.price, null);
});

test('eBay reads Product JSON-LD first', () => {
  const html = `<html><head><meta property="og:title" content="Ignored | eBay">${jsonLd({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Herman Miller Aeron chair',
    image: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg'],
    offers: { '@type': 'Offer', price: '450.00', priceCurrency: 'USD',
      itemCondition: 'https://schema.org/UsedCondition', availability: 'https://schema.org/InStock' },
  })}</head><body></body></html>`;
  const item = ebay.extract(html, 'https://www.ebay.com/itm/1');
  assert.equal(item.title, 'Herman Miller Aeron chair');
  assert.equal(item.price, 450);
  assert.equal(item.condition, 'Used');
  assert.deepEqual(item.imageLinks, ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg']);
  assert.equal(item.available, true);
});

test('eBay falls back to markup and treats an ended listing as unavailable', () => {
  const html = `<html><head><meta property="og:title" content="Desk lamp | eBay"></head><body>
    <div class="x-item-title"><h1 class="x-item-title__mainTitle"><span>Desk lamp</span></h1></div>
    <div class="x-price-primary"><span>US $35.99</span></div>
    <div>This listing has ended.</div></body></html>`;
  const item = ebay.extract(html, 'https://www.ebay.com/itm/1');
  assert.equal(item.title, 'Desk lamp');
  assert.equal(item.price, 35.99);
  assert.equal(item.available, false);
});

test('eBay trusts a SoldOut offer over page text', () => {
  const html = `<html><head>${jsonLd({ '@type': 'Product', name: 'Mug',
    offers: { price: 5, availability: 'https://schema.org/SoldOut' } })}</head></html>`;
  assert.equal(ebay.extract(html, 'https://www.ebay.com/itm/1').available, false);
});

test('Poshmark reads JSON-LD inside an @graph and normalizes NWT', () => {
  const html = `<html><head>${jsonLd({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList' },
    { '@type': 'Product', name: "Levi's 501 jeans", description: 'Levi&#x27;s, size 32 &amp; long',
      image: { '@type': 'ImageObject', url: 'https://di2ponv0v5otw.cloudfront.net/posts/1.jpg' },
      offers: { '@type': 'Offer', price: 48, availability: 'https://schema.org/InStock' } },
  ] })}</head><body><span class="condition-tag">NWT</span></body></html>`;
  const item = poshmark.extract(html, 'https://poshmark.com/listing/x');
  assert.equal(item.title, "Levi's 501 jeans");
  assert.equal(item.price, 48);
  assert.equal(item.description, "Levi's, size 32 & long");
  assert.equal(normalizeCondition(item.condition), 'New');
  assert.deepEqual(item.imageLinks, ['https://di2ponv0v5otw.cloudfront.net/posts/1.jpg']);
  assert.equal(item.available, true);
});

test('Poshmark sold badge marks the listing unavailable', () => {
  const html = '<html><body><h1>Boots</h1><div class="sold-tag">Sold</div></body></html>';
  assert.equal(poshmark.extract(html, 'https://poshmark.com/listing/x').available, false);
});

test('Mercari and Depop read rendered page metadata', () => {
  const pageData = {
    jsonLd: ['not json', JSON.stringify({ '@type': 'Product', name: 'Nintendo Switch',
      offers: { price: '180', itemCondition: 'https://schema.org/UsedCondition' } })],
    meta: { 'og:title': 'Nintendo Switch | Mercari', 'og:image': 'https://u-mercari-images.mercdn.net/1.jpg' },
    h1: 'Nintendo Switch',
    sold: false,
  };
  const m = mercari.extract(pageData, 'https://www.mercari.com/us/item/m1/');
  assert.equal(m.title, 'Nintendo Switch');
  assert.equal(m.price, 180);
  assert.equal(m.condition, 'Used');
  assert.deepEqual(m.imageLinks, ['https://u-mercari-images.mercdn.net/1.jpg']);
  assert.equal(m.available, true);

  const d = depop.extract({ jsonLd: [], meta: { 'og:title': 'Vintage jacket | Depop' }, h1: '', sold: true },
    'https://www.depop.com/products/x/');
  assert.equal(d.title, 'Vintage jacket');
  assert.equal(d.price, null);
  assert.equal(d.available, false);
});

test('rendered scrapers prefer the heading over a truncated JSON-LD name and full-size Mercari images', () => {
  const d = depop.extract({
    jsonLd: [JSON.stringify({ '@type': 'Product', name: 'Brown velvet jacket -no...', offers: { price: 35 } })],
    meta: {}, h1: "American Vintage Women's Brown Jacket", sold: false,
  }, 'https://www.depop.com/products/x/');
  assert.equal(d.title, "American Vintage Women's Brown Jacket");

  const m = mercari.extract({
    jsonLd: [JSON.stringify({ '@type': 'Product', name: 'Lamp', offers: { price: '1025' },
      image: ['https://u-mercari-images.mercdn.net/photos/m1_1.jpg?179&width=200&height=200'] })],
    meta: { 'og:image': 'https://u-mercari-images.mercdn.net/photos/m1_1.jpg?179' }, h1: 'Privacy settings', sold: false,
  }, 'https://www.mercari.com/us/item/m1/');
  assert.equal(m.title, 'Lamp');
  assert.deepEqual(m.imageLinks, ['https://u-mercari-images.mercdn.net/photos/m1_1.jpg?179']);
});

test('collectPageMetadata is self-contained enough to serialize into a page', () => {
  // renderPage sends it to Chromium as source text; a closure over module scope
  // would throw ReferenceError there, so it must parse standalone.
  assert.doesNotThrow(() => new Function(`return (${collectPageMetadata.toString()})`)());
});

test('bot-challenge pages are recognised', () => {
  assert.equal(looksLikeChallenge('<title>Pardon Our Interruption...</title>'), true);
  assert.equal(looksLikeChallenge('<title>Just a moment...</title>'), true);
  assert.equal(looksLikeChallenge('<title>Oak dresser - eBay</title>'), false);
});
