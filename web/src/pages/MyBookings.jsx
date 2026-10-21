// src/pages/MyBookings.jsx
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import PhotoPicker from "../components/PhotoPicker.jsx";

function BookingCard({ booking, role, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickupFiles, setPickupFiles] = useState([]);
  const [dropFiles, setDropFiles] = useState([]);
  const [defectNote, setDefectNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const accept = () => run(() => api.post(`/bookings/${booking.id}/accept`));
  const reject = () => run(() => api.post(`/bookings/${booking.id}/reject`));
  const cancel = () => run(() => api.post(`/bookings/${booking.id}/cancel`));

  const submitPickup = () => run(async () => {
    const fd = new FormData();
    pickupFiles.forEach((f) => fd.append("photos", f));
    await api.postForm(`/bookings/${booking.id}/pickup`, fd);
  });

  const submitDrop = () => run(async () => {
    const fd = new FormData();
    dropFiles.forEach((f) => fd.append("photos", f));
    await api.postForm(`/bookings/${booking.id}/drop`, fd);
  });

  const reviewAccept = () => run(() => api.post(`/bookings/${booking.id}/review`, { hasDefect: false }));
  const reviewDefect = () => run(() => api.post(`/bookings/${booking.id}/review`, { hasDefect: true, note: defectNote }));
  const submitDispute = () => run(() => api.post(`/bookings/${booking.id}/dispute`, { reason: disputeReason }));

  return (
    <div className="bg-white rounded-lg border p-4 mb-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{booking.item_title}</h3>
          <p className="text-sm text-gray-500">
            {new Date(booking.start_date).toLocaleDateString()} – {new Date(booking.end_date).toLocaleDateString()}
            {" · "}₹{booking.rent_coins} rent + ₹{booking.deposit_coins} deposit
          </p>
        </div>
        <span className="text-xs font-medium bg-gray-100 px-2 py-1 rounded">{booking.status}</span>
      </div>

      {role === "lender" && booking.status === "REQUESTED" && booking.borrower_name && (
        <div className="mt-3 rounded bg-blue-50 p-3 text-sm">
          <p className="font-medium">Borrower contact</p>
          <p>{booking.borrower_name} · {booking.borrower_phone} · Room {booking.borrower_room_no}</p>
        </div>
      )}
      {role === "borrower" && booking.lender_name && (
        <div className="mt-3 rounded bg-green-50 p-3 text-sm">
          <p className="font-medium">Lender pickup contact</p>
          <p>{booking.lender_name} · {booking.lender_phone} · Room {booking.lender_room_no}</p>
        </div>
      )}

      {error && <p className="bg-red-50 text-red-600 text-sm p-2 rounded mt-3">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {/* Consent is now signed on the item page when requesting */}
        {role === "borrower" && booking.status === "REQUESTED" && (
          <span className="text-sm text-green-700 self-center">✓ Consent signed · waiting for lender</span>
        )}
        {role === "borrower" && ["REQUESTED", "CONFIRMED"].includes(booking.status) && (
          <button disabled={busy} onClick={cancel} className="border text-sm px-3 py-1.5 rounded">
            Cancel
          </button>
        )}

        {/* Lender: accept/reject while REQUESTED */}
        {role === "lender" && booking.status === "REQUESTED" && (
          <>
            <button disabled={busy} onClick={accept} className="bg-green-600 text-white text-sm px-3 py-1.5 rounded">
              Accept
            </button>
            <button disabled={busy} onClick={reject} className="bg-red-600 text-white text-sm px-3 py-1.5 rounded">
              Reject
            </button>
          </>
        )}
      </div>

      {/* Borrower: pickup photos */}
      {role === "borrower" && booking.status === "CONFIRMED" && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-2">Accept condition at pickup (min. 4 photos)</p>
          <PhotoPicker onChange={setPickupFiles} />
          <button disabled={busy || pickupFiles.length < 4} onClick={submitPickup}
            className="mt-2 bg-blue-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
            Submit pickup
          </button>
        </div>
      )}

      {/* Borrower: drop photos */}
      {role === "borrower" && ["PICKED_UP", "OVERDUE"].includes(booking.status) && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-2">Upload drop-point photos (min. 4 photos)</p>
          <PhotoPicker onChange={setDropFiles} />
          <button disabled={busy || dropFiles.length < 4} onClick={submitDrop}
            className="mt-2 bg-blue-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
            Submit drop
          </button>
        </div>
      )}

      {/* Lender: review drop */}
      {role === "lender" && booking.status === "DROP_SUBMITTED" && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-2">Review the returned item</p>
          <button disabled={busy} onClick={reviewAccept} className="bg-green-600 text-white text-sm px-3 py-1.5 rounded mr-2">
            Accept — no defects
          </button>
          <div className="mt-2 flex gap-2">
            <input
              placeholder="Describe the defect..." value={defectNote} onChange={(e) => setDefectNote(e.target.value)}
              className="flex-1 border rounded px-2 py-1 text-sm"
            />
            <button disabled={busy || !defectNote} onClick={reviewDefect}
              className="bg-red-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
              Report defect
            </button>
          </div>
        </div>
      )}

      {/* Either party: raise a dispute */}
      {booking.status === "DROP_SUBMITTED" && (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs text-gray-500 mb-2">Raise a dispute before the lender reviews the return so the rent and deposit stay on hold.</p>
          {!showDispute ? (
            <button onClick={() => setShowDispute(true)} className="text-sm text-amber-700">
              Raise a dispute
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                placeholder="Reason for dispute..." value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
              <button disabled={busy || !disputeReason} onClick={submitDispute}
                className="bg-amber-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                Submit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyBookings() {
  const location = useLocation();
  const [tab, setTab] = useState("borrower");
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState(location.state?.message || "");

  function load() {
    api.get(`/bookings/mine?as=${tab}`)
      .then((d) => setBookings(d.bookings))
      .catch((e) => setError(e.message));
  }

  useEffect(load, [tab]);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">My Bookings</h1>
      {infoMessage && (
        <p className="bg-green-50 text-green-700 text-sm p-3 rounded mb-4 flex justify-between items-start gap-3">
          <span>{infoMessage}</span>
          <button onClick={() => setInfoMessage("")} className="text-green-700 font-bold leading-none">&times;</button>
        </p>
      )}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("borrower")}
          className={`px-3 py-1.5 rounded text-sm ${tab === "borrower" ? "bg-blue-600 text-white" : "bg-gray-100"}`}>
          As Borrower
        </button>
        <button onClick={() => setTab("lender")}
          className={`px-3 py-1.5 rounded text-sm ${tab === "lender" ? "bg-blue-600 text-white" : "bg-gray-100"}`}>
          As Lender
        </button>
      </div>
      {error && <p className="text-red-600">{error}</p>}
      {bookings.map((b) => (
        <BookingCard key={b.id} booking={b} role={tab} onChanged={load} />
      ))}
      {bookings.length === 0 && !error && <p className="text-gray-500">No bookings here yet.</p>}
    </div>
  );
}
