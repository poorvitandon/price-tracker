/**
 * backend/routes/cronRoutes.js
 *
 * Fix: cron-job.org was timing out because the route awaited the entire
 * Playwright scrape (all active products, sequentially) before responding.
 *
 * New behaviour:
 *   1. Authenticate synchronously (unchanged).
 *   2. Fetch active tracked products synchronously (unchanged query).
 *   3. If none are active, respond 200 immediately (unchanged).
 *   4. If there are active products, respond 202 IMMEDIATELY, then run the
 *      actual scraping in the background via setImmediate(). This is safe on
 *      a Render Web Service because the Node process keeps running after the
 *      response is sent — it is not a serverless/edge function that freezes
 *      on response.
 *   5. Every product is scraped independently; one failure never stops the
 *      rest. All background errors are caught so nothing becomes an
 *      unhandled promise rejection.
 *
 * scrapeProduct(), the database schema, and authentication are untouched.
 */

const express = require("express");
const router = express.Router();
const supabase = require("../db/supabase");

router.post("/scrape", async (req, res) => {
  try {
    // 1. Authenticate (unchanged)
    const cronSecret = req.headers["x-cron-secret"];
    if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // 2. Fetch active tracked products (unchanged)
    const { data: products, error } = await supabase
      .from("tracked_products")
      .select("id, product_id, product_name")
      .eq("is_active", true);

    if (error) throw error;

    // 3. Nothing to do — respond immediately, nothing to background
    if (!products || products.length === 0) {
      return res.json({
        success: true,
        message: "No active products to scrape",
        results: [],
      });
    }

    // 4. Accept the job and respond immediately so cron-job.org never waits
    //    on Playwright.
    res.status(202).json({
      success: true,
      message: "Scraping started in background",
      productCount: products.length,
    });

    // 5. Run the actual scraping AFTER the response has been sent.
    //    setImmediate defers this to the next event loop tick; the Render
    //    Node process stays alive and keeps executing it normally.
    setImmediate(() => {
      runBackgroundCronScrape(products).catch((err) => {
        // Belt-and-braces: runBackgroundCronScrape already catches per-product
        // errors internally, but guard against any unexpected top-level throw
        // so it can never become an unhandled promise rejection.
        console.error("Unexpected error in background cron scrape:", err);
      });
    });
  } catch (error) {
    // This only covers the synchronous, pre-response part (auth / product
    // fetch). If we've already sent a response above, this block is not
    // reached for that request.
    console.error("Cron scrape setup failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Cron scraping failed",
      });
    }
  }
});

/**
 * Scrapes every active product sequentially, in the background, after the
 * HTTP response has already been returned to the caller. Never throws —
 * every per-product failure is caught and logged so one bad scrape never
 * stops the rest of the batch or crashes the process.
 */
async function runBackgroundCronScrape(products) {
  console.log("Starting background cron scrape...");
  const { scrapeProduct } = require("../scraper");

  const results = [];

  for (const product of products) {
    console.log(`Starting cron scrape for product ${product.product_id}...`);
    try {
      const result = await scrapeProduct(product.product_id);
      results.push({
        productId: product.product_id,
        productName: product.product_name,
        success: true,
        result,
      });
    } catch (err) {
      console.error(
        `Cron scrape failed for product ${product.product_id}: ${err.message}`
      );
      results.push({
        productId: product.product_id,
        productName: product.product_name,
        success: false,
        error: err.message,
      });
      // intentionally continue to the next product
    }
  }

  console.log("Background cron scraping completed.");
  console.log(JSON.stringify(results, null, 2));
  return results;
}

module.exports = router;