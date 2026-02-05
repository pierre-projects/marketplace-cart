require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const methodOverride = require('method-override');
const morgan = require('morgan');
const path = require('path');
const flash = require('connect-flash');
const logger = require('./utils/logger');

// Load Passport config
require('./config/passport')(passport);

// Initialize Express App
const app = express();

// Environment
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// DB Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Core Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));

// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Flash + Globals
app.use(flash());
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

// View Engine
app.set('view engine', 'ejs');

// Routes
app.use('/', require('./routes/index'));          // Dashboard/homepage
app.use('/auth', require('./routes/auth'));       // Signup/Login
app.use('/items', require('./routes/items'));     // Add/view item links
app.use('/listings', require('./routes/listings'));
app.use('/categories', require('./routes/categories'));

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err.stack);
  res.status(500).render('error', { message: 'Something went wrong. Please try again.' });
});

// Server Start
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
