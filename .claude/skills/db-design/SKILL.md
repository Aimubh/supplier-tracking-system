---
name: db-design
description: Database and data-model conventions for the Lazer Believe Sourcing Tracker (PostgreSQL + Prisma). Use this whenever adding or changing the schema, creating Prisma models, writing migrations, designing a new entity, or wiring data persistence in this project. Trigger on requests like "add a Payment table", "model the supplier", "create the Prisma schema", "add a field for HS code", "set up the database", "write a migration", or any task that introduces or alters stored data — even if Prisma/Postgres aren't named. Encodes entity patterns, enum/money/file conventions, the document vault, and the pipeline state machine.
---

# Sourcing Tracker — Data Model Conventions

The stack is **PostgreSQL + Prisma** (type-safe client + migrations). The data model
mirrors the business process: candidate products move through phases, and the schema's
job is to make the *gates* enforceable and the *cash + documents* auditable.

Source of truth for entities and fields is the technical design doc; the working domain
constants already live in `src/lib/pipeline.ts` (stages, phases, gates),
`src/lib/access.ts` (users/roles), and `src/lib/steps.ts`.

## Universal conventions

Every entity carries these implicitly — include them on every model:

```prisma
id        String   @id @default(uuid())
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

- **Money is two fields, never a float**: `amount Decimal @db.Decimal(12,2)` + `currency String @default("USD")`. Never store money as `Float`.
- **Status/category-with-fixed-set is an `enum`**, not a free string.
- **Files are URLs** to the S3-compatible store (samples, QC photos, BL/PI/CI scans):
  `String?` holding the object key/URL. Multiple files → a related `Document` rows or a
  `String[]`.
- **Relations use explicit FK fields**: `poId String` + `po PurchaseOrder @relation(fields: [poId], references: [id])`.
- Names: models PascalCase singular (`PurchaseOrder`), fields camelCase, enums
  SCREAMING_SNAKE values.

## Entities by phase (from the technical design)

**Core / Pre-Order**: `Product` (the unit that moves through the pipeline — has `stage`,
`status`, `sourceType`, `targetMarkets`), `Supplier` (with `type` FACTORY/TRADING_COMPANY/UNKNOWN
and `verificationStatus`), `Quotation` (a.k.a. Proforma Invoice — belongs to a supplier+product,
NOT a PO; carries `incoterm`, `moq`, `priceTiers`, `paymentTerms`), `Sample`, `Compliance`
(hsCode, dutyRatePct, igstRatePct, licence fields, `status` BLOCKED/CLEARED), `Costing`
(one row per product × marketplace; the GO/NO_GO engine; pulls from editable rate tables).

**Order / Production**: `PurchaseOrder` (issued by US to the supplier; references the accepted
`quotationId`), `Payment` (the cash ledger — see below), `Production` (mould/packaging/PP sample),
`QualityInspection` (`result` PENDING/PASS/FAIL; gates the balance payment).

**Logistics / Landing**: `Shipment` (blNumber, container, vessel, etd/eta), `CustomsClearance`
(boeNumber, dutyPaid, igstPaid, portDays for demurrage), `LastMileTransport`
(vehicleChassisNumber), `GoodsReceipt` (GRN — three-way reconciliation orderedQty/receivedQty/
invoicedQty, then `handedToInventory`).

**Cross-cutting**: `Document` (polymorphic vault — `docType` enum, `entityType`/`entityId`,
`fileUrl`, `issuedDate`), and editable **rate-tables** (fees, duty, freight) so figures are
never hard-coded.

## Two patterns that are easy to get wrong

1. **The cash ledger (`Payment`)** is the most important table. Every money movement is a row:
   `type` DEPOSIT/BALANCE/FREIGHT/DUTY/CHA/OTHER, `amount`+`currency`, `dueDate`/`paidDate`,
   `status` PENDING/PAID, `proofUrl`, and a `gateBlocked Boolean @default(false)` — the BALANCE
   is blocked until QC passes. Canonical model:

```prisma
model Payment {
  id          String        @id @default(uuid())
  po          PurchaseOrder @relation(fields: [poId], references: [id])
  poId        String
  type        PaymentType
  amount      Decimal       @db.Decimal(12,2)
  currency    String        @default("USD")
  dueDate     DateTime?
  paidDate    DateTime?
  status      PaymentStatus @default(PENDING)
  proofUrl    String?
  gateBlocked Boolean       @default(false)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}
enum PaymentType { DEPOSIT BALANCE FREIGHT DUTY CHA OTHER }
enum PaymentStatus { PENDING PAID }
```

2. **The pipeline stage lives on `Product.stage`** as an enum matching the `Stage` type in
   `src/lib/pipeline.ts` (DISCOVERED … HANDED_OFF). Keep the Prisma enum and the TS union in
   sync. Allowed transitions are validated server-side (see the app-logic skill), not enforced
   by the DB.

## Migrations & workflow

- Use `prisma migrate dev` locally; `prisma migrate deploy` runs in CI against managed Postgres.
- Run `prisma generate` after schema edits; the typed client is the only way the app reads/writes.
- Secrets (`DATABASE_URL`) come from env, never the repo.
- Prefer additive migrations; when renaming, do expand→migrate→contract rather than destructive drops.

## Build order (don't boil the ocean)

Phase 1 (Spine): Product, Supplier, Quotation, Costing, Payment, QualityInspection, rate tables —
these protect cash and quality. Phase 2: Compliance, supplier vetting, PurchaseOrder, Document
vault, GoodsReceipt. Phase 3: Shipment, customs, last-mile. Build the spine first; the freight
forwarder may already supply Phase-3 tracking, so confirm before building it.

Keep enums and the `pipeline.ts`/`access.ts` constants as the shared vocabulary between DB and UI.
