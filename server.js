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
const { closeBrowser } = require('./utils/browser');

// Load Passport config
require('./config/passport')(passport);

// Initialize Express App
const app = express();

// Environment
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;
const mongoOptions = {
  serverSelectionTimeoutMS: 10000,
};

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Core Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));

// View Engine
app.set('view engine', 'ejs');

// Shutdown hooks — close shared Puppeteer browser on exit
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

function validateEnv() {
  const missing = ['MONGO_URI', 'SESSION_SECRET'].filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function logMongoConnectionGuidance(err) {
  const details = [err?.message, err?.cause?.message]
    .filter(Boolean)
    .join(' ');

  if (/mongodb\.net/i.test(MONGO_URI || '') && /ReplicaSetNoPrimary|ServerSelectionError|whitelist/i.test(details)) {
    logger.error(
      'Atlas connectivity checks: confirm your current public IP is allowed in Atlas Network Access and verify the database user/password in MONGO_URI.'
    );
  }

  if (/tlsv1 alert internal error|SSL routines/i.test(details)) {
    logger.error(
      'TLS handshake with Atlas failed. Common causes are VPN/proxy/antivirus SSL inspection, an outdated Node runtime on Windows, or a network blocking Atlas traffic.'
    );
  }
}

async function connectToMongo() {
  try {
    await mongoose.connect(MONGO_URI, mongoOptions);
    logger.info('MongoDB Connected');
    return mongoose.connection.getClient();
  } catch (err) {
    logger.error('MongoDB Connection Error:', err);
    logMongoConnectionGuidance(err);
    throw err;
  }
}

async function startServer() {
  try {
    validateEnv();

    const mongoClient = await connectToMongo();
    const sessionStore = MongoStore.create({
      client: mongoClient,
      dbName: mongoose.connection.name,
    });

    sessionStore.on('error', (err) => {
      logger.error('Session store error:', err);
      logMongoConnectionGuidance(err);
    });

    // Sessions
    app.use(session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
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

    // Routes
    app.use('/', require('./routes/index'));          // Dashboard/homepage
    app.use('/auth', require('./routes/auth'));       // Signup/Login
    app.use('/items', require('./routes/items'));     // Add/view item links
    app.use('/listings', require('./routes/listings'));
    app.use('/categories', require('./routes/categories'));

    // Global Error Handler
    app.use((err, req, res, next) => {
      logger.error('Unhandled error:', err.stack);
      const statusCode = err.status || 500;
      const message = statusCode >= 500
        ? 'Something went wrong. Please try again.'
        : (err.message || 'Something went wrong.');

      res.status(statusCode).render('error', {
        message,
        statusCode,
        user: req.user || null
      });
    });

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    logger.error('Server startup failed:', err);
    await closeBrowser();
    process.exit(1);
  }
}

startServer();
