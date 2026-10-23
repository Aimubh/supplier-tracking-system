// Self-check: stored files must open via a Blob URL, never as a data: link
// (Chrome shows a blank tab for those). Run with: node src/lib/open-file.test.ts

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openFile } from "./open-file.ts";

// Stub the browser bits openFile touches.
let opened = "", blob: Blob | null = null;
(globalThis as any).window = { open: (u: string) => { opened = u; } };
URL.createObjectURL = (b: Blob) => { blob = b; return "blob:test/1"; };
URL.revokeObjectURL = () => {};
(globalThis as any).setTimeout = () => 0;

const pdf = Buffer.from("%PDF-1.4 test file");
openFile("data:application/pdf;base64," + pdf.toString("base64"));
assert.equal(opened, "blob:test/1", "a data: file must open through a Blob URL");
assert.equal(blob!.type, "application/pdf", "the file type is kept, so the PDF viewer opens");
assert.deepEqual(Buffer.from(await blob!.arrayBuffer()), pdf, "bytes survive intact");

opened = ""; openFile(""); assert.equal(opened, "", "nothing opens when bytes aren't loaded");

// No screen may link straight to file data again.
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const src = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const offenders = walk(src).filter((f) => !f.endsWith(".test.ts") && /href=\{[\w.]*\.data\}/.test(readFileSync(f, "utf8")));
assert.deepEqual(offenders, [], "use openFile() instead of href={x.data}");

console.log("open-file: files open via Blob URLs, no data: links left — all checks passed");
