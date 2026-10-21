// src/pages/Register.jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(name, email, password, phone, roomNo);
      navigate("/items");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Create account</h1>
        {error && <p className="bg-red-50 text-red-600 text-sm p-2 rounded mb-4">{error}</p>}
        <label className="block text-sm font-medium mb-1">Name</label>
        <input
          required minLength={2} pattern="[\p{L} ]+" title="Use letters only"
          value={name} onChange={(e) => setName(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />
        <label className="block text-sm font-medium mb-1">Campus Email</label>
        <input
          type="email" required pattern=".+@srm\.edu\.in$" title="Use your @srm.edu.in email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />
        <label className="block text-sm font-medium mb-1">Contact number</label>
        <input
          type="tel" required inputMode="numeric" pattern="[0-9]{10}" maxLength={10}
          title="Enter exactly 10 digits" value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          className="w-full border rounded px-3 py-2 mb-4"
        />
        <label className="block text-sm font-medium mb-1">Room number</label>
        <input
          required value={roomNo} onChange={(e) => setRoomNo(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />
        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />
        <button
          type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white rounded py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Register"}
        </button>
        <p className="text-sm text-center mt-4">
          Have an account? <Link to="/login" className="text-blue-600">Log in</Link>
        </p>
      </form>
    </div>
  );
}
