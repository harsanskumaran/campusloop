// src/pages/MyItems.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import AuthImage from "../components/AuthImage.jsx";

export default function MyItems() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  function load() {
    api.get("/items/mine")
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function releaseCooling(itemId) {
    setBusyId(itemId);
    setError("");
    try {
      await api.post(`/items/${itemId}/cooling/release`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">My items</h1>
      {error && <p className="bg-red-50 text-red-600 text-sm p-2 rounded mb-4">{error}</p>}
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="bg-white border rounded-lg p-4">
            <div className="flex items-center gap-4">
              <Link to={`/items/${item.id}`} className="shrink-0">
                <AuthImage photoId={item.cover_photo_id} alt={item.title} className="w-20 h-20 object-cover rounded" />
              </Link>
              <div className="flex-1 min-w-0">
                <Link to={`/items/${item.id}`} className="font-semibold hover:underline">{item.title}</Link>
                <p className="text-sm text-gray-600">
                  {item.hold_booking_id ? (
                    <span className="inline-block text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">ON HOLD</span>
                  ) : item.status}
                  {item.cooling_until && ` · Cooling until ${new Date(item.cooling_until).toLocaleString()}`}
                </p>
              </div>
              {item.status === "COOLING" && (
                <button
                  disabled={busyId === item.id}
                  onClick={() => releaseCooling(item.id)}
                  className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
                >
                  {busyId === item.id ? "Releasing..." : "Release cooling period"}
                </button>
              )}
            </div>
            {item.hold_booking_id && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Why it is on hold</p>
                <p className="mt-1">{item.hold_reason}</p>
                <p className="text-xs text-amber-700 mt-1">
                  Raised by {item.hold_raised_by.toLowerCase()} · {new Date(item.hold_since).toLocaleString()} ·
                  the admin will review and close it.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      {items.length === 0 && !error && <p className="text-gray-500">You have not listed any items yet.</p>}
    </div>
  );
}
