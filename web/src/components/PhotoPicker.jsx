// src/components/PhotoPicker.jsx
import { useState } from "react";

// capture="environment" prompts the phone's back camera when available.
export default function PhotoPicker({ onChange, minCount = 4 }) {
  const [files, setFiles] = useState([]);

  function handleFiles(e) {
    const list = Array.from(e.target.files);
    setFiles(list);
    onChange(list);
  }

  return (
    <div>
      <input
        type="file" accept="image/*" capture="environment" multiple
        onChange={handleFiles}
        className="block w-full text-sm border rounded px-3 py-2"
      />
      <p className="text-xs text-gray-500 mt-1">
        {files.length} photo{files.length === 1 ? "" : "s"} selected
        {files.length < minCount && ` (minimum ${minCount} required)`}
      </p>
      {files.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {files.map((f, i) => (
            <img key={i} src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded border" />
          ))}
        </div>
      )}
    </div>
  );
}
