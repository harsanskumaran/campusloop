// src/pages/Items.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import AuthImage from "../components/AuthImage.jsx";
import { ITEM_CATEGORIES, categoryLabel } from "../constants/categories.js";

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
          {ITEM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-600">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((item) => (
          <Link key={item.id} to={`/items/${item.id}`} className="bg-white rounded-lg border overflow-hidden hover:shadow-md transition">
            <div className="relative">
              <AuthImage
                photoId={item.cover_photo_id} alt={item.title}
                className="w-full h-44 object-cover"
              />
              {item.photo_count > 1 && (
                <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                  {item.photo_count} photos
                </span>
              )}
            </div>
            <div className="p-4">
              <h2 className="font-semibold">{item.title}</h2>
              <p className="text-sm text-gray-500">{categoryLabel(item.category)}</p>
              <p className="mt-2">₹{item.rent_per_day}/day · Deposit ₹{item.deposit}</p>
              {item.tier === "HIGH_VALUE" && (
                <span className="inline-block mt-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                  High value
                </span>
              )}
            </div>
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
