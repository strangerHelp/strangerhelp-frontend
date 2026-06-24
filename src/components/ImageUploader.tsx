import { useState, useRef } from "react";

interface Props {
  onUpload?: (files: File[]) => void;
  maxFiles?: number;
}

export default function ImageUploader({ onUpload, maxFiles = 5 }: Props) {
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files).slice(0, maxFiles - previews.length);
    const urls = newFiles.map((f) => URL.createObjectURL(f));
    setPreviews((prev) => [...prev, ...urls]);
    onUpload?.(newFiles);
  }

  function remove(index: number) {
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div>
      {previews.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-3">
          {previews.map((url, i) => (
            <div key={url} className="relative w-20 h-20">
              <img src={url} alt="" className="w-full h-full object-cover rounded-md border border-[var(--color-hairline)]" />
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-full text-xs"
                aria-label="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}
      <div
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center h-24 border-2 border-dashed border-[var(--color-hairline)] rounded-md hover:border-[var(--color-hairline-strong)] transition-colors cursor-pointer"
      >
        <div className="text-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-[var(--color-mute)]"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          <p className="mt-1 text-xs text-[var(--color-mute)]">
            {previews.length >= maxFiles ? "Max files reached" : "Upload photos or use camera"}
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  );
}
