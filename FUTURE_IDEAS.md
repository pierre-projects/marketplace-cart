# MarketplaceCart - Future Ideas

A collection of feature ideas and enhancements for MarketplaceCart.

---

## 1. Multi-Platform Scrapers

**Priority: High**

Currently only OfferUp is supported via the scraper registry pattern (`utils/scrapers/`). Adding more platforms would dramatically increase usefulness.

**Platforms to add:**
- **eBay** - Structured product pages, well-documented
- **Facebook Marketplace** - Requires auth/cookies, harder to scrape
- **Mercari** - Clean product pages, similar to OfferUp
- **Craigslist** - Simpler HTML, easier to parse

**Implementation:**
- Each scraper follows the existing registry pattern (export `canHandle(url)` + `scrape(url)`)
- Auto-detect platform from URL in `scraperRegistry.js`
- Platform-specific parsing for title, price, condition, images, location, availability

---

## 2. Price Tracking & History

**Priority: High**

Re-scrape saved items periodically to detect price changes. Track history over time and visualize trends.

**Features:**
- Scheduled re-scraping (daily/weekly via cron job or `node-cron`)
- Price history stored as array on Item model: `[{ price, date }]`
- Sparkline or chart on item card showing price trend
- "Price dropped!" badge on items that decreased
- Dashboard widget: "X items dropped in price this week"

**Tech considerations:**
- Avoid hitting rate limits — stagger scrapes, respect robots.txt
- Store scrape timestamps to prevent redundant fetches
- Chart library: Chart.js (lightweight, no dependencies)

---

## 3. Price Alerts & Notifications

**Priority: Medium**

Let users set price thresholds and get notified when items drop below them.

**Features:**
- Per-item "Alert me below $X" setting
- Email notifications via Nodemailer + Gmail/SendGrid
- In-app notification bell with unread count
- Notification preferences page (email on/off, frequency)

**Implementation:**
- `PriceAlert` model: `{ user, item, targetPrice, active }`
- After each re-scrape, check alerts and trigger notifications
- Notification model: `{ user, message, read, createdAt }`

---

## 4. Wishlist / Saved Searches

**Priority: Medium**

Save search queries and auto-populate new matches from supported platforms.

**Features:**
- "Save this search" on any marketplace platform
- Periodic search execution via scrapers
- New matches appear in a "New Finds" feed
- Configurable: keyword, platform, max price, location radius

**Implementation:**
- `SavedSearch` model: `{ user, query, platform, maxPrice, location }`
- Background worker runs saved searches on schedule
- Deduplication against existing items in user's collection

---

## 5. Comparison View

**Priority: Low**

Side-by-side comparison of 2-3 similar items to help make purchase decisions.

**Features:**
- Select items from listings to compare
- Table view: price, condition, location, seller, images side-by-side
- Highlight differences (cheaper, newer condition, closer location)
- "Pick a winner" — mark one as preferred

**Implementation:**
- Client-side only — select items via checkbox, render comparison table
- Could use a modal or dedicated `/compare` page
- Store comparison as a URL with item IDs for sharing

---

## 6. Mobile PWA

**Priority: Medium**

Convert the web app into a Progressive Web App so users can install it on mobile devices.

**Features:**
- Add-to-home-screen prompt
- Offline access to previously viewed listings
- Push notifications for price alerts
- Fast, app-like navigation

**Implementation:**
- Add `manifest.json` with app name, icons, theme colors
- Register a service worker for caching static assets
- Cache API responses for offline viewing
- Use Web Push API for notifications

---

## 7. Browser Extension

**Priority: Medium**

A Chrome/Firefox extension that adds a "Save to MarketplaceCart" button on supported marketplace websites.

**Features:**
- Floating button on OfferUp/eBay/Mercari pages
- One-click save to your MarketplaceCart account
- Category selection popup
- Badge showing if item is already saved

**Implementation:**
- Chrome Extension with content scripts for each supported site
- Communicates with MarketplaceCart API via authenticated fetch
- Would require adding API token auth (JWT or session cookies)

---

## 8. Public Category Sharing via Link

**Priority: Low**

The `isPublic` flag already exists on categories. Enhance it with shareable URLs and a nice public-facing view.

**Features:**
- Generate short shareable links (e.g., `/public/abc123`)
- Public read-only view with clean layout (no edit controls)
- Social media preview cards (Open Graph meta tags)
- Optional password protection for semi-private sharing
- Embed code for forums/blogs

**Implementation:**
- Add `publicSlug` field to Category model
- New `/public/:slug` route (no auth required)
- Stripped-down EJS template showing items without edit UI

---

## 9. Export & Reports

**Priority: Low**

Export category contents as CSV or PDF for insurance documentation, inventory tracking, or moving planning.

**Features:**
- CSV export: title, price, condition, link, date added
- PDF export: formatted report with thumbnails
- Summary statistics at the top
- Filter before export (only available items, price range)

**Implementation:**
- CSV: Use `json2csv` library
- PDF: Use `puppeteer` (already installed) or `pdfkit`
- Download endpoint: `GET /categories/:id/export?format=csv`

---

## 10. Collaborative Shopping Lists

**Priority: Medium**

Build on the existing sharing system (roles: viewer/editor) to create truly collaborative lists.

**Features:**
- Comments on individual items ("I think this is overpriced")
- Voting: thumbs up/down on items
- "Claimed" status — mark items you're going to buy
- Activity log: see who added/removed/commented
- @mentions in comments

**Implementation:**
- `Comment` model: `{ item, category, user, text, createdAt }`
- `Vote` model: `{ item, user, type: 'up'|'down' }`
- Add `claimedBy` field to category item entries
- Activity feed stored as events: `{ category, user, action, target, createdAt }`

---

## 11. Item Status Workflow

**Priority: Medium**

Track the buying lifecycle beyond just "available" and "sold."

**Statuses:**
1. **Watching** — Saved, keeping an eye on it
2. **Contacted** — Messaged the seller
3. **Negotiating** — In price discussion
4. **Agreed** — Deal made, pending pickup
5. **Purchased** — Bought it
6. **Picked Up** — In your possession

**Implementation:**
- Add `status` enum field to Item model (default: "watching")
- Status dropdown on item card (replaces simple available/sold)
- Filter by status on listings page (add to filter chips)
- Dashboard widget: "3 items pending pickup"

---

## 12. Image Gallery / Lightbox

**Priority: Low**

Items already store `imageLinks[]` but only show the first image. Add a full gallery experience.

**Features:**
- Click thumbnail to open lightbox
- Arrow navigation between images
- Image count badge on thumbnail ("1/5")
- Zoom on hover/click
- Lazy loading for performance

**Implementation:**
- Client-side lightbox (vanilla JS, no library needed)
- Modal overlay with full-size image
- Keyboard navigation (arrow keys, Escape to close)
- Preload adjacent images for smooth browsing

---

## Implementation Priority Order

If starting from scratch, recommended order:

1. **Multi-platform scrapers** — Most impact, builds on existing architecture
2. **Price tracking** — Unique value proposition, encourages return visits
3. **Item status workflow** — Small change, big UX improvement
4. **Image gallery** — Quick win, data already exists
5. **Mobile PWA** — Makes the app feel professional
6. **Price alerts** — Builds on price tracking
7. **Collaborative lists** — Builds on existing sharing
8. **Export/reports** — Useful but niche
9. **Browser extension** — High effort, high reward
10. **Saved searches** — Complex but powerful
11. **Comparison view** — Nice to have
12. **Public sharing** — Foundation already exists
