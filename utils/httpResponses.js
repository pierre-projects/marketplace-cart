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

function renderHtmlError(req, res, statusCode, message, options = {}) {
  const { title, actionHref, actionLabel } = options;

  return res.status(statusCode).render('error', {
    user: req.user || null,
    statusCode,
    message,
    title,
    actionHref,
    actionLabel
  });
}

module.exports = {
  getSafeRedirectPath,
  redirectWithFlashError,
  renderHtmlError
};

