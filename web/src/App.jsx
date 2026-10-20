// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Items from "./pages/Items.jsx";
import ItemDetail from "./pages/ItemDetail.jsx";
import MyBookings from "./pages/MyBookings.jsx";
import Wallet from "./pages/Wallet.jsx";
import PostItem from "./pages/PostItem.jsx";
import Admin from "./pages/Admin.jsx";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "ADMIN") return <Navigate to="/items" replace />;
  return children;
}

function Nav() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
      <Link to="/items" className="font-bold text-lg">CampusLoop</Link>
      <div className="flex items-center gap-4 text-sm">
        <Link to="/items">Browse</Link>
        <Link to="/post-item">List an item</Link>
        <Link to="/bookings">My Bookings</Link>
        <Link to="/wallet">Wallet</Link>
        {user.role === "ADMIN" && <Link to="/admin" className="text-purple-600 font-medium">Admin</Link>}
        <span className="text-gray-600">{user.name} ({user.status})</span>
        <button onClick={logout} className="text-red-600">Log out</button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/items" element={<ProtectedRoute><Items /></ProtectedRoute>} />
          <Route path="/items/:id" element={<ProtectedRoute><ItemDetail /></ProtectedRoute>} />
          <Route path="/bookings" element={<ProtectedRoute><MyBookings /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
          <Route path="/post-item" element={<ProtectedRoute><PostItem /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/items" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
