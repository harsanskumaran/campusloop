// src/api/client.js
const API_BASE = "http://localhost:4000";
//const API_BASE = "https://7qk6g969-4000.inc1.devtunnels.ms";

function getToken() {
  return localStorage.getItem("campusloop_token");
}

export function setToken(token) {
  if (token) localStorage.setItem("campusloop_token", token);
  else localStorage.removeItem("campusloop_token");
}

// Core request function. Pass { json: {...} } for a JSON body,
// or { formData } for file uploads (photos).
async function request(method, path, { json, formData } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body;
  if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (formData) {
    body = formData; // browser sets the multipart Content-Type automatically
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data.error
      ? (typeof data.error === "string" ? data.error : JSON.stringify(data.error))
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, json) => request("POST", path, { json }),
  del: (path, json) => request("DELETE", path, { json }),
  postForm: (path, formData) => request("POST", path, { formData }),
};
