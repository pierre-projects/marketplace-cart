const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { wantsJson, getSafeRedirectPath, renderHtmlError } = require('../utils/httpResponses');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const message = errors.array()[0].msg;
  if (wantsJson(req)) {
    return res.status(400).json({ error: message });
  }
  // For form submissions, go back with a flash. `res.redirect('back')` trusted
  // the Referer header outright; this only follows a same-origin one.
  req.flash('error_msg', message);
  return res.redirect(getSafeRedirectPath(req, req.user ? '/dashboard' : '/'));
};

/**
 * 404 for a malformed `:param` id, before the handler runs. A bad id used to
 * reach Mongoose and surface as a CastError 500.
 */
const validateObjectId = (param = 'id') => (req, res, next) => {
  if (mongoose.isValidObjectId(req.params[param])) return next();
  if (wantsJson(req)) return res.status(404).json({ error: 'Not found.' });
  return renderHtmlError(req, res, 404, 'That page does not exist.');
};

const httpUrl = { require_protocol: true, protocols: ['http', 'https'] };

// Validate item link
const validateItemLink = [
  body('link')
    .trim()
    .notEmpty().withMessage('Link is required')
    .isLength({ max: 2048 }).withMessage('That link is too long')
    .isURL(httpUrl).withMessage('Paste the full link, starting with https://'),
  handleValidationErrors
];

const collectionName = body('name')
  .trim()
  .notEmpty().withMessage('Collection name is required.')
  .isLength({ max: 50 }).withMessage('Collection names must be under 50 characters.');

const validateCategory = [collectionName, handleValidationErrors];

// Validate share email
const validateShare = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Enter a valid email address.')
    .toLowerCase(),
  body('access').isIn(['viewer', 'editor']).withMessage('Choose viewer or editor access.'),
  handleValidationErrors
];

const validateMemberRole = [
  body('userId').custom(v => mongoose.isValidObjectId(v)).withMessage('Unknown member.'),
  body('newRole').isIn(['viewer', 'editor']).withMessage('Choose viewer or editor access.'),
  handleValidationErrors
];

const validateMemberId = [
  body('userId').custom(v => mongoose.isValidObjectId(v)).withMessage('Unknown member.'),
  handleValidationErrors
];

const validateItemId = [
  body('itemId').custom(v => mongoose.isValidObjectId(v)).withMessage('That listing could not be found.'),
  handleValidationErrors
];

// Field rules for the manual-listing form. itemService.normalizeManualInput
// re-checks and normalizes; these give early, field-specific messages.
const validateManualItem = [
  body('title').trim().notEmpty().withMessage('Give the listing a title.')
    .isLength({ max: 300 }).withMessage('Titles must be under 300 characters.'),
  body('link').optional({ values: 'falsy' }).trim()
    .isURL(httpUrl).withMessage('The link must start with http:// or https://.'),
  body('price').optional({ values: 'falsy' }).trim()
    .customSanitizer(v => String(v).replace(/[$,\s]/g, ''))
    .isFloat({ min: 0, max: 1e9 }).withMessage('Price must be a number of zero or more.'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateObjectId,
  validateItemLink,
  validateCategory,
  validateShare,
  validateMemberRole,
  validateMemberId,
  validateItemId,
  validateManualItem,
};
