const express = require("express");
const router = express.Router();
require("dotenv").config();

const supabase = require("../db/supabase");

router.post("/scrape", async (req, res) => {
  try {
    const cronSecret = req.headers["x-cron-secret"];

    if (
      !process.env.CRON_SECRET ||
      cronSecret !== process.env.CRON_SECRET
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { data: products, error } = await supabase
      .from("tracked_products")
      .select("id, product_id, product_name")
      .eq("is_active", true);

    if (error) {
      throw error;
    }

    if (!products || products.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No active products to scrape",
        results: [],
      });
    }

    // Start scraping in background.
    // Do not keep the cron HTTP request waiting.
    setImmediate(async () => {
      console.log(
        `Starting background cron scrape for ${products.length} product(s)...`
      );

      const { scrapeProduct } = require("../scraper");

      for (const product of products) {
        try {
          console.log(
            `Starting cron scrape for product ${product.product_id}...`
          );

          const result = await scrapeProduct(
            product.product_id
          );

          console.log(
            `Cron scrape completed for product ${product.product_id}:`,
            result
          );
        } catch (error) {
          console.error(
            `Cron scrape failed for product ${product.product_id}:`,
            error.message
          );
        }
      }

      console.log("Background cron scraping completed.");
    });

    // Respond immediately so cron-job.org does not timeout.
    return res.status(202).json({
      success: true,
      message: "Scraping started in background",
      productCount: products.length,
    });

  } catch (error) {
    console.error(
      "Cron endpoint error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Cron scraping failed",
    });
  }
});

module.exports = router;