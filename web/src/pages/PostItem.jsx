// src/pages/PostItem.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

export default function PostItem() {
  const navigate = useNavigate();
  const VALUE_BANDS = {
    low: { label: "Low (under ₹2,000)", amount: 1000 },
    medium: { label: "Medium (₹2,000 – ₹5,000)", amount: 3500 },
    high: { label: "High (above ₹5,000)", amount: 7500 },
  };

  const [form, setForm] = useState({
    title: "", description: "", category: "", valueBand: "", rentPerDay: "", deposit: "", knownDefects: "",
  });
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api.post("/items", {
        title: form.title,
        description: form.description,
        category: form.category,
        declaredValue: VALUE_BANDS[form.valueBand].amount,
        rentPerDay: Number(form.rentPerDay),
        deposit: Number(form.deposit),
        knownDefects: form.knownDefects || undefined,
      });

      const itemId = data.item.id;

      if (photos.length > 0) {
        const fd = new FormData();
        photos.forEach((f) => fd.append("photos", f));
        await api.postForm(`/items/${itemId}/photos`, fd);
      }

      navigate(`/items/${itemId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const declaredValue = form.valueBand ? VALUE_BANDS[form.valueBand].amount : 0;
  const tierPreview = declaredValue > 5000 ? "High value (max 2 rentals/month, cooling period applies)" : "Standard";

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">List an item</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-6 space-y-4">
        {error && <p className="bg-red-50 text-red-600 text-sm p-2 rounded">{error}</p>}

        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input required value={form.title} onChange={(e) => update("title", e.target.value)}
            className="w-full border rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea required value={form.description} onChange={(e) => update("description", e.target.value)}
            className="w-full border rounded px-3 py-2" rows={3} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <input required value={form.category} onChange={(e) => update("category", e.target.value)}
            placeholder="e.g. electronics, books, sports"
            className="w-full border rounded px-3 py-2" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Item value</label>
            <select required value={form.valueBand} onChange={(e) => update("valueBand", e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white">
              <option value="" disabled>Select a range</option>
              {Object.entries(VALUE_BANDS).map(([key, band]) => (
                <option key={key} value={key}>{band.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Deposit (₹, max 5,000)</label>
            <input type="number" required min="0" max="5000" value={form.deposit}
              onChange={(e) => update("deposit", e.target.value)}
              className="w-full border rounded px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Cost for 1 day (₹)</label>
          <input
            type="number" required min="1" step="1" value={form.rentPerDay}
            onChange={(e) => update("rentPerDay", e.target.value)}
            placeholder="e.g. 50" className="w-full border rounded px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">
            This is the rate for exactly 1 day. If someone books for 3 days, they'll pay 3 × this amount automatically.
          </p>
        </div>

        {declaredValue > 0 && (
          <p className={`text-sm p-2 rounded ${declaredValue > 5000 ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-gray-600"}`}>
            Tier: {tierPreview}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Known defects (optional)</label>
          <input value={form.knownDefects} onChange={(e) => update("knownDefects", e.target.value)}
            placeholder="Be upfront — this protects you if a dispute comes up later"
            className="w-full border rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Photos</label>
          <input type="file" accept="image/*" multiple onChange={(e) => setPhotos(Array.from(e.target.files))}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>

        <button type="submit" disabled={busy}
          className="w-full bg-blue-600 text-white rounded py-2 font-medium disabled:opacity-50">
          {busy ? "Posting..." : "Post item"}
        </button>
        <p className="text-xs text-gray-500">Posting counts as 1 of your 10 activities this semester.</p>
      </form>
    </div>
  );
}
