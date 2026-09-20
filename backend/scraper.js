const { chromium } = require("playwright");

const {
  saveTrackedProduct,
  savePriceHistory,
  saveScrapeLog,
} = require("./services/databaseService");

const PRODUCT_ID = process.argv[2] || 224;

// Deployment: HEADLESS=true
// Local: default headed mode
const HEADLESS = process.env.HEADLESS === "true";

// --------------------------------------------------
// COOKIE HANDLER
// --------------------------------------------------

async function acceptCookies(page) {
  try {
    if (page.isClosed()) return false;

    const cookieOverlay = page.locator(".cookie-overlay");

    if ((await cookieOverlay.count()) === 0) {
      return false;
    }

    if (!(await cookieOverlay.isVisible().catch(() => false))) {
      return false;
    }

    console.log("Cookie overlay detected.");

    const buttons = cookieOverlay.locator("button");
    const count = await buttons.count();

    console.log("Cookie buttons found:", count);

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);

      if (await button.isVisible().catch(() => false)) {
        console.log(
          "Accepting cookie:",
          await button.innerText().catch(() => "ACCEPT")
        );

        await button.click({
          force: true,
          timeout: 5000,
        });

        console.log("Cookie accepted and closed.");

        // Do NOT wait here.
        // The store may update/re-render after accepting cookies.

        return true;
      }
    }

    return false;
  } catch (error) {
    console.log("Cookie handling error:", error.message);
    return false;
  }
}

// --------------------------------------------------
// EXTRACT VALUE FROM API RESPONSE
// --------------------------------------------------

function findValue(obj, possibleKeys) {
  if (!obj || typeof obj !== "object") {
    return null;
  }

  for (const key of possibleKeys) {
    if (
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== null &&
      obj[key] !== undefined
    ) {
      return obj[key];
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findValue(value, possibleKeys);

      if (found !== null && found !== undefined) {
        return found;
      }
    }
  }

  return null;
}

// --------------------------------------------------
// MAIN SCRAPER
// --------------------------------------------------

