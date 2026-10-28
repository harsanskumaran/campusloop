// src/pages/MyBookings.jsx
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client.js";

const REVIEW_WINDOW_HOURS = 24;
const MIN_COMMENT = 3;

// "5h 12m" style text for the time left until the lender's review deadline
function timeLeft(dropSubmittedAt, now) {
  const deadline = new Date(dropSubmittedAt).getTime() + REVIEW_WINDOW_HOURS * 3600 * 1000;
  const ms = deadline - now;
  if (ms <= 0) return null;
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Small labelled note (pickup comment, drop note, review comment)
function Note({ label, text }) {
  if (!text) return null;
  return (
    <div className="text-sm">
      <span className="font-medium">{label}: </span>
      <span className="text-gray-700">{text}</span>
    </div>
  );
}

export function BookingCard({ booking, role, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pickupComment, setPickupComment] = useState("");
  const [dropNote, setDropNote] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [extensionEndDate, setExtensionEndDate] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // keep the 24h countdown fresh
  useEffect(() => {
    if (booking.status !== "DROP_SUBMITTED") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [booking.status]);

  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (result?.message) setNotice(result.message);
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
  const requestBookingExtension = () => run(async () => {
    const { wallet } = await api.get("/wallet");
    if (wallet.cash_balance < extensionRent) {
      throw new Error(
        `Not enough wallet balance for this extension. Available: ₹${wallet.cash_balance}, required: ₹${extensionRent}`
      );
    }
    return api.post(`/bookings/${booking.id}/booking-extension`, {
      requestedEndDate: extensionEndDate,
    });
  });
  const respondToBookingExtension = (approve) => run(() =>
    api.post(`/bookings/booking-extensions/${booking.extension_id}/${approve ? "approve" : "reject"}`)
  );

  // Borrower: pickup needs a comment about the item's condition
  const submitPickup = () => run(() =>
    api.post(`/bookings/${booking.id}/pickup`, { comment: pickupComment.trim() })
  );
  // Borrower: drop = "I've returned it" (note optional); starts the lender's 24h window
  const submitDrop = () => run(() =>
    api.post(`/bookings/${booking.id}/drop`, dropNote.trim() ? { note: dropNote.trim() } : {})
  );
  // Lender: a comment is required to accept or to report a defect
  const reviewAccept = () => run(() =>
    api.post(`/bookings/${booking.id}/review`, { hasDefect: false, note: reviewComment.trim() })
  );
  const reviewDefect = () => run(() =>
    api.post(`/bookings/${booking.id}/review`, { hasDefect: true, note: reviewComment.trim() })
  );
  const submitDispute = () => run(() => api.post(`/bookings/${booking.id}/dispute`, { reason: disputeReason.trim() }));

  const remaining = booking.status === "DROP_SUBMITTED" && booking.drop_submitted_at
    ? timeLeft(booking.drop_submitted_at, now) : null;
  const windowPassed = booking.status === "DROP_SUBMITTED" && booking.drop_submitted_at && !remaining;
  const commentOk = reviewComment.trim().length >= MIN_COMMENT;
  const hasNotes = booking.pickup_comment || booking.drop_note || booking.review_note;
  const canExtend = role === "borrower" &&
    ["PICKED_UP", "OVERDUE"].includes(booking.status);
  const currentEndDate = new Date(booking.end_date).toISOString().slice(0, 10);
  const extensionDays = extensionEndDate
    ? (Date.parse(`${extensionEndDate}T00:00:00Z`) - Date.parse(`${currentEndDate}T00:00:00Z`)) / 86400000
    : 0;
  const extensionRent = extensionDays > 0 ? extensionDays * booking.rent_per_day : 0;

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

      {/* Why this booking is on hold */}
      {booking.hold_reason && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">On hold — admin is reviewing</p>
          <p className="mt-1">Reason: {booking.hold_reason}</p>
          <p className="text-xs text-amber-700 mt-1">
            Raised by {booking.hold_raised_by?.toLowerCase()}
            {booking.hold_since && ` · ${new Date(booking.hold_since).toLocaleString()}`}
            {" · "}₹{booking.rent_coins + booking.deposit_coins} (rent + deposit) stays held until the admin closes it.
          </p>
        </div>
      )}

      {hasNotes && (
        <div className="mt-3 space-y-1 rounded bg-gray-50 p-3">
          <Note label="Borrower's pickup comment" text={booking.pickup_comment} />
          <Note label="Borrower's return note" text={booking.drop_note} />
          <Note label="Lender's review comment" text={booking.review_note} />
        </div>
      )}

      {error && <p className="bg-red-50 text-red-600 text-sm p-2 rounded mt-3">{error}</p>}
      {notice && <p className="bg-amber-50 text-amber-800 text-sm p-2 rounded mt-3">{notice}</p>}
      {booking.extension_id && (
        <div className="mt-3 rounded border bg-gray-50 p-3 text-sm">
          <p className="font-medium">Return-date extension: {booking.extension_status}</p>
          <p>
            Requested return date: {new Date(booking.extension_requested_end_date).toLocaleDateString()}
            {" · "}Additional rent: ₹{booking.extension_additional_rent}
          </p>
          {role === "lender" && booking.extension_status === "PENDING" && (
            <div className="mt-2 flex gap-2">
              <button disabled={busy} onClick={() => respondToBookingExtension(true)}
                className="bg-green-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                Approve extension
              </button>
              <button disabled={busy} onClick={() => respondToBookingExtension(false)}
                className="bg-red-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                Reject extension
              </button>
            </div>
          )}
          {role === "borrower" && booking.extension_status === "PENDING" && (
            <p className="mt-1 text-amber-700">Waiting for the lender to decide.</p>
          )}
        </div>
      )}
      {role === "borrower" && booking.status === "REJECTED" && (
        <p className="mt-3 text-sm text-gray-600">
          This request was declined. When another request for the item is approved, other pending requests are declined automatically.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {/* Consent is signed on the item page when requesting */}
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

      {canExtend && booking.extension_status !== "PENDING" && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-1">Need more time with this item?</p>
          <p className="text-xs text-gray-500 mb-2">
            The lender must approve the new return date. Additional rent will be held from your wallet if approved.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              New return date
              <input type="date" min={currentEndDate} value={extensionEndDate}
                onChange={(e) => setExtensionEndDate(e.target.value)}
                className="block border rounded px-2 py-1 mt-1" />
            </label>
            <button disabled={busy || extensionDays <= 0} onClick={requestBookingExtension}
              className="bg-amber-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
              Request extension
            </button>
          </div>
          {extensionDays > 0 && (
            <p className="text-xs text-gray-600 mt-2">
              {extensionDays} extra day{extensionDays === 1 ? "" : "s"} · ₹{booking.rent_per_day} per day ·
              {" "}₹{extensionRent} additional rent
            </p>
          )}
        </div>
      )}

      {/* Borrower: pickup — comment required */}
      {role === "borrower" && booking.status === "CONFIRMED" && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-1">
            Confirm pickup <span className="text-red-600">*</span>
          </p>
          <p className="text-xs text-gray-500 mb-2">
            Describe the item's condition as you receive it (e.g. accessories included, any marks).
          </p>
          <textarea
            rows={2} value={pickupComment} onChange={(e) => setPickupComment(e.target.value)}
            placeholder="Comment about the item's condition at pickup (required)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <button disabled={busy || pickupComment.trim().length < MIN_COMMENT} onClick={submitPickup}
            className="mt-2 bg-blue-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
            Confirm pickup
          </button>
        </div>
      )}

      {/* Borrower: return — note optional */}
      {role === "borrower" && ["PICKED_UP", "OVERDUE"].includes(booking.status) && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-1">Returning the item?</p>
          <p className="text-xs text-gray-500 mb-2">
            The lender has {REVIEW_WINDOW_HOURS} hours to review it. You can add a note (optional), e.g. where you left it.
          </p>
          <input
            value={dropNote} onChange={(e) => setDropNote(e.target.value)}
            placeholder="Note for the lender (optional)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <button disabled={busy} onClick={submitDrop}
            className="mt-2 bg-blue-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
            I've returned the item
          </button>
        </div>
      )}

      {/* Borrower: waiting for the lender */}
      {role === "borrower" && booking.status === "DROP_SUBMITTED" && (
        <p className="mt-3 text-sm text-gray-600">
          Waiting for the lender to review the return
          {remaining ? ` (${remaining} left before it goes to the admin).` : "."}
        </p>
      )}

      {/* Lender: review drop — comment required */}
      {role === "lender" && booking.status === "DROP_SUBMITTED" && (
        <div className="mt-4 border-t pt-3">
          <p className="text-sm font-medium mb-1">Review the returned item</p>
          <p className={`text-xs mb-2 ${windowPassed ? "text-red-600" : "text-amber-700"}`}>
            {remaining
              ? `Please respond within ${remaining} — otherwise this booking goes on hold for the admin.`
              : "The 24-hour review window has passed — this booking is about to go on hold for the admin."}
          </p>
          <textarea
            rows={2} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)}
            placeholder="Your comment (required) — e.g. received in good condition, or describe the defect"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy || !commentOk} onClick={reviewAccept}
              className="bg-green-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
              Accept — no defects
            </button>
            <button disabled={busy || !commentOk} onClick={reviewDefect}
              className="bg-red-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
              Report defect
            </button>
          </div>
          {!commentOk && <p className="text-xs text-gray-500 mt-1">Add a comment to enable these buttons.</p>}
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
              <button disabled={busy || disputeReason.trim().length < 5} onClick={submitDispute}
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
