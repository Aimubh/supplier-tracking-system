// Self-check for the placeholder-name helpers. Node 22.6+ strips TS types, so
// this runs with no test framework and no dependencies:
//
//   node src/lib/untitled-name.test.ts
//
// store.tsx can't be imported here (it pulls in React), so the helpers are
// duplicated below. Keep them in sync with src/lib/store.tsx.

import assert from "node:assert/strict";

const UNTITLED = /^Untitled (\d+)$/;

function nextUntitledName(products: { name: string }[]): string {
  const highest = products.reduce((max, p) => {
    const n = Number(UNTITLED.exec(p.name.trim())?.[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `Untitled ${highest + 1}`;
}

function isPlaceholderName(name: string): boolean {
  const s = name.trim();
  return s === "" || UNTITLED.test(s);
}

const names = (...n: string[]) => n.map((name) => ({ name }));

// Empty list starts at 1.
assert.equal(nextUntitledName([]), "Untitled 1");

// Named products are ignored entirely.
assert.equal(nextUntitledName(names("sampoo", "shubham")), "Untitled 1");

// Counts from the highest existing number, not the list length.
assert.equal(nextUntitledName(names("Untitled 1")), "Untitled 2");
assert.equal(nextUntitledName(names("sampoo", "Untitled 1", "Untitled 2")), "Untitled 3");

// Gaps don't cause a collision — deleting Untitled 2 must not reissue it.
assert.equal(nextUntitledName(names("Untitled 1", "Untitled 3")), "Untitled 4");

// Out-of-order input still finds the maximum.
assert.equal(nextUntitledName(names("Untitled 7", "Untitled 2")), "Untitled 8");

// Double digits compare numerically, not as strings ("9" > "10" lexically).
assert.equal(nextUntitledName(names("Untitled 9", "Untitled 10")), "Untitled 11");

// Near-misses are not placeholders and must not be counted.
assert.equal(nextUntitledName(names("Untitled", "Untitled product", "untitled 5", "Untitled 2x")), "Untitled 1");

// The legacy blank names (created before numbering existed) are skipped too.
assert.equal(nextUntitledName(names("", "", "Untitled 1")), "Untitled 2");

// isPlaceholderName: blank and generated names are placeholders.
assert.equal(isPlaceholderName(""), true);
assert.equal(isPlaceholderName("   "), true);
assert.equal(isPlaceholderName("Untitled 1"), true);
assert.equal(isPlaceholderName("Untitled 42"), true);

// A real name is not — saving Pre-Order must never overwrite one.
assert.equal(isPlaceholderName("sampoo"), false);
assert.equal(isPlaceholderName("Untitled product"), false);
assert.equal(isPlaceholderName("Untitled Neck Pillow"), false);

console.log("untitled-name: all checks passed");
