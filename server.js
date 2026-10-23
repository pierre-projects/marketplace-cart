const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const helmet = require('helmet');
const methodOverride = require('method-override');
const morgan = require('morgan');
const path = require('path');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const { readEnv } = require('./config/env');
const logger = require('./utils/logger');
const { closeBrowser } = require('./utils/scrapers/browser');
const scrapeQueue = require('./services/scrapeQueue');
const maintenance = require('./services/maintenance');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandlers');

const { env, errors: envErrors } = readEnv();
if (envErrors.length) {
  logger.error(`Invalid environment:\n  - ${envErrors.join('\n  - ')}\nSee .env.example.`);
  process.exit(1);
}

// Load Passport config
require('./config/passport')(passport);

const app = express();
let server = null;

if (env.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers. The CSP nonce lets exactly one inline script run — the
// theme stamp in the layout <head>, which must execute before first paint.
// Listing images come from every marketplace's CDN, hence img-src https:.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: env.isProduction ? [] : null,
    },
  },
  // Marketplace image CDNs do not send CORP headers; requiring them would
  // break every listing photo.
  crossOriginEmbedderPolicy: false,
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Core Middleware
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(methodOverride('_method'));
// The add-item modal polls job status, so a single 4s Facebook scrape
// produced a dozen log lines and looked like repeated scraping. Skip the poll
// route; the enqueue and the result still show.
app.use(morgan(env.isProduction ? 'combined' : 'dev', {
  skip: (req) => req.method === 'GET' && /^\/items\/jobs\//.test(req.path)
}));

// View Engine — one layout owns the HTML shell so it cannot drift per page.
// extractScripts hoists each view's own <script> tags into the layout, which
// keeps per-page scripts local to the view that needs them.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Presentation helpers available in every template, so no view ever
// hand-formats currency or a date again.
Object.assign(app.locals, require('./utils/format'));
// Fallbacks for a page rendered before the CSRF/CSP middleware ran (an error
// during session setup, say), so the layout never hits a ReferenceError.
Object.assign(app.locals, { csrfToken: '', csrfField: '', cspNonce: '' });

app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// --- Lifecycle ---

let shuttingDown = false;

// Drain in-flight scrapes (bounded), stop taking requests, then release the
// browser and the database, so a half-finished job isn't left 'running'.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);

  // Belt and braces: never hang forever on a stuck close.
  setTimeout(() => process.exit(1), 45000).unref();

  maintenance.stop();
  await scrapeQueue.stop().catch(err => logger.error('Error stopping scrape queue:', err.message));
  if (server) await new Promise(resolve => server.close(resolve));
  await closeBrowser().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});

function logMongoConnectionGuidance(err) {
  const details = [err?.message, err?.cause?.message]
    .filter(Boolean)
    .join(' ');

  if (/mongodb\.net/i.test(env.mongoUri || '') && /ReplicaSetNoPrimary|ServerSelectionError|whitelist/i.test(details)) {
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
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
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
      name: 'mc.sid',
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 1 day
        httpOnly: true,
        sameSite: 'lax',
        secure: env.isProduction,
      },
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

    // Collections used to live at /categories. 308 keeps the method, so old
    // bookmarks, shared public links and any stale form all still land.
    // Ahead of the CSRF check: the form is re-sent, token included, to the
    // new URL, where it is checked.
    app.use('/categories', (req, res) => res.redirect(308, `/collections${req.url === '/' ? '' : req.url}`));

    // Every state-changing request below must carry the session's token.
    app.use(csrfProtection);

    // Routes
    app.use('/', require('./routes/index'));          // Dashboard/homepage
    app.use('/auth', require('./routes/auth'));       // Signup/Login
    app.use('/items', require('./routes/items'));     // Preview, save, manual listings
    app.use('/listings', require('./routes/listings'));
    app.use('/collections', require('./routes/collections'));
    app.use('/settings', require('./routes/settings'));

    app.use(notFound);
    app.use(errorHandler);

    // Idempotent data fixes (isDefault, item source, indexes). No-ops after
    // the first boot.
    await maintenance.prepareSchema();

    // Background workers start only after Mongo is connected — both read from it.
    scrapeQueue.start();
    maintenance.start();

    server = app.listen(env.port, () => {
      logger.info(`Server running on http://localhost:${env.port}`);
    });
  } catch (err) {
    logger.error('Server startup failed:', err);
    await closeBrowser().catch(() => {});
    process.exit(1);
  }
}

startServer();
