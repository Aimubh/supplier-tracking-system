// Self-check: the light product list must carry no file bytes — photos AND
// documents. Run with no framework or dependency:
//
//   node src/lib/light-list.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/products/route.ts", import.meta.url), "utf8");

// docImages is a map of slot -> files; it must go through the map stripper.
assert.ok(/logistics\.docImages = stripMediaMap\(/.test(route), "docImages must be stripped slot by slot");
assert.ok(!/logistics\.docImages = stripMediaArray\(/.test(route), "stripMediaArray ignores a map and leaks every PDF");

// The map stripper must empty each slot's bytes, using the same array stripper.
const fn = route.slice(route.indexOf("function stripMediaMap"), route.indexOf("function toLight"));
assert.ok(fn.includes("Object.entries") && fn.includes("stripMediaArray(arr)"), "each slot must be stripped");

console.log("light-list: documents stripped from the product list — all checks passed");
