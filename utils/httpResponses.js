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
  getSafeRedirectPath,
  redirectWithFlashError,
  renderHtmlError
};

