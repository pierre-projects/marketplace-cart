# MarketplaceCart

Create and share lists of items from secondhand marketplaces. Use listings from marketplaces like OfferUp, organize them into categories, calculate totals, and share with others.

## Features

- **Scrape Marketplace Listings** - Paste an OfferUp or Facebook Marketplace link to preview item details (title, price, images, condition, location, availability) before adding
- **Two-Step Preview Workflow** - Preview scraped data first, then confirm. Cached data avoids re-scraping on save
- **Condition Normalization** - Raw conditions from any platform are standardized to 5 canonical values: New, Like New, Good, Fair, Poor
- **Filter, Sort & Search** - Filter listings by availability or condition, sort by price/title/condition/date, and search across titles and descriptions
- **Multi-Category Assignment** - Assign items to multiple categories at once via checkbox dropdown on each card
- **Organize with Categories** - Create custom categories to group items by project, room, or any system you prefer
- **Cost Calculation** - Automatic totals with platform-based grouping, deduplication of items across categories, and grand total
- **Shareable Lists** - Share categories with other users as viewers (read-only) or editors (can add items)
- **Public/Private Toggle** - Make categories visible to anyone or keep them private
- **User Authentication** - Secure accounts with session-based auth

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Templating**: EJS
- **Authentication**: Passport.js (local strategy)
- **Scraping**: Cheerio + Axios (OfferUp), Puppeteer (Facebook Marketplace)
- **Validation**: express-validator

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/pierre-projects/marketplace-cart.git
   cd MarketplaceCart
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root
   ```
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   SESSION_SECRET=your_secret_key
   ```

4. Start the server
   ```bash
   npm start
   ```

5. Open http://localhost:5000 in your browser

## Project Structure

```
MarketplaceCart/
├── config/
│   └── passport.js              # Passport authentication config
├── middleware/
│   ├── authMiddleware.js        # Route protection (ensureAuthenticated)
│   └── validation.js            # Input validation (express-validator)
├── models/
│   ├── User.js                  # User schema with password hashing
│   ├── Items.js                 # Item schema (title, price, images, etc.)
│   └── Category.js              # Category schema with sharing/roles
├── routes/
│   ├── auth.js                  # Login, register, logout
│   ├── items.js                 # Preview, add, delete, assign categories
│   ├── categories.js            # CRUD, sharing, visibility
│   ├── listings.js              # View all listings
│   └── index.js                 # Dashboard and home
├── services/
│   └── itemService.js           # Preview/create flows, normalization, platform detection
├── utils/
│   ├── browser.js               # Puppeteer singleton (shared browser instance)
│   ├── conditionMap.js          # Condition normalizer (New/Like New/Good/Fair/Poor)
│   ├── logger.js                # Environment-aware logging
│   └── scrapers/
│       ├── index.js             # Scraper registry (URL pattern routing)
│       ├── offerup.js           # OfferUp scraper (axios + cheerio)
│       └── facebook.js          # Facebook Marketplace scraper (Puppeteer)
├── views/
│   ├── auth/                    # Login/register pages
│   ├── categories/              # Category list and detail pages
│   ├── listings/                # All listings view with filter/sort/search
│   ├── partials/                # Navbar, item cards
│   ├── error.ejs                # Error page
│   └── dashboard.ejs            # Main dashboard with add-listing modal
├── public/
│   ├── css/style.css            # Dark theme styling
│   └── js/
│       ├── dashboard.js         # Two-step preview/add modal flow
│       ├── listings.js          # Filter, sort, and search logic
│       ├── totals.js            # Price totals with deduplication
│       ├── assign-categories.js # Multi-category assignment dropdowns
│       ├── categories.js        # Category management modal
│       └── category-show.js     # Category detail modal
├── SCRAPER_DOCS.md              # Detailed scraper system documentation
├── server.js                    # Express app entry point + shutdown hooks
└── package.json
```

## Architecture

### Modular Design

The codebase uses a service-oriented architecture for maintainability:

**services/itemService.js** - Centralized item handling:
- `createItem(link, cachedData)` - Scrape (or use cached preview) and save item
- `previewItem(link)` - Scrape without saving (for AJAX preview)
- `normalizeItemData(data)` - Ensures consistent data types + condition normalization
- `detectPlatform(link)` - Returns platform name from URL

