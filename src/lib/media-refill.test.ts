// Self-check: saving a form seeded from the light list must never write blank
// file placeholders over real files. Run with: node src/lib/media-refill.test.ts

import assert from "node:assert/strict";
import { refillStrippedMedia } from "./media-refill.ts";

const pdf = (id: string, data: string) => ({ id, kind: "pdf", fileName: id + ".pdf", fileType: "application/pdf", data });
const hole = (id: string) => ({ ...pdf(id, ""), hasData: true });

// In memory: the full record, with real bytes.
const prev = {
  id: "p1",
  working: { productMedia: [{ ...pdf("ph1", "data:image/jpeg;base64,AAA"), kind: "image" }], sampleMedia: [], packagingMedia: [] },
  logistics: { docImages: { docBoE: [pdf("boe1", "data:application/pdf;base64,JVBERi0x")] } },
} as never;

// The form's copy: seeded from the light list, so every file is a placeholder,
// plus one brand-new upload the user just added.
const draft = {
  id: "p1",
  working: { productMedia: [{ ...hole("ph1"), kind: "image" }], sampleMedia: [], packagingMedia: [] },
  logistics: { docImages: { docBoE: [hole("boe1")], docDO: [pdf("new1", "data:application/pdf;base64,JVBERi0y")] } },
} as never;

const product = refillStrippedMedia(draft, prev) as any;
assert.equal(product.logistics.docImages.docBoE[0].data, "data:application/pdf;base64,JVBERi0x", "document bytes restored");
assert.equal(product.working.productMedia[0].data, "data:image/jpeg;base64,AAA", "photo bytes restored");
assert.equal("hasData" in product.logistics.docImages.docBoE[0], false, "placeholder flag dropped");
assert.equal(product.logistics.docImages.docDO[0].data, "data:application/pdf;base64,JVBERi0y", "new upload kept as is");

// Bytes not in memory: the placeholder stays a placeholder (the store waits for
// the full record before saving a light product), never fake data.
const empty = { id: "p1", working: { productMedia: [], sampleMedia: [], packagingMedia: [] }, logistics: { docImages: {} } } as never;
const left = (refillStrippedMedia(draft, empty) as any).logistics.docImages.docBoE[0];
assert.equal(left.data, "", "no bytes invented");
assert.equal(left.hasData, true, "still marked as a placeholder");

console.log("media-refill: placeholders never overwrite real files — all checks passed");
