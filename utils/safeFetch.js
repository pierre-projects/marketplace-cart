const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const axios = require('axios');

/**
 * Outbound HTTP for URLs a user typed in.
 *
 * Any server-side fetch of a user-supplied URL is an SSRF hole unless the
 * destination is checked: `http://169.254.169.254/` reads cloud metadata,
 * `http://localhost:27017/` pokes the database. Checking the hostname string is
 * not enough — a public name can resolve to a private address, and a redirect
 * can point anywhere — so the check runs on the resolved address, inside the
 * socket's own DNS lookup, for the first request and for every redirect hop.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
]) blocked.addSubnet(addr, prefix, 'ipv6');

class BlockedHostError extends Error {
  constructor(host) {
    super(`Refusing to fetch a private or reserved address (${host}).`);
    this.name = 'BlockedHostError';
    this.code = 'EBLOCKED';
  }
}

/** True for loopback, private, link-local, metadata and other non-public ranges. */
function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) is the IPv4 address.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}

/** dns.lookup with the result checked before the socket connects to it. */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some(a => isBlockedAddress(a.address))) {
      return callback(new BlockedHostError(hostname));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * Throws unless `url` is http(s) without credentials. An IP-literal host never
 * reaches the lookup above, so it is checked here instead.
 */
function assertFetchableUrl(url) {
  let parsed;
  try {
    parsed = url instanceof URL ? url : new URL(String(url));
  } catch (err) {
    throw new BlockedHostError(String(url));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedHostError(parsed.protocol);
  }
  if (parsed.username || parsed.password) throw new BlockedHostError(parsed.host);

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedHostError(host);
  if (host === 'localhost' || host.endsWith('.localhost')) throw new BlockedHostError(host);
  return parsed;
}

const httpAgent = new http.Agent({ lookup: safeLookup });
const httpsAgent = new https.Agent({ lookup: safeLookup });

/**
 * GET a user-supplied URL as text. Rejects with BlockedHostError (code
 * EBLOCKED) for a disallowed destination, or with the usual axios error.
 */
async function safeGet(url, { timeout = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, headers = {} } = {}) {
  const parsed = assertFetchableUrl(url);

  return axios.get(parsed.href, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', ...headers },
    timeout,
    maxContentLength: maxBytes,
    maxRedirects: MAX_REDIRECTS,
    responseType: 'text',
    httpAgent,
    httpsAgent,
    // Re-checked per hop: a public page may redirect to a private address.
    beforeRedirect: (options) => {
      assertFetchableUrl(`${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ''}/`);
    },
  });
}

module.exports = { safeGet, assertFetchableUrl, isBlockedAddress, BlockedHostError };
