// Self-check for shortTitle(). Node 22.6+ strips TS types natively, so this runs
// with no test framework and no dependencies:
//
//   node src/lib/sourcing-enrich.test.ts

import assert from "node:assert/strict";
import { shortTitle, roundMoney } from "./sourcing-enrich.ts";

// roundMoney: the API sends 32-bit floats, so $0.10 arrives as 0.10000000149…
assert.equal(roundMoney(0.10000000149011612), 0.1);
assert.equal(roundMoney(2.4500000476837158), 2.45);

// Sub-cent FOBs are real at these volumes and must survive rounding.
assert.equal(roundMoney(0.0125), 0.0125);
assert.equal(roundMoney(0.00012), 0.0001);

// Exact values pass through untouched.
assert.equal(roundMoney(0), 0);
assert.equal(roundMoney(19), 19);

// Junk must not become NaN in a money field.
assert.equal(roundMoney(undefined), 0);
assert.equal(roundMoney(NaN), 0);
assert.equal(roundMoney(Infinity), 0);

// The real titles that prompted this — full Amazon SEO listings.
assert.equal(
  shortTitle("Lazer Reusable Noise Cancelling 4 Ear Plugs with Storage Case, Soft Silicone, Pack of 3"),
  "Lazer Reusable Noise Cancelling 4 Ear Plugs with Storage Case"
);
assert.equal(
  shortTitle("Lazer Portable Inflatable Travel Neck Pillow | U-Shape Head Support for Flights"),
  "Lazer Portable Inflatable Travel Neck Pillow"
);

// Already short — left exactly as-is.
assert.equal(shortTitle("Silicone Phone Lanyard"), "Silicone Phone Lanyard");

// Separators: parens, brackets, en/em dash, spaced hyphen and bullet.
assert.equal(shortTitle("Glass Tumbler (350ml, set of 4)"), "Glass Tumbler");
assert.equal(shortTitle("Glass Tumbler [Blue]"), "Glass Tumbler");
assert.equal(shortTitle("Glass Tumbler – Blue"), "Glass Tumbler");
assert.equal(shortTitle("Glass Tumbler - Blue"), "Glass Tumbler");
assert.equal(shortTitle("Glass Tumbler • Blue"), "Glass Tumbler");

// A hyphen *inside* a word is part of the name, not a separator.
assert.equal(shortTitle("Anti-Slip Yoga Mat"), "Anti-Slip Yoga Mat");

// Whitespace is collapsed and trimmed.
assert.equal(shortTitle("  Glass   Tumbler  "), "Glass Tumbler");

// Missing / empty input must not throw — the scraper often returns nothing.
assert.equal(shortTitle(undefined), "");
assert.equal(shortTitle(""), "");

// A late word boundary is used, so the result stays whole-worded.
assert.equal(
  shortTitle("Stainless Steel Insulated Water Bottle Wide Mouth Vacuum Flask Leakproof Lid"),
  "Stainless Steel Insulated Water Bottle Wide Mouth Vacuum Flask"
);

// Never exceeds the cap. When the only boundary sits in the first half, cutting
// there would discard most of the name — a hard slice loses less.
const long = shortTitle("A".repeat(20) + " " + "B".repeat(80));
assert.equal(long.length, 70);

// A single unbroken word longer than the cap has no boundary to cut on — a hard
// slice is correct here rather than returning an empty string.
assert.equal(shortTitle("C".repeat(80)).length, 70);

console.log("shortTitle: all checks passed");
