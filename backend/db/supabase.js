require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL is missing from .env");
}

if (!process.env.SUPABASE_KEY) {
  throw new Error("SUPABASE_KEY is missing from .env");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = supabase;