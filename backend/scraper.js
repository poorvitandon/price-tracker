const { chromium } = require("playwright");

const {
  saveTrackedProduct,
  savePriceHistory,
  saveScrapeLog,
} = require("./services/databaseService");

const PRODUCT_ID = process.argv[2] || 224;

// Default is headed mode.
// For deployment, set HEADLESS=true.
const HEADLESS = process.env.HEADLESS === "true";

async function scrapeProduct(productId) {
  const browser = await chromium.launch({
    headless: HEADLESS,
  });

  const page = await browser.newPage();

  // Store price API attempts
  const priceAttempts = [];

  // --------------------------------------------------
  // NETWORK LOGGING
  // --------------------------------------------------

  page.on("request", (request) => {
    if (
      request.resourceType() === "fetch" ||
      request.resourceType() === "xhr"
    ) {
      console.log(
        ">> REQUEST:",
        request.method(),
        request.url()
      );
    }
  });

  page.on("response", (response) => {
    const url = response.url();

    if (
      response.request().resourceType() === "fetch" ||
      response.request().resourceType() === "xhr"
    ) {
      console.log(
        "<< RESPONSE:",
        response.status(),
        url
      );
    }

    // Capture ONLY the actual product price API
    if (url.includes(`/api/products/${productId}/price`)) {
      const status = response.status();

      priceAttempts.push({
        attemptNumber: priceAttempts.length + 1,
        httpStatus: status,
        timestamp: new Date(),
      });

      console.log(
        `PRICE ATTEMPT ${priceAttempts.length}: HTTP ${status}`
      );
    }
  });

  try {
    console.log(`Opening product ${productId}...`);

    // --------------------------------------------------
    // STEP 1: OPEN PRODUCT
    // --------------------------------------------------

    await page.goto(
      `https://demo.inelabteamdev.com/product/${productId}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }
    );

    console.log("Page loaded.");

    await page.waitForTimeout(2000);

    // --------------------------------------------------
    // STEP 2: FIND PRICE AREA
    // --------------------------------------------------

    console.log("Moving mouse over price area...");

    const priceBlock = page.locator(".price-block").first();

    await priceBlock.waitFor({
      state: "visible",
      timeout: 10000,
    });

    const box = await priceBlock.boundingBox();

    if (!box) {
      throw new Error("Could not find price block coordinates");
    }

    console.log("Price area:", box);

    // --------------------------------------------------
    // STEP 3: HUMAN-LIKE MOUSE MOVEMENT
    // --------------------------------------------------

    await priceBlock.hover();

    await page.waitForTimeout(200);

    for (let i = 0; i < 12; i++) {
      await priceBlock.hover({
        position: {
          x: 20 + (i % 4) * 40,
          y: 20 + (i % 3) * 15,
        },
      });

      await page.waitForTimeout(120);
    }

    // Required dwell time
    await page.waitForTimeout(1000);

    // --------------------------------------------------
    // STEP 4: REVEAL PRICE
    // --------------------------------------------------

    console.log("Looking for Reveal price button...");

    const revealButton = page.getByRole("button", {
      name: /reveal price/i,
    });

    await revealButton.waitFor({
      state: "visible",
      timeout: 10000,
    });

    const disabled = await revealButton.isDisabled();

    console.log("Button disabled state:", disabled);

    if (disabled) {
      throw new Error(
        "Reveal button is still disabled after mouse interaction"
      );
    }

    console.log("Reveal price button is enabled.");

    await revealButton.click();

    console.log("Reveal price clicked.");

    // --------------------------------------------------
    // STEP 5: WAIT FOR REAL PRICE
    // --------------------------------------------------

    await page.waitForFunction(
      () => {
        const priceMain =
          document.querySelector(".price-main");

        if (!priceMain) return false;

        const text = priceMain.innerText;

        const prices =
          text.match(/₹[\d,\u200b]+/g) || [];

        return prices.length >= 2;
      },
      {
        timeout: 60000,
      }
    );

    console.log("Actual price loaded.");

    // --------------------------------------------------
    // STEP 6: EXTRACT RESULT
    // --------------------------------------------------

    const result = await page.evaluate(() => {
      const priceMain =
        document.querySelector(".price-main");

      if (!priceMain) {
        throw new Error("Price block not found");
      }

      const text = priceMain.innerText;

      // Extract rupee values including zero-width spaces
      const prices =
        text.match(/₹[\d,\u200b]+/g) || [];

      const cleanPrice = (value) =>
        value.replace(
          /[₹,\u200b\u200c\u200d\ufeff]/g,
          ""
        );

      const numericPrices = prices
        .map(cleanPrice)
        .filter((value) => /^\d+$/.test(value));

      console.log(
        "Detected prices:",
        numericPrices
      );

      // First value = MRP
      // Second value = current selling price
      const currentPrice =
        numericPrices.length >= 2
          ? numericPrices[1]
          : numericPrices.length === 1
            ? numericPrices[0]
            : null;

      // Stock
      const stockElement =
        document.querySelector(".stock-badge") ||
        document.querySelector(".stock");

      const stock =
        stockElement?.innerText?.trim() || null;

      // Product name
      const name =
        document
          .querySelector("h1")
          ?.innerText?.trim() || null;

      return {
        name,
        price: currentPrice,
        stock,
      };
    });

    console.log("\nSCRAPE RESULT:");
    console.log(result);

    // --------------------------------------------------
    // STEP 7: CONVERT PRICE
    // --------------------------------------------------

    const priceNumber =
      result.price !== null
        ? Number(result.price)
        : null;

    console.log(
      "\nNumeric price:",
      priceNumber
    );

    // --------------------------------------------------
    // STEP 8: SAVE TRACKED PRODUCT
    // --------------------------------------------------

    console.log(
      "\nSaving result to Supabase..."
    );

    const trackedProduct =
      await saveTrackedProduct({
        productId,
        productName: result.name,
      });

    console.log(
      "Tracked product saved:",
      trackedProduct.id
    );

    // --------------------------------------------------
    // STEP 9: SAVE PRICE HISTORY
    // --------------------------------------------------

    if (
      priceNumber !== null &&
      Number.isFinite(priceNumber)
    ) {
      const priceHistory =
        await savePriceHistory({
          trackedProductId: trackedProduct.id,
          price: priceNumber,
          stockStatus: result.stock,
        });

      console.log(
        "Price history saved:",
        priceHistory.id
      );
    } else {
      console.log(
        "Price history NOT saved because price extraction failed."
      );
    }

    // --------------------------------------------------
    // STEP 10: SAVE EVERY PRICE ATTEMPT
    // --------------------------------------------------

    console.log(
      "\nSaving scrape attempts..."
    );

    const hasSuccessfulAttempt =
      priceAttempts.some(
        (attempt) => attempt.httpStatus === 200
      );

    for (const attempt of priceAttempts) {
      let status;

      if (attempt.httpStatus === 200) {
        status = "success";
      } else {
        // If a later 200 succeeded, this attempt
        // was genuinely retried.
        status = hasSuccessfulAttempt
          ? "retrying"
          : "failed";
      }

      await saveScrapeLog({
        trackedProductId:
          trackedProduct.id,
        attemptNumber:
          attempt.attemptNumber,
        status,
        httpStatus:
          attempt.httpStatus,
        errorMessage:
          attempt.httpStatus === 200
            ? null
            : `Price API returned HTTP ${attempt.httpStatus}`,
        startedAt:
          attempt.timestamp,
        completedAt:
          new Date(),
      });

      console.log(
        `Attempt ${attempt.attemptNumber}: ${attempt.httpStatus} → ${status}`
      );
    }

    console.log(
      "Scrape logs saved."
    );

    // --------------------------------------------------
    // FINAL RESULT
    // --------------------------------------------------

    return {
      success: true,
      productId,
      productName: result.name,
      price: priceNumber,
      stock: result.stock,
      attempts: priceAttempts.length,
      trackedProductId:
        trackedProduct.id,
    };
    } catch (error) {
    console.error("\nSCRAPE FAILED:");
    console.error(error.message);

    throw error;
    
  } finally {
    await browser.close();
  }
}

// --------------------------------------------------
// DIRECT SCRIPT EXECUTION
// --------------------------------------------------

if (require.main === module) {
  scrapeProduct(PRODUCT_ID).catch(() => {
    process.exit(1);
  });
}

module.exports = {
  scrapeProduct,
};