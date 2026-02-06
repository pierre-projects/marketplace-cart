# MarketplaceCart Scraper System

Complete documentation of the scraper architecture, data flow, and implementation details.

---

## System Overview

The scraper system extracts product listing data (title, price, condition, location, images, availability) from marketplace URLs. It uses a **registry pattern** to route URLs to platform-specific scrapers, a **service layer** to manage the preview/create lifecycle, and a **condition normalizer** for consistent data storage.

### Data Flow

```
User enters URL in dashboard modal
        |
        v
  POST /items/preview  (AJAX)
        |
        v
  itemService.previewItem(link)
        |
        v
  scrapers/index.js  -->  scrapeItem(url)
        |                       |
        |           +-----------+-----------+
        |           |                       |
        v           v                       v
   getScraper()   offerup.scrape()    facebook.scrape()
                  (axios + cheerio)   (Puppeteer + __bbox)
        |
        v
  Return scraped data --> Frontend shows preview
  User caches data in hidden form fields
        |
        v
  User clicks "Add Listing"
        |
        v
  POST /items/add  (form submit with cached data)
        |
        v
  itemService.createItem(link, cachedData)
        |
        v
  normalizeItemData() + normalizeCondition()
        |
        v
  new Item({...data, link, platform}).save()
        |
        v
  Category.$addToSet(item) --> Redirect to /dashboard
```

### Key Design Decisions

- **Two-step flow**: Preview first, then save. Cached data avoids re-scraping.
- **Registry pattern**: Adding a new scraper = one file + one line in the registry.
- **Condition normalization**: All platforms' conditions map to 5 canonical values at the service layer, not in each scraper.
- **Browser singleton**: Puppeteer-based scrapers share one browser instance across the app lifecycle.

---

## Scraper Registry

**File:** `utils/scrapers/index.js`

The registry maps URL patterns to scraper modules. Every scrape flows through `scrapeItem()`.

### Registered Scrapers

| Pattern | Scraper | Method |
|---|---|---|
| `/offerup\.com\/item/` | `./offerup` | HTTP (axios + cheerio) |
| `/facebook\.com\/marketplace/` | `./facebook` | Browser (Puppeteer) |

### Interface

Every scraper module must export:

```js
module.exports = { scrape };
```

Where `scrape(url)` is an async function returning:

```js
{
  title: string,
  price: number,
  description: string | null,
  condition: string | null,
  location: string | null,
  imageLinks: string[],
  available: boolean
}
```

### Functions

| Function | Purpose |
|---|---|
| `scrapeItem(url)` | Find matching scraper, run it, log timing |
| `getScraper(url)` | Return scraper module for a URL (or null) |
| `isSupported(url)` | Check if any scraper handles this URL |

### Timing

`scrapeItem()` logs execution time for every scrape:

```
Scrape [offerup\.com\/item]: 1102ms
Scrape [facebook\.com\/marketplace]: 8234ms
```

---

## OfferUp Scraper

**File:** `utils/scrapers/offerup.js`
**Method:** HTTP request via axios, HTML parsing via cheerio
**No browser required**

### How It Works

1. Fetch page HTML with axios (spoofed User-Agent)
2. Parse HTML with cheerio
3. Extract JSON-LD structured data (`<script type="application/ld+json">`)
4. Extract Open Graph meta tags
5. For each field, try structured data first, then fall back through DOM selectors

### Fallback Chains

Each field has a prioritized extraction chain. The first successful source wins.

**Title:**
1. JSON-LD `name`
2. Meta `og:title` (strips " - OfferUp" suffix)
3. `[data-testid="listing-title"]`
4. First `<h1>` element

**Price:**
1. JSON-LD `offers.price`
2. Meta `product:price:amount`
3. `[data-testid="price"]` or `[data-qa="price"]`
4. `p.MuiTypography-h4`
5. Regex: first `$XXX` pattern in HTML

