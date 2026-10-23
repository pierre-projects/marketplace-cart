/**
 * An error a service throws when the request itself is at fault — not found,
 * not allowed, invalid. Routes turn it into a flash or a JSON body with its
 * message; anything else is a 500 and its message stays in the log.
 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Did the caller ask for JSON (fetch with Accept, or an XHR)? */
function wantsJson(req) {
  return Boolean(req.xhr || req.get('accept')?.includes('application/json'));
}

/**
 * Express 4 does not catch a rejected async handler: the request just hangs
 * and the rejection goes unhandled. Wrapping forwards it to the error handler.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getSafeRedirectPath(req, fallback = '/') {
  const referrer = req.get('referer');
  if (!referrer) return fallback;

  try {
    const host = req.get('host');
    if (!host) return fallback;

    const requestOrigin = `${req.protocol}://${host}`;
    const referrerUrl = new URL(referrer, requestOrigin);

    if (referrerUrl.origin !== requestOrigin) return fallback;

    return `${referrerUrl.pathname}${referrerUrl.search}`;
  } catch (err) {
    return fallback;
  }
}

/**
 * Validate a caller-supplied `returnTo` before redirecting to it.
 *
 * Anything that could leave this origin is refused rather than sanitised:
 * absolute URLs, protocol-relative `//host`, backslashes (which some clients
 * normalise to `/`), and embedded CR/LF. A convenience is not worth an open
 * redirect. Lived in routes/items.js; shared so a second caller cannot grow a
 * weaker second copy.
 */
function getSafeReturnToPath(rawPath, fallback = '/dashboard') {
  if (typeof rawPath !== 'string') return fallback;

  const trimmed = rawPath.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  if (trimmed.includes('\\') || trimmed.includes('://') || /[\r\n]/.test(trimmed)) return fallback;

  try {
    const parsed = new URL(trimmed, 'http://localhost');
    return `${parsed.pathname}${parsed.search}`;
  } catch (err) {
    return fallback;
  }
}

function redirectWithFlashError(req, res, message, fallback = '/') {
  req.flash('error_msg', message);
  return res.redirect(getSafeRedirectPath(req, fallback));
}

const ERROR_HEADINGS = {
  403: 'Access denied',
  404: 'Page not found',
};

/**
 * Render the error page.
 *
 * `heading` is the on-page <h1>; `title` is the document title the layout uses.
 * These were the same local before the shared layout existed, which made them
 * collide — the layout needs `title` for <title>, the page wants it for <h1>.
 */
function renderHtmlError(req, res, statusCode, message, options = {}) {
  const { heading, actionHref, actionLabel } = options;
  const resolvedHeading = heading
    || ERROR_HEADINGS[statusCode]
    || 'Something went wrong';

  const signedIn = Boolean(req.user);

  return res.status(statusCode).render('error', {
    title: `${statusCode} — ${resolvedHeading}`,
    user: req.user || null,
    statusCode,
    message: message || 'An unexpected error occurred.',
    heading: resolvedHeading,
    actionHref: actionHref || (signedIn ? '/dashboard' : '/'),
    actionLabel: actionLabel || (signedIn ? 'Back to Dashboard' : 'Back to Home')
  });
}

module.exports = {
  HttpError,
  wantsJson,
  asyncHandler,
  getSafeRedirectPath,
  getSafeReturnToPath,
  redirectWithFlashError,
  renderHtmlError
};

