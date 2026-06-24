"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { Check, FileText, Upload, X, Eye, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { MediaItem } from "@/lib/store";

// A document line: collected toggle + multi-file upload (images / videos / PDFs)
// that auto-ticks once any file is attached. Thumbnails sit inline; images open
// in a lightbox, videos and PDFs open in a new tab. Used in Post-Order checklists.
export function DocRow({
  label,
  critical,
  collected,
  items,
  onChange,
  uid,
  // Some rows are driven by another field (e.g. B/L by its number) — lock toggle.
  toggleLocked,
  maxMb = 8,
}: {
  label: string;
  critical?: boolean;
  collected: boolean;
  items: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  uid: (prefix?: string) => string;
  toggleLocked?: boolean;
  maxMb?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  function kindOf(type: string): MediaItem["kind"] {
    if (type.startsWith("video/")) return "video";
    if (type === "application/pdf") return "pdf";
    return "image";
  }

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const tooBig = files.filter((f) => f.size > maxMb * 1024 * 1024).map((f) => f.name);
    if (tooBig.length) alert(`Skipped (over ${maxMb} MB):\n${tooBig.join("\n")}`);
    const ok = files.filter((f) => f.size <= maxMb * 1024 * 1024);

    Promise.all(
      ok.map(
        (file) =>
          new Promise<MediaItem>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: uid("doc"),
                kind: kindOf(file.type),
                fileName: file.name,
                fileType: file.type,
                data: String(reader.result),
              });
            reader.readAsDataURL(file);
          })
      )
    ).then((picked) => onChange([...items, ...picked]));

    e.target.value = "";
  }

  function remove(id: string) {
    onChange(items.filter((m) => m.id !== id));
  }

  return (
    <>
      <div
        className={clsx(
          "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition",
          collected ? "border-go/30 bg-go/10" : "border-line bg-surface"
        )}
      >
        {/* Collected tick (driven by attachment count, unless locked) */}
        <button
          disabled
          className={clsx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
            collected ? "bg-go text-white" : "bg-surface text-line-strong ring-1 ring-inset ring-line"
          )}
        >
          {collected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <FileText className="h-3 w-3" />}
        </button>

        <span className={clsx("flex-1 truncate text-[13px]", collected ? "text-ink" : "text-muted")}>
          {label}
        </span>

        {critical && (
          <span className="figure rounded bg-pending/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pending">
            key
          </span>
        )}

        {/* Thumbnails of attached files */}
        {items.length > 0 && (
          <div className="flex items-center gap-1.5">
            {items.map((m) => (
              <DocThumb key={m.id} item={m} onView={() => setLightbox(m)} onRemove={() => remove(m.id)} />
            ))}
          </div>
        )}

        {/* Add / upload button */}
        <button
          onClick={() => ref.current?.click()}
          className="flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-[11px] font-medium text-body ring-1 ring-inset ring-line transition hover:bg-white hover:text-ink"
        >
          <Upload className="h-3.5 w-3.5" /> {items.length > 0 ? "Add" : "Upload"}
        </button>

        <input
          ref={ref}
          type="file"
          accept="image/*,video/*,application/pdf"
          multiple
          onChange={onFiles}
          className="hidden"
        />
      </div>

      {/* Lightbox (images only; video/pdf open in a tab) */}
      <AnimatePresence>
        {lightbox && lightbox.kind === "image" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[85vh] max-w-3xl overflow-hidden rounded-xl bg-white ring-1 ring-line"
            >
              <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
                <span className="truncate text-[13px] font-semibold text-ink">{lightbox.fileName || label}</span>
                <button onClick={() => setLightbox(null)} className="text-muted hover:text-ink">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightbox.data} alt={label} className="max-h-[75vh] w-auto object-contain" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function DocThumb({
  item,
  onView,
  onRemove,
}: {
  item: MediaItem;
  onView: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative h-9 w-9 overflow-hidden rounded-md ring-1 ring-line">
      {item.kind === "image" ? (
        <button onClick={onView} className="block h-full w-full" title="View">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.data} alt={item.fileName} className="h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
            <Eye className="h-3.5 w-3.5 text-white" />
          </span>
        </button>
      ) : item.kind === "video" ? (
        <a href={item.data} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center bg-ink text-white" title={item.fileName}>
          <Play className="h-3.5 w-3.5" fill="currentColor" />
        </a>
      ) : (
        <a href={item.data} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center bg-surface text-coral" title={item.fileName}>
          <FileText className="h-4 w-4" />
        </a>
      )}
      <button
        onClick={onRemove}
        className="absolute -right-0.5 -top-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-block text-white group-hover:flex"
        aria-label="Remove file"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
