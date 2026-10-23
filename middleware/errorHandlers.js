const logger = require('../utils/logger');
const { wantsJson, renderHtmlError } = require('../utils/httpResponses');

/** Nothing matched the request. */
function notFound(req, res) {
  if (wantsJson(req)) return res.status(404).json({ error: 'Not found.' });
  return renderHtmlError(req, res, 404, 'That page does not exist.');
}

/**
 * Last-resort error handler — goes through the same helper as every route so
 * the error view has exactly one contract for its locals. A 5xx never shows
 * its internal message.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || 500;
  if (statusCode >= 500) logger.error('Unhandled error:', err.stack || err);

  const message = statusCode >= 500
    ? 'Something went wrong. Please try again.'
    : (err.expose === false ? 'Something went wrong.' : (err.message || 'Something went wrong.'));

  if (res.headersSent) return next(err);
  if (wantsJson(req)) return res.status(statusCode).json({ error: message });
  return renderHtmlError(req, res, statusCode, message);
}

module.exports = { notFound, errorHandler };
