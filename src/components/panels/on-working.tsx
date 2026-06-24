"use client";

import { Check, X, Truck, PackageCheck } from "lucide-react";
import { useStore, type Working, type CurrencyCode } from "@/lib/store";
import { Field, Text, Num, Select, Toggle, Stat, PanelHead } from "../fields";
import { MediaUpload } from "../media-upload";
import { CurrencyConverter } from "../currency-converter";
import { Countdown } from "../countdown";
import { useDraft } from "../use-draft";
import { SaveBar } from "../save-bar";

const CURRENCY_SYMBOL: Record<CurrencyCode, string> = { USD: "$", INR: "₹", CNY: "¥" };

// What each Incoterm already covers vs. what the buyer still has to add on top.
// Drives the cost note under the Rates section so the order total isn't mistaken
// for the true landed cost.
const INCOTERM_NOTE: Record<string, { covers: string; add: string }> = {
  EXW: {
    covers: "Goods only, at the supplier's door.",
    add: "You still add export clearance, freight, insurance, duty + IGST.",
  },
  FCA: {
    covers: "Goods + delivery to the named carrier + export clearance.",
    add: "You still add main freight, insurance, duty + IGST.",
  },
  FOB: {
    covers: "Goods loaded onto the ship + export clearance at origin.",
    add: "You still add sea freight, insurance, duty + IGST.",
  },
  CIF: {
    covers: "Goods + sea freight + insurance to your destination port.",
    add: "You still add customs duty + IGST and last-mile/CHA.",
  },
};

// Shared helper: a draft over the active product's `working` slice.
function useWorkingDraft() {
  const { active, patch } = useStore();
  const d = useDraft<Working>(
    active?.working ?? ({} as Working),
    (active?.id ?? "") + ":working"
  );
  return { active, patch, ...d };
}

// Small section heading inside the combined panel.
function SubHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 mt-7 border-t border-line pt-5 first:mt-0 first:border-0 first:pt-0">
      <h3 className="font-display text-[16px] font-medium text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

