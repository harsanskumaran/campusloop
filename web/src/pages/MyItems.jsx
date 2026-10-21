import { useEffect, useState } from "react";
import { api } from "../api/client.js";

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
          <div key={item.id} className="bg-white border rounded-lg p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">{item.title}</p>
              <p className="text-sm text-gray-600">
                {item.status}
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
        ))}
      </div>
      {items.length === 0 && !error && <p className="text-gray-500">You have not listed any items yet.</p>}
    </div>
  );
}
