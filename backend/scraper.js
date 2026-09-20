/**
 * backend/scraper.js
 *
 * Product Price Tracker — reliable scraper for https://demo.inelabteamdev.com/
 *
 * Fixes applied vs the previous version:
 *  - Handles the DELAYED cookie overlay before every interaction (hover, click),
 *    not just once after page load.
 *  - Never lets the cookie overlay block priceBlock.hover() or Reveal Price click;
 *    retries the action after re-dismissing the overlay.
 *  - Captures the real /api/products/{id}/price network response and uses it as the
 *    primary price/stock source; DOM regex extraction (original rupee logic) is a fallback.
 *  - Logs every price API attempt (attemptNumber, httpStatus, timestamp) and derives
 *    success / retrying / failed per attempt, honestly, never hiding failures.
 *  - Never fabricates a price. Price history is only saved when a valid finite number
 *    was actually extracted.
 *  - Retries the whole interaction flow (fresh page) up to MAX_FLOW_ATTEMPTS times on
 *    structural failures (e.g. reveal button never became clickable).
 *  - Guards every wait/interaction against "Target page, context or browser has been
 *    closed" by checking page.isClosed() first.
 *  - Works headed locally (HEADLESS unset) and headless on Render (HEADLESS=true).
 *
 * Usage:
 *   node scraper.js [productId]        // standalone / headed demo run
 *   require('./scraper').scrapeProduct(productId)   // used by routes/cron
 */

require("dotenv").config();
const { chromium } = require("playwright");
const {
  saveTrackedProduct,
  savePriceHistory,
  saveScrapeLog,
} = require("./services/databaseService");

const STORE_BASE_URL = "https://demo.inelabteamdev.com";
const HEADLESS = process.env.HEADLESS === "true";

const MAX_FLOW_ATTEMPTS = 3; // full page-load-to-reveal retries
const PRICE_API_WAIT_TIMEOUT_MS = 25000; // wait for a captured price API response
const DOM_FALLBACK_WAIT_MS = 10000;
const COOKIE_OVERLAY_POLL_MS = 500;
const MOUSE_MOVEMENTS = 12;
const DWELL_TIME_MS = 1000;

// ---------------------------------------------------------------------------
// Small safe helpers
// ---------------------------------------------------------------------------

function isPageAlive(page) {
  try {
    return !!page && !page.isClosed();
  } catch (e) {
    return false;
  }
}

async function safeWait(page, ms) {
  if (!isPageAlive(page)) return;
  try {
    await page.waitForTimeout(ms);
  } catch (err) {
    if (!/closed/i.test(err.message || "")) throw err;
  }
}

// ---------------------------------------------------------------------------
// Cookie overlay handling
// ---------------------------------------------------------------------------

/**
 * Polls for the (possibly delayed) cookie overlay and clicks ACCEPT if present.
 * Returns true if no overlay is blocking after this call, false if it never
 * cleared within the timeout (caller decides whether that's fatal).
 */
async function dismissCookieOverlay(page, { timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (!isPageAlive(page)) return false;

    const overlay = page.locator(".cookie-overlay").first();
    let visible = false;
    try {
      visible = await overlay.isVisible();
    } catch (e) {
      visible = false;
    }

    if (!visible) {
      return true; // nothing blocking right now
    }

    console.log("Cookie overlay detected.");
    const buttons = overlay.locator("button");
    const count = await buttons.count().catch(() => 0);
    console.log(`Cookie buttons found: ${count}`);

    let clicked = false;
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const text = (await btn.innerText().catch(() => "")).trim();
      if (/accept/i.test(text)) {
        console.log(`Accepting cookie: ${text}`);
        try {
          await btn.click({ timeout: 3000 });
          clicked = true;
          break;
        } catch (e) {
          /* try next candidate */
        }
      }
    }
    if (!clicked && count > 0) {
      try {
        await buttons.first().click({ timeout: 3000 });
        clicked = true;
      } catch (e) {
        /* fall through to poll again */
      }
    }

    try {
      await overlay.waitFor({ state: "hidden", timeout: 5000 });
      console.log("Cookie accepted and closed.");
      return true;
    } catch (e) {
      // overlay still there (or re-appeared) — loop and try again
    }

    await safeWait(page, COOKIE_OVERLAY_POLL_MS);
  }

  return false;
}

/**
 * Runs actionFn(), and if it fails because the cookie overlay intercepted the
 * pointer event (or a plain timeout that looks overlay-related), re-dismisses
 * the overlay and retries. Never retries once the page/context is closed.
 */
async function withCookieRetry(page, actionFn, description, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!isPageAlive(page)) {
      throw new Error(`Page closed before "${description}"`);
    }
    try {
      await dismissCookieOverlay(page, { timeout: 4000 });
      await actionFn();
      return;
    } catch (err) {
      lastErr = err;
      const msg = (err && err.message) || "";
      if (/closed/i.test(msg)) throw err; // don't retry a dead page/context/browser
      console.log(
        `"${description}" failed (attempt ${attempt}/${maxRetries}): ${
          msg.split("\n")[0]
        }`
      );
      if (/cookie-overlay|intercepts pointer events|Timeout/i.test(msg)) {
        await dismissCookieOverlay(page, { timeout: 8000 });
      }
      await safeWait(page, 500);
    }
  }
  throw lastErr || new Error(`"${description}" failed after ${maxRetries} attempts`);
}

// ---------------------------------------------------------------------------
// Human-like interaction
// ---------------------------------------------------------------------------

async function humanHover(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Price block bounding box not found");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (let i = 0; i < MOUSE_MOVEMENTS; i++) {
    const dx = cx + (Math.random() * 40 - 20);
    const dy = cy + (Math.random() * 20 - 10);
    await page.mouse.move(dx, dy, { steps: 5 });
    await safeWait(page, 40 + Math.random() * 60);
  }
  await page.mouse.move(cx, cy, { steps: 5 });
  await safeWait(page, DWELL_TIME_MS);
}

// ---------------------------------------------------------------------------
// Price / stock extraction
// ---------------------------------------------------------------------------

// Original DOM extraction logic — preserved as-is (fallback only).
function extractPriceFromText(text) {
  const prices = text.match(/₹[\d,\u200b]+/g) || [];
  const cleanPrice = (value) => value.replace(/[₹,\u200b\u200c\u200d\ufeff]/g, "");
  const numericPrices = prices.map(cleanPrice).filter((value) => /^\d+$/.test(value));
  const currentPrice =
    numericPrices.length >= 2
      ? numericPrices[1]
      : numericPrices.length === 1
        ? numericPrices[0]
        : null;
  return currentPrice;
}

function extractStockFromDom(text) {
  const match = text.match(/in stock|out of stock|low stock/i);
  return match ? match[0].toLowerCase() : null;
}

// Parse the real API payload defensively — no invented structure, just common shapes.
function extractPriceFromApiPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.price,
    payload.currentPrice,
    payload.salePrice,
    payload?.data?.price,
    payload?.data?.currentPrice,
    payload?.product?.price,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const n = typeof c === "string" ? Number(c.replace(/[₹,\s]/g, "")) : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractStockFromApiPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.stock,
    payload.stockStatus,
    payload.stock_status,
    payload?.data?.stock,
    payload?.data?.stockStatus,
    payload?.product?.stock,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().toLowerCase();
    if (typeof c === "boolean") return c ? "in_stock" : "out_of_stock";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Network capture — every hit to the real price API is logged
// ---------------------------------------------------------------------------

function attachPriceApiListener(page, priceAttempts) {
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!/\/api\/products\/[^/]+\/price/.test(url)) return;

      const status = response.status();
      let payload = null;
      if (status === 200) {
        try {
          payload = await response.json();
        } catch (e) {
          payload = null;
        }
      }

      priceAttempts.push({
        attemptNumber: priceAttempts.length + 1,
        httpStatus: status,
        timestamp: new Date().toISOString(),
        url,
        payload,
      });
      console.log(`PRICE ATTEMPT ${priceAttempts.length}: HTTP ${status}`);
    } catch (e) {
      // never let a listener error kill the scrape
    }
  });
}

// ---------------------------------------------------------------------------
// One full interaction flow (page load -> reveal -> extract)
// ---------------------------------------------------------------------------

async function runFlow(page, productId, priceAttempts) {
  const url = `${STORE_BASE_URL}/product/${productId}`;
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Cookie overlay can appear immediately or after a delay — check now, and
  // again before every subsequent interaction via withCookieRetry.
  await dismissCookieOverlay(page);

  await safeWait(page, 1500); // let layout/content settle

  const productName = await page
    .locator("h1")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => null);

  const priceBlock = page.locator(".price-block").first();
  await priceBlock.waitFor({ state: "visible", timeout: 15000 });

  await withCookieRetry(
    page,
    async () => humanHover(page, priceBlock),
    "Hover over price block"
  );

  const revealBtn = page
    .locator('button[aria-label="Reveal price"], button:has-text("Reveal price")')
    .first();
  await revealBtn.waitFor({ state: "visible", timeout: 15000 });

  const isEnabled = await revealBtn.isEnabled().catch(() => false);
  if (!isEnabled) throw new Error("Reveal price button not enabled");

  await withCookieRetry(
    page,
    async () => revealBtn.click({ timeout: 5000 }),
    "Click Reveal price"
  );

  console.log("Reveal price clicked, waiting for price API response...");

  const attemptsBefore = priceAttempts.length;
  const deadline = Date.now() + PRICE_API_WAIT_TIMEOUT_MS;
  let apiPrice = null;
  let apiStock = null;
  let sawApiSuccess = false;

  while (Date.now() < deadline) {
    if (!isPageAlive(page)) throw new Error("Page closed while waiting for price API");
    const successAttempt = priceAttempts
      .slice(attemptsBefore)
      .find((a) => a.httpStatus === 200 && a.payload);
    if (successAttempt) {
      apiPrice = extractPriceFromApiPayload(successAttempt.payload);
      apiStock = extractStockFromApiPayload(successAttempt.payload);
      sawApiSuccess = true;
      break;
    }
    await safeWait(page, 300);
  }

  let finalPrice = apiPrice;
  let finalStock = apiStock;
  let source = "api";

  // Fall back to DOM extraction only if the API path didn't give us a usable price.
  if (!Number.isFinite(finalPrice)) {
    source = "dom";
    console.log("API price unavailable/unparseable — falling back to DOM extraction.");
    try {
      await page.waitForFunction(
        () => {
          const text = document.body.innerText || "";
          const prices = text.match(/₹[\d,\u200b]+/g) || [];
          return prices.length >= 1;
        },
        { timeout: DOM_FALLBACK_WAIT_MS }
      );
    } catch (e) {
      console.log("DOM price wait timed out — attempting extraction anyway.");
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const domPriceStr = extractPriceFromText(bodyText);
    finalPrice = domPriceStr !== null ? Number(domPriceStr) : null;
    if (!finalStock) finalStock = extractStockFromDom(bodyText);
  }

  return {
    productName: productName || `Product ${productId}`,
    price: Number.isFinite(finalPrice) ? finalPrice : null,
    stock: finalStock || null,
    priceSource: source,
    apiObservedSuccess: sawApiSuccess,
  };
}

// ---------------------------------------------------------------------------
// Top-level scrape orchestration
// ---------------------------------------------------------------------------

async function scrapeProduct(productId, options = {}) {
  const headless = options.headless !== undefined ? options.headless : HEADLESS;
  console.log(`\n=== Starting scrape for product ${productId} (headless=${headless}) ===`);

  const startedAt = new Date().toISOString();
  const priceAttempts = [];
  let browser, context, page;
  let flowError = null;
  let result = null;

  try {
    browser = await chromium.launch({ headless });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    for (let flowAttempt = 1; flowAttempt <= MAX_FLOW_ATTEMPTS; flowAttempt++) {
      try {
        if (page && !page.isClosed()) await page.close().catch(() => {});
        page = await context.newPage();
        attachPriceApiListener(page, priceAttempts);

        result = await runFlow(page, productId, priceAttempts);

        if (Number.isFinite(result.price)) {
          flowError = null;
          break;
        }
        throw new Error("Flow completed but no valid numeric price was extracted");
      } catch (err) {
        flowError = err;
        console.log(`Flow attempt ${flowAttempt}/${MAX_FLOW_ATTEMPTS} failed: ${err.message}`);
        if (flowAttempt < MAX_FLOW_ATTEMPTS) {
          console.log("Retrying full scrape flow with a fresh page...");
          await safeWait(page, 1000);
        }
      }
    }
  } finally {
    try {
      if (page && !page.isClosed()) await page.close();
    } catch (e) {}
    try {
      if (context) await context.close();
    } catch (e) {}
    try {
      if (browser) await browser.close();
    } catch (e) {}
  }

  const completedAt = new Date().toISOString();
  const success = !!(result && Number.isFinite(result.price));

  // Derive per-attempt status: 200 = success; non-200 before an eventual success = retrying;
  // non-200 with no later success = failed. Never hide a failed attempt.
  const firstSuccessIndex = priceAttempts.findIndex((a) => a.httpStatus === 200);
  const attemptLogs = priceAttempts.map((a, idx) => {
    let status;
    if (a.httpStatus === 200) status = "success";
    else if (firstSuccessIndex !== -1 && idx < firstSuccessIndex) status = "retrying";
    else status = "failed";
    return {
      attempt_number: a.attemptNumber,
      status,
      http_status: a.httpStatus,
      error_message: a.httpStatus === 200 ? null : `Price API returned HTTP ${a.httpStatus}`,
      started_at: a.timestamp,
      completed_at: a.timestamp,
    };
  });

  // If the flow failed before any price API call was ever observed (e.g. cookie
  // overlay never cleared, reveal button never appeared), still log honestly.
  if (attemptLogs.length === 0) {
    attemptLogs.push({
      attempt_number: 1,
      status: "failed",
      http_status: null,
      error_message: flowError ? flowError.message : "Unknown scraping failure",
      started_at: startedAt,
      completed_at: completedAt,
    });
  } else if (!success && flowError) {
    attemptLogs.push({
      attempt_number: attemptLogs.length + 1,
      status: "failed",
      http_status: null,
      error_message: flowError.message,
      started_at: startedAt,
      completed_at: completedAt,
    });
  }

  // Persist tracked product (upsert by product_id — existing behaviour preserved).
  let trackedProduct = null;
  try {
    trackedProduct = await saveTrackedProduct({
      product_id: String(productId),
      product_name: result ? result.productName : `Product ${productId}`,
      is_active: true,
    });
  } catch (err) {
    console.log(`Failed to save tracked product: ${err.message}`);
  }

  const trackedProductId =
    trackedProduct &&
    (trackedProduct.id ||
      (Array.isArray(trackedProduct) && trackedProduct[0] && trackedProduct[0].id));

  if (trackedProductId) {
    for (const log of attemptLogs) {
      try {
        await saveScrapeLog({ tracked_product_id: trackedProductId, ...log });
      } catch (err) {
        console.log(`Failed to save scrape log: ${err.message}`);
      }
    }

    if (success) {
      try {
        await savePriceHistory({
          tracked_product_id: trackedProductId,
          price: result.price,
          stock_status: result.stock,
        });
        console.log(`Saved price history: price=${result.price} stock=${result.stock}`);
      } catch (err) {
        console.log(`Failed to save price history: ${err.message}`);
      }
    } else {
      console.log(
        "Scrape did not produce a valid price — price history NOT saved (honest failure)."
      );
    }
  } else {
    console.log("No trackedProductId available — skipping log/history persistence.");
  }

  const finalResult = {
    productId: String(productId),
    productName: result ? result.productName : null,
    success,
    price: success ? result.price : null,
    stock: success ? result.stock : null,
    priceSource: result ? result.priceSource : null,
    priceAttempts: attemptLogs,
    error: success ? null : flowError ? flowError.message : "Unknown failure",
    startedAt,
    completedAt,
  };

  console.log(`=== Scrape ${success ? "SUCCEEDED" : "FAILED"} for product ${productId} ===\n`);
  return finalResult;
}

module.exports = { scrapeProduct };

// ---------------------------------------------------------------------------
// Standalone execution (npm run scrape / npm run scrape:headed)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const targetProductId = process.env.PRODUCT_ID || process.argv[2] || "747";
  scrapeProduct(targetProductId)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal scraper error:", err);
      process.exit(1);
    });
}