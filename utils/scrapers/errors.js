/**
 * One failure contract for every scraper.
 *
 * Scrapers previously disagreed: OfferUp swallowed errors and returned null,
 * Facebook threw. Callers had to handle both for the same operation, and the
 * null path discarded the root cause entirely. Every scraper now throws a
 * ScrapeError carrying a machine-readable `code`; nothing returns null.
 */

const CODES = {
  UNSUPPORTED: 'UNSUPPORTED',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  NOT_FOUND: 'NOT_FOUND',
  BLOCKED: 'BLOCKED',
  PARSE_FAILED: 'PARSE_FAILED',
  BROWSER_UNAVAILABLE: 'BROWSER_UNAVAILABLE',
};

// Codes worth retrying. Retrying UNSUPPORTED or NOT_FOUND just burns another
// full scrape (up to 30s of Puppeteer) to reach the same conclusion.
//
// BROWSER_UNAVAILABLE is deliberately absent: no amount of backoff installs a
// browser. It was previously reported as NETWORK, which IS retryable, so a
// missing Chrome burned all three attempts before failing — and blamed the
// user's connection while doing it.
const RETRYABLE = new Set([CODES.NETWORK, CODES.TIMEOUT]);

const USER_MESSAGES = {
  [CODES.UNSUPPORTED]: 'That link is not from a marketplace we support yet.',
  [CODES.NETWORK]: 'Could not reach the marketplace. Check your connection and try again.',
  [CODES.TIMEOUT]: 'The marketplace took too long to respond. Try again in a moment.',
  [CODES.NOT_FOUND]: 'That listing could not be found. It may have been removed.',
  [CODES.BLOCKED]: 'The marketplace blocked this request. Try again in a few minutes.',
  [CODES.PARSE_FAILED]: 'We reached the listing but could not read its details.',
  [CODES.BROWSER_UNAVAILABLE]: 'The scraper could not start its browser. Facebook listings need Chrome installed.',
};

class ScrapeError extends Error {
  constructor(code, message, options = {}) {
    super(message || USER_MESSAGES[code] || 'Scrape failed.');
    this.name = 'ScrapeError';
    this.code = CODES[code] ? code : CODES.PARSE_FAILED;
    if (options.cause) this.cause = options.cause;
  }

  get retryable() {
    return RETRYABLE.has(this.code);
  }

  /** Message safe to show a user — never leaks a stack or an internal string. */
  get userMessage() {
    return USER_MESSAGES[this.code] || USER_MESSAGES[CODES.PARSE_FAILED];
  }
}

/**
 * Wrap anything thrown by a scraper into a ScrapeError. Non-ScrapeError throws
 * (a TypeError in an extractor, say) become PARSE_FAILED rather than leaking.
 */
function asScrapeError(err, fallbackCode = CODES.PARSE_FAILED) {
  if (err instanceof ScrapeError) return err;
  return new ScrapeError(fallbackCode, undefined, { cause: err });
}

/** Classify an axios failure into a ScrapeError code. */
function classifyAxiosError(err) {
  // safeFetch refused the destination. Retrying reaches the same address.
  if (err.code === 'EBLOCKED') {
    return new ScrapeError(CODES.UNSUPPORTED, undefined, { cause: err });
  }
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
    return new ScrapeError(CODES.TIMEOUT, undefined, { cause: err });
  }

  const status = err.response?.status;
  if (status === 404 || status === 410) {
    return new ScrapeError(CODES.NOT_FOUND, undefined, { cause: err });
  }
  if (status === 403 || status === 429 || status === 401) {
    return new ScrapeError(CODES.BLOCKED, undefined, { cause: err });
  }
  if (status >= 500) {
    // Upstream 5xx is transient — worth a retry, so classify as NETWORK.
    return new ScrapeError(CODES.NETWORK, undefined, { cause: err });
  }
  if (status) {
    return new ScrapeError(CODES.PARSE_FAILED, undefined, { cause: err });
  }

  return new ScrapeError(CODES.NETWORK, undefined, { cause: err });
}

module.exports = { ScrapeError, CODES, RETRYABLE, USER_MESSAGES, asScrapeError, classifyAxiosError };
