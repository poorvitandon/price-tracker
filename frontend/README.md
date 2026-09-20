# Product Price Tracker

A full-stack product price tracking application built for the INE Software Engineer Intern Assignment.

The application allows users to search for products from the INE mock store, track products, manually scrape their current price and stock, view price history, and maintain detailed scrape attempt logs.

The scraper is designed to handle delayed content, cookie overlays, human-like interaction requirements, slow responses, and transient HTTP failures such as 429, 500, and 503.

---

## Live Application

### Frontend

https://price-tracker-eight-beta.vercel.app

### Backend API

https://price-tracker-droc.onrender.com/

### GitHub Repository

https://github.com/poorvitandon/price-tracker

---

## Features

- Search products by partial or full product name
- Track products for price monitoring
- Manual price scraping
- Current price and stock status
- Price history
- Per-product scrape history
- Detailed scrape attempt logs
- HTTP status tracking for scrape attempts
- Retry handling for transient failures
- Cookie overlay handling
- Human-like mouse interaction before price reveal
- Playwright-based browser automation
- Supabase PostgreSQL persistence
- REST API architecture
- External scheduled scraping using cron-job.org
- Production deployment using Vercel and Render

---

## Tech Stack

### Frontend

- React
- Vite
- Axios
- CSS

### Backend

- Node.js
- Express.js
- Playwright
- dotenv
- CORS

### Database

- Supabase
- PostgreSQL

### Deployment

- Vercel - Frontend
- Render - Backend
- cron-job.org - Scheduled scraping

---

## Project Structure

```text
price-tracker/
│
├── backend/
│   ├── server.js
│   ├── scraper.js
│   ├── package.json
│   ├── .env
│   │
│   ├── db/
│   │   └── supabase.js
│   │
│   ├── services/
│   │   └── databaseService.js
│   │
│   └── routes/
│       ├── productRoutes.js
│       ├── trackedProductRoutes.js
│       └── cronRoutes.js
│
└── frontend/
    ├── package.json
    ├── src/
    │   ├── App.jsx
    │   └── App.css
    └── .gitignore