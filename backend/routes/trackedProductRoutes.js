const express = require("express");
const supabase = require("../db/supabase");
const {
  saveTrackedProduct,
} = require("../services/databaseService");

const router = express.Router();


// POST /api/tracked-products
// Track a product
router.post("/", async (req, res) => {
  try {
    const { productId, productName } = req.body;

    if (!productId || !productName) {
      return res.status(400).json({
        success: false,
        message: "productId and productName are required",
      });
    }

    const product = await saveTrackedProduct({
      productId,
      productName,
    });

    res.status(201).json({
      success: true,
      message: "Product is now being tracked",
      product,
    });

  } catch (error) {
    console.error("Track product error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to track product",
    });
  }
});


// GET /api/tracked-products
// Get all tracked products
router.get("/", async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from("tracked_products")
      .select("*")
      .eq("is_active", true)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    const productsWithLatestData = await Promise.all(
      products.map(async (product) => {
        const { data: latestHistory, error: historyError } =
          await supabase
            .from("price_history")
            .select("price, stock_status, scraped_at")
            .eq("tracked_product_id", product.id)
            .order("scraped_at", {
              ascending: false,
            })
            .limit(1)
            .maybeSingle();

        if (historyError) {
          console.error(
            `History error for product ${product.id}:`,
            historyError.message
          );
        }

        return {
          ...product,
          latestPrice: latestHistory?.price ?? null,
          latestStock: latestHistory?.stock_status ?? null,
          lastScrapedAt: latestHistory?.scraped_at ?? null,
        };
      })
    );

    res.json({
      success: true,
      count: productsWithLatestData.length,
      products: productsWithLatestData,
    });

  } catch (error) {
    console.error(
      "Get tracked products error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch tracked products",
    });
  }
});

router.post("/:id/scrape", async (req, res) => {
  try {
    const trackedProductId = Number(req.params.id);

    if (!Number.isInteger(trackedProductId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tracked product ID",
      });
    }

    // Find tracked product
    const { data: product, error } = await supabase
      .from("tracked_products")
      .select("*")
      .eq("id", trackedProductId)
      .eq("is_active", true)
      .single();

    if (error || !product) {
      return res.status(404).json({
        success: false,
        message: "Tracked product not found",
      });
    }

    console.log(
      `Starting manual scrape for product ${product.product_id}...`
    );

    const { scrapeProduct } = require("../scraper");

    const result = await scrapeProduct(product.product_id);

    res.json({
      success: true,
      message: "Product scraped successfully",
      result,
    });

  } catch (error) {
    console.error(
      "Manual scrape error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Scrape failed",
      error: error.message,
    });
  }
});

// GET /api/tracked-products/:id/history
// Get price and stock history
router.get("/:id/history", async (req, res) => {
  try {
    const trackedProductId = Number(req.params.id);

    if (!Number.isInteger(trackedProductId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tracked product ID",
      });
    }

    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("tracked_product_id", trackedProductId)
      .order("scraped_at", {
  ascending: false,
});

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      count: data.length,
      history: data,
    });

  } catch (error) {
    console.error(
      "Get price history error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch price history",
    });
  }
});

// GET /api/tracked-products/:id/logs
// Get scrape attempt logs
router.get("/:id/logs", async (req, res) => {
  try {
    const trackedProductId = Number(req.params.id);

    if (!Number.isInteger(trackedProductId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tracked product ID",
      });
    }

    const { data, error } = await supabase
      .from("scrape_logs")
      .select("*")
      .eq("tracked_product_id", trackedProductId)
      .order("started_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      count: data.length,
      logs: data,
    });

  } catch (error) {
    console.error(
      "Get scrape logs error:",
      error.message
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch scrape logs",
    });
  }
});

module.exports = router;