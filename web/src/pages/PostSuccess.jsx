// src/pages/PostSuccess.jsx
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const REDIRECT_SECONDS = 5;

// Shown right after an item is posted, then sends the person to the front page.
export default function PostSuccess() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [seconds, setSeconds] = useState(REDIRECT_SECONDS);

  // Opened directly (not after posting)? Nothing to celebrate, go to the front page.
  useEffect(() => {
    if (!state?.itemId) navigate("/items", { replace: true });
  }, [state, navigate]);

  useEffect(() => {
    if (!state?.itemId) return undefined;
    const timer = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (seconds <= 0) navigate("/items", { replace: true });
  }, [seconds, navigate]);

  if (!state?.itemId) return null;

  return (
    <div className="max-w-md mx-auto p-6 mt-10">
      <div className="bg-white rounded-lg border p-8 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold mb-2">Item posted successfully!</h1>
        <p className="text-gray-600">
          “{state.title}” is now listed and visible on the browse page.
        </p>

        <p className="text-sm text-gray-500 mt-5">
          Taking you to the front page in {Math.max(seconds, 0)} second{seconds === 1 ? "" : "s"}…
        </p>
        <div className="h-1.5 bg-gray-100 rounded mt-2 overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-1000 ease-linear"
            style={{ width: `${((REDIRECT_SECONDS - Math.max(seconds, 0)) / REDIRECT_SECONDS) * 100}%` }}
          />
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Link to="/items" replace className="bg-blue-600 text-white rounded py-2 font-medium">
            Go to front page now
          </Link>
          <div className="flex gap-2">
            <Link to={`/items/${state.itemId}`} className="flex-1 border rounded py-2 text-sm">View listing</Link>
            <Link to="/post-item" className="flex-1 border rounded py-2 text-sm">List another item</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
