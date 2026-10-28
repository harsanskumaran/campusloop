// src/pages/ItemDetail.jsx
import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api/client.js";
import AuthImage from "../components/AuthImage.jsx";
import { categoryLabel } from "../constants/categories.js";

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [balance, setBalance] = useState(null); // borrower's spendable wallet cash
  const [activePhoto, setActivePhoto] = useState(0);

  useEffect(() => {
    api.get(`/items/${id}`).then((d) => setItem(d.item)).catch((e) => setError(e.message));
    api.get(`/items/${id}/availability`).then((d) => setAvailability(d)).catch(() => {});
    api.get("/wallet").then((d) => setBalance(d.wallet.cash_balance)).catch(() => {});
  }, [id]);

  async function handleBook(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const data = await api.post("/bookings", {
        itemId: Number(id), startDate, endDate, consent: consentChecked,
      });
      navigate("/bookings", {
        state: { message: `Requested with your signed consent! Total: ₹${data.price.total} (₹${data.price.rent} rent + ₹${data.price.deposit} deposit). Waiting for the lender to accept (requests expire after 24 hours).` },
      });
      return;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!item) return <div className="p-6">{error || "Loading..."}</div>;

  // Live cost preview (same formula as the server: days = end - start).
  // The server stays the source of truth and re-checks everything.
  const days = startDate && endDate
    ? Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) : 0;
  const estRent = days > 0 ? item.rent_per_day * days : 0;
  const estTotal = days > 0 ? estRent + item.deposit : 0;
  const insufficient = balance !== null && estTotal > 0 && balance < estTotal;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <button onClick={() => navigate(-1)} className="text-sm text-blue-600 mb-4">&larr; Back</button>

      <div className="bg-white rounded-lg border p-6 mb-6">
        {item.photos?.length > 0 && (
          <div className="mb-5">
            <AuthImage
              photoId={item.photos[Math.min(activePhoto, item.photos.length - 1)].id}
              alt={item.title} className="w-full h-72 object-cover rounded"
            />
            {item.photos.length > 1 && (
              <div className="flex gap-2 mt-2 overflow-x-auto">
                {item.photos.map((p, i) => (
                  <button
                    key={p.id} type="button" onClick={() => setActivePhoto(i)}
                    className={`shrink-0 rounded border-2 ${i === activePhoto ? "border-blue-600" : "border-transparent"}`}
                  >
                    <AuthImage photoId={p.id} alt={`${item.title} photo ${i + 1}`} className="w-16 h-16 object-cover rounded" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex items-start justify-between">
          <h1 className="text-2xl font-bold">{item.title}</h1>
          {item.tier === "HIGH_VALUE" && (
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">High value</span>
          )}
        </div>
        <p className="text-gray-600 mt-2">{item.description}</p>
        <p className="text-sm text-gray-500 mt-1">Category: {categoryLabel(item.category)} · Owner: {item.owner_name}</p>
        <p className="mt-4 font-medium">₹{item.rent_per_day} per day (fixed rate) · Deposit ₹{item.deposit}</p>
        {item.known_defects && (
          <p className="mt-2 text-sm text-amber-700 bg-amber-50 p-2 rounded">
            Known defects: {item.known_defects}
          </p>
        )}
        {item.hold && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">On hold — under admin review</p>
            {item.hold.reason ? (
              <>
                <p className="mt-1">Reason: {item.hold.reason}</p>
                <p className="text-xs text-amber-700 mt-1">
                  Raised by {item.hold.raised_by.toLowerCase()} · {new Date(item.hold.held_since).toLocaleString()}
                </p>
              </>
            ) : (
              <p className="mt-1">This item is temporarily unavailable while a recent return is being reviewed.</p>
            )}
          </div>
        )}
        {item.status !== "LISTED" && !item.hold && (
          <p className="mt-3 text-sm text-red-600">
            Not currently available ({item.status}
            {item.cooling_until ? ` until ${new Date(item.cooling_until).toLocaleDateString()}` : ""})
          </p>
        )}
      </div>

      {availability?.bookedRanges?.length > 0 && (
        <div className="bg-white rounded-lg border p-4 mb-6">
          <h2 className="font-semibold mb-2">Already booked</h2>
          <ul className="text-sm text-gray-600 space-y-1">
            {availability.bookedRanges.map((r, i) => (
              <li key={i}>
                {new Date(r.start_date).toLocaleDateString()} – {new Date(r.end_date).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleBook} className="bg-white rounded-lg border p-6">
        <h2 className="font-semibold mb-4">Request this item</h2>
        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-2 rounded mb-3">
            <p>{error}</p>
          </div>
        )}
        {success && <p className="bg-green-50 text-green-700 text-sm p-2 rounded mb-3">{success}</p>}
        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Start date</label>
            <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full border rounded px-3 py-2" />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">End date</label>
            <input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full border rounded px-3 py-2" />
          </div>
        </div>

        {/* Cost vs. wallet — checked here and again by the server on request */}
        {estTotal > 0 && (
          <div className={`border rounded p-3 mb-4 text-sm ${insufficient ? "bg-red-50 border-red-200" : "bg-gray-50"}`}>
            <p>
              {days} day{days > 1 ? "s" : ""} × ₹{item.rent_per_day} = ₹{estRent} rent + ₹{item.deposit} deposit
              {" "}= <span className="font-semibold">₹{estTotal} total</span>
            </p>
            {balance !== null && (
              <p className="mt-1">
                Your wallet: <span className="font-semibold">₹{balance}</span>
                {insufficient ? (
                  <span className="text-red-600">
                    {" "}— you need ₹{estTotal - balance} more.{" "}
                    <Link to="/wallet" className="underline">Top up wallet</Link>
                  </span>
                ) : (
                  <span className="text-green-700"> ✓ enough to request</span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Booking consent — signed here, on the listing page */}
        <div className="border rounded p-3 mb-4 bg-gray-50">
          <p className="text-sm font-medium mb-2">Booking consent</p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mb-3">
            <li>The item is in the condition described above{item.known_defects ? `, including the known defects: “${item.known_defects}”` : " (no known defects declared)"}.</li>
            <li>₹{item.deposit} deposit plus rent is held from my wallet once the lender accepts.</li>
            <li>I will describe the item's condition in a comment at pickup and tell the lender when I return it.</li>
            <li>If the lender reports a defect on return, my deposit may be forfeited.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)} className="mt-1" />
            <span>I have read and agree to the above. This is my signed consent for this booking.</span>
          </label>
        </div>

        <button type="submit" disabled={loading || !consentChecked || insufficient || item.status !== "LISTED"}
          className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Requesting..." : "Sign consent & request booking"}
        </button>
      </form>
    </div>
  );
}
