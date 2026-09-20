Design Note — Product Price Tracker

1. Overview

The Product Price Tracker is a full-stack application developed for the INE Software Engineer Intern assignment.

The application allows users to search for products from the provided INE mock store, track products, retrieve their current price and stock status, view price history, and inspect individual scrape attempts.

The main engineering challenge was building a reliable scraper for a deliberately difficult mock store. The store uses dynamic content, interaction requirements, delayed cookie overlays, slow responses, and transient HTTP failures. The implementation therefore focuses on reliability, observability, honest failure handling, and safe data persistence.

2. System Architecture

The application follows a simple full-stack architecture:

                    ┌──────────────────────┐
                    │      React + Vite    │
                    │       Frontend       │
                    │       (Vercel)        │
                    └──────────┬───────────┘
                               │
                         REST API calls
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Node.js + Express  │
                    │       Backend        │
                    │       (Render)       │
                    └───────┬───────┬──────┘
                            │       │
                    ┌───────┘       └────────┐
                    ▼                        ▼
             ┌─────────────┐          ┌──────────────┐
             │  Playwright │          │   Supabase   │
             │   Scraper   │          │  PostgreSQL  │
             └─────────────┘          └──────────────┘

Scheduled scraping is triggered externally:

cron-job.org
      │
      │ POST /api/cron/scrape
      ▼
Render Backend
      │
      ▼
Playwright Scraper
      │
      ▼
Supabase

The frontend does not perform scraping directly. All scraping, validation, retry handling, and database operations are performed by the backend.

3. Technology Choices

Frontend

React

Vite

Axios

CSS

React was selected to provide a simple component-based interface for product search, tracking, current price/stock display, and historical information.

Backend

Node.js

Express.js

Playwright

dotenv

CORS

Node.js and Express provide a lightweight REST API, while Playwright is used because the mock store requires browser interaction before the live price becomes available.

Database

Supabase PostgreSQL

Supabase provides hosted PostgreSQL storage suitable for the free-tier deployment requirements of the assignment.

Deployment

Vercel for the frontend

Render for the backend

cron-job.org for external scheduling

External scheduling was selected because a free-tier backend can sleep and should not be relied upon for an internal process that must execute every two hours.

4. Backend Structure

The backend separates API routes, database operations, and scraping logic.

backend/
│
├── server.js
├── scraper.js
│
├── db/
│   └── supabase.js
│
├── services/
│   └── databaseService.js
│
└── routes/
    ├── productRoutes.js
    ├── trackedProductRoutes.js
    └── cronRoutes.js

server.js

Responsible for:

creating the Express application

enabling CORS

parsing JSON requests

registering API routes

starting the server

scraper.js

Contains the complete Playwright scraping workflow.

It can be used by:

manual scraping

scheduled scraping

local headed execution

databaseService.js

Encapsulates Supabase operations for:

tracked products

price history

scrape logs

This avoids duplicating database queries throughout the application.

5. Scraping Workflow

The mock store does not simply expose the final price in the initial HTML.

The observed workflow is:

Open Product Page
        │
        ▼
GET /api/product/{id}
        │
        ▼
GET /api/layout
        │
        ▼
Handle Cookie Overlay
        │
        ▼
Move Mouse Over Price Area
        │
        ▼
Human-like Mouse Movement
        │
        ▼
Required Dwell Time
        │
        ▼
Reveal Price
        │
        ▼
GET /api/challenge
        │
        ▼
POST /api/session
        │
        ▼
GET /api/products/{id}/price
        │
        ▼
Extract Price + Stock
        │
        ▼
Persist Result

This approach reproduces the intended interaction flow of the mock store instead of attempting to bypass it.

6. Human-like Interaction

The mock store requires interaction before the price can be revealed.

The scraper therefore performs:

Locate the price block.

Hover over the price area.

Perform multiple mouse movements across the price block.

Wait for the required dwell period.

Locate the Reveal Price button.

Verify that the button is enabled.

Click the Reveal Price button.

This was necessary because directly requesting the final price endpoint without completing the interaction would not reliably reproduce the store's intended flow.

7. Cookie Overlay Handling

A significant reliability issue during development was the store's cookie overlay.

The overlay:

.cookie-overlay

can appear after the page has already loaded.

When present, it intercepts pointer events. This caused Playwright operations such as:

priceBlock.hover()

and:

Reveal Price click

to timeout even though the target elements were visible and enabled.

