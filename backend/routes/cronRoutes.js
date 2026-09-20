const express = require("express");
const supabase = require("../db/supabase");

const router = express.Router();

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
      return res.json({
        success: true,
        message: "No active products to scrape",
        results: [],
      });
    }

    const { scrapeProduct } = require("../scraper");

    const results = [];

    for (const product of products) {
      try {
        console.log(
          `Cron scraping: ${product.product_name} (${product.product_id})`
        );

        const result = await scrapeProduct(
          product.product_id
        );

        results.push({
          productId: product.product_id,
          productName: product.product_name,
          success: true,
          result,
        });

      } catch (error) {
        console.error(
          `Cron scrape failed for ${product.product_name}:`,
          error.message
        );

        results.push({
          productId: product.product_id,
          productName: product.product_name,
          success: false,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: "Cron scraping completed",
      results,
    });

  } catch (error) {
    console.error(
      "Cron scrape error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Cron scraping failed",
    });
  }
});

module.exports = router;