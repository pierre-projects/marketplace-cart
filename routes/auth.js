const express = require('express');
const passport = require('passport');
const User = require('../models/User');
const { authLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');
const router = express.Router();

const USERNAME_RE = /^[\w.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function renderRegister(res, status, formData, errorMessage) {
  return res.status(status).render('auth/register', {
    title: 'Create account',
    currentPage: 'register',
    formData,
    errorMessage
  });
}

/** First problem with a registration, or null. */
function registrationError({ username, email, password }) {
  if (!username || !email || !password) return 'Username, email, and password are required.';
  if (!USERNAME_RE.test(username)) return 'Usernames are 3–30 letters, numbers, dots, dashes or underscores.';
  if (!EMAIL_RE.test(email) || email.length > 254) return 'Enter a valid email address.';
  if (password.length < MIN_PASSWORD) return `Passwords must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return 'Passwords must be at most 72 characters.'; // bcrypt's limit
  return null;
}

// Show the register form (GET)
router.get('/register', (req, res) => renderRegister(res, 200, {}, null));

// Handle user registration (POST)
router.post('/register', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const formData = { username, email };

  const problem = registrationError({ username, email, password });
  if (problem) return renderRegister(res, 400, formData, problem);

  try {
    const existingUser = await User.exists({ $or: [{ email }, { username }] });
    if (existingUser) {
      return renderRegister(res, 409, formData, 'An account with that username or email already exists. Try signing in instead.');
    }

    await User.create({ username, email, password });
    logger.info('New user registered:', username);

    req.flash('success_msg', 'Registration successful! You can now sign in.');
    return res.redirect('/auth/login');
  } catch (err) {
    if (err.code === 11000) {
      return renderRegister(res, 409, formData, 'An account with that username or email already exists. Try signing in instead.');
    }
    logger.error('Error registering user:', err.message);
    return renderRegister(res, 500, formData, 'We could not complete registration right now. Please try again.');
  }
});

// Show the login form
router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Sign in', currentPage: 'login' });
});

router.post('/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      logger.error('Error during authentication:', err.message);
      req.flash('error_msg', 'We could not process your sign-in right now. Please try again.');
      return res.redirect('/auth/login');
    }
    if (!user) {
      req.flash('error_msg', info?.message || 'Incorrect email or password.');
      return res.redirect('/auth/login');
    }
    // A new session id on sign-in, so a session id planted before login is
    // worthless after it.
    return req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.redirect('/dashboard');
    });
  })(req, res, next);
});

// Logout. POST, not GET: a GET could be triggered by any page that embeds an
// image pointing here.
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    return res.redirect('/');
  });
});

module.exports = router;
