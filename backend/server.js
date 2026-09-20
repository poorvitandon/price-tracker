const express = require("express");
const cors = require("cors");

const productRoutes = require("./routes/productRoutes");
const trackedProductRoutes =
  require("./routes/trackedProductRoutes");

  const cronRoutes = require("./routes/cronRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Product Price Tracker API is running",
  });
});

app.use("/api/products", productRoutes);
app.use(
  "/api/tracked-products",
  trackedProductRoutes
);
app.use("/api/cron", cronRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});