The scraper therefore explicitly handles the delayed cookie overlay and clicks the actual:

ACCEPT

button before continuing with the interaction.

The implementation is careful not to assume that the cookie overlay is present immediately after page load.

This was an important reliability correction because a simple one-time cookie check was insufficient when the overlay appeared later.

8. Price API and Extraction Strategy

The mock store exposes the live price through:

/api/products/{productId}/price

The scraper records the HTTP status of every request to this endpoint.

A successful response is used as the primary source of the live price when the response contains an extractable price value.

DOM extraction is retained as a fallback.

The DOM fallback handles rupee values using the pattern:

₹[\d,\u200b]+

The extracted values are cleaned of:

rupee symbols

commas

zero-width characters

The intended interpretation is:

First value  → MRP
Second value → Current selling price

If only one valid numeric value is available, that value can be used as the current price.

The application does not intentionally fabricate a price. Price history is written only when the resulting value is a valid finite number.

9. Retry and Failure Handling

The mock store can intentionally return transient HTTP errors such as:

429 Too Many Requests

500 Internal Server Error

503 Service Unavailable

The scraper does not treat the first failed request as the end of the scraping process.

Each price API attempt is recorded.

For example:

Attempt 1: 429 → retrying
Attempt 2: 200 → success

This provides visibility into transient failures and successful recovery.

If no successful price API attempt occurs, the scraper reports the failure rather than silently storing an incorrect result.

10. Scrape Logging

Every observed price API attempt is stored in the scrape_logs table.

Each log contains:

tracked product ID

attempt number

status

HTTP status

error message where applicable

start timestamp

completion timestamp

The status values distinguish:

success
retrying
failed

This makes the scrape history auditable.

A failed attempt followed by a successful retry is therefore represented differently from a scrape that failed completely.

11. Database Design

Three main tables are used.

tracked_products

Stores products selected by the user for tracking.

Important fields:

id
product_id
product_name
is_active

price_history

Stores successful price observations.

Important fields:

id
tracked_product_id
price
stock_status
scraped_at

scrape_logs

Stores individual scrape attempts.

Important fields:

id
tracked_product_id
attempt_number
status
http_status
error_message
started_at
completed_at

The separation between price_history and scrape_logs is intentional.

A scrape attempt can fail without producing a valid price observation. Therefore, an attempt should not automatically become a price-history record.

12. Data Correctness

A key design decision is to avoid storing invalid prices.

Before inserting into price_history, the scraper validates that the extracted price:

exists,

can be converted to a number, and

is finite.

Conceptually:

Extracted value
      │
      ▼
Convert to Number
      │
      ▼
Number.isFinite(...)
      │
 ┌────┴────┐
 │         │
Valid    Invalid
 │         │
 ▼         ▼
Save     Do not save
history  fake/invalid data

This prevents failed extraction from polluting historical price data.

13. Scheduled Scraping

The backend exposes:

POST /api/cron/scrape

The endpoint requires:

x-cron-secret

The secret is stored in the backend environment rather than hardcoded.

cron-job.org is configured to trigger the endpoint every two hours.

The scheduler is external because the backend is deployed on a free-tier service where an internal scheduler cannot be assumed to remain active continuously.

The cron endpoint identifies all active tracked products and invokes the same scrapeProduct() implementation used by manual scraping.

This keeps manual and scheduled scraping behavior consistent.

14. Security Considerations

Sensitive configuration is stored using environment variables.

Backend secrets include:

SUPABASE_URL
SUPABASE_KEY
CRON_SECRET

The frontend does not receive Supabase credentials.

The cron endpoint requires the x-cron-secret header.

The .env file is excluded from Git.

This prevents database credentials and scheduler authentication secrets from being included in the public repository.

15. Deployment Design

Frontend

The React application is deployed on Vercel.

The frontend communicates with the Render backend using:

VITE_API_URL

Backend

The Node.js application is deployed on Render.

The production environment uses:

HEADLESS=true

so Playwright runs without opening a visible browser window.

Playwright Chromium is installed during the Render build process.

Scheduler

cron-job.org sends authenticated POST requests to the Render cron endpoint every two hours.

16. Headed vs Headless Mode

The scraper supports both execution modes.

Local demonstration

npm run scrape:headed

The browser is visible.

This mode was used to demonstrate:

cookie handling

mouse movement

Reveal Price interaction

API activity

retry/recovery behavior

Production

