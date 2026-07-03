// Convert iPhone HEIC/HEIF photos to JPEG in the browser.
//
// Browsers (except Safari) can't render or reliably upload HEIC, so any HEIC
// picked from a file input is converted to a JPEG File before we store it or
// send it to an API. Non-HEIC files pass through untouched. Client-only —
// heic2any uses browser APIs, so it's imported dynamically at call time.

export function isHeic(file: File): boolean {
  const t = file.type.toLowerCase();
  const n = file.name.toLowerCase();
  return t === "image/heic" || t === "image/heif" || n.endsWith(".heic") || n.endsWith(".heif");
}

// Return a storable/uploadable File: HEIC → JPEG, everything else unchanged.
// On conversion failure, returns the original file so nothing is lost.
export async function toJpegIfHeic(file: File, quality = 0.85): Promise<File> {
  const r = await convertHeic(file, quality);
  return r.file;
}

// Like toJpegIfHeic but also reports whether a HEIC failed to convert, so the
// caller can warn the user (an unconverted HEIC won't preview outside Safari).
export async function convertHeic(
  file: File,
  quality = 0.85
): Promise<{ file: File; wasHeic: boolean; converted: boolean; error?: string }> {
  if (!isHeic(file)) return { file, wasHeic: false, converted: false };
  try {
    const heic2any = (await import("heic2any")).default;
    const result = (await heic2any({ blob: file, toType: "image/jpeg", quality })) as Blob | Blob[];
    // heic2any can return an array (multi-image HEIC) — take the first frame.
    const out = Array.isArray(result) ? result[0] : result;
    if (!out || out.size === 0) throw new Error("empty conversion output");
    const jpegName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    return { file: new File([out], jpegName, { type: "image/jpeg" }), wasHeic: true, converted: true };
  } catch (e) {
    return {
      file,
      wasHeic: true,
      converted: false,
      error: e instanceof Error ? e.message : "HEIC conversion failed",
    };
  }
}
