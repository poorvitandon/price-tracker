const express = require("express");

const router = express.Router();

const STORE_URL = "https://demo.inelabteamdev.com";

// Search products from INE Store catalog
router.get("/search", async (req, res) => {
  try {
    const query = req.query.q?.trim().toLowerCase();

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const response = await fetch(
      `${STORE_URL}/api/catalog?page=1&pageSize=100`
    );

    if (!response.ok) {
      throw new Error(
        `Store catalog returned HTTP ${response.status}`
      );
    }

    const result = await response.json();

    // Catalog may return products inside different fields,
    // so inspect the actual structure first.
    const products =
      Array.isArray(result)
        ? result
        : result.products || result.items || result.data || [];

    const filteredProducts = products.filter((product) => {
      const name = String(
        product.name || product.title || ""
      ).toLowerCase();

      return name.includes(query);
    });

    res.json({
      success: true,
      count: filteredProducts.length,
      products: filteredProducts.slice(0, 20),
    });

  } catch (error) {
    console.error("Product search error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to search products",
      error: error.message,
    });
  }
});

module.exports = router;