Render uses:

HEADLESS=true

This allows the scraper to run without a visible browser.

The same scraping logic is used in both modes.

17. Major Debugging Issues and Corrections

Several issues were encountered during implementation.

Issue 1 — Playwright Browser Missing on Render

Initially, the backend deployed successfully but Playwright could not find its Chromium executable.

The error indicated that the browser executable did not exist in the expected Playwright cache location.

The deployment build was updated to explicitly install Chromium using the Playwright CLI.

This allowed browser automation to run in the Render environment.

Issue 2 — Playwright Permission Error

Using:

npx playwright install chromium

caused a permission-related build error on the deployment environment.

The installation command was changed to invoke the Playwright CLI directly through Node:

node node_modules/playwright/cli.js install chromium

This avoided the executable permission problem.

Issue 3 — Cookie Overlay Blocking Interaction

The store's delayed cookie overlay intercepted pointer events.

The initial approach assumed the overlay would be present immediately after page load.

That assumption was incorrect.

The scraper was changed to handle the delayed overlay and explicitly click the ACCEPT button before continuing.

Issue 4 — DOM Price Wait Timing Out

A previous implementation waited for:

.price-main

and required at least two rupee values to appear.

The price API could successfully return HTTP 200 while the expected DOM representation was not available within the timeout.

This caused errors such as:

page.waitForFunction: Timeout exceeded

The scraper was adjusted so that the successful price API response can be used as the primary source, with DOM extraction retained as a fallback.

This reduces dependence on a specific frontend rendering state.

Issue 5 — Transient HTTP Failures

The mock store intentionally produces HTTP failures.

Instead of treating the first failure as a permanent failure, the scraper records each attempt and allows later successful attempts to be represented as recovery.

Example:

429 → retrying
200 → success

This makes the system's behavior observable and honest.

Issue 6 — Cron Request Timeout

The scraper can take significant time because of browser automation, interaction requirements, slow responses, and retries.

The scheduled endpoint therefore needs to avoid making the scheduler wait unnecessarily for the entire browser operation.

The scheduled execution is separated from the initial scheduler request so that the scheduler can receive an acknowledgement while the scraping work continues.

Background errors are caught and logged rather than becoming unhandled promise rejections.

18. AI-Assisted Development and Corrections

AI tools were used during development for debugging, code suggestions, and troubleshooting.

AI assistance was not treated as automatically correct.

Several generated approaches required correction after testing against the actual mock store.

Examples included:

assuming the cookie overlay appeared immediately

relying exclusively on DOM price rendering

assuming a successful HTTP request automatically meant the expected DOM element was ready

using an installation command that caused a Render permission error

The implementation was corrected through direct testing against the provided mock store and deployment environment.

The final approach prioritizes observed application behavior over assumptions from generic scraping examples.

19. Reliability Trade-offs

The scraper intentionally favors correctness and observability over minimal execution time.

This results in:

browser startup overhead

mouse interaction delays

dwell time

waiting for dynamic content

retries for transient failures

However, these costs are appropriate for this assignment because the mock store is specifically designed to test scraper reliability.

A faster scraper that silently ignores failed requests or stores incomplete values would provide less trustworthy tracking data.

20. Failure Philosophy

The system follows three important principles:

1. Do not silently fail

Every scrape attempt should produce observable logs.

2. Do not store fabricated data

If a valid price cannot be extracted, the system should not create a fake price-history record.

3. Recover when possible

Transient HTTP errors should be retried when the store recovers.

This results in behavior such as:

Temporary failure
      ↓
Retry
      ↓
Successful response
      ↓
Save valid price
      ↓
Record both attempts

21. Future Improvements

Possible future improvements include:

configurable scraping frequency per product

price-change alerts

back-in-stock notifications

email or notification integrations

multi-product analytics

historical price charts

stronger job queue management for large numbers of tracked products

distributed background workers for high-scale scraping

These were not required for the core assignment and were therefore kept outside the minimum implementation.

22. Conclusion

The final architecture separates the user interface, API layer, scraping workflow, database persistence, and scheduled execution.

The main engineering focus was reliability under the mock store's intentionally difficult behavior.

The scraper handles:

delayed cookie overlays

human-like interaction

dynamic price retrieval

transient HTTP failures

retry and recovery

price validation

historical persistence

detailed scrape logging

The resulting system is designed to provide transparent and trustworthy product tracking rather than simply returning a price when the happy path works.