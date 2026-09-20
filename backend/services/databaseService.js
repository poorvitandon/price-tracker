const supabase = require("../db/supabase");

async function saveTrackedProduct({
  productId,
  productName,
}) {
  const productUrl =
    `https://demo.inelabteamdev.com/product/${productId}`;

  const { data, error } = await supabase
    .from("tracked_products")
    .upsert(
      {
        product_id: productId,
        product_name: productName,
        product_url: productUrl,
        is_active: true,
      },
      {
        onConflict: "product_id",
      }
    )
    .select()
    .single();

  if (error) {
    throw new Error(
      `Failed to save tracked product: ${error.message}`
    );
  }

  return data;
}


async function savePriceHistory({
  trackedProductId,
  price,
  stockStatus,
}) {
  const { data, error } = await supabase
    .from("price_history")
    .insert({
      tracked_product_id: trackedProductId,
      price,
      stock_status: stockStatus,
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      `Failed to save price history: ${error.message}`
    );
  }

  return data;
}


async function saveScrapeLog({
  trackedProductId,
  attemptNumber,
  status,
  httpStatus = null,
  errorMessage = null,
  startedAt = new Date(),
  completedAt = new Date(),
}) {
  const { data, error } = await supabase
    .from("scrape_logs")
    .insert({
      tracked_product_id: trackedProductId,
      attempt_number: attemptNumber,
      status,
      http_status: httpStatus,
      error_message: errorMessage,
      started_at: startedAt,
      completed_at: completedAt,
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      `Failed to save scrape log: ${error.message}`
    );
  }

  return data;
}


module.exports = {
  saveTrackedProduct,
  savePriceHistory,
  saveScrapeLog,
};