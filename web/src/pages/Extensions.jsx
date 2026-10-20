// src/pages/Extensions.jsx
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function Extensions() {
  const [extensions, setExtensions] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  function load() {
    api.get("/bookings/extensions/mine")
      .then((d) => setExtensions(d.extensions))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function respond(id, approve) {
    setBusyId(id);
    try {
      await api.post(`/bookings/extensions/${id}/${approve ? "approve" : "reject"}`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const statusColor = { PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-green-100 text-green-800", REJECTED: "bg-red-100 text-red-800" };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Extension Requests</h1>
      <p className="text-sm text-gray-500 mb-6">
        Borrowers who've hit an item's monthly rental limit can ask you for one more slot this month.
      </p>
      {error && <p className="bg-red-50 text-red-600 text-sm p-2 rounded mb-4">{error}</p>}

      {extensions.map((ext) => (
        <div key={ext.id} className="bg-white border rounded-lg p-4 mb-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold">{ext.item_title}</p>
              <p className="text-sm text-gray-600">Requested by {ext.requested_by_name} for {ext.month_year}</p>
              {ext.note && <p className="text-sm text-gray-500 mt-1">"{ext.note}"</p>}
            </div>
            <span className={`text-xs px-2 py-1 rounded ${statusColor[ext.status]}`}>{ext.status}</span>
          </div>
          {ext.status === "PENDING" && (
            <div className="mt-3 flex gap-2">
              <button disabled={busyId === ext.id} onClick={() => respond(ext.id, true)}
                className="bg-green-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                Approve
              </button>
              <button disabled={busyId === ext.id} onClick={() => respond(ext.id, false)}
                className="bg-red-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
      {extensions.length === 0 && !error && <p className="text-gray-500">No extension requests yet.</p>}
    </div>
  );
}