// ---- Step 1: Product Decision (Sample + MOQ + Rates + Mould) -------------------
export function ProductDecisionPanel() {
  const { active, patch, draft, setField, dirty, saved, flashSaved, discard } = useWorkingDraft();
  const { uid } = useStore();
  if (!active) return null;
  const w = draft;

  // Approval is a decision recorded on the draft (committed via Save like the rest).
  function approve() {
    setField("sampleResult", "APPROVED");
  }
  function reject() {
    setField("sampleResult", "REJECTED");
  }

  return (
    <div>
      <PanelHead
        title="Product Decision"
        desc="The core buy decision in one place — sample check, order quantity, rate term, and mould setup."
        right={
          <span
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider ${
              w.sampleResult === "APPROVED"
                ? "bg-go/15 text-go ring-1 ring-inset ring-go/30"
                : w.sampleResult === "REJECTED"
                  ? "bg-block/15 text-block ring-1 ring-inset ring-block/30"
                  : "bg-surface text-muted ring-1 ring-inset ring-line"
            }`}
          >
            {w.sampleResult === "APPROVED" ? "● Approved" : w.sampleResult === "REJECTED" ? "✕ Rejected" : "— pending"}
          </span>
        }
      />

      {/* Sample check */}
      <SubHead title="Sample check" hint="Add product & sample media, then approve or reject. Rejected samples stay in the catalog." />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <MediaUpload
          label="Product photos / videos"
          items={w.productMedia ?? []}
          onChange={(next) => setField("productMedia", next)}
          uid={uid}
        />
        <MediaUpload
          label="Sample photos / videos"
          items={w.sampleMedia ?? []}
          onChange={(next) => setField("sampleMedia", next)}
          uid={uid}
        />
      </div>
      <div className="mt-4">
        <Field label="Sample notes (quality observations)">
          <Text value={w.sampleNotes} onChange={(v) => setField("sampleNotes", v)} placeholder="finish, feel, colour match…" />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={approve}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition ${
            w.sampleResult === "APPROVED"
              ? "bg-go/20 text-go ring-1 ring-inset ring-go/40"
              : "bg-surface text-body ring-1 ring-inset ring-line hover:bg-go/10 hover:text-go"
          }`}
        >
          <Check className="h-4 w-4" /> Approve sample
        </button>
        <button
          onClick={reject}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition ${
            w.sampleResult === "REJECTED"
              ? "bg-block/20 text-block ring-1 ring-inset ring-block/40"
              : "bg-surface text-body ring-1 ring-inset ring-line hover:bg-block/10 hover:text-block"
          }`}
        >
          <X className="h-4 w-4" /> Reject sample
        </button>
      </div>
      {w.sampleResult === "REJECTED" && (
        <div className="mt-4">
          <Field label="Reject reason (stored in catalog)">
            <Text value={w.rejectReason} onChange={(v) => setField("rejectReason", v)} placeholder="why it was rejected…" />
          </Field>
          <p className="mt-2 text-[12px] text-block">
            This product is kept in the catalog as rejected — the record stays for future reference.
          </p>
        </div>
      )}

      {/* MOQ decision */}
      <SubHead title="MOQ decision" hint="Decide the order quantity. The first order is a test of demand, not a bet on volume." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Order quantity (units)">
          <Num value={w.moq} onChange={(v) => setField("moq", v)} placeholder="0" blankZero />
        </Field>
        <Field label="Decision note">
          <Text value={w.moqNote} onChange={(v) => setField("moqNote", v)} placeholder="test batch / negotiated MOQ…" />
        </Field>
      </div>
      <div className="mt-4 sm:max-w-xs">
        <Stat label="Decided quantity" value={w.moq ? w.moq.toLocaleString() : "—"} tone={w.moq ? "go" : "default"} />
      </div>

      {/* Rates */}
      <SubHead title="Rates" hint="Lock the rate term, total amount and advance — the split is calculated for you." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Rate term">
          <Select
            value={w.rate}
            onChange={(v) => setField("rate", v)}
            options={[
              { value: "FOB", label: "FOB — free on board" },
              { value: "CIF", label: "CIF — cost, insurance, freight" },
              { value: "EXW", label: "EXW — ex works" },
              { value: "FCA", label: "FCA — free carrier" },
            ]}
          />
        </Field>
        <Field label={`Total amount (${w.rate})`}>
          <Num value={w.rateValue} onChange={(v) => setField("rateValue", v)} prefix={CURRENCY_SYMBOL[w.rateCurrency ?? "USD"]} placeholder="0" blankZero />
        </Field>
        <Field label="Advance paid">
          <Num value={w.advancePaid} onChange={(v) => setField("advancePaid", v)} prefix={CURRENCY_SYMBOL[w.rateCurrency ?? "USD"]} placeholder="0" blankZero />
        </Field>
      </div>

      {/* Auto advance / pending split + what the Incoterm covers */}
      {(() => {
        const sym = CURRENCY_SYMBOL[w.rateCurrency ?? "USD"];
        const cur = w.rateCurrency ?? "USD";
        const total = w.rateValue || 0;
        const advance = Math.min(w.advancePaid || 0, total); // never more than total
        const pending = Math.max(total - advance, 0);
        const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
        const note = INCOTERM_NOTE[w.rate];
        const fmt = (n: number) => `${sym} ${n.toLocaleString()} ${cur}`;
        return (
          <div className="mt-4 rounded-md border border-line bg-surface p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-line bg-white px-3.5 py-3">
                <p className="eyebrow">Total · 100%</p>
                <p className="figure mt-0.5 text-[16px] font-semibold text-ink">{total > 0 ? fmt(total) : "—"}</p>
              </div>
              <div className="rounded-md border border-line bg-white px-3.5 py-3">
                <p className="eyebrow">Advance · {pctOf(advance)}%</p>
                <p className="figure mt-0.5 text-[16px] font-semibold text-go">{total > 0 ? fmt(advance) : "—"}</p>
              </div>
              <div className="rounded-md border border-line bg-white px-3.5 py-3">
                <p className="eyebrow">Pending · {pctOf(pending)}%</p>
                <p className={`figure mt-0.5 text-[16px] font-semibold ${pending > 0 ? "text-pending" : "text-go"}`}>
                  {total > 0 ? fmt(pending) : "—"}
                </p>
              </div>
            </div>

            {/* Split bar */}
            {total > 0 && (
              <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-surface-strong">
                <div className="h-full bg-go" style={{ width: `${pctOf(advance)}%` }} />
                <div className="h-full bg-pending" style={{ width: `${pctOf(pending)}%` }} />
              </div>
            )}

            {note && (
              <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed">
                <p className="text-body">
                  <span className="font-semibold text-go">{w.rate} includes:</span> {note.covers}
                </p>
                <p className="mt-1 text-pending">
                  <span className="font-semibold">Not included:</span> {note.add}
                </p>
                <p className="mt-1.5 text-muted">
                  This is the goods order value only — see the Pre-Order · Costing tab for the full landed cost and GO / NO-GO.
                </p>
              </div>
            )}
          </div>
        );
      })()}

      <div className="mt-4">
        <CurrencyConverter
          amount={w.rateValue}
          currency={w.rateCurrency ?? "USD"}
          onCurrencyChange={(c) => setField("rateCurrency", c)}
        />
      </div>

      {/* Mould setup */}
      <SubHead title="Mould setup" hint="Tick if mould / tooling setup is applicable for this product." />
      <Toggle on={w.moldRequired} onChange={(v) => setField("moldRequired", v)} label="Mould / tooling setup applicable" />

      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("working", draft); flashSaved(); }} onDiscard={discard} tab="on-working" />
    </div>
  );
}

// ---- Step 2: Design Processing (Packaging design + Order processing) ----------
export function DesignProcessingPanel() {
  const { active, patch, draft, setField, dirty, saved, flashSaved, discard } = useWorkingDraft();
  const { uid } = useStore();
  if (!active) return null;
  const w = draft;

  // Approve / reject the uploaded logo & packaging proofs. Approval also flips
  // the derived packagingDone flag that the dispatch gate and dashboard read.
  function approve() {
    setField("packagingResult", "APPROVED");
    setField("packagingDone", true);
  }
  function reject() {
    setField("packagingResult", "REJECTED");
    setField("packagingDone", false);
  }

  return (
    <div>
      <PanelHead
        title="Design Processing"
        desc="Approve the logo / packaging proofs, then put the order into processing and start the production countdown."
        right={
          <span
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider ${
              w.packagingResult === "APPROVED"
                ? "bg-go/15 text-go ring-1 ring-inset ring-go/30"
                : w.packagingResult === "REJECTED"
                  ? "bg-block/15 text-block ring-1 ring-inset ring-block/30"
                  : "bg-surface text-muted ring-1 ring-inset ring-line"
            }`}
          >
            {w.packagingResult === "APPROVED" ? "● Approved" : w.packagingResult === "REJECTED" ? "✕ Rejected" : "— pending"}
          </span>
        }
      />

      {/* Packaging design */}
      <SubHead title="Packaging design" hint="Upload the logo & packaging proofs, then approve or reject the design." />
      <MediaUpload
        label="Logo & packaging proofs (photos / videos / PDF)"
        items={w.packagingMedia ?? []}
        onChange={(next) => setField("packagingMedia", next)}
        uid={uid}
      />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={approve}
          disabled={(w.packagingMedia ?? []).length === 0}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            w.packagingResult === "APPROVED"
              ? "bg-go/20 text-go ring-1 ring-inset ring-go/40"
              : "bg-surface text-body ring-1 ring-inset ring-line hover:bg-go/10 hover:text-go"
          }`}
        >
          <Check className="h-4 w-4" /> Approve logo
        </button>
        <button
          onClick={reject}
          disabled={(w.packagingMedia ?? []).length === 0}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            w.packagingResult === "REJECTED"
              ? "bg-block/20 text-block ring-1 ring-inset ring-block/40"
              : "bg-surface text-body ring-1 ring-inset ring-line hover:bg-block/10 hover:text-block"
          }`}
        >
          <X className="h-4 w-4" /> Reject logo
        </button>
      </div>
      {(w.packagingMedia ?? []).length === 0 && (
        <p className="mt-2 text-[12px] text-muted">Upload at least one proof before approving or rejecting.</p>
      )}
      {w.packagingResult === "REJECTED" && (
        <div className="mt-4">
          <Field label="Reject reason (what to fix)">
            <Text value={w.packagingRejectReason} onChange={(v) => setField("packagingRejectReason", v)} placeholder="colour off, wrong logo placement…" />
          </Field>
        </div>
      )}

      {/* Order processing */}
      <SubHead title="Order processing" hint="Mark the order in processing and set the production-ready date to start the countdown." />
      <Toggle on={w.orderProcessing} onChange={(v) => setField("orderProcessing", v)} label="Order in processing" />
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Production start date">
          <input
            type="date"
            value={w.productionStart}
            onChange={(e) => setField("productionStart", e.target.value)}
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          />
        </Field>
        <Field label="Production ready date (countdown target)">
          <input
            type="date"
            value={w.productionReady}
            onChange={(e) => setField("productionReady", e.target.value)}
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          />
        </Field>
      </div>
      <div className="mt-5">
        <p className="eyebrow mb-2">Production time</p>
        <Countdown target={w.productionReady} />
      </div>

      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("working", draft); flashSaved(); }} onDiscard={discard} tab="on-working" />
    </div>
  );
}

