"use client";

import { useRef } from "react";
import { UploadCloud } from "lucide-react";

// Pick a file (image or PDF) → base64 data URL. Returns name/type/data to the
// caller. No backend; everything lives in localStorage. Caps size to keep
// localStorage from overflowing.
export function FileUpload({
  label,
  accept = "image/*,application/pdf",
  maxMb = 5,
  onPick,
}: {
  label: string;
  accept?: string;
  maxMb?: number;
  onPick: (file: { name: string; type: string; data: string }) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      alert(`Please choose a file under ${maxMb} MB.`);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onPick({ name: file.name, type: file.type, data: String(reader.result) });
      e.target.value = ""; // allow re-picking the same file
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <input ref={ref} type="file" accept={accept} onChange={onFile} className="hidden" />
      <button
        onClick={() => ref.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line bg-surface py-6 text-muted transition hover:border-line-strong hover:bg-surface hover:text-ink"
      >
        <UploadCloud className="h-6 w-6" />
        <span className="text-[12px] font-medium">{label}</span>
        <span className="text-[10px] text-line-strong">PDF / PNG / JPG · under {maxMb} MB</span>
      </button>
    </>
  );
}
