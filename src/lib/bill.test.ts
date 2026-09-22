// Self-check: third-party commission must appear on the bill but must never
// affect any total. Run with no framework or dependency:
//
//   node src/lib/bill.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bill = readFileSync(new URL("./bill.ts", import.meta.url), "utf8");
const summary = readFileSync(new URL("./order-summary.ts", import.meta.url), "utf8");
const costing = readFileSync(new URL("./costing.ts", import.meta.url), "utf8");

// Every view that shows a goods / advance amount must value it at the rate the
// payment was actually made (convertPayment), never at today's rate — or the
// bill and the Order Summary drift apart on a paid order.
for (const view of ["../components/order-summary-view.tsx", "../components/dashboard-view.tsx"]) {
  const src = readFileSync(new URL(view, import.meta.url), "utf8");
  assert.ok(src.includes("convertPayment("), `${view} must value payments via convertPayment`);
  assert.ok(!/convert\(\s*p\.working\.(rateValue|advancePaid)/.test(src), `${view} converts a payment at today's rate`);
}
assert.ok(bill.includes("convertPayment("), "bill must value payments via convertPayment");
// The bill lists each remittance with its date, amount and bank rate, so the
// goods figure can be re-added by hand. It sits before the charges table.
assert.ok(bill.includes("<h2>Payments</h2>"), "bill needs a Payments section");
assert.ok(bill.includes("${paymentsHtml}"), "Payments section must be rendered");
assert.ok(bill.indexOf("${paymentsHtml}") < bill.indexOf("<h2>Charges"), "Payments come before charges");

// The bill discloses the company and the commission percentage.
assert.ok(bill.includes("thirdPartyCompany"), "bill must print the third-party company");
assert.ok(bill.includes("thirdPartyCommissionPct"), "bill must print the commission %");
assert.ok(/Third party/.test(bill), "bill needs a Third party heading");

// It must render OUTSIDE the totals table, or it would read as a costed line.
// The section is built into a variable, so what decides output order is where
// that variable is interpolated — not where the string is declared.
const totalsStart = bill.indexOf('<table class="totals">');
const totalsEnd = bill.indexOf("</table>", totalsStart);
const injectedAt = bill.indexOf("${thirdPartyHtml}");
assert.ok(totalsStart > 0, "expected a totals table in the bill");
assert.ok(injectedAt > 0, "expected thirdPartyHtml to be interpolated into the markup");
assert.ok(
  injectedAt > totalsEnd,
  "the Third party section must render after the totals table, not inside it"
);

// And the money paths must never reference it — this is the actual requirement:
// recorded and disclosed, never costed.
for (const [name, src] of [["order-summary.ts", summary], ["costing.ts", costing]] as const) {
  assert.ok(
    !/thirdParty/i.test(src),
    `${name} must not reference third-party commission — it must stay out of every calculation`
  );
}

// The disclosure line has to say it isn't counted, so nobody reconciles against it.
assert.ok(
  /not included in the totals/i.test(bill),
  "the bill must state the commission is not included in the totals"
);

console.log("bill: third-party disclosed, not costed — all checks passed");
