"use client";

import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";

// Pick an image from the computer → base64 data URL → stored in the product.
// No backend needed; previews inline. Caps size so localStorage doesn't overflow.
export function ImageUpload({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert("Please choose an image under 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <span className="eyebrow mb-1.5 block">{label}</span>
      <input ref={ref} type="file" accept="image/*" onChange={onFile} className="hidden" />
      {value ? (
        <div className="group relative overflow-hidden rounded-xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="h-44 w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => ref.current?.click()}
              className="rounded-lg bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur hover:bg-white/25"
            >
              Replace
            </button>
            <button
              onClick={() => onChange("")}
              className="flex items-center gap-1 rounded-lg bg-block/80 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-block"
            >
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface text-muted transition hover:border-line-strong hover:bg-surface hover:text-ink"
        >
          <ImagePlus className="h-7 w-7" />
          <span className="text-[12px] font-medium">Click to upload</span>
          <span className="text-[10px] text-line-strong">PNG / JPG · under 3 MB</span>
        </button>
      )}
    </div>
  );
}
