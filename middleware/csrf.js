const crypto = require('crypto');
const { wantsJson, renderHtmlError } = require('../utils/httpResponses');

/**
 * Synchronizer-token CSRF protection. One random token per session; every
 * state-changing request must echo it back, as a `_csrf` form field or an
 * `X-CSRF-Token` header (lib/api.js sends the header, read from a <meta>).
 *
 * A cross-site page can make the browser POST here with the session cookie
 * attached, but it cannot read the token, so the request is refused.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensMatch(expected, received) {
  if (typeof received !== 'string' || !expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrfProtection(req, res, next) {
  if (!req.session) return next(new Error('csrfProtection requires express-session'));

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  }
  const token = req.session.csrfToken;
  res.locals.csrfToken = token;
  res.locals.csrfField = `<input type="hidden" name="_csrf" value="${token}">`;

  if (SAFE_METHODS.has(req.method)) return next();

  const received = req.get('x-csrf-token') || req.body?._csrf;
  if (tokensMatch(token, received)) return next();

  if (wantsJson(req)) {
    return res.status(403).json({ error: 'Your session expired. Reload the page and try again.' });
  }
  // A form post gets the error page rather than a redirect: a redirect cannot
  // carry a 403, and silently bouncing hides that nothing was saved.
  return renderHtmlError(req, res, 403, 'Your session expired or the form is out of date. Go back, reload the page and try again.');
}

module.exports = { csrfProtection, tokensMatch };
