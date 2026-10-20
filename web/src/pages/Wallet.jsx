// src/pages/Wallet.jsx
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api.get("/wallet").then((d) => setWallet(d.wallet)).catch((e) => setError(e.message));
    api.get("/wallet/ledger").then((d) => setLedger(d.ledger)).catch(() => {});
  }

  useEffect(load, []);

  async function handleTopUp(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await api.post("/wallet/topup", { amount: Number(amount) });
      setMessage(`Topped up ₹${amount} (mock payment)`);
      setAmount("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const data = await api.post("/wallet/withdraw");
      setMessage(`Withdrew ₹${data.withdrawn}`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) return <div className="p-6">{error || "Loading..."}</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Wallet</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex justify-between text-center">
          <div className="flex-1">
            <p className="text-sm text-gray-500">Available balance</p>
            <p className="text-3xl font-bold">₹{wallet.cash_balance}</p>
          </div>
          <div className="flex-1 border-l">
            <p className="text-sm text-gray-500">Held (in bookings)</p>
            <p className="text-3xl font-bold text-amber-600">₹{wallet.held_cash}</p>
          </div>
        </div>
      </div>

      {error && <p className="bg-red-50 text-red-600 text-sm p-3 rounded mb-4">{error}</p>}
      {message && <p className="bg-green-50 text-green-700 text-sm p-3 rounded mb-4">{message}</p>}

      <form onSubmit={handleTopUp} className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-3">Top up (max ₹10,000 balance)</h2>
        <div className="flex gap-3">
          <input
            type="number" min="1" required value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount in ₹" className="flex-1 border rounded px-3 py-2"
          />
          <button type="submit" disabled={busy}
            className="bg-blue-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50">
            Top up
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">This is a mock payment for testing — no real money moves.</p>
      </form>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-2">Withdraw</h2>
        <p className="text-sm text-gray-500 mb-3">
          Only available once your semester has ended, and no money is currently held in an active booking.
        </p>
        <button onClick={handleWithdraw} disabled={busy}
          className="bg-gray-800 text-white px-4 py-2 rounded font-medium disabled:opacity-50">
          Withdraw full balance
        </button>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="font-semibold mb-3">Transaction history</h2>
        {ledger.length === 0 && <p className="text-gray-500 text-sm">No transactions yet.</p>}
        <div className="space-y-2">
          {ledger.map((entry) => (
            <div key={entry.id} className="flex justify-between text-sm border-b pb-2">
              <div>
                <p className="font-medium">{entry.type}</p>
                <p className="text-gray-500">{entry.note}</p>
              </div>
              <div className="text-right">
                <p className={entry.type === "DAMAGE_DEDUCTION" || entry.type === "HOLD" ? "text-red-600" : "text-green-700"}>
                  ₹{entry.amount}
                </p>
                <p className="text-gray-400">{new Date(entry.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
