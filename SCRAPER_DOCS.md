# MarketplaceCart Scraper System

How a pasted link becomes a saved item: the queue that runs the scrape, the registry that picks a
scraper, the two scrapers themselves, and the failure contract they share.

For setup and the wider app, see [README.md](README.md).

---

## System overview

Scraping does **not** happen inside the HTTP request. A request enqueues a job and returns; a
worker in the same process does the work and writes the item.

```
POST /items/preview ─────────────────► 202 { jobId }
      │                                (validated against the registry first;
      │                                 an unsupported link never creates a job)
      ▼
services/scrapeQueue.js
      │  atomic claim: findOneAndUpdate({ status: 'queued', nextAttemptAt: <= now })
      │  deduped: an existing queued/running job for this link + user is reused
      ▼
utils/scrapers/index.js  ──► offerup.js     (axios + cheerio)
                         ├─► craigslist.js  (safeFetch + cheerio)
                         ├─► poshmark.js    (safeFetch + cheerio, JSON-LD first)
                         ├─► mercari.js     (Puppeteer via renderPage)
                         ├─► depop.js       (Puppeteer via renderPage)
                         └─► facebook.js    (Puppeteer)
      │
      ▼
services/itemService.js  upsertItemByLink()   ◄── the Item is written HERE
      │
      ▼
GET /items/jobs/:id  polled once a second  ──► queued | running | done | failed
      │
      ▼
POST /items/add ──► addItemToCategory        (looks the item up; never re-scrapes)
```

### Key design decisions

- **The item is saved before the user confirms.** `/items/add` attaches an existing item to
  collections. An abandoned preview therefore leaves an Item that no collection references, which
  `services/maintenance.js` sweeps every 6 hours, ignoring anything saved in the last hour.
- **Upsert, not insert.** `Item.link` is unique, so re-scraping a URL refreshes the existing
  document rather than creating a second copy. `addedAt` is set with `$setOnInsert` and survives.
- **One failure contract.** Every scraper throws a `ScrapeError`; nothing returns `null`. Callers
  cannot otherwise tell "not found" from "blocked" from "markup changed".
- **The registry is the single source of truth** for which marketplaces exist and what they are
  called. `detectPlatform` reads the same list, which is why it can no longer claim support for a
  marketplace that has no scraper.

### Queue behaviour

| Setting | Value | Where |
|---|---|---|
| Concurrent jobs | 2 | `MAX_CONCURRENT_JOBS` |
| Attempts | 3 | `MAX_ATTEMPTS` |
| Backoff | 2s, 4s, 8s | `2000 * 2^(attempts-1)` |
| Job record TTL | 24h | `JOB_TTL_SECONDS` |
| Client poll / give-up | 1s / 90s | `POLL_INTERVAL_MS`, `POLL_CEILING_MS` |

Jobs left `running` by a crash are reclaimed at boot. A retry keeps the original `job.createdAt`,
which is what the item's `addedAt` is taken from — so a scrape that succeeds on the third attempt is
still dated when you asked for it.

---

## Failure contract

**File:** `utils/scrapers/errors.js`

| Code | Meaning | Retried |
|---|---|---|
| `UNSUPPORTED` | No scraper matches the URL | no |
| `NETWORK` | Could not reach the marketplace | **yes** |
| `TIMEOUT` | Marketplace too slow | **yes** |
| `NOT_FOUND` | 404 / 410 — listing removed | no |
| `BLOCKED` | 401 / 403 / 429 | no |
| `PARSE_FAILED` | Reached the page, could not read it | no |
| `BROWSER_UNAVAILABLE` | No Chrome could be resolved | no |

Retrying `UNSUPPORTED` or `NOT_FOUND` burns another full scrape to reach the same answer.
`BROWSER_UNAVAILABLE` is deliberately excluded for a stronger reason: no amount of backoff installs
a browser. It previously came through as `NETWORK` — which *is* retryable — so a missing Chrome
consumed all three attempts and told the user to check their connection.

`asScrapeError(err, fallbackCode)` wraps anything a scraper throws, so a stray `TypeError` in an
extractor surfaces as `PARSE_FAILED` rather than leaking. `classifyAxiosError(err)` maps HTTP
status codes onto the table above.

