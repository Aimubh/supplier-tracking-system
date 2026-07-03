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
  if (!isHeic(file)) return file;
  try {
    const heic2any = (await import("heic2any")).default;
    const out = (await heic2any({ blob: file, toType: "image/jpeg", quality })) as Blob;
    const jpegName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    return new File([out], jpegName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