**Description:**
1. JSON-LD `description`
2. Meta `og:description`
3. `<h2>` with text "Description" + sibling paragraph
4. MUI class: `h2.MuiTypography-h5` "Description" + `p.MuiTypography-body1`

**Condition:**
1. JSON-LD `offers.itemCondition` (parses schema.org URI, e.g. `UsedCondition` -> `Used`)
2. Meta `product:condition`
3. `p.MuiTypography-body1` containing "Condition:"

**Images:**
1. JSON-LD `image` (array or single)
2. Meta `og:image`
3. All `<img>` with `src` containing `offerup.com` (skips first if multiple — usually profile pic)

**Location:**
- `span.MuiTypography-body1` matching `/^in /` (strips "in " prefix)

**Availability:**
- `false` if HTML contains `"This item is no longer available"`

### Error Handling

Returns `null` on any error (axios failure, parse error). Logged via `logger.error()`.

---

## Facebook Marketplace Scraper

**File:** `utils/scrapers/facebook.js`
**Method:** Puppeteer browser automation
**Requires:** `utils/browser.js` singleton

### How It Works

1. Extract listing ID from URL (`/item/(\d+)/`)
2. Get shared browser via `getBrowser()`
3. Create isolated incognito context
4. Navigate to URL with `domcontentloaded` (no need to wait for async requests)
5. Fire-and-forget modal dismiss (`[aria-label="Close"]`)
6. Single `page.evaluate()` extracts scripts, meta tags, and images
7. Multi-candidate scoring selects best data from multiple `__bbox` payloads
8. Close context (not browser)

### Why Multi-Candidate?

Facebook splits listing data across multiple `__bbox` Relay payloads in different `<script>` tags. A single script rarely contains all fields. The scraper extracts candidates from ALL matching scripts, scores them, and merges the best ones.

### Script Extraction (in page.evaluate)

```
Filter: __bbox + listingId in script text
Caps: max 10 scripts, 300KB each, skip < 200 chars
```

### Candidate Extraction

For each matching script, regex-extract these fields:

| Field | Primary Pattern | Fallback Pattern |
|---|---|---|
| Title | `"marketplace_listing_title":"..."` | `"base_marketplace_listing_title":"..."` |
| Price | `"listing_price":{..."amount":"..."}` | `"formatted_amount_zeros_stripped":"..."` |
| Location | `"location_text":{"text":"..."}` | — |
| Description | `"redacted_description":{"text":"..."}` | `"description":{"text":"..."}` |
| Condition | `"attribute_name":"Condition"..."label":"..."` | — |
| Sold/Live/Pending | `"is_sold":true/false` etc. | — |
| Share URI | `"share_uri":"..."` | — |

Only candidates with at least one useful field are kept.

### Scoring Algorithm

Each candidate gets a deterministic score:

| Signal | Points |
|---|---|
| `share_uri` contains listing ID | +6 |
| Has title | +3 |
| Has price | +3 |
| Has location | +2 |
| `is_live === true` | +2 |
| Description > 120 chars | +2 |
| Description > 40 chars | +1 |
| Has condition | +1 |
| Script > 200KB | +1 |
| `is_sold === true` | -6 |
| `is_pending === true` | -3 |

### Candidate Merging

1. Sort candidates by score (highest first)
2. Take the best candidate
3. Merge in fields from runners-up within 4 points of top score
4. Merge rule: fill missing fields only, never overwrite existing
5. Exception: use longer description if secondary is 30+ chars longer
6. Calculate `available = (isLive !== false) && !isSold && !isPending`

### OG Meta Fallback

If no candidates extracted, fall back to Open Graph meta tags:
- `og:title`, `og:description`, `og:image`, `product:price:amount`
- Sets `condition: null`, `location: null`, `available: true`

### Performance Optimizations

| Optimization | Impact |
|---|---|
| Browser singleton (no `puppeteer.launch()` per scrape) | ~1-3s saved |
| `domcontentloaded` instead of `networkidle2` | ~3-8s saved |
| Block images/CSS/fonts via request interception | Bandwidth saved |
| Single `page.evaluate()` (scripts + meta + images) | ~0.5s saved |
| Fire-and-forget modal dismiss (no 5s wait) | ~2-6s saved |
| Script caps (10 scripts, 300KB each) | ~0.3-1s saved |

