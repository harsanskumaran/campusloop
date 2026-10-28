// src/components/PhotoPicker.jsx
import { useEffect, useMemo } from "react";

// Controlled picker: the parent owns `files`. People can add photos in several
// rounds and remove any of them. Shows how many more are still needed.
export default function PhotoPicker({ files, onChange, minCount = 4, maxCount = 8 }) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function addFiles(e) {
    const incoming = Array.from(e.target.files || []);
    e.target.value = ""; // allow choosing the same file again later
    const known = new Set(files.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
    const fresh = incoming.filter((f) => !known.has(`${f.name}|${f.size}|${f.lastModified}`));
    onChange([...files, ...fresh].slice(0, maxCount));
  }

  const remove = (index) => onChange(files.filter((_, i) => i !== index));
  const missing = Math.max(0, minCount - files.length);

  return (
    <div>
      <input
        type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addFiles}
        disabled={files.length >= maxCount}
        className="block w-full text-sm border rounded px-3 py-2 disabled:opacity-50"
      />
      <p className={`text-xs mt-1 ${missing > 0 ? "text-amber-700" : "text-green-700"}`}>
        {files.length} of {maxCount} photos selected
        {missing > 0 ? ` — add ${missing} more (minimum ${minCount} required)` : " ✓"}
      </p>
      {files.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mt-2">
          {previews.map((url, i) => (
            <div key={url} className="relative">
              <img src={url} alt={`Selected photo ${i + 1}`} className="w-full h-20 object-cover rounded border" />
              <button
                type="button" onClick={() => remove(i)} aria-label={`Remove photo ${i + 1}`}
                className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs leading-none"
              >
                &times;
              </button>
              {i === 0 && (
                <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1 rounded">
                  Cover
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {files.length > 1 && (
        <p className="text-xs text-gray-500 mt-1">The first photo is shown on the browse page.</p>
      )}
    </div>
  );
}
