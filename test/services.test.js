const test = require('node:test');
const assert = require('node:assert/strict');
const { roleFor, canEdit, canView } = require('../services/permissions');
const { normalizeManualInput, parseImageLinks } = require('../services/itemService');
const { computeItemStats, computePlatformBreakdown, toPrice } = require('../services/categoryStats');
const { tokensMatch } = require('../middleware/csrf');
const { readEnv } = require('../config/env');

const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const EDITOR = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const VIEWER = 'cccccccccccccccccccccccc';
const STRANGER = 'dddddddddddddddddddddddd';

const category = (extra = {}) => ({
  user: OWNER,
  isPublic: false,
  usersAdded: [{ user: EDITOR, role: 'editor' }, { user: { _id: VIEWER }, role: 'viewer' }],
  ...extra,
});

test('roleFor resolves owner, members (populated or not), public and none', () => {
  assert.equal(roleFor(category(), OWNER), 'owner');
  assert.equal(roleFor(category(), EDITOR), 'editor');
  assert.equal(roleFor(category(), VIEWER), 'viewer');
  assert.equal(roleFor(category(), STRANGER), null);
  assert.equal(roleFor(category({ isPublic: true }), STRANGER), 'public');
  assert.equal(roleFor(category({ isPublic: true }), null), 'public');
  assert.equal(roleFor(null, OWNER), null);
});

test('only owners and editors can edit; anyone with a role can view', () => {
  assert.equal(canEdit('owner'), true);
  assert.equal(canEdit('editor'), true);
  assert.equal(canEdit('viewer'), false);
  assert.equal(canEdit('public'), false);
  assert.equal(canView('public'), true);
  assert.equal(canView(null), false);
});

test('normalizeManualInput accepts a minimal listing', () => {
  const { data, errors } = normalizeManualInput({ title: '  Desk  ' });
  assert.deepEqual(errors, []);
  assert.equal(data.title, 'Desk');
  assert.equal(data.price, null);
  assert.equal(data.link, undefined);
  assert.equal(data.platform, 'Other');
  assert.equal(data.available, true);
});

test('normalizeManualInput normalizes price, link, condition and platform', () => {
  const { data, errors } = normalizeManualInput({
    title: 'Bike', price: '$1,200.50', link: 'https://www.ebay.com/itm/9',
    condition: 'Good', available: ['false', 'true'],
  });
  assert.deepEqual(errors, []);
  assert.equal(data.price, 1200.5);
  assert.equal(data.platform, 'eBay');
  assert.equal(data.condition, 'Good');
  assert.equal(data.available, true);

  assert.equal(normalizeManualInput({ title: 'x', price: '0' }).data.price, 0);
  assert.equal(normalizeManualInput({ title: 'x', condition: 'Mint' }).data.condition, null);
  assert.equal(normalizeManualInput({ title: 'x', available: 'false' }).data.available, false);
});

test('normalizeManualInput reports bad input', () => {
  assert.ok(normalizeManualInput({ title: '' }).errors.length);
  assert.ok(normalizeManualInput({ title: 'x', price: '-4' }).errors.length);
  assert.ok(normalizeManualInput({ title: 'x', price: 'cheap' }).errors.length);
  assert.ok(normalizeManualInput({ title: 'x', link: 'javascript:alert(1)' }).errors.length);
});

test('parseImageLinks keeps http(s) URLs, dedupes and caps', () => {
  const lines = ['https://a.example/1.jpg', 'javascript:x', 'https://a.example/1.jpg', ' http://b.example/2.png '].join('\n');
  assert.deepEqual(parseImageLinks(lines), ['https://a.example/1.jpg', 'http://b.example/2.png']);
  const many = Array.from({ length: 10 }, (_, i) => `https://a.example/${i}.jpg`);
  assert.equal(parseImageLinks(many).length, 6);
});

test('stats keep free and unpriced items distinct', () => {
  const entries = [
    { item: { price: 100, available: true, platform: 'eBay', link: 'https://ebay.com/1' } },
    { item: { price: 0, available: true, platform: 'Other', link: null } },
    { item: { price: null, available: false, platform: 'eBay', link: 'https://ebay.com/2' } },
    { item: null },
  ];
  assert.deepEqual(computeItemStats(entries), {
    totalItems: 3, totalValue: 100, availableCount: 2, unpricedCount: 1, freeCount: 1,
  });
  assert.equal(toPrice('12.5'), 12.5);
  assert.equal(toPrice(''), null);

  const { platforms, total } = computePlatformBreakdown(entries);
  assert.equal(total, 100);
  assert.equal(platforms[0].platform, 'eBay');
  assert.equal(platforms[0].unpricedCount, 1);
});

test('csrf tokens compare exactly', () => {
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('abc', 'ab'), false);
  assert.equal(tokensMatch('abc', undefined), false);
  assert.equal(tokensMatch('', ''), false);
});

test('readEnv reports missing and weak settings', () => {
  assert.deepEqual(readEnv({ MONGO_URI: 'mongodb://x', SESSION_SECRET: 's' }).errors, []);
  assert.equal(readEnv({}).errors.length, 2);
  assert.ok(readEnv({ MONGO_URI: 'm', SESSION_SECRET: 'short', NODE_ENV: 'production' }).errors.length);
  assert.ok(readEnv({ MONGO_URI: 'm', SESSION_SECRET: 's', PORT: 'abc' }).errors.length);
});
