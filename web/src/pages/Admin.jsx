// src/pages/Admin.jsx
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

function ReportsTab() {
  const [reports, setReports] = useState(null);
  useEffect(() => { api.get("/admin/reports").then((d) => setReports(d)); }, []);
  if (!reports) return <p>Loading...</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-2">Active listings</h3>
        <p className="text-3xl font-bold">{reports.activeListings}</p>
      </div>
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-2">Items by tier</h3>
        {reports.itemsByTier.map((r) => (
          <p key={r.tier} className="text-sm">{r.tier}: <span className="font-medium">{r.count}</span></p>
        ))}
      </div>
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-2">Bookings by status</h3>
        {reports.bookingsByStatus.map((r) => (
          <p key={r.status} className="text-sm">{r.status}: <span className="font-medium">{r.count}</span></p>
        ))}
      </div>
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-2">Disputes by status</h3>
        {reports.disputesByStatus.map((r) => (
          <p key={r.status} className="text-sm">{r.status}: <span className="font-medium">{r.count}</span></p>
        ))}
      </div>
      <div className="bg-white border rounded-lg p-4 md:col-span-2">
        <h3 className="font-semibold mb-2">Users by status</h3>
        <div className="flex gap-4">
          {reports.usersByStatus.map((r) => (
            <p key={r.status} className="text-sm">{r.status}: <span className="font-medium">{r.count}</span></p>
          ))}
        </div>
      </div>
    </div>
  );
}

function DisputesTab() {
  const [disputes, setDisputes] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  function load() {
    api.get("/admin/concerns").then((d) => setDisputes(d.disputes));
  }
  useEffect(load, []);

  async function resolve(id, resolution) {
    setBusyId(id);
    try {
      await api.post(`/admin/disputes/${id}/resolve`, { resolution, note: notes[id] || "" });
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {disputes.map((d) => (
        <div key={d.id} className="bg-white border rounded-lg p-4">
          <div className="flex justify-between">
            <div>
              <p className="font-semibold">{d.item_title}</p>
              <p className="text-sm text-gray-600">{d.reason}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded h-fit ${d.status === "OPEN" ? "bg-amber-100 text-amber-800" : "bg-gray-100"}`}>
              {d.status}
            </span>
          </div>
          {d.status === "OPEN" && (
            <div className="mt-3 flex gap-2">
              <input
                placeholder="Resolution note..."
                value={notes[d.id] || ""}
                onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))}
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
              <button disabled={busyId === d.id} onClick={() => resolve(d.id, "NO_REFUND")}
                className="bg-red-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                No refund
              </button>
              <button disabled={busyId === d.id} onClick={() => resolve(d.id, "OFFLINE_SETTLED")}
                className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                Offline settled
              </button>
            </div>
          )}
          {d.status === "RESOLVED" && (
            <p className="mt-2 text-sm text-gray-500">
              Resolved: {d.resolution} — {d.resolution_note}
            </p>
          )}
        </div>
      ))}
      {disputes.length === 0 && <p className="text-gray-500">No concerns raised yet.</p>}
    </div>
  );
}

function UsersTab() {
  const [exceeded, setExceeded] = useState([]);
  const [suspended, setSuspended] = useState([]);
  const [busyId, setBusyId] = useState(null);

  function load() {
    api.get("/admin/users/exceeded").then((d) => setExceeded(d.users));
    api.get("/admin/users/suspended").then((d) => setSuspended(d.users));
  }
  useEffect(load, []);

  async function lift(userId) {
    setBusyId(userId);
    try {
      await api.post("/quota/admin/lift", { userId, reason: "Admin reviewed and approved" });
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function unsuspend(userId) {
    setBusyId(userId);
    try {
      await api.post("/admin/users/unsuspend", { userId });
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-2">Exceeded users ({exceeded.length})</h3>
        {exceeded.map((u) => (
          <div key={u.id} className="bg-white border rounded-lg p-3 flex justify-between items-center mb-2">
            <span className="text-sm">{u.name} ({u.email})</span>
            <button disabled={busyId === u.id} onClick={() => lift(u.id)}
              className="bg-blue-600 text-white text-sm px-3 py-1 rounded disabled:opacity-50">
              Lift limit
            </button>
          </div>
        ))}
        {exceeded.length === 0 && <p className="text-gray-500 text-sm">None.</p>}
      </div>

      <div>
        <h3 className="font-semibold mb-2">Suspended users ({suspended.length})</h3>
        {suspended.map((u) => (
          <div key={u.id} className="bg-white border rounded-lg p-3 flex justify-between items-center mb-2">
            <span className="text-sm">{u.name} ({u.email})</span>
            <button disabled={busyId === u.id} onClick={() => unsuspend(u.id)}
              className="bg-blue-600 text-white text-sm px-3 py-1 rounded disabled:opacity-50">
              Unsuspend
            </button>
          </div>
        ))}
        {suspended.length === 0 && <p className="text-gray-500 text-sm">None.</p>}
      </div>
    </div>
  );
}

function BlockedTab() {
  const [blocked, setBlocked] = useState([]);
  useEffect(() => { api.get("/blocklist/all").then((d) => setBlocked(d.blocked)); }, []);

  return (
    <div className="space-y-2">
      {blocked.map((b) => (
        <div key={b.id} className="bg-white border rounded-lg p-3 text-sm">
          <span className="font-medium">{b.lender_name}</span> blocked <span className="font-medium">{b.borrower_name}</span>
        </div>
      ))}
      {blocked.length === 0 && <p className="text-gray-500 text-sm">No blocks in place.</p>}
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState("reports");
  const tabs = [
    { id: "reports", label: "Reports" },
    { id: "disputes", label: "Concerns" },
    { id: "users", label: "Users" },
    { id: "blocked", label: "Blocked" },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Admin</h1>
      <div className="flex gap-2 mb-6">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded text-sm ${tab === t.id ? "bg-blue-600 text-white" : "bg-gray-100"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "reports" && <ReportsTab />}
      {tab === "disputes" && <DisputesTab />}
      {tab === "users" && <UsersTab />}
      {tab === "blocked" && <BlockedTab />}
    </div>
  );
}
