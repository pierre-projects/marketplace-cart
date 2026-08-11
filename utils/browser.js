const puppeteer = require('puppeteer');
const logger = require('./logger');

// Chromium is heavy; bound how many browser contexts can be live at once.
const MAX_CONCURRENT_CONTEXTS = 2;

// The launch PROMISE is memoized, not the resolved browser. Memoizing the
// resolved value left a window where two concurrent callers both saw `null`,
// both called launch(), and the second assignment orphaned the first Chromium
// beyond the reach of closeBrowser().
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.isConnected()) return existing;
    } catch (err) {
      // Fall through and relaunch below.
    }
    browserPromise = null;
  }

  browserPromise = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // Clear the memo on failure so a transient launch error doesn't poison every
  // subsequent call with the same rejected promise.
  browserPromise.catch(() => { browserPromise = null; });

  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;

  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch (err) {
    logger.error('Error closing browser:', err.message);
  }
}

// --- Context slot semaphore ---

let activeContexts = 0;
const waiting = [];

/**
 * Reserve a browser-context slot. Resolves to a release function that must be
 * called exactly once — callers do so in a `finally`.
 */
function acquireContextSlot() {
  if (activeContexts < MAX_CONCURRENT_CONTEXTS) {
    activeContexts++;
    return Promise.resolve(makeRelease());
  }
  return new Promise(resolve => waiting.push(() => resolve(makeRelease())));
}

function makeRelease() {
  let released = false;
  return function release() {
    if (released) return;
    released = true;

    const next = waiting.shift();
    if (next) {
      // Hand the slot straight to the next waiter without decrementing.
      next();
    } else {
      activeContexts--;
    }
  };
}

module.exports = { getBrowser, closeBrowser, acquireContextSlot };