// ---- Step 3: Dispatch (GATE) --------------------------------------------------
export function DispatchPanel() {
  const { active, patch, draft, setField, dirty, saved, flashSaved, discard } = useWorkingDraft();
  if (!active) return null;
  const w = draft;
  const sampleOk = w.sampleResult === "APPROVED";

  return (
    <div>
      <PanelHead title="Dispatch" desc="Mark the goods dispatched once production is complete." />
      <div className="mb-4 space-y-2 sm:max-w-md">
        <GateRow label="Sample approved" ok={sampleOk} />
        <GateRow label="Order processed" ok={w.orderProcessing} />
        <GateRow label="Packaging approved" ok={w.packagingDone} />
      </div>
      <button
        onClick={() => setField("dispatched", !w.dispatched)}
        disabled={!sampleOk}
        className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition ${
          w.dispatched
            ? "bg-go/15 text-go ring-1 ring-inset ring-go/30"
            : sampleOk
              ? "bg-ink text-white hover:brightness-110"
              : "cursor-not-allowed bg-surface text-line-strong"
        }`}
      >
        {w.dispatched ? <PackageCheck className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
        {w.dispatched ? "Products dispatched" : "Mark products dispatched now"}
      </button>
      {!sampleOk && <p className="mt-2 text-[12px] text-muted">Approve the sample (step 1) before dispatching.</p>}
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("working", draft); flashSaved(); }} onDiscard={discard} tab="on-working" />
    </div>
  );
}

function GateRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
      <span className="text-[13px] text-body">{label}</span>
      <span className={`figure rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${ok ? "bg-go/15 text-go" : "bg-block/15 text-block"}`}>
        {ok ? "✓ done" : "✕ pending"}
      </span>
    </div>
  );
}
