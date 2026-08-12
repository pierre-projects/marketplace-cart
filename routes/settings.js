const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');

/**
 * Accent presets. Declared here so the page and the stylesheet cannot drift:
 * each `key` must have a matching `:root[data-accent='<key>']` rule in
 * tokens.css, and the swatch preview reads the same token the app does.
 */
const ACCENTS = [
  { key: 'default', label: 'Pink' },
  { key: 'blue', label: 'Blue' },
  { key: 'teal', label: 'Teal' },
  { key: 'violet', label: 'Violet' },
  { key: 'amber', label: 'Amber' },
];

// GET /settings
router.get('/', ensureAuthenticated, (req, res) => {
  res.render('settings', {
    title: 'Settings',
    currentPage: 'settings',
    user: req.user,
    accents: ACCENTS,
  });
});

module.exports = router;
module.exports.ACCENTS = ACCENTS;
