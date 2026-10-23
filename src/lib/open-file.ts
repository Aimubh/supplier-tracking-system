// Open a stored file (photo, video, PDF) in a new tab.
//
// Files are kept as data: URLs, and Chrome/Edge refuse to open a data: URL as a
// top-level tab — clicking a plain <a href="data:..."> just shows a blank tab.
// So the file is turned into a Blob and opened by its object URL, which the
// browser's own PDF / image / video viewer accepts.
export function openFile(src: string) {
  if (!src) return; // light record: bytes not loaded yet
  if (!src.startsWith("data:")) {
    window.open(src, "_blank", "noopener");
    return;
  }
  const comma = src.indexOf(",");
  const meta = src.slice(5, comma); // e.g. "application/pdf;base64"
  const type = meta.split(";")[0] || "application/octet-stream";
  const body = src.slice(comma + 1);
  const bytes = meta.endsWith(";base64")
    ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(body));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  window.open(url, "_blank", "noopener");
  // The tab has loaded it by then; freeing the memory keeps long sessions light.
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
