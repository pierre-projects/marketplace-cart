const { body, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // For AJAX requests, return JSON
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    // For form submissions, redirect back with flash message
    req.flash('error_msg', errors.array()[0].msg);
    return res.redirect('back');
  }
  next();
};

// Validate item link
const validateItemLink = [
  body('link')
    .trim()
    .notEmpty().withMessage('Link is required')
    .isURL().withMessage('Must be a valid URL'),
  handleValidationErrors
];

// Validate user registration
const validateRegistration = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors
];

// Validate category creation
const validateCategory = [
  body('name')
    .trim()
    .notEmpty().withMessage('Category name is required')
    .isLength({ max: 50 }).withMessage('Category name must be under 50 characters'),
  handleValidationErrors
];

// Validate share email
const validateShareEmail = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email'),
  handleValidationErrors
];

module.exports = {
  validateItemLink,
  validateRegistration,
  validateCategory,
  validateShareEmail
};
