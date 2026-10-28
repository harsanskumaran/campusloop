// src/components/AuthImage.jsx
import { useEffect, useState } from "react";
import { fetchBlob } from "../api/client.js";

// Photos are protected (login required), so we download them with the token and
// show them through an object URL. Each photo is fetched once and then reused.
const urlCache = new Map();   // photoId -> object URL
const inFlight = new Map();   // photoId -> Promise<object URL>

function loadPhoto(photoId) {
  if (urlCache.has(photoId)) return Promise.resolve(urlCache.get(photoId));
  if (inFlight.has(photoId)) return inFlight.get(photoId);
  const promise = fetchBlob(`/photos/${photoId}`)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      urlCache.set(photoId, url);
      return url;
    })
    .finally(() => inFlight.delete(photoId));
  inFlight.set(photoId, promise);
  return promise;
}

export default function AuthImage({ photoId, alt = "", className = "" }) {
  // Result of the last download, tagged with the photo it belongs to so a stale
  // result is never shown for a different photo.
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!photoId || urlCache.has(photoId)) return undefined;
    let alive = true;
    loadPhoto(photoId)
      .then((url) => alive && setResult({ photoId, url }))
      .catch(() => alive && setResult({ photoId, failed: true }));
    return () => { alive = false; };
  }, [photoId]);

  const src = photoId ? urlCache.get(photoId) ?? (result?.photoId === photoId ? result.url : null) : null;
  const failed = !photoId || (result?.photoId === photoId && result.failed === true);

  if (failed) {
    return (
      <div className={`${className} bg-gray-100 flex items-center justify-center text-xs text-gray-400`}>
        No photo
      </div>
    );
  }
  if (!src) return <div className={`${className} bg-gray-100 animate-pulse`} />;
  return <img src={src} alt={alt} className={className} />;
}
