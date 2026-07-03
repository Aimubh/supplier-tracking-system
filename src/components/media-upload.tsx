"use client";

import { useRef } from "react";
import { UploadCloud, X, FileText, Play } from "lucide-react";
import type { MediaItem } from "@/lib/store";
import { convertHeic } from "@/lib/heic";

// Multi-file uploader for photos, videos and PDFs. Each file is read to a
// base64 data URL and added to the gallery, so several can be attached to one
// field — and a PDF can stand in for a photo. No backend; everything lives in
// localStorage, so sizes are capped to keep it from overflowing.
export function MediaUpload({
  label,
  items,
  onChange,
  uid,
  maxMb = 8,
  accept = "image/*,video/*,application/pdf",
}: {
  label: string;
  items: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  uid: (prefix?: string) => string;
  maxMb?: number;
  accept?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function kindOf(type: string): MediaItem["kind"] {
    if (type.startsWith("video/")) return "video";
    if (type === "application/pdf") return "pdf";
    return "image";
  }

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same files
    if (files.length === 0) return;

    // Convert HEIC → JPEG FIRST (iPhone photos), collecting any that fail so we
    // can tell the user instead of silently storing an unviewable file.
    const failed: string[] = [];
    const converted = await Promise.all(
      files.map(async (raw) => {
        const r = await convertHeic(raw);
        if (r.wasHeic && !r.converted) failed.push(raw.name);
        return r.file;
      })
    );

    // Size-check AFTER conversion (the JPEG can be larger than the source HEIC).
    const tooBig = converted.filter((f) => f.size > maxMb * 1024 * 1024).map((f) => f.name);
    if (tooBig.length) {
      alert(`These files are over ${maxMb} MB and were skipped:\n${tooBig.join("\n")}`);
    }
    if (failed.length) {
      alert(
        `Couldn't convert these iPhone HEIC photos (they'll upload but may not preview):\n${failed.join("\n")}\n\nTip: on iPhone, Settings → Camera → Formats → "Most Compatible" saves as JPEG.`
      );
    }
    const ok = converted.filter((f) => f.size <= maxMb * 1024 * 1024);

    // Read each to a base64 data URL.
    const picked = await Promise.all(
      ok.map(async (file) => {
        const data = await readAsDataUrl(file);
        return {
          id: uid("media"),
          kind: kindOf(file.type),
          fileName: file.name,
          fileType: file.type,
          data,
        } as MediaItem;
      })
    );
    onChange([...items, ...picked]);
  }

  function remove(id: string) {
    onChange(items.filter((m) => m.id !== id));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {items.length > 0 && (
          <span className="figure text-[11px] text-muted">{items.length} file{items.length > 1 ? "s" : ""}</span>
        )}
      </div>

      <input ref={ref} type="file" accept={accept} multiple onChange={onFiles} className="hidden" />

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((m) => (
          <Thumb key={m.id} item={m} onRemove={() => remove(m.id)} />
        ))}

        {/* Add tile */}
        <button
          onClick={() => ref.current?.click()}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line bg-surface text-muted transition hover:border-line-strong hover:text-ink"
        >
          <UploadCloud className="h-5 w-5" />
          <span className="text-[10px] font-medium">Add files</span>
        </button>
      </div>

      <p className="mt-1.5 text-[10px] text-line-strong">
        Photos, videos or PDF · multiple allowed · under {maxMb} MB each
      </p>
    </div>
  );
}

function Thumb({ item, onRemove }: { item: MediaItem; onRemove: () => void }) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border border-line bg-surface">
      {item.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.data} alt={item.fileName} className="h-full w-full object-cover" />
      ) : item.kind === "video" ? (
        <>
          <video src={item.data} className="h-full w-full object-cover" muted />
          <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
            <Play className="h-5 w-5" fill="currentColor" />
          </span>
        </>
      ) : (
        <a
          href={item.data}
          target="_blank"
          rel="noreferrer"
          className="flex h-full w-full flex-col items-center justify-center gap-1 text-coral"
          title={item.fileName}
        >
          <FileText className="h-6 w-6" />
          <span className="px-1 text-center text-[9px] text-muted line-clamp-2">{item.fileName}</span>
        </a>
      )}

      <button
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink/70 text-white opacity-0 transition hover:bg-block group-hover:opacity-100"
        aria-label="Remove file"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