### String Decoding

`safeDecode()` unescapes JSON strings from `__bbox` data:
- `\"` -> `"`
- `\n` -> newline
- `\u2019` -> right single quote
- `\u201c` / `\u201d` -> smart double quotes

---

## Browser Singleton

**File:** `utils/browser.js`

Manages a single Puppeteer browser instance shared across the app.

| Function | Purpose |
|---|---|
| `getBrowser()` | Return existing browser or lazy-launch one. Checks `browser.isConnected()` for stale instances. |
| `closeBrowser()` | Close browser and null the reference. Called on shutdown. |

### Launch Config

```js
puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
})
```

### Shutdown Hooks

In `server.js`, SIGINT and SIGTERM call `closeBrowser()` before `process.exit(0)`.

### Usage in Scrapers

```js
const browser = await getBrowser();             // Shared instance
const ctx = await browser.createBrowserContext(); // Isolated context
const page = await ctx.newPage();
// ... scrape ...
await ctx.close();  // Close context, NOT browser
```

---

## Condition Normalizer

**File:** `utils/conditionMap.js`

Maps raw condition strings from any marketplace to 5 canonical values.

### Canonical Conditions (ordered best to worst)

`New` > `Like New` > `Good` > `Fair` > `Poor`

### Mapping Rules

| Input Contains (case-insensitive) | Maps To |
|---|---|
| "like new", "likenew" | Like New |
| "new", "brand new", "sealed" | New |
| "very good", "excellent" | Good |
| "good" | Good |
| "fair", "acceptable", "decent" | Fair |
| "poor", "parts", "salvage", "broken" | Poor |

**Order matters**: "like new" is checked before "new" so "Used - Like New" maps to "Like New", not "New".

If no pattern matches, the original string is returned unchanged.

### Where It's Applied

In `itemService.js` -> `normalizeItemData()`:
```js
condition: normalizeCondition(data.condition || data.cachedCondition) || null
```

Scrapers return raw strings. Normalization happens at the service boundary.

---

## Item Service

**File:** `services/itemService.js`

### previewItem(link)

Scrape-only, no database save. Used for AJAX preview.

1. Check `isSupported(link)` -> throw if unsupported
2. `scrapeItem(link)` -> get raw data
3. Validate title exists -> throw if missing
4. Return raw scraped data

### createItem(link, cachedData = null)

Scrape (or use cache) + save to database.

1. If `cachedData` has title -> use cached data (skip scraping)
2. Else -> scrape fresh + validate
3. `normalizeItemData()` -> consistent types + condition normalization
4. `detectPlatform(link)` -> "OfferUp", "Facebook Marketplace", etc.
5. `new Item({...data, link, platform}).save()`
6. Return saved document

### normalizeItemData(data)

Handles both fresh scraped data and cached form data (prefixed with `cached`):

| Field | Logic |
|---|---|
| title | `data.title \|\| data.cachedTitle \|\| ''` |
| price | Parse as float, default 0 |
| condition | `normalizeCondition(raw)`, default null |
| description | String or null |
| location | String, default `''` |
| imageLinks | Parse JSON if string, default `[]` |
| available | Coerce `'true'` string to boolean |

### detectPlatform(link)

| URL Contains | Platform |
|---|---|
| `offerup.com` | OfferUp |
| `ebay.com` | eBay |
| `mercari.com` | Mercari |
| `facebook.com/marketplace` | Facebook Marketplace |
| (default) | Unknown |

---

## Item Model

**File:** `models/Items.js`

| Field | Type | Default | Required |
|---|---|---|---|
| `title` | String | — | No |
| `price` | Number | 0 | No |
| `condition` | String | — | No |
| `description` | String | — | No |
| `imageLinks` | [String] | — | No |
| `location` | String | — | No |
| `link` | String | — | **Yes** |
| `platform` | String | 'Unknown' | No |
| `available` | Boolean | true | No |
| `addedAt` | Date | Date.now | No |

---

## Frontend Flow

**File:** `public/js/dashboard.js`

### Step 1: Preview

1. User enters URL in modal input
2. Click "Preview" -> AJAX `POST /items/preview` with `{ link }`
3. Button shows "Loading..." while waiting
4. On success: populate preview fields (title, price, condition, location, description, image)
5. Cache all scraped data in hidden form fields (`cachedTitle`, `cachedPrice`, etc.)
6. Show Step 2

### Step 2: Confirm & Add

1. User sees preview data + selects optional category
2. Click "Add Listing" -> form POST to `/items/add`
3. Sends cached data + link + category IDs
4. Server uses cached data (no re-scrape) -> saves to DB
5. Redirect to dashboard

### Error Handling

- AJAX errors show inline error message, keep Step 1 visible
- Form errors redirect with flash message

---

## HTTP Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/items/preview` | AJAX scrape preview | Yes |
| POST | `/items/add` | Save item + assign categories | Yes |
| DELETE | `/items/:id` | Delete item + remove from all categories | Yes |
| POST | `/items/:id/assign-categories` | Reassign item to categories | Yes |

All endpoints log execution time in the server console.

---

## Adding a New Scraper

To add support for a new marketplace (e.g., eBay):

### 1. Create the scraper file

```
utils/scrapers/ebay.js
```

Export a `scrape(url)` function that returns the standard item object:

```js
async function scrape(url) {
  // Fetch and parse the listing page
  // Return: { title, price, description, condition, location, imageLinks, available }
}

module.exports = { scrape };
```

**Choose your method:**
- **HTTP (axios + cheerio)**: Faster, simpler. Use if the site serves data in HTML/JSON-LD/meta tags.
- **Puppeteer**: Use if the site requires JavaScript rendering. Import `getBrowser()` from `../browser`.

### 2. Register in the index

In `utils/scrapers/index.js`:

```js
const ebayScraper = require('./ebay');

const scrapers = [
  { pattern: /offerup\.com\/item/, scraper: offerupScraper },
  { pattern: /facebook\.com\/marketplace/, scraper: facebookScraper },
  { pattern: /ebay\.com\/itm/, scraper: ebayScraper },
];
```

### 3. Add platform detection

In `services/itemService.js` -> `detectPlatform()`:

```js
if (link.includes('ebay.com')) return 'eBay';
```

### 4. Done

No other changes needed. The condition normalizer, item model, frontend, and routes all work automatically with any scraper that follows the interface.

---

## Logging

**File:** `utils/logger.js`

| Method | Prefix | Active When |
|---|---|---|
| `logger.info()` | `[INFO]` | All environments except `test` |
| `logger.error()` | `[ERROR]` | Always |
| `logger.debug()` | `[DEBUG]` | Only when `NODE_ENV=development` |

Scrapers use `logger.debug()` to log which data source was used for each field, candidate scores, and extraction steps. Set `NODE_ENV=development` to see these.

---

## File Map

```
utils/
  browser.js              Puppeteer singleton (getBrowser, closeBrowser)
  conditionMap.js          Condition normalizer (New/Like New/Good/Fair/Poor)
  logger.js                Environment-aware logging
  scrapers/
    index.js               Scraper registry (URL pattern -> scraper routing)
    offerup.js             OfferUp scraper (axios + cheerio)
    facebook.js            Facebook scraper (Puppeteer + multi-candidate scoring)

services/
  itemService.js           Preview/create flows, normalization, platform detection

models/
  Items.js                 Mongoose schema for Item documents

routes/
  items.js                 HTTP endpoints for preview/add/delete/assign

middleware/
  validation.js            URL validation (express-validator)

public/js/
  dashboard.js             Frontend preview/add modal flow

server.js                  Shutdown hooks for browser cleanup
```