Each error carries a `userMessage` safe to render, while the server log gets the underlying cause.

---

## Scraper registry

**File:** `utils/scrapers/index.js`

```js
const scrapers = [
  { hosts: ['offerup.com'], path: /^\/item\//, platform: 'OfferUp', scraper: offerupScraper },
  { hosts: ['facebook.com'], path: /^\/marketplace\//, platform: 'Facebook Marketplace', scraper: facebookScraper },
  { hosts: ['craigslist.org'], path: /^\/view\/d\/[^/]+\/[^/]+\/?$|\/\d+\.html$/, platform: 'Craigslist', scraper: craigslistScraper },
  { hosts: ['poshmark.com', 'poshmark.ca'], path: /^\/listing\//, platform: 'Poshmark', scraper: poshmarkScraper },
  { hosts: ['mercari.com'], path: /^\/(us\/)?item\//, platform: 'Mercari', scraper: mercariScraper },
  { hosts: ['depop.com'], path: /^\/products\//, platform: 'Depop', scraper: depopScraper },
];
```

A URL matches on its parsed hostname (exactly, or a subdomain) and then its path, so a look-alike
host (`poshmark.com.evil.example`) or a site name smuggled into a path or query never matches.

| Export | Purpose |
|---|---|
| `scrapeItem(url)` | Route to a scraper and run it; throws `UNSUPPORTED` if none matches |
| `getScraper(url)` | The scraper module, or `null` |
| `isSupported(url)` | Whether any entry matches — used to reject links before enqueuing |
| `detectPlatform(url)` | Display name from the same registry |

### Interface

A scraper exports one function:

```js
async function scrape(url) → {
  title,        // string
  price,        // number, 0 for free, null if unreadable
  description,  // string | null
  condition,    // raw marketplace wording; normalised later
  location,     // string
  imageLinks,   // string[]
  available     // boolean
}
```

Throw a `ScrapeError` on failure. **Never return `null`, and never substitute `0` for a price you
could not read** — `0` means the listing is genuinely free, and the UI renders the two differently.

---

## OfferUp scraper

**File:** `utils/scrapers/offerup.js` · axios + cheerio · no browser · 15s timeout, max 5 redirects

1. Fetch the HTML with a spoofed User-Agent
2. Parse with cheerio
3. Read JSON-LD (`<script type="application/ld+json">`) and Open Graph meta tags
4. Per field, try structured data first, then fall back through DOM selectors

### Fallback chains

The first successful source wins.

**Title:** JSON-LD `name` → `og:title` (strips the " - OfferUp" suffix) →
`[data-testid="listing-title"]` → first `<h1>`

**Price:** JSON-LD `offers.price` → `product:price:amount` → `[data-testid="price"]` /
`[data-qa="price"]` → `p.MuiTypography-h4` → first `$XXX` in the HTML

**Description:** JSON-LD `description` → `og:description` → `<h2>`"Description" + sibling paragraph
→ `h2.MuiTypography-h5` + `p.MuiTypography-body1`

**Condition:** JSON-LD `offers.itemCondition` (parses the schema.org URI, `UsedCondition` → `Used`)
→ `product:condition` → `p.MuiTypography-body1` containing "Condition:"

**Images:** JSON-LD `image` → `og:image` → every `<img>` whose `src` contains `offerup.com`, skipping
the first when there are several (usually the seller avatar)

**Location:** `span.MuiTypography-body1` matching `/^in /`

**Availability:** `false` when the HTML contains "This item is no longer available"

### Errors

Network and HTTP failures go through `classifyAxiosError`; a missing title after parsing throws
`PARSE_FAILED`. Nothing is swallowed.

---

## Structured-data scrapers: Craigslist, Poshmark (and the unregistered eBay)

