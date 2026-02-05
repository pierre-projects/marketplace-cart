# MarketplaceCart

Create and share lists of items from secondhand marketplaces. Scrape listings from OfferUp, organize them into categories, calculate totals, and share with others.

## Features

- **Scrape OfferUp Listings** - Paste a link to preview item details (title, price, images, condition, location, availability) before adding
- **Organize with Categories** - Create custom categories to group items by project, room, or any system you prefer
- **Cost Calculation** - Automatic totals with breakdown by platform and grand total
- **Shareable Lists** - Share categories with other users as viewers (read-only) or editors (can add items)
- **Public/Private Toggle** - Make categories visible to anyone or keep them private
- **User Authentication** - Secure accounts with session-based auth

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Templating**: EJS
- **Authentication**: Passport.js (local strategy)
- **Scraping**: Cheerio + Axios

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/MarketplaceCart.git
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
│   └── passport.js          # Passport authentication config
├── middleware/
│   └── authMiddleware.js    # Route protection (ensureAuthenticated)
├── models/
│   ├── User.js              # User schema with password hashing
│   ├── Items.js             # Item schema (title, price, images, etc.)
│   └── Category.js          # Category schema with sharing/roles
├── routes/
│   ├── auth.js              # Login, register, logout
│   ├── items.js             # Preview, add, delete, assign categories
│   ├── categories.js        # CRUD, sharing, visibility
│   ├── listings.js          # View all listings
│   └── index.js             # Dashboard and home
├── utils/
│   └── scraper.js           # OfferUp scraper
├── views/
│   ├── auth/                # Login/register pages
│   ├── categories/          # Category list and detail pages
│   ├── listings/            # All listings view
│   ├── partials/            # Navbar, item cards
│   └── dashboard.ejs        # Main dashboard
├── public/
│   ├── css/style.css        # Dark theme styling
│   └── js/                  # Dashboard, totals, category assignment
├── server.js                # Express app entry point
└── package.json
```

## How It Works

### Adding Items

1. Log in and go to the dashboard
2. Paste an OfferUp link in the "Add Listing" form
3. Click **Preview** to see the scraped item data
4. Review the details (title, price, condition, images, availability)
5. Select a category (optional) and click **Add Listing**

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

### Cost Totals

- View the listings page or any category to see automatic cost calculations
- Items are grouped by platform with subtotals
- Grand total shown at the bottom
- Duplicate items (same link) are automatically deduplicated

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
| POST | `/items/preview` | Preview scraped item data |
| POST | `/items/add` | Save item to database |
| DELETE | `/items/:id` | Remove item |
| POST | `/items/:id/assign-categories` | Update item's categories |

### Categories
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/categories` | List all categories |
| POST | `/categories/create` | Create new category |
| GET | `/categories/:id` | View category |
| POST | `/categories/:id/share` | Share with user |
| POST | `/categories/:id/visibility` | Toggle public/private |
| DELETE | `/categories/:id` | Delete category |

## License

MIT
