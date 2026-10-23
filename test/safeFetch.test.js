const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedAddress, assertFetchableUrl, safeGet } = require('../utils/safeFetch');

test('private, loopback, link-local and metadata addresses are blocked', () => {
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('assertFetchableUrl refuses non-http, credentials, IP literals and localhost', () => {
  assert.throws(() => assertFetchableUrl('file:///etc/passwd'), { code: 'EBLOCKED' });
  assert.throws(() => assertFetchableUrl('http://user:pass@example.com/'), { code: 'EBLOCKED' });
  assert.throws(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data'), { code: 'EBLOCKED' });
  assert.throws(() => assertFetchableUrl('http://[::1]:5000/'), { code: 'EBLOCKED' });
  assert.throws(() => assertFetchableUrl('http://localhost:27017/'), { code: 'EBLOCKED' });
  assert.throws(() => assertFetchableUrl('http://api.localhost/'), { code: 'EBLOCKED' });
  assert.ok(assertFetchableUrl('https://www.ebay.com/itm/1'));
});

test('safeGet rejects a hostname that resolves to a private address', async () => {
  // localtest.me-style names are not guaranteed offline; a numeric host in
  // decimal form is parsed by URL as 127.0.0.1, which exercises the literal check.
  await assert.rejects(safeGet('http://2130706433/'), { code: 'EBLOCKED' });
});