**Files:** `utils/scrapers/{craigslist,poshmark,ebay}.js` · safeFetch + cheerio · no browser ·
15s timeout, 6MB cap (eBay item pages run past safeFetch's 2MB default)

**eBay is not in the registry.** It answers `403` to every non-browser client (its homepage
included) and to headless Chrome, so a registered eBay turned a working manual-form path into a
guaranteed `BLOCKED`. eBay links therefore go to the manual form. `ebay.js` and its fixture tests
are kept so it can be re-registered with one line if that changes.

All three fetch through `fetchHtml` in `utils/scrapers/structured.js`, which classifies failures
with `classifyAxiosError` and also recognises **bot-challenge pages** (eBay's "Pardon Our
Interruption", Cloudflare's "Just a moment…", PerimeterX). Those answer `200`, so without the
check they parsed as a listing with no title and were reported as `PARSE_FAILED`, which is the
wrong code and points whoever debugs it at the extractor. They now throw `BLOCKED`.

Each module exports a pure `_internals.extract(html, url)` that the tests run against fixtures.

| Site | Primary source | Fallbacks | Unavailable when |
|---|---|---|---|
| Craigslist | `#titletextonly`, `.price`, `#postingbody` (QR boilerplate stripped), `.attrgroup` "condition:" | `og:*`, `geo.placename` | "This posting has been deleted / expired / flagged" |
| eBay | Product JSON-LD (incl. `ProductGroup` variations) | `.x-item-title`, `.x-price-primary`, `og:*` | offer `availability` is OutOfStock/SoldOut, or "This listing has ended" |
| Poshmark | Product JSON-LD (incl. `@graph`) | `h1`, `.listing__description`, `og:*` | offer `availability`, or the listing's own `sold-tag` badge |

Craigslist publishes no Product JSON-LD, but its posting markup has been stable for years and is
the same under both URL shapes (`/<area>/<cat>/d/<slug>/<id>.html` and `/view/d/<slug>/<token>`). A
removed posting with no title throws `NOT_FOUND`, not `PARSE_FAILED`.

Prices follow the Facebook rule: `null` means "no price found" and is kept apart from a real `0`.

---

## Rendered scrapers: Mercari, Depop

**Files:** `utils/scrapers/{mercari,depop}.js` · Puppeteer via `renderPage` · needs Chrome

Both sites render client-side behind Cloudflare, so a plain GET returns either an app shell or a
challenge. `renderPage(url, collectPageMetadata, options)` in `browser.js` loads the page in its own
context and runs `collectPageMetadata` in it. That function returns the JSON-LD script texts, every
meta tag, the first `h1`, and whether a site-specific sold selector or sold phrase is present.
`fromPageMetadata` then builds the item with the same pure helpers the HTTP scrapers use.

`collectPageMetadata` runs **inside Chromium** as serialized source. It must stay self-contained:
no closures over module scope and no requires. A test checks that it parses on its own.

A title that is still "Just a moment…" means the challenge never cleared, and it throws `BLOCKED`.

---

## Facebook Marketplace scraper

**File:** `utils/scrapers/facebook.js` · Puppeteer · 25s navigation timeout

Facebook server-renders listing data into `__bbox` Relay payloads inside `<script>` tags. There is
no stable DOM to target, so the data is pulled out of those payloads.

1. Extract the listing id from the URL
2. Open an isolated `BrowserContext`, block images/stylesheets/fonts/media
3. Navigate with `domcontentloaded` — the payloads are in the initial HTML
4. Collect scripts that contain both `__bbox` and the listing id (max 10, 300KB each)
5. Build candidates, score them, merge the strong ones
6. Fall back to Open Graph tags if nothing scored

### Extraction is anchored to the listing

**This is the subtle part.** A Marketplace page embeds dozens of `listing_price` nodes for the
related-items rail. Matching a field regex against the whole script returns the *first* hit, which
is frequently a different seller's listing. Measured live, that produced a "Hoverboard" candidate at
$20 on a pressure-washer page, and an "Anime figures" candidate at $5 on an Xbox page.

So each candidate is built from a **±6000 character window around an occurrence of the listing id**,
not from the whole script. Scoring then compares candidates that all genuinely describe the target.

### Scoring

| Signal | Points |
|---|---|
| `share_uri` contains the listing id | +6 |
| Has title | +3 |
| Has price | +3 |
| Has location | +2 |
| `is_live === true` | +2 |
| Description > 120 chars | +2 |
| Description > 40 chars | +1 |
| Has condition | +1 |
| `is_sold === true` | −6 |
| `is_pending === true` | −3 |

### Merging

1. Sort by score, take the best
2. Merge in fields from candidates within 4 points of the top
3. Fill **missing** fields only — never overwrite
4. A price of `0` counts as present, not missing. Treating it as fillable would let a neighbouring
   listing's price overwrite a genuine "Free"
5. Prefer a description 30+ characters longer
6. `available = (isLive !== false) && !isSold && !isPending`

### Price resolution

`null` (no price node in the window) and `0` (Facebook reports `$0`) are kept distinct all the way
to the database. `||` cannot be used to pick a fallback here, because a genuine `0` is falsy and
would fall through to the meta tag and then to `0`, collapsing both states.

---

## Browser lifecycle

**File:** `utils/scrapers/browser.js`

### Resolving a Chrome

`puppeteer.launch()` with no options uses `puppeteer.executablePath()`, which returns a path whether
or not anything is installed there — so a machine that never ran the browser download failed at
*launch* with an opaque error rather than at resolution. The chain now resolves up front, memoized,
and prefers a browser that exists:

1. `PUPPETEER_EXECUTABLE_PATH` — an explicit override; a stale value logs and falls through rather
   than taking scraping down
2. Puppeteer's managed download, **only if the file is really on disk**
3. The system Chrome

Failing all three throws `BROWSER_UNAVAILABLE` naming the install command.

### One browser, bounded contexts

The launch **promise** is memoized, not the resolved browser. Memoizing the browser left a window
where two concurrent callers both saw `null`, both called `launch()`, and the second assignment
orphaned the first Chromium beyond the reach of `closeBrowser()`. The memo is cleared on rejection
so a transient failure does not poison every later call.

Each scrape takes a slot from a 2-permit semaphore (`MAX_CONCURRENT_CONTEXTS`) and creates its own
`BrowserContext`, released in a `finally`. Contexts are real browser profiles, not cheap handles, so
they are bounded independently of queue concurrency.

`closeBrowser()` runs from the server's shutdown hooks.

### renderPage

`renderPage(url, evaluateFn, arg, { waitFor })` wraps the whole page lifecycle for scrapers that
only need to read a rendered DOM: slot, context, UA and viewport, blocking images/fonts/media,
navigation timeout → `TIMEOUT`, HTTP 404/410 → `NOT_FOUND`, 401/403/429 → `BLOCKED`, an optional
selector wait (missing is not an error), and an evaluate timeout. A browser that will not start is
`BROWSER_UNAVAILABLE`. Mercari and Depop use it. Facebook predates it and still keeps its own copy
of the same steps.

---

## Condition normalizer

**File:** `utils/conditionMap.js`

Canonical values, best to worst: `New`, `Like New`, `Good`, `Fair`, `Poor`.

Matching is substring-based on the lowercased string, and **order matters** — "like new" is checked
before "new", or every "Like New" would be filed as "New".

| Keywords | Canonical |
|---|---|
| `like new`, `likenew` | Like New |
| `new`, `brand new`, `sealed` | New |
| `very good`, `excellent` | Good |
| `good` | Good |
| `fair`, `acceptable`, `decent` | Fair |
| `poor`, `parts`, `salvage`, `broken` | Poor |

Anything unrecognised returns **`null`**, not the raw text. `Item.condition` is enum-constrained, so
passing scraped wording through would fail validation on every save. This is applied once, in
`normalizeItemData`, so scrapers stay free to return whatever the marketplace said.

---

## Item service

**File:** `services/itemService.js`

| Function | Purpose |
|---|---|
| `upsertItemByLink(link, itemData, platform, addedAt)` | Insert or refresh by unique link |
| `normalizeItemData(data)` | Coerce scraper output to the schema's shapes |
| `detectPlatform(link)` | Re-exported from the registry |
| `isSupported(link)` | Re-exported from the registry |

`upsertItemByLink` uses `$set` for the scraped fields and `$setOnInsert` for `addedAt`, so a refresh
updates price and availability while preserving the date you first saved it. `E11000` from two
concurrent upserts of the same link is retried once: the second pass finds the now-existing document
and updates it.

`addedAt` is supplied by the caller — the queue passes `job.createdAt`, the moment the user hit save.
It used to default to "now", which dated an item by when its scrape *finished*, so a slow or retried
scrape jumped the queue in "Date saved" ordering.

`normalizeItemData` accepts exactly one input shape: whatever a scraper returned. It previously also
accepted `cached*` fields posted back from the browser; that path is gone.

---

## Item model

**File:** `models/Items.js`

| Field | Notes |
|---|---|
| `link` | **unique**, trimmed — the identity of an item |
| `price` | `Number`, default `null`. `null` = unreadable, `0` = free |
| `condition` | enum of the five canonical values, or `null` |
| `platform` | from the registry, default `Unknown` |
| `available` | boolean |
| `addedAt` | when the user asked to save it |
| `createdAt` / `updatedAt` | Mongoose timestamps; `updatedAt` records refreshes |

---

## Adding a scraper

**1.** Create `utils/scrapers/newsite.js`. For a site that publishes JSON-LD or OpenGraph, the
helpers in `structured.js` do most of the work:

```js
const cheerio = require('cheerio');
const { ScrapeError, CODES, asScrapeError } = require('./errors');
const { fetchHtml, findProductJsonLd, readOffer, productImages, cleanImages, metaReader } = require('./structured');

function extract(html, url) {
  const $ = cheerio.load(html);
  const product = findProductJsonLd($);
  const offer = readOffer(product);
  return {
    title: product?.name || metaReader($)('og:title'),
    price: offer.price,                     // null when unknown, never 0
    description: product?.description || null,
    condition: offer.conditionRaw,          // normalised later by conditionMap
    location: '',
    imageLinks: cleanImages(productImages(product), url),
    available: offer.available !== false,
  };
}

async function scrape(url) {
  const html = await fetchHtml(url, 'NewSite');   // throws classified ScrapeErrors
  try {
    const item = extract(html, url);
    if (!item.title) throw new ScrapeError(CODES.PARSE_FAILED);
    return item;
  } catch (err) {
    throw asScrapeError(err);
  }
}

module.exports = { scrape, _internals: { extract } };
```

For a client-rendered site, call `renderPage(url, collectPageMetadata, options)` and pass the
result to `fromPageMetadata` (see `mercari.js`).

**2.** Register it. This is the only place the marketplace is named:

```js
const scrapers = [
  // ...
  { hosts: ['newsite.com'], path: /^\/listing\//, platform: 'NewSite', scraper: require('./newsite') },
];
```

**3.** Add a fixture test for `_internals.extract`. Nothing else needs changing: `detectPlatform`,
`isSupported`, the queue, the condition normalizer, the item model, and the entire frontend pick it
up from the registry.

---

## Logging

`utils/logger.js` exposes `info`, `error` and `debug`. **`debug` is a no-op unless
`NODE_ENV=development`**, which is worth knowing: queue retries were logged at `debug` for a while,
so a transient failure that later succeeded left no trace at any level. Anything you need to see in
production belongs at `error`.

---

## File map

| File | Role |
|---|---|
| `services/scrapeQueue.js` | Claim, run, retry, reclaim |
| `services/maintenance.js` | Sweep abandoned previews |
| `services/itemService.js` | Upsert and normalise |
| `models/ScrapeJob.js` | Job records, 24h TTL, dedupe index |
| `utils/scrapers/index.js` | Registry and routing |
| `utils/scrapers/errors.js` | `ScrapeError`, codes, retry policy |
| `utils/scrapers/offerup.js` | axios + cheerio |
| `utils/scrapers/facebook.js` | Puppeteer + anchored `__bbox` extraction |
| `utils/scrapers/craigslist.js` | safeFetch + cheerio, posting markup |
| `utils/scrapers/ebay.js` | safeFetch + cheerio, JSON-LD first — **unregistered** |
| `utils/scrapers/poshmark.js` | safeFetch + cheerio, JSON-LD first |
| `utils/scrapers/mercari.js` | Puppeteer via `renderPage` |
| `utils/scrapers/depop.js` | Puppeteer via `renderPage` |
| `utils/scrapers/structured.js` | `fetchHtml`, challenge detection, JSON-LD/OG helpers |
| `utils/scrapers/browser.js` | Chrome resolution, launch memo, context semaphore, `renderPage` |
| `utils/conditionMap.js` | Raw condition → canonical or `null` |
| `routes/items.js` | `/preview`, `/jobs/:id`, `/add` |
| `public/js/lib/add-listing.js` | Enqueue and poll from the modal |
