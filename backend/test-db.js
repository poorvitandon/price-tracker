const supabase = require("./db/supabase");

async function testDatabase() {
  console.log("Testing Supabase connection...");

  const { data, error } = await supabase
    .from("tracked_products")
    .select("*")
    .limit(1);

  if (error) {
    console.error("❌ Supabase connection failed:");
    console.error(error.message);
    return;
  }

  console.log("✅ Supabase connected successfully!");
  console.log("Tracked products:", data);
}

testDatabase();