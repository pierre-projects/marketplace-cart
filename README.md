# MarketplaceCart

Save listings from secondhand marketplaces into collections, see what the pile actually costs, and
share it. Paste an OfferUp or Facebook Marketplace link; the app scrapes the title, price, photos,
condition, location and availability in the background and files it away.

> **A note on wording.** The UI calls them **collections**. The routes are still `/categories`, and
> the Mongoose model is still `Category` — renaming URLs would break saved links for no user-visible
> gain.

## Features

- **Paste a link, get a listing** — OfferUp and Facebook Marketplace, with title, price, images,
  condition, location and whether it is still live.
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
- **Scraping** — axios + cheerio (OfferUp), Puppeteer (Facebook Marketplace)

## Getting started

### Prerequisites

- **Node.js ≥ 20.11** — `node --watch` is used by `npm run dev` and is only stable from 20.11.
- **MongoDB**, local or Atlas.
- **A Chrome**, only if you want Facebook Marketplace listings. See [Chrome](#chrome) below —
  usually there is nothing to do.

### Install

```bash
git clone https://github.com/pierre-projects/marketplace-cart.git
cd MarketplaceCart
npm install
```

Create a `.env` in the project root:

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/marketplacecart
SESSION_SECRET=change_this_to_something_random
```

### Run

```bash
npm run dev     # node --watch, restarts on server-side changes
npm start       # plain node
```

Then open http://localhost:5000.

`node --watch` only reloads modules the process actually loads, so editing a view or a stylesheet
does **not** restart the server — save the file and refresh the browser.

### Chrome

Only the Facebook scraper needs a browser. It is resolved in this order, and the first one that
exists on disk wins:

1. `PUPPETEER_EXECUTABLE_PATH`, if you set it
2. Puppeteer's own downloaded Chrome (`npx puppeteer browsers install chrome`)
3. Chrome installed on the system

If none resolve, Facebook scrapes fail with a `BROWSER_UNAVAILABLE` error naming the fix, and are
**not** retried — no amount of backoff installs a browser. OfferUp is unaffected; it never launches
a browser.

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
- **Re-adding a link refreshes it.** `Item.link` is unique, so a second save updates price and
  availability on the existing document instead of creating a duplicate.

### The queue

| Setting | Value |
|---|---|
| Concurrent jobs | 2 |
| Attempts before giving up | 3 |
| Backoff | 2s, 4s, 8s |
| Retried codes | `NETWORK`, `TIMEOUT` only |
| Job record lifetime | 24h (TTL index) |
| Client poll interval / ceiling | 1s / 90s |

Jobs left `running` by a crash are reclaimed at boot. Enqueueing a link that is already queued for
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
- **`link`** — unique across the collection, which is what makes re-adding a refresh.

## Project structure

```
MarketplaceCart/
├── config/passport.js            # Local strategy
├── middleware/
│   ├── authMiddleware.js         # ensureAuthenticated
│   └── validation.js             # express-validator rules
├── models/
│   ├── User.js
│   ├── Items.js                  # unique link, nullable price, condition enum
│   ├── Category.js               # collections, sharing roles, isDefault
│   └── ScrapeJob.js              # queue records, 24h TTL
├── routes/
│   ├── index.js                  # landing + dashboard
│   ├── auth.js                   # register / login / logout
│   ├── items.js                  # preview, job status, add, delete, assign
│   ├── listings.js               # all saved items
│   ├── categories.js             # collections CRUD, sharing, membership
│   └── settings.js               # appearance
├── services/
│   ├── itemService.js            # upsert by link, normalisation, platform detection
│   ├── categoryService.js        # stats, platform breakdown, ordering, card stats
│   ├── scrapeQueue.js            # background worker: claim, retry, reclaim
│   └── maintenance.js            # sweeps abandoned previews
├── utils/
│   ├── browser.js                # Chrome resolution + context semaphore
│   ├── conditionMap.js           # raw condition -> canonical or null
│   ├── httpResponses.js          # safe redirects, flash errors, error pages
│   ├── logger.js
│   └── scrapers/
│       ├── index.js              # URL -> scraper registry
│       ├── errors.js             # ScrapeError contract
│       ├── offerup.js            # axios + cheerio
│       └── facebook.js           # Puppeteer + anchored __bbox extraction
├── lib/format.js                 # money, relative dates, plural, platform helpers
├── views/
│   ├── layouts/main.ejs          # shell: sidebar or navbar, no-flash theme script
│   ├── partials/                 # sidebar, item card, stats panel, empty state, modals
│   ├── auth/  categories/  listings/
│   ├── dashboard.ejs  settings.ejs  index.ejs  error.ejs
├── public/
│   ├── css/                      # tokens -> base -> components -> pages
│   ├── js/                       # dashboard, listings, categories, stats-panel, theme-toggle, toast
│   └── images/marketplaces/      # OfferUp and Facebook marks
├── scripts/migrate.js            # data repair, dry-run by default
├── server.js                     # boots after Mongo connects; starts queue + maintenance
└── package.json
```

Stylesheets load in order: `tokens.css` defines the custom properties, everything else consumes
them. Themes and accents are applied by stamping `data-theme` / `data-accent` on `<html>` before the
stylesheets load, so there is no flash on navigation.

## Routes

### Auth
| Method | Route | Description |
|---|---|---|
| GET | `/auth/register` | Registration page |
| POST | `/auth/register` | Create account |
| GET | `/auth/login` | Login page |
| POST | `/auth/login` | Authenticate (uses **email**, not username) |
| GET | `/auth/logout` | Log out |

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
| POST | `/items/add` | Attach an already-scraped item to collections |
| DELETE | `/items/:id/saved` | Remove an item from the current user's Saved items |
| POST | `/items/:id/assign-categories` | Replace an item's collection membership |

### Collections
| Method | Route | Description |
|---|---|---|
| GET | `/categories` | All collections |
| POST | `/categories/create` | Create one |
| GET | `/categories/:id` | View one |
| POST | `/categories/:id/edit` | Rename (owner only) |
| DELETE | `/categories/:id` | Delete (items survive) |
| POST | `/categories/:id/add-item` | Add an item (owner/editor) |
| POST | `/categories/:id/remove-item` | Remove an item |
| POST | `/categories/:id/share` | Share with a user by email |
| POST | `/categories/:id/visibility` | Public / private |
| POST | `/categories/:id/update-role` | Change a collaborator's role |
| POST | `/categories/:id/remove-user` | Revoke access |

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

2. Register the URL pattern in `utils/scrapers/index.js`.
3. Add the platform name to `detectPlatform()` in `services/itemService.js`.

Condition normalisation, the item model, the queue, and the whole frontend work unchanged.

See [SCRAPER_DOCS.md](SCRAPER_DOCS.md) for the extraction strategies, the Facebook scoring
algorithm, and the browser lifecycle.

## Documentation

- [SCRAPER_DOCS.md](SCRAPER_DOCS.md) — scraper architecture in depth

## License

All Rights Reserved. See `LICENSE.md`.
