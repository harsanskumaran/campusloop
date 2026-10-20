// src/pages/Items.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

export default function Items() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  function load() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    const query = params.toString();
    api.get(`/items${query ? `?${query}` : ""}`)
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.message));
  }

  // Initial load
  useEffect(load, []);

  // Debounce search-as-you-type so it doesn't fire a request on every keystroke
  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
  }, [search, category]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Browse Items</h1>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border rounded px-3 py-2"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="">All categories</option>
          <option value="electronics">Electronics</option>
          <option value="books">Books</option>
          <option value="sports">Sports</option>
          <option value="furniture">Furniture</option>
          <option value="appliances">Appliances</option>
          <option value="other">Other</option>
        </select>
      </div>

      {error && <p className="text-red-600">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((item) => (
          <Link key={item.id} to={`/items/${item.id}`} className="bg-white rounded-lg border p-4 hover:shadow-md transition">
            <h2 className="font-semibold">{item.title}</h2>
            <p className="text-sm text-gray-500">{item.category}</p>
            <p className="mt-2">₹{item.rent_per_day}/day · Deposit ₹{item.deposit}</p>
            {item.tier === "HIGH_VALUE" && (
              <span className="inline-block mt-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                High value
              </span>
            )}
          </Link>
        ))}
      </div>
      {items.length === 0 && !error && (
        <p className="text-gray-500">
          {search || category ? "No items match your search." : "No items listed yet."}
        </p>
      )}
    </div>
  );
}
