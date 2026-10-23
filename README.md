# MarketplaceCart

Save listings from secondhand marketplaces into collections, see what the pile actually costs, and
share it. Paste a link from OfferUp, Facebook Marketplace, Craigslist, Poshmark, Mercari or Depop; the app scrapes the title, price, photos,
condition, location and availability in the background and files it away.

> **A note on wording.** Collections live at `/collections`; old `/categories/...` links redirect
> there with a 308. The Mongoose model is still `Category` (and its MongoDB collection
> `categories`) — renaming stored data would buy nothing a user can see.

## Features

- **Paste a link, get a listing** — OfferUp, Facebook Marketplace, Craigslist, Poshmark, Mercari
  and Depop, with title, price, images, condition, location and whether it is still live.
- **Any other site, or no link at all** — eBay, Etsy, Kijiji, Nextdoor, a shop page, a listing seen
  in a group chat. Paste the link and the form is prefilled from the page's own preview metadata
  (OpenGraph / schema.org) when it can be read; check it, edit it, save it. Manual listings are
  yours alone and stay editable.
- **Scraping runs in the background** — the request returns immediately with a job id and the modal
  shows live status, so a slow Facebook page never blocks the page.
- **Collections** — group saved items by room, project, or trip. An item can live in several at
  once. Rename a collection by clicking its title.
- **Marketplace subtotals** — a stats panel shows the total and a donut breakdown of where the money
  is going, per marketplace, on both the dashboard and each collection.
- **Search, filter and sort** — across title and description, by status, condition and marketplace,
  with the state mirrored into the URL so a filtered view is linkable.
- **Sharing** — share a collection as a viewer (read-only) or editor (can add), or make it public.
- **Appearance** — light by default, dark on request, five accent colours. Stored per device.
- **Honest data** — an unreadable price says "Price unavailable" rather than pretending the item is
  free; an unrecognised condition is stored as nothing rather than as junk text.

## Tech stack

- **Backend** — Node.js, Express 4
- **Database** — MongoDB with Mongoose 8
- **Views** — EJS with `express-ejs-layouts`
- **Auth** — Passport (local strategy), sessions in MongoDB via `connect-mongo`
- **Scraping** — axios + cheerio (OfferUp, Craigslist, Poshmark), Puppeteer (Facebook
  Marketplace, Mercari, Depop)

## Getting started

### Prerequisites

- **Node.js ≥ 20.11** — `node --watch` is used by `npm run dev` and is only stable from 20.11.
- **MongoDB**, local or Atlas.
- **A Chrome**, only if you want Facebook Marketplace, Mercari or Depop listings. See [Chrome](#chrome) below —
  usually there is nothing to do.

### Install

```bash
git clone https://github.com/pierre-projects/marketplace-cart.git
cd MarketplaceCart
npm install
```

Copy `.env.example` to `.env` in the project root (`config/env.js` validates it at startup):

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/marketplacecart
SESSION_SECRET=change_this_to_something_random
```

### Run

```bash
npm run dev     # node --watch, restarts on server-side changes
npm start       # plain node
npm test        # unit tests (node --test, no database needed)
```

Then open http://localhost:5000.

`node --watch` only reloads modules the process actually loads, so editing a view or a stylesheet
does **not** restart the server — save the file and refresh the browser.

### Chrome

Only the Facebook, Mercari and Depop scrapers need a browser. It is resolved in this order, and the first one that
exists on disk wins:

1. `PUPPETEER_EXECUTABLE_PATH`, if you set it
2. Puppeteer's own downloaded Chrome (`npx puppeteer browsers install chrome`)
3. Chrome installed on the system

If none resolve, those scrapes fail with a `BROWSER_UNAVAILABLE` error naming the fix, and are
**not** retried — no amount of backoff installs a browser. OfferUp, Craigslist and Poshmark are
unaffected; they never launch a browser.

### Repairing existing data

```bash
npm run migrate         # dry run: reports what it would change
npm run migrate:apply   # actually writes
```

Deduplicates items by link, collapses duplicate collection entries, normalises conditions, backfills
the default collection flag, and syncs indexes.

## How adding an item works

This is the part most worth understanding, because scraping does **not** happen inside the request.

```
paste a link
      │
      ▼
POST /items/preview ───────────────► 202 { jobId }      (returns immediately)
      │
      ▼
scrapeQueue: atomic claim, deduped by link + user
      │
      ▼
scraper ──► upsertItemByLink        ◄── the Item is written to MongoDB HERE
      │
      ▼
client polls GET /items/jobs/:id every second ──► done | failed
      │
      ▼
you confirm ──► POST /items/add ──► addItemToCategory   (no re-scrape)
```

Two consequences worth knowing:

- **The item exists before you confirm.** `/items/add` does not scrape; it looks up the item that
  the worker already saved and attaches it to your collections. A preview you abandon leaves an Item
  that no collection references.
  `services/maintenance.js` sweeps those every 6 hours, ignoring anything from the last hour.
- **Re-adding a link refreshes it.** A scraped `Item.link` is unique, so a second save updates price and
  availability on the existing document instead of creating a duplicate.

### The queue

| Setting | Value |
|---|---|
| Concurrent jobs | 2 |
| Attempts before giving up | 3 |
| Backoff | 2s, 4s, 8s |
| Retried codes | `NETWORK`, `TIMEOUT` only |
| Job record lifetime | 24h (TTL index) |
| Client poll interval / ceiling | 1s → 3s backoff / 90s |

Jobs left `running` by a crash are reclaimed at boot and every minute after. An idle worker backs
off from 1.5s to 15s between polls. Enqueueing a link that is already queued for
you returns the **same** job rather than scraping twice.

### When a scrape fails

Every scraper throws a `ScrapeError` carrying a machine-readable code; nothing returns `null`.

| Code | Meaning | Retried |
|---|---|---|
| `UNSUPPORTED` | Not a marketplace we handle | no |
| `NETWORK` | Could not reach the site | **yes** |
| `TIMEOUT` | Site too slow | **yes** |
| `NOT_FOUND` | Listing gone (404/410) | no |
| `BLOCKED` | Refused us (401/403/429) | no |
| `PARSE_FAILED` | Reached it, could not read it | no |
| `BROWSER_UNAVAILABLE` | No Chrome to drive | no |

The user sees a plain-language message; the server log carries the underlying cause.

## Data model notes

- **`price`** — a number, `0` for a genuinely free listing, and `null` when the scraper could not
  read one. These are different things and the UI shows them differently ("Free" vs "Price
  unavailable"). Totals count only real prices.
- **`condition`** — one of `New`, `Like New`, `Good`, `Fair`, `Poor`, or `null`. Raw marketplace
  wording is normalised at the service layer; anything unrecognised becomes `null` rather than being
  stored verbatim.
- **`addedAt`** — when *you* asked to save the link, taken from the job's creation time, so a slow
  or retried scrape does not push the item to the top of "Date saved".
- **`link`** — unique among scraped items, which is what makes re-adding a refresh. Optional for
  manual items.
- **`source`** — `scraped` (shared, one document per link, content comes from the marketplace) or
  `manual` (owned by one user via `owner`, content typed by them, only they can edit it).

## Manual listings

```
paste a link ──► POST /items/preview
                    │
      supported? ───┴── no ──► 400 { code: UNSUPPORTED } ──► manual form
                                                                │
                                       POST /items/prefill ◄────┘  (best effort, never fails)
                                                                │
                                        you edit ──► POST /items/manual
```

Prefill fetches the page through `utils/safeFetch.js`, which resolves the hostname and refuses
private, loopback, link-local and cloud-metadata addresses on every redirect hop, with an 8s timeout
and a 2 MB cap. A failed scrape of a supported marketplace also offers "Add it manually".

## Security

- **Collections:** every write checks the caller's role through `services/permissions.js`. The
  default collection is resolved on the server, never taken from the form.
- **CSRF:** a per-session token, sent as `_csrf` in forms and `X-CSRF-Token` from `lib/api.js`.
- **Headers:** Helmet with a CSP; the one inline script (the theme stamp) runs under a nonce, so
  views use `data-confirm` / `data-autosubmit` instead of inline handlers.
- **Rate limits:** sign-in/registration and preview/prefill, per IP.
- **Sessions:** `httpOnly`, `sameSite=lax`, `secure` in production. Logout is a POST.
- **Scraped URLs** match the registry by parsed hostname and path, not a substring.

## Project structure

```
MarketplaceCart/
├── config/
│   ├── env.js                    # every env var, validated once at boot
│   └── passport.js               # Local strategy
├── middleware/
│   ├── authMiddleware.js         # ensureAuthenticated
│   ├── csrf.js                   # session token check
│   ├── errorHandlers.js          # 404 + last-resort handler
│   ├── rateLimit.js              # auth and scrape limits
│   └── validation.js             # express-validator rules, ObjectId params
├── models/
│   ├── User.js
│   ├── Items.js                  # source scraped|manual, partial unique link, owner
│   ├── Category.js               # collections, sharing roles, isDefault
│   └── ScrapeJob.js              # queue records, 24h TTL
├── routes/
│   ├── index.js                  # landing + dashboard
│   ├── auth.js                   # register / login / logout
│   ├── items.js                  # preview, prefill, manual, edit, add, unsave, assign
│   ├── listings.js               # all saved items
│   ├── collections.js            # collections CRUD, sharing, membership
│   └── settings.js               # appearance
├── services/
│   ├── itemService.js            # scraped upserts, manual items, item access
│   ├── categoryService.js        # every collection read/write, permission-checked
│   ├── categoryStats.js          # pure: stats, platform breakdown, ordering, card stats
│   ├── permissions.js            # owner / editor / viewer / public
│   ├── scrapeQueue.js            # background worker: claim, retry, reclaim
│   └── maintenance.js            # sweeps abandoned previews
├── utils/
│   ├── format.js                 # money, relative dates, plural, platform helpers
│   ├── safeFetch.js              # SSRF-safe GET for user-supplied URLs
│   ├── conditionMap.js           # raw condition -> canonical or null
│   ├── httpResponses.js          # safe redirects, flash errors, error pages
│   ├── logger.js
│   └── scrapers/
│       ├── index.js              # URL -> scraper registry
│       ├── errors.js             # ScrapeError contract
│       ├── browser.js            # Chrome resolution, context semaphore, renderPage
│       ├── structured.js         # fetchHtml, challenge detection, JSON-LD/OG helpers
│       ├── offerup.js            # safeFetch + cheerio
│       ├── craigslist.js         # safeFetch + cheerio, posting markup
│       ├── ebay.js               # unregistered: eBay blocks automated clients
│       ├── poshmark.js           # safeFetch + cheerio, JSON-LD first
│       ├── mercari.js            # Puppeteer via renderPage
│       ├── depop.js              # Puppeteer via renderPage
│       ├── facebook.js           # Puppeteer + anchored __bbox extraction
│       └── generic.js            # OpenGraph/JSON-LD prefill for any site
├── views/
│   ├── layouts/main.ejs          # shell: sidebar or navbar, no-flash theme script
│   ├── partials/                 # sidebar, item card, stats panel, empty state, modals
│   ├── auth/  collections/  items/  listings/
│   ├── dashboard.ejs  settings.ejs  index.ejs  error.ejs
├── public/
│   ├── css/                      # tokens -> base -> components -> layout -> pages
│   ├── js/app.js                 # every page: theme, account menu, form behaviours
│   ├── js/pages/                 # one ES module per page
│   ├── js/lib/                   # api, dialog, disclosure, toast, item cards, add-listing…
│   └── images/marketplaces/      # OfferUp and Facebook marks
├── scripts/
│   ├── migrate.js                # data repair, dry-run by default
│   └── scrape-once.js            # node scripts/scrape-once.js <url>
├── test/                         # node --test
├── server.js                     # boots after Mongo connects; starts queue + maintenance
└── package.json
```

## Design system

The look is "refined commerce": neutral white / near-black surfaces with hairline borders, so the
listing photos carry the colour. The raspberry brand colour is reserved for primary actions, the
active nav item, focus rings and the few figures that matter.

**Stylesheets, in load order** (each layer may only use the ones before it):

| File | Holds |
|---|---|
| `tokens.css` | Primitive ramps (`--gray-*`, `--rasp-*`) and the semantic tokens components use |
| `base.css` | Reset, document type, focus ring, plain form controls, utilities |
| `components.css` | Button, field, badge, alert/toast, item card, collection card, stats panel, menus, dialog, toolbar |
| `layout.css` | Brand lockup, app shell (sidebar + mobile tab bar), page head, marketing navbar, footer |
| `pages.css` | Rules only one page needs: landing, auth, settings, collection detail, error |

**Rules**

- Components read **semantic** tokens only: `--bg-surface`, `--text-muted`, `--border-subtle`,
  `--accent`, `--danger-soft` and so on. A raw hex value or a `--gray-*` primitive in a component is
  a bug: it will be wrong in one of the two themes.
- Dark mode and the five accent presets (Settings) are token swaps in `tokens.css`. The inline script
  in the layout `<head>` stamps `data-theme` / `data-accent` on `<html>` before first paint, so
  there is no flash.
- **Type:** Instrument Sans (Google Fonts) on a 14px body. Sizes come from `--text-xs` … `--text-4xl`,
  each paired with an `--lh-*` line height. Money and counts use tabular numerals.
- **Space:** a 4px grid, `--space-1` (4px) to `--space-20` (80px). Lay out sibling groups with
  `gap`, not margins.
- **Surfaces:** resting cards get a 1px `--border-subtle` and `--shadow-xs`; shadows grow only on
  hover and for floating layers (menus, dialogs, toasts).
- **Charts:** OfferUp and Facebook keep their brand hues (`--mkt-offerup`, `--mkt-facebook`); every
  other marketplace takes `--chart-1` … `--chart-8` in order. The brand colour is never a chart colour.
- **Motion** is short (120–280ms) and never required: a chart or panel must be complete with
  animations paused, and `prefers-reduced-motion` turns them off.

## Routes

### Auth
| Method | Route | Description |
|---|---|---|
| GET | `/auth/register` | Registration page |
| POST | `/auth/register` | Create account |
| GET | `/auth/login` | Login page |
| POST | `/auth/login` | Authenticate (uses **email**, not username) |
| POST | `/auth/logout` | Log out |

### Pages
| Method | Route | Description |
|---|---|---|
| GET | `/` | Landing page |
| GET | `/dashboard` | Totals, recent items, collections |
| GET | `/listings` | Every saved item, newest first |
| GET | `/settings` | Theme and accent |

### Items
| Method | Route | Description |
|---|---|---|
| POST | `/items/preview` | Enqueue a scrape → `202 {jobId}` |
| GET | `/items/jobs/:id` | Poll job status → `queued`/`running`/`done`/`failed` |
| POST | `/items/prefill` | Best-effort details for any URL (manual form) |
| POST | `/items/manual` | Create a manual listing |
| GET | `/items/:id/edit` | Edit a manual listing you own |
| PUT | `/items/:id` | Save edits to a manual listing you own |
| POST | `/items/add` | Attach an existing item to collections |
| DELETE | `/items/:id/saved` | Remove an item from the current user's Saved items |
| POST | `/items/:id/assign-collections` | Replace an item's collection membership |

### Collections
| Method | Route | Description |
|---|---|---|
| GET | `/collections` | All collections |
| POST | `/collections/create` | Create one |
| GET | `/collections/:id` | View one |
| POST | `/collections/:id/edit` | Rename (owner only) |
| DELETE | `/collections/:id` | Delete (items survive) |
| POST | `/collections/:id/add-item` | Add an item (owner/editor) |
| POST | `/collections/:id/remove-item` | Remove an item |
| POST | `/collections/:id/share` | Share with a user by email |
| POST | `/collections/:id/visibility` | Public / private |
| POST | `/collections/:id/update-role` | Change a collaborator's role |
| POST | `/collections/:id/remove-user` | Revoke access |

All routes except the landing page, auth, and public collections require a session.

## Adding a marketplace

1. Create `utils/scrapers/newsite.js` exporting `scrape(url)` that returns
   `{ title, price, description, condition, location, imageLinks, available }` and throws a
   `ScrapeError` on failure:

   ```js
   const { ScrapeError, CODES, classifyAxiosError } = require('./errors');

   async function scrape(url) {
     // ...
     if (!title) throw new ScrapeError(CODES.PARSE_FAILED);
     return { title, price, description, condition, location, imageLinks, available };
   }

   module.exports = { scrape };
   ```

   Return `price: null` when there is no readable price — do not substitute `0`, which means free.

2. Register `{ hosts, path, platform, scraper }` in `utils/scrapers/index.js`. `detectPlatform`
   reads the same entry. Fetch with `utils/safeFetch.js`, not axios directly.

Condition normalisation, the item model, the queue, and the whole frontend work unchanged.

See [SCRAPER_DOCS.md](SCRAPER_DOCS.md) for the extraction strategies, the Facebook scoring
algorithm, and the browser lifecycle.

## Documentation

- [SCRAPER_DOCS.md](SCRAPER_DOCS.md) — scraper architecture in depth

## License

All Rights Reserved. See `LICENSE.md`.
