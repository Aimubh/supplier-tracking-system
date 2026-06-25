# Supplier Tracking System

Internal web app for **Lazer Believe (Lazer Ecommerce Ventures Pvt. Ltd.)** that tracks
products sourced from China through every stage — from market research to landing the
goods in our warehouse — with **decision gates** that protect cash and quality, and a
per-product **profit/cost summary** with a downloadable order bill.

> This README is written so a developer (or an AI assistant in a fresh session) can
> understand the whole project quickly: what it does, how it's built, where things live,
> and how to run it.

---

## 1. What the app does

A "candidate" product moves through a gated pipeline. At each step the team records data;
some steps are **hard gates** (e.g. compliance, costing GO/NO-GO, sample approval) that
should block progress until cleared. The app is organised as tabs in a left sidebar:

| Tab | Purpose |
|---|---|
| **Dashboard** | Overview cards (total products, arrival status, listing pending, current product's capital paid/pending) + a filterable table of all products with live phase, progress, status, and a **View** modal + **download bill**. |
| **Manufacturer / Trader Directory** | Reusable address book of factories & trading companies (vet once, reuse across products): name, address, business certification, representative (name/number/WeChat/QR), product catalogs, rating, notes. |
| **Pre-Order** | Market check · Find & vet supplier · Compliance (HS code, duty/IGST, licence) · Costing (backward GO/NO-GO engine). |
| **On-Working** | **Product Decision** (sample check + MOQ + rates + mould), **Design Processing** (logo/packaging approval + order processing/countdown), **Dispatch**. |
| **Post-Order** | **Dispatch & Documentation** (vessel/container/B-L, shipment dims POL/POD/pkgs/weight/CBM, shipping agent, movement steps, export docs), **Custom Clearance** (unloading + CHA + IGM + BOE + duty), **Product arrival State** (last-mile, port-to-warehouse cost, GRN 3-way reconciliation, handoff to inventory). |
| **Order Summary** | Per-product **P&L / cost sheet** — rolls up amounts/dates/status, lets you edit everything inline, itemises every cost in a chosen currency, and downloads a printable **order bill (PDF)**. |
| **Admin → Users & access** | Admin-only screen to create team members with a role + per-tab access. |

---

## 2. Tech stack

- **Next.js 14.2.35** (App Router) · **TypeScript** · **React 18**
- **Tailwind CSS** with a custom design-token system
- **PostgreSQL (Neon)** + **Prisma 6** ORM
  > Prisma is intentionally **pinned to v6**. Prisma 7 changed the datasource config
  > (no `url` in schema, requires driver adapters) — do **not** upgrade without reworking.
- **NextAuth v4** (credentials provider, bcrypt password hashing, JWT sessions)
- **Framer Motion** (via the `motion` package, re-exported through `src/components/motion.tsx`)
- **lucide-react** icons
- Live FX rates from `https://open.er-api.com` (free, no key) for currency conversion

---

## 3. Design system ("Airtable editorial")

White canvas, dark-ink type, **flat hairline cards**, near-black ink primary buttons —
**no gradients, glow, or atmospheric effects**. Emphasis comes from size and contrast.

- **Tokens** (`tailwind.config.ts`): `base` = white, `surface` = #f8fafc, `line` = hairline,
  `ink`/`body`/`muted` text, `brand` = near-black, semantic `go`/`block`/`pending`, plus
  signature colors (coral/forest/cream/etc.). Shared utility classes (`glass`, `eyebrow`,
  `figure`) live in `src/app/globals.css`.
- **Fonts:** Inter (body) + Inter Tight (display) — modest weights.
- **Default currency: INR** (₹). USD ($) and CNY (¥) also supported everywhere.

When restyling/adding UI, keep this look (flat, hairline, ink — never gradient/glow).

---

## 4. Project structure

```
src/
  app/
    (app)/                 # authenticated shell (sidebar layout)
      dashboard/  directory/  pre-order/  on-working/  post-order/
      order-summary/  users/  page.tsx (redirects to dashboard)  pipeline/ (legacy redirect)
    (auth)/login/          # login page
    api/
      auth/[...nextauth]/  # NextAuth route
      products/  products/[id]/        # product CRUD
      manufacturers/  manufacturers/[id]/
      users/  users/[id]/              # admin-only user CRUD
    layout.tsx  globals.css
  components/
    sidebar, dashboard-view, directory-view, order-summary-view, users-view,
    product-view-modal, product-switcher, media-upload, doc-row, currency-converter,
    fields, save-bar, tab-guard, session-provider, ...
    panels/ pre-order.tsx  on-working.tsx  post-order.tsx   # the step forms
  lib/
    store.tsx          # client data store (loads/saves via API; mirrors Prisma shape)
    db.ts              # Prisma client singleton
    auth.ts            # NextAuth options (credentials + DB lookup)
    access.ts          # TabKey, roles, TABS, canAccess(), TAB_STEPS
    flow.ts            # getFlow(product) — single source of truth for step status/progress/alerts
    steps.ts           # the sub-step definitions per phase
    costing.ts         # backward costing engine (landed cost, GO/NO-GO)
    order-summary.ts   # computeOrderSummary(product) — P&L rollup
    bill.ts            # builds the printable order-bill HTML (print → Save as PDF)
    fx.ts              # live FX rates hook + convert() helper
    api-map.ts         # maps full objects → Prisma row columns/JSON
    use-current-user.tsx # session → AppUser hook
  middleware.ts        # protects all pages + APIs (redirect to /login if unauthenticated)
  types/next-auth.d.ts # augments session with role + access
prisma/
  schema.prisma        # User, Product, Manufacturer models
  migrations/          # init, add_user, add_expenses
  seed.mjs             # seeds the admin user
  seed-example.mjs     # fills a product with the Ningbo→Nhava Sheva example
```

---

## 5. Data model (Prisma)

Three models. The complex per-phase data is stored as **JSON columns** that mirror the
TypeScript interfaces in `src/lib/store.tsx` (so the client store maps 1:1 and the schema
stays small). Files (photos/videos/PDF scans) are stored inline as **base64 data URLs**.

- **`User`** — `email`, `name`, `passwordHash`, `role` (ADMIN | EMPLOYEE), `access` (tab keys), `active`.
- **`Product`** — relational `id/name/category/filed` + JSON slices:
  `market`, `supplier`, `compliance`, `costing`, `po`, `payments`, `production`, `qc`,
  `logistics`, `working`, `expenses`.
  - `working` holds the On-Working data incl. **two payments** (product + shipment, each
    with its own currency/total/advance), sample/packaging media galleries, rate term, MOQ.
  - `logistics` holds shipment dims (POL/POD/packages/weight/CBM), shipping agent, movement
    flags, CHA/IGM/BOE/customs, doc uploads (`docImages`), GRN, and the port-to-warehouse cost.
  - `expenses` holds the Order Summary actuals (itemised freight: ocean/DO/THC/CFS/WGMT/GST,
    duty, CHA, last-mile, other, expected revenue).
- **`Manufacturer`** — directory entry (name/type/verification/city/address/cert/rep/catalogs…).

The client store (`store.tsx`) keeps an optimistic local copy, loads from the API on mount,
and **debounce-saves** changes (PATCH/POST/DELETE). Its `StoreShape` interface is the API the
whole UI uses (`useStore()`).

---

## 6. Auth & access

- Real login via **NextAuth** credentials provider; passwords are bcrypt-hashed in the DB.
- `src/middleware.ts` redirects unauthenticated requests to `/login` and gates the API.
- Session carries `role` + `access`; `useCurrentUser()` exposes it. `TabGuard` and the
  sidebar hide tabs an employee can't access. **ADMIN** sees everything.
- Admins manage users at **/users** (create/edit/deactivate/delete, set role + tab access).
- ⚠️ The data APIs are auth-gated but do **not** yet enforce per-tab role checks per request
  (see Known issues).

---

## 7. Setup & running

### Prerequisites
- Node.js (project developed on Windows; in PowerShell prefix commands with
  `$env:Path = "C:\Program Files\nodejs;" + $env:Path` if `node`/`npm` aren't on PATH).
- A PostgreSQL database — **Neon** (free, serverless) is what this uses.

### 1. Install
```bash
npm install
```

### 2. Environment — create `.env` (gitignored; see `.env.example`)
```
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler/DB?sslmode=require"   # pooled (app)
DIRECT_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"            # direct (migrations)
NEXTAUTH_SECRET="<32-byte base64>"   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
NEXTAUTH_URL="http://localhost:3000"
```

### 3. Database
```bash
npm run db:migrate      # apply migrations to the DB
npm run db:seed         # create the admin user
npm run db:seed:example # (optional) fill a demo product "sampoo" with example data
npm run db:studio       # (optional) open Prisma Studio to inspect data
```

### 4. Run
```bash
npm run dev             # http://localhost:3000
```
Log in with **admin@gmail.com / admin@123** (change it after first login).

### Useful scripts
| Script | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate && next build` |
| `npm run typecheck` | `tsc --noEmit` (use this to verify changes) |
| `npm run db:migrate` / `db:push` / `db:studio` / `db:generate` | Prisma helpers |
| `npm run db:seed` / `db:seed:example` | Seed admin / example product |

> Verifying a route compiled: probing a protected page returns **HTTP 307** (redirect to
> login) when unauthenticated — that means it compiled fine, not an error.

---

## 8. Key features (and where they live)

- **Gated pipeline & progress** — `lib/flow.ts` is the single source of truth; the dashboard,
  panels, and Order Summary all read from it so they never disagree.
- **Multi-file uploads** (images/videos/PDF) — `components/media-upload.tsx` (product/sample/
  packaging) and `components/doc-row.tsx` (export & clearance docs).
- **Two payments** (product + shipment, separate currencies) — On-Working → Product Decision
  Rates section (`panels/on-working.tsx`).
- **Costing engine** — `lib/costing.ts` (start from selling price, subtract channel + landed
  costs → net margin → GO/NO-GO).
- **Order Summary P&L** — `lib/order-summary.ts` + `components/order-summary-view.tsx`:
  fully editable inline, itemised cost lines, a **"Show in" currency filter** (converts every
  figure live via `lib/fx.ts`), and per-product totals.
- **Order bill PDF** — `lib/bill.ts` opens a clean invoice-styled HTML in a new window and
  triggers print → "Save as PDF". Cost-only (no profit shown on the bill). Honors the chosen
  display currency; flags pending amount when the product hasn't arrived.
- **Dashboard filters** — search + phase + status + category, in `components/dashboard-view.tsx`.

---

## 9. Known issues / TODO before production

1. **Rotate secrets** — the dev DB password and admin password were shared during development;
   reset both before any public use.
2. ~~**Per-role API enforcement**~~ ✅ **Done.** `/api/products` and `/api/manufacturers` now
   check the caller's tab access server-side via `src/lib/api-guard.ts` (`requireTabAccess`),
   returning 401/403 for callers without the relevant tab. The users API was already admin-only.
3. ~~**`next build` Suspense error**~~ ✅ **Done.** The authenticated `(app)` group is marked
   `export const dynamic = "force-dynamic"` in its layout (it's all session-gated and
   data-driven, so static prerender added no value). `npm run build` now succeeds.
4. **Files in Postgres as base64** — fine for an internal tool at small scale; move to object
   storage (S3 / Supabase Storage) later — the `MediaItem` shape is ready for URLs.
5. **Multi-currency rollups** — cross-product totals sum raw unless converted; the per-product
   sheets convert correctly via the FX filter.

---

## 10. Conventions / skills

The repo carries `.claude/skills/` with project conventions: **db-design** (Postgres+Prisma
patterns), **app-logic** (gated state machine, server-side gates, access control), and
**ui-design** (the design system). Follow these when extending the app.

---

## 11. Deployment (not done yet)

Runs on localhost only. Intended target: **Vercel** + the Neon `DATABASE_URL`/`DIRECT_URL`
and `NEXTAUTH_*` env vars. Fix the Suspense build error (TODO #3) before deploying.
