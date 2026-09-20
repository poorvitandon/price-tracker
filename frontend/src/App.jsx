import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

function App() {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [trackedProducts, setTrackedProducts] = useState([]);
  const [productData, setProductData] = useState({});
  const [loading, setLoading] = useState(false);
  const [scrapingId, setScrapingId] = useState(null);
  const [message, setMessage] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
const [history, setHistory] = useState([]);
const [logs, setLogs] = useState([]);
const [historyLoading, setHistoryLoading] = useState(false);


  // Load tracked products
  const loadTrackedProducts = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/tracked-products`
      );

      setTrackedProducts(response.data.products || []);

    } catch (error) {
      console.error(
        "Failed to load tracked products:",
        error
      );
    }
  };

  useEffect(() => {
    loadTrackedProducts();
  }, []);

  // Search products
  const handleSearch = async (value) => {
    setSearch(value);

    if (!value.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setLoading(true);

      const response = await axios.get(
        `${API_URL}/api/products/search`,
        {
          params: {
            q: value,
          },
        }
      );

      setSearchResults(
        response.data.products || []
      );

    } catch (error) {
      console.error("Search failed:", error);

      setSearchResults([]);

    } finally {
      setLoading(false);
    }
  };

  // Track product
  const trackProduct = async (product) => {
    try {
      await axios.post(
        `${API_URL}/api/tracked-products`,
        {
          productId: product.id,
          productName: product.name,
        }
      );

      setMessage(
        `${product.name} is now being tracked.`
      );

      setSearch("");
      setSearchResults([]);

      await loadTrackedProducts();

    } catch (error) {
      console.error(
        "Failed to track product:",
        error
      );

      setMessage("Failed to track product.");
    }
  };

  // Scrape product
  const scrapeProduct = async (product) => {
    try {
      setScrapingId(product.id);

      setMessage(
        `Scraping ${product.product_name}...`
      );

      const response = await axios.post(
        `${API_URL}/api/tracked-products/${product.id}/scrape`
      );

      const result = response.data.result;

      setProductData((previous) => ({
        ...previous,
        [product.id]: result,
      }));

      setMessage(
        `${product.product_name} scraped successfully.`
      );

      await loadTrackedProducts();

    } catch (error) {
      console.error(
        "Scrape failed:",
        error
      );

      setMessage(
        `Failed to scrape ${product.product_name}.`
      );

    } finally {
      setScrapingId(null);
    }
  };

  const viewHistory = async (product) => {
  try {
    setSelectedProduct(product);
    setHistoryLoading(true);

    const [historyResponse, logsResponse] =
      await Promise.all([
        axios.get(
          `${API_URL}/api/tracked-products/${product.id}/history`
        ),
        axios.get(
          `${API_URL}/api/tracked-products/${product.id}/logs`
        ),
      ]);

    setHistory(
      historyResponse.data.history || []
    );

    setLogs(
      logsResponse.data.logs || []
    );

  } catch (error) {
    console.error(
      "Failed to load history:",
      error
    );

    setMessage("Failed to load product history.");

  } finally {
    setHistoryLoading(false);
  }
};

  return (
    <div className="app">

      {/* HEADER */}
      <header className="header">
        <div>
          <h1>Price Tracker</h1>

          <p>
            Track product prices and stock changes
          </p>
        </div>
      </header>


      <main className="container">

        {/* SEARCH */}
        <section className="search-section">

          <h2>Find a Product</h2>

          <input
            type="text"
            value={search}
            placeholder="Search products..."
            onChange={(e) =>
              handleSearch(e.target.value)
            }
          />

          {loading && (
            <p className="info">
              Searching...
            </p>
          )}


          {searchResults.length > 0 && (

            <div className="search-results">

              {searchResults.map((product) => (

                <div
                  className="product-result"
                  key={product.id}
                >

                  <div>

                    <h3>
                      {product.name}
                    </h3>

                    <p>
                      {product.brand} •{" "}
                      {product.category}
                    </p>

                    <small>
                      SKU: {product.sku}
                    </small>

                  </div>


                  <button
                    onClick={() =>
                      trackProduct(product)
                    }
                  >
                    Track
                  </button>

                </div>

              ))}

            </div>

          )}

        </section>


        {/* MESSAGE */}

        {message && (
          <div className="message">
            {message}
          </div>
        )}


        {/* TRACKED PRODUCTS */}

        <section className="tracked-section">

          <div className="section-heading">

            <div>

              <h2>
                My Tracked Products
              </h2>

              <p>
                Products currently being monitored
              </p>

            </div>

            <span className="count">
              {trackedProducts.length}
            </span>

          </div>


          {trackedProducts.length === 0 ? (

            <div className="empty">

              <h3>
                No products tracked yet
              </h3>

              <p>
                Search for a product above to
                start tracking its price.
              </p>

            </div>

          ) : (

            <div className="product-grid">

              {trackedProducts.map(
                (product) => {

                  const data =
                    productData[product.id];

                  return (

                    <div
                      className="product-card"
                      key={product.id}
                    >

                      <div className="card-top">

                        <div>

                          <h3>
                            {product.product_name}
                          </h3>

                          <p>
                            Product ID:{" "}
                            {product.product_id}
                          </p>

                        </div>

                        <span className="active">
                          ACTIVE
                        </span>

                      </div>


                      {/* CURRENT DATA */}

                      <div className="current-data">
  <div className="metric">
    <span>Current Price</span>
    <strong>
      {data?.price != null
        ? `₹${Number(data.price).toLocaleString("en-IN")}`
        : product.latestPrice != null
          ? `₹${Number(product.latestPrice).toLocaleString("en-IN")}`
          : "Not available"}
    </strong>
  </div>

  <div className="metric">
    <span>Stock</span>
    <strong>
      {data?.stock || product.latestStock || "Not available"}
    </strong>
  </div>
</div>


                      {/* ACTIONS */}

                      <div className="card-actions">

                        <button
                          className="scrape-button"
                          disabled={
                            scrapingId ===
                            product.id
                          }
                          onClick={() =>
                            scrapeProduct(product)
                          }
                        >

                          {scrapingId ===
                          product.id
                            ? "Scraping..."
                            : "Scrape Now"}

                        </button>


                       <button
  className="history-button"
  onClick={() => viewHistory(product)}
>
  View History
</button>

                      </div>

                    </div>

                  );
                }
              )}

            </div>

          )}

        </section>

      </main>

      {selectedProduct && (
  <div className="modal-overlay">

    <div className="history-modal">

      <div className="modal-header">

        <div>
          <h2>
            {selectedProduct.product_name}
          </h2>

          <p>
            Price history & scrape activity
          </p>
        </div>

        <button
          className="close-button"
          onClick={() => {
            setSelectedProduct(null);
            setHistory([]);
            setLogs([]);
          }}
        >
          ×
        </button>

      </div>


      {historyLoading ? (

        <div className="modal-loading">
          Loading history...
        </div>

      ) : (

        <>

          {/* PRICE HISTORY */}

          <section className="history-section">

            <h3>
              Price History
            </h3>

            {history.length === 0 ? (

              <p className="empty-text">
                No price history available.
              </p>

            ) : (

              <div className="history-table">

                <div className="table-row table-header">

                  <span>Date</span>
                  <span>Price</span>
                  <span>Stock</span>

                </div>

                {history.map((item) => (

                  <div
                    className="table-row"
                    key={item.id}
                  >

                    <span>
                      {new Date(
                        item.scraped_at
                      ).toLocaleString("en-IN")}
                    </span>

                    <strong>
                      ₹
                      {Number(
                        item.price
                      ).toLocaleString("en-IN")}
                    </strong>

                    <span>
                      {item.stock_status ||
                        "Unknown"}
                    </span>

                  </div>

                ))}

              </div>

            )}

          </section>


          {/* SCRAPE LOGS */}

          <section className="history-section">

            <h3>
              Scrape Attempts
            </h3>

            {logs.length === 0 ? (

              <p className="empty-text">
                No scrape logs available.
              </p>

            ) : (

              <div className="history-table">

                <div className="table-row table-header">

                  <span>Attempt</span>
                  <span>HTTP</span>
                  <span>Status</span>

                </div>

                {logs.map((log) => (

                  <div
                    className="table-row"
                    key={log.id}
                  >

                    <span>
                      Attempt{" "}
                      {log.attempt_number}
                    </span>

                    <span>
                      {log.http_status || "—"}
                    </span>

                    <span
                      className={
                        log.status === "success"
                          ? "status-success"
                          : "status-retry"
                      }
                    >
                      {log.status}
                    </span>

                  </div>

                ))}

              </div>

            )}

          </section>

        </>

      )}

    </div>

  </div>
)}

    </div>
  );
}

export default App;