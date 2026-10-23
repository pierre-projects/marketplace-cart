const rateLimit = require('express-rate-limit');
const { wantsJson } = require('../utils/httpResponses');

/**
 * Per-IP limits for the endpoints that are expensive or guessable: sign-in and
 * registration (password guessing), and preview/prefill (each one makes the
 * server fetch a page, Puppeteer for Facebook).
 */
function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      if (wantsJson(req)) return res.status(429).json({ error: message });
      req.flash('error_msg', message);
      return res.redirect(req.originalUrl.startsWith('/auth/register') ? '/auth/register' : '/auth/login');
    },
  });
}

const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

const scrapeLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 20,
  message: 'Too many previews in a row. Wait a minute and try again.',
});

module.exports = { authLimiter, scrapeLimiter };