**utils/scrapers/** - Extensible scraper registry:
- `index.js` - Registry that routes URLs to the correct scraper by pattern
- `offerup.js` - OfferUp scraper (HTTP via axios + cheerio)
- `facebook.js` - Facebook Marketplace scraper (Puppeteer + multi-candidate scoring)
- Easy to add new marketplaces (eBay, Mercari, etc.)

**utils/browser.js** - Puppeteer browser singleton:
- Shared browser instance across the app lifecycle
- Incognito contexts for scraper isolation
- Shutdown hooks for clean exit

**utils/conditionMap.js** - Condition normalizer:
- Maps raw condition strings from any marketplace to 5 canonical values
- Used at the service layer so scrapers return raw data

**middleware/validation.js** - Input validation:
- `validateItemLink` - Validates URLs for item routes
- `validateRegistration` - Validates user registration
- `validateCategory` - Validates category creation
- `validateShareEmail` - Validates email for sharing

### Data Flow

```
User submits link in dashboard modal
       ↓
Validation middleware (validateItemLink)
       ↓
itemService.previewItem() → Scraper registry
       ↓                         ↓
       ↓              ┌──────────┴──────────┐
       ↓              ↓                     ↓
       ↓      OfferUp scraper      Facebook scraper
       ↓      (axios + cheerio)    (Puppeteer + __bbox)
       ↓              ↓                     ↓
       ↓              └──────────┬──────────┘
       ↓                         ↓
Preview displayed to user (cached in hidden fields)
       ↓
User confirms → itemService.createItem() (uses cached data)
       ↓
normalizeItemData() + normalizeCondition()
       ↓
Item saved to MongoDB → Added to categories
```

## How It Works

### Adding Items

1. Log in and go to the dashboard
2. Paste an OfferUp or Facebook Marketplace link in the "Add Listing" modal
3. Click **Preview** to see the scraped item data
4. Review the details (title, price, condition, images, location, availability)
5. Select a category (optional) and click **Add Listing**
6. Cached preview data is used on save to avoid re-scraping

### Managing Categories

- A default "All Listings" category is created when you register
- Create custom categories from the dashboard or categories page
- Move items between categories using the dropdown on each item card
- Delete categories (items remain in other categories they belong to)

### Sharing Categories

1. Open a category you own
2. Enter a user's email and select their role:
   - **Viewer**: Can see items but not modify
   - **Editor**: Can add items to the category
3. Toggle **Public** to let anyone with the link view the category

### Browsing Listings

- **Filter** by availability (available/sold) or condition (New, Like New, Good, Fair, Poor)
- **Sort** by price, title, condition, or date added
- **Search** across titles and descriptions in real time

### Cost Totals

- View the listings page or any category to see automatic cost calculations
- Items are grouped by platform (OfferUp, Facebook Marketplace, etc.) with subtotals
- Grand total shown at the bottom
- Duplicate items (same link across categories) are automatically deduplicated

## API Routes

### Authentication
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/auth/login` | Login page |
| POST | `/auth/login` | Authenticate user |
| GET | `/auth/register` | Register page |
| POST | `/auth/register` | Create account |
| GET | `/auth/logout` | Log out |

### Items
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/items/preview` | Preview scraped item data (requires auth) |
| POST | `/items/add` | Save item to database (requires auth) |
| DELETE | `/items/:id` | Remove item (requires auth) |
| POST | `/items/:id/assign-categories` | Update item's categories (requires auth) |

### Categories
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/categories` | List all categories |
| POST | `/categories/create` | Create new category |
| GET | `/categories/:id` | View category |
| POST | `/categories/:id/add-item` | Add item to category (owner/editor) |
| POST | `/categories/:id/share` | Share with user |
| POST | `/categories/:id/visibility` | Toggle public/private |
| DELETE | `/categories/:id` | Delete category |

## Extending Scrapers

To add support for a new marketplace:

1. Create `utils/scrapers/newsite.js`:
   ```js
   const axios = require('axios');
   const cheerio = require('cheerio');

   async function scrape(url) {
     // Scrape logic here
     return { title, price, description, condition, location, imageLinks, available };
   }

   module.exports = { scrape };
   ```

2. Register in `utils/scrapers/index.js`:
   ```js
   const scrapers = [
     { pattern: /offerup\.com\/item/, scraper: require('./offerup') },
     { pattern: /newsite\.com\/listing/, scraper: require('./newsite') },
   ];
   ```

3. Update `services/itemService.js` `detectPlatform()`:
   ```js
   if (link.includes('newsite.com')) return 'NewSite';
   ```

No other changes needed. The condition normalizer, item model, frontend, and routes all work automatically with any scraper that follows the interface.

See [SCRAPER_DOCS.md](SCRAPER_DOCS.md) for detailed documentation on the scraper system, including fallback chains, the multi-candidate scoring algorithm, and performance optimizations.

## Documentation

- [SCRAPER_DOCS.md](SCRAPER_DOCS.md) - Comprehensive documentation of the scraper architecture, data extraction strategies, condition normalization, and browser singleton

## License

MIT