async function scrapeProduct(productId) {
  const browser = await chromium.launch({
    headless: HEADLESS,
  });

  const page = await browser.newPage();

  // Store price API attempts
  const priceAttempts = [];

  // Actual successful price API response
  let apiPriceData = null;

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

  page.on("response", async (response) => {
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

    // --------------------------------------------------
    // CAPTURE ACTUAL PRODUCT PRICE API
    // --------------------------------------------------

    if (url.includes(`/api/products/${productId}/price`)) {
      const status = response.status();

      const attemptNumber = priceAttempts.length + 1;

      priceAttempts.push({
        attemptNumber,
        httpStatus: status,
        timestamp: new Date(),
      });

      console.log(
        `PRICE ATTEMPT ${attemptNumber}: HTTP ${status}`
      );

      // Capture successful API response
      if (status === 200) {
        try {
          const body = await response.json();

          apiPriceData = body;

          console.log(
            "PRICE API RESPONSE RECEIVED."
          );

          console.log(
            "PRICE API DATA:",
            JSON.stringify(body)
          );
        } catch (error) {
          console.log(
            "Could not parse price API response:",
            error.message
          );
        }
      }
    }
  });

  try {
    console.log(
      `Opening product ${productId}...`
    );

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

    await page.waitForTimeout(1500);

    // Cookie can appear slightly after page load
    await acceptCookies(page);

    // --------------------------------------------------
    // STEP 2: FIND PRICE AREA
    // --------------------------------------------------

    console.log(
      "Moving mouse over price area..."
    );

    const priceBlock =
      page.locator(".price-block").first();

    await priceBlock.waitFor({
      state: "visible",
      timeout: 10000,
    });

    const box =
      await priceBlock.boundingBox();

    if (!box) {
      throw new Error(
        "Could not find price block coordinates"
      );
    }

    console.log(
      "Price area:",
      box
    );

    // --------------------------------------------------
    // STEP 3: HUMAN-LIKE MOUSE MOVEMENT
    // --------------------------------------------------

    // Cookie may appear after initial page load
    await acceptCookies(page);

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

    // Cookie can appear again
    await acceptCookies(page);

    // --------------------------------------------------
    // STEP 4: REVEAL PRICE
    // --------------------------------------------------

    console.log(
      "Looking for Reveal price button..."
    );

    const revealButton =
      page.getByRole("button", {
        name: /reveal price/i,
      });

    await revealButton.waitFor({
      state: "visible",
      timeout: 10000,
    });

    const disabled =
      await revealButton.isDisabled();

    console.log(
      "Button disabled state:",
      disabled
    );

    if (disabled) {
      throw new Error(
        "Reveal button is still disabled after mouse interaction"
      );
    }

    console.log(
      "Reveal price button is enabled."
    );

    // Cookie protection one final time
    await acceptCookies(page);

    await revealButton.click({
      force: true,
      timeout: 10000,
    });

    console.log(
      "Reveal price clicked."
    );

    // --------------------------------------------------
    // STEP 5: WAIT FOR PRICE API
    // --------------------------------------------------

    console.log(
      "Waiting for price API response..."
    );

    // The actual source of truth is the price API,
    // not .price-main DOM rendering.
    const apiDeadline =
      Date.now() + 60000;

    while (
      !apiPriceData &&
      Date.now() < apiDeadline
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );
    }

    // --------------------------------------------------
    // STEP 6: EXTRACT RESULT
    // --------------------------------------------------

    let result = {
      name: null,
      price: null,
      stock: null,
    };

    // --------------------------------------------------
    // FIRST: TRY API RESPONSE
    // --------------------------------------------------

    if (apiPriceData) {
      console.log(
        "Extracting price from API response..."
      );

      const apiPrice = findValue(
        apiPriceData,
        [
          "price",
          "currentPrice",
          "sellingPrice",
          "salePrice",
          "finalPrice",
          "amount",
        ]
      );

      const apiStock = findValue(
        apiPriceData,
        [
          "stock",
          "stockStatus",
          "availability",
          "inventory",
          "quantity",
        ]
      );

      const apiName = findValue(
        apiPriceData,
        [
          "name",
          "productName",
          "title",
        ]
      );

      if (
        apiPrice !== null &&
        apiPrice !== undefined
      ) {
        result.price =
          String(apiPrice)
            .replace(/[₹,\u200b\u200c\u200d\ufeff]/g, "")
            .trim();
      }

      if (
        apiStock !== null &&
        apiStock !== undefined
      ) {
        result.stock =
          String(apiStock).trim();
      }

      if (
        apiName !== null &&
        apiName !== undefined
      ) {
        result.name =
          String(apiName).trim();
      }
    }

    // --------------------------------------------------
    // SECOND: DOM FALLBACK
    // --------------------------------------------------

    if (
      result.price === null ||
      result.price === undefined ||
      result.price === ""
    ) {
      console.log(
        "API price not directly detected. Trying DOM fallback..."
      );

      try {
        result = await page.evaluate(
          () => {
            const priceMain =
              document.querySelector(
                ".price-main"
              );

            let currentPrice = null;

            if (priceMain) {
              const text =
                priceMain.innerText || "";

              const prices =
                text.match(
                  /₹[\d,\u200b]+/g
                ) || [];

              const cleanPrice =
                (value) =>
                  value.replace(
                    /[₹,\u200b\u200c\u200d\ufeff]/g,
                    ""
                  );

              const numericPrices =
                prices
                  .map(cleanPrice)
                  .filter(
                    (value) =>
                      /^\d+$/.test(value)
                  );

              console.log(
                "Detected prices:",
                numericPrices
              );

              currentPrice =
                numericPrices.length >= 2
                  ? numericPrices[1]
                  : numericPrices.length === 1
                    ? numericPrices[0]
                    : null;
            }

            const stockElement =
              document.querySelector(
                ".stock-badge"
              ) ||
              document.querySelector(
                ".stock"
              );

            const stock =
              stockElement?.innerText?.trim() ||
              null;

            const name =
              document
                .querySelector("h1")
                ?.innerText?.trim() ||
                null;

            return {
              name,
              price: currentPrice,
              stock,
            };
          }
        );
      } catch (error) {
        console.log(
          "DOM fallback failed:",
          error.message
        );
      }
    } else {
      // Fill missing fields from DOM
      try {
        const domInfo =
          await page.evaluate(() => ({
            name:
              document
                .querySelector("h1")
                ?.innerText?.trim() ||
              null,

            stock:
              document
                .querySelector(".stock-badge")
                ?.innerText?.trim() ||
              document
                .querySelector(".stock")
                ?.innerText?.trim() ||
              null,
          }));

        if (!result.name) {
          result.name =
            domInfo.name;
        }

        if (!result.stock) {
          result.stock =
            domInfo.stock;
        }
      } catch (error) {
        console.log(
          "Could not read DOM metadata:",
          error.message
        );
      }
    }

    console.log(
      "\nSCRAPE RESULT:"
    );

    console.log(result);

    // --------------------------------------------------
    // VALIDATE PRICE
    // --------------------------------------------------

    const priceNumber =
      result.price !== null &&
      result.price !== undefined &&
      result.price !== ""
        ? Number(result.price)
        : null;

    console.log(
      "\nNumeric price:",
      priceNumber
    );

    if (
      priceNumber === null ||
      !Number.isFinite(priceNumber)
    ) {
      throw new Error(
        "Price API succeeded but price could not be extracted."
      );
    }

    // --------------------------------------------------
    // STEP 7: SAVE TRACKED PRODUCT
    // --------------------------------------------------

    console.log(
      "\nSaving result to Supabase..."
    );

    const trackedProduct =
      await saveTrackedProduct({
        productId,
        productName:
          result.name ||
          `Product ${productId}`,
      });

    console.log(
      "Tracked product saved:",
      trackedProduct.id
    );

    // --------------------------------------------------
    // STEP 8: SAVE PRICE HISTORY
    // --------------------------------------------------

    const priceHistory =
      await savePriceHistory({
        trackedProductId:
          trackedProduct.id,
        price: priceNumber,
        stockStatus: result.stock,
      });

    console.log(
      "Price history saved:",
      priceHistory.id
    );

    // --------------------------------------------------
    // STEP 9: SAVE EVERY PRICE ATTEMPT
    // --------------------------------------------------

    console.log(
      "\nSaving scrape attempts..."
    );

    const hasSuccessfulAttempt =
      priceAttempts.some(
        (attempt) =>
          attempt.httpStatus === 200
      );

    for (const attempt of priceAttempts) {
      let status;

      if (
        attempt.httpStatus === 200
      ) {
        status = "success";
      } else {
        status =
          hasSuccessfulAttempt
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
      productName:
        result.name ||
        `Product ${productId}`,
      price: priceNumber,
      stock: result.stock,
      attempts:
        priceAttempts.length,
      trackedProductId:
        trackedProduct.id,
    };

  } catch (error) {
    console.error(
      "\nSCRAPE FAILED:"
    );

    console.error(
      error.message
    );

    throw error;

  } finally {
    await browser.close();
  }
}

// --------------------------------------------------
// DIRECT SCRIPT EXECUTION
// --------------------------------------------------

if (require.main === module) {
  scrapeProduct(PRODUCT_ID)
    .then((result) => {
      console.log(
        "\nFINAL SCRAPE RESULT:"
      );

      console.log(result);

      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = {
  scrapeProduct,
};