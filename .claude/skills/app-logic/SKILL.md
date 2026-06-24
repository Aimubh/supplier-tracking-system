---
name: app-logic
description: Business-logic and access-control rules for the Lazer Believe Sourcing Tracker — the gated state machine and role-based access. Use this whenever implementing stage transitions, gate checks, costing go/no-go, payment release rules, the pipeline workflow, server actions/API handlers, auth, or who-can-see-what. Trigger on requests like "let the user advance a product to the next stage", "block the balance payment until QC", "add the costing engine", "wire the API for X", "enforce permissions", "add a role", or anything touching how the app decides what's allowed — even if "gate" or "state machine" isn't said. The central rule: gates are enforced server-side, never by the UI alone.
---

# Sourcing Tracker — App Logic & Access

The whole product exists to **enforce gates** — checkpoints that protect cash and quality.
The value is in the gates, not the status display. So the cardinal rule:

> **Gates are enforced server-side. The UI may reflect a gate, but must never be the only
> thing enforcing it.** Validate every stage change and every money release on the server
> (route handler / server action), against the rules below.

## The pipeline state machine

Stages, phases, and gate definitions are in `src/lib/pipeline.ts` (the shared vocabulary).
A `Product.stage` advances through an ordered sequence; a transition is allowed only when its
gate passes. The four hard gates:

1. **SAMPLE_OK** — physical sample APPROVED.
2. **COMPLIANCE_OK** — HS code, duty, and licence CLEARED before ordering.
3. **COSTING_GO** — per-market backward-costing verdict = GO.
4. **QC_PASS** — pre-shipment QC = PASS. This also **unblocks the balance payment.**

Any stage can go to `REJECTED` or `ON_HOLD` (with a reason). Store allowed transitions as a
single map/table and validate against it server-side. Never let the client pick an arbitrary
next stage.

Implementation pattern:

```ts
// One source of truth for legal moves.
const ALLOWED: Record<Stage, Stage[]> = { /* DISCOVERED: ["VALIDATING", ...], ... */ };

function assertTransition(current: Stage, next: Stage, ctx: GateContext) {
  if (!ALLOWED[current]?.includes(next)) throw new Error("Illegal transition");
  // Gate guards — refuse to enter a gated stage unless its checkpoint passed.
  if (next === "SAMPLE_OK" && ctx.sample !== "APPROVED") throw new GateError("Sample not approved");
  if (next === "COMPLIANCE_OK" && ctx.compliance !== "CLEARED") throw new GateError("Compliance not cleared");
  if (next === "COSTING_GO" && ctx.costingVerdict !== "GO") throw new GateError("Costing is not GO");
  if (next === "QC_PASS" && ctx.qc !== "PASS") throw new GateError("QC has not passed");
}
```

Keep the `Stage` union (TS) and the Prisma enum in sync (see the db-design skill).

## Costing — worked backwards (go / no-go engine)

Pricing is **never** supplier-price-plus-margin. Start from the realistic channel selling price,
subtract every channel cost (marketplace fee, fulfilment, ad/TACOS, returns, GST, freight, duty),
and what remains is the **max landed cost** = our counter-target price. One `Costing` row per
product × marketplace.

```
netMargin = sellingPrice
          − channelFees (referral + fulfilment + storage)
          − sellingPrice * adCostPct
          − sellingPrice * returnRatePct
          − landedCostPerUnit            // ex-works + freight + duty + IGST
verdict = netMarginPct >= requiredMarginPct ? GO : NO_GO
```

Pull fee/duty/freight numbers from the **editable rate tables**, never hard-coded constants.
First orders are sized as a **demand test**, not to hit a supplier MOQ — keep that framing in any
quantity-suggestion logic.

## Payment release rule

The balance payment is **gateBlocked until QC passes**. On any attempt to mark a BALANCE payment
PAID, the server must check the linked PO's `QualityInspection.result === "PASS"` first; otherwise
reject. Deposits/freight/duty are not gated this way. Record proof (`proofUrl`) on every payment.

## Access control (RBAC)

Model is in `src/lib/access.ts`: `ADMIN` (the parent — sees everything) and `EMPLOYEE` (granted
per-tab access). `canAccess(user, tab)` is the check. Currently UI-only via `TabGuard`; when the
backend lands:

- Enforce access on the **server** too (session + middleware), not just `TabGuard`. A user without
  `on-working` access must be refused the data and the mutations, not merely hidden the link.
- Admin-only operations (user management, rate tables) require a server-side role check.
- Auth is Auth.js (email + role). The default admin is seeded; employee logins come later.

## Where logic lives

- Pure domain rules and constants: `src/lib/*` (`pipeline.ts`, `access.ts`, `steps.ts`).
- Mutations: Next.js server actions / route handlers — do all validation here.
- Keep handlers thin: load context → `assertTransition` / gate check → persist → return. Surface a
  clear error (in the interface's voice) when a gate blocks an action; the UI shows it, but the
  server is what said no.

## Principle to keep returning to

Build the gates first; they're the only parts that change decisions. A status that can be flipped
freely from the client isn't a gate — it's decoration. If a change would let someone advance a
product or release money without the checkpoint, it's a bug, not a feature.
