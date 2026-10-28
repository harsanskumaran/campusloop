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
    throw new Error(readableError(data.error) || `Request failed (${res.status})`);
  }
  return data;
}

// The server sends either a plain message or a zod validation object
// ({ formErrors: [], fieldErrors: { field: ["message"] } }). Show people text, not JSON.
function readableError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error.fieldErrors || error.formErrors) {
    const messages = [...(error.formErrors || []), ...Object.values(error.fieldErrors || {}).flat()];
    if (messages.length) return messages.join(". ");
  }
  return JSON.stringify(error);
}

// Download a protected file (e.g. /photos/12) as a Blob. <img src> can't send the
// login token, so images are fetched here and shown through an object URL.
export async function fetchBlob(path) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Could not load file (${res.status})`);
  return res.blob();
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, json) => request("POST", path, { json }),
  del: (path, json) => request("DELETE", path, { json }),
  postForm: (path, formData) => request("POST", path, { formData }),
};
