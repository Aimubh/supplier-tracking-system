---
name: ui-design
description: The "Manifest" design system for the Lazer Believe Sourcing Tracker. Use this whenever building or restyling any UI in this project — new pages, components, forms, tables, modals, or screens — so everything stays visually consistent. Trigger on any request that adds or changes frontend appearance (e.g. "add a payments screen", "build the supplier form", "style this table", "make a modal", "redesign X", "add a tab"), even when the user doesn't mention design explicitly. Covers palette, typography, layout primitives, the signature Seal/stamp element, and Framer Motion animation conventions.
---

# The Manifest Design System

This project's UI is themed as an **import/customs control document** — ink on warm
document paper, with statuses rendered as customs **seals/stamps**. The look is
deliberately *not* a generic SaaS dashboard. Stay in this world: ledger
typography, hairline rules, monospaced figures, and one bold element (the seal).

Why this identity: the product's job is to *gate capital* behind paperwork
checkpoints (sample, compliance, costing, QC). Making the UI feel like a control
document reinforces that every step is a record that releases money or goods.

## Palette (Tailwind tokens, already in `tailwind.config.ts`)

Use the named tokens — never hard-code hex.

- `paper` #F7F5EF — page background (warm document paper)
- `panel` #FCFBF7 — sheets/cards
- `ink` #15130E — primary text, borders, primary buttons
- `muted` #6F6A5C — secondary text, labels
- `rule` #DAD5C7 — all hairline dividers and borders
- `seal` #1F6F5C — CLEARED / GO / PASS (customs green). Soft: `seal-soft`
- `block` #B3412C — BLOCKED / NO-GO / held / errors (oxide red). Soft: `block-soft`
- `stamp` #C8902A — pending / on-hold / in-transit / gate marker (ochre). Soft: `stamp-soft`

Semantics matter: green = cleared/go, red = blocked/no-go, ochre = pending/gate.
Don't introduce blue/indigo/violet — that was the rejected generic look.

## Typography (fonts wired in `src/app/layout.tsx`)

- `font-display` (Archivo) — headings, titles, brand. Bold/extrabold, tight tracking.
- `font-body` (IBM Plex Sans) — body copy, descriptions.
- `font-mono` (IBM Plex Mono) — **every figure, money value, reference number, code,
  count, ID, and label**. Money reads like a ledger. Use `.figure` (mono + tabular-nums).

Type scale: page titles `text-2xl font-extrabold`; section/card titles
`font-display text-[15px] font-bold`; body `text-[12.5px]`–`text-[13px]`; labels via
`.eyebrow`.

## Layout primitives (CSS in `src/app/globals.css`)

- `.paper-bg` — the ruled document background (on the app shell).
- `.sheet` — a panel/card: panel bg, `rule` border, soft `shadow-doc`. Use instead of
  ad-hoc card classes. Corners are subtle: `rounded-sm`.
- `.eyebrow` — small uppercase mono classification label (e.g. "PHASE A · PRE-ORDER",
  "STEPS", "STATUS"). Use these to *classify* content, not decorate.
- `.figure` — monospaced tabular figure.
- `.rule` — hairline border color helper.

Structure with **hairline rules and eyebrow labels**, like a form. Tables get ruled
column headers (No. / Item / Status). Numbering is allowed because the process genuinely
is an ordered sequence — render numbers as zero-padded mono (`01`, `02`).

## Signature element — the Seal

`src/components/seal.tsx` exports `<Seal>` (rotated, double-ruled customs stamp) and
`<Chip>` (flat status pill). This is the ONE bold element — spend boldness here, keep
everything else quiet.

- Gate markers: `<Seal label="Gate" tone="stamp" mark="✷" />`
- Outcomes: `tone="seal"` (◉ cleared/go/pass), `tone="block"` (✕ blocked/no-go),
  `tone="stamp"` (● pending). `<Chip>` for dense rows where a rotated stamp is noisy.

Don't reinvent status badges — reuse `Seal`/`Chip`.

## Motion (Framer Motion via `motion/react`)

Primitives live in `src/components/motion.tsx`: `Reveal`, `Stagger`, `Item`, and
variants `riseItem`, `stampItem`, `staggerParent`. Also `page-enter.tsx`
(`PageEnter`/`EnterItem`) and `count-up.tsx` (`CountUp` for animated figures).

Conventions:
- Motion should feel like a document being filled: things **rise + settle**, seals
  **stamp in** (`stampItem` — oversize → spring to rest).
- Page load: stagger the masthead/sections. Scroll-in: `Reveal`/`Stagger`. Active
  nav markers: shared `layoutId` so they slide between items.
- ALWAYS respect reduced motion: every primitive already checks
  `useReducedMotion()` and renders static. New animated components must do the same.
- Keep it purposeful. One orchestrated moment beats scattered effects.

## Building a new screen — checklist

1. Wrap content in the app shell (it provides `.paper-bg` + sidebar). Add a route
   under `src/app/(app)/`.
2. Start with `<PageHeader eyebrow="…" title="…" subtitle="…" section="…" />`.
3. Build panels as `.sheet` with `rounded-sm`, hairline `rule` dividers, `.eyebrow`
   section labels.
4. All numbers/money/refs in `.figure` (mono).
5. Statuses via `Seal`/`Chip` with the correct tone semantics.
6. Add restrained motion via the existing primitives; respect reduced motion.
7. Gate-related UI uses `stamp` ochre and the lock idiom.
8. Quality floor: responsive to mobile, visible keyboard focus
   (`focus:ring-1 focus:ring-ink`), good contrast.

## Reference components to copy patterns from

- `src/components/page-header.tsx` — animated document header
- `src/components/sub-tabs.tsx` — left step-nav + animated content panel
- `src/components/step-list.tsx` — manifest table with staggered rows + gate seals
- `src/components/sidebar.tsx` — masthead + section index + signatory block
- `src/components/login-form.tsx` — form fields, the AUTHORISED stamp overlay

When in doubt, match these. Consistency is the point.
