"use client";

// Sourcing Model panel (Pre-Order). An in-app replica of the LAZERECOM workbook:
// editable per-SKU inputs + assumptions on the left, and the live landed-cost
// build-up, per-channel contribution, and GO / NO-GO decision on the right.
// All figures are computed by src/lib/sourcing-model.ts (never stored).

import { useState } from "react";
import { useStore, type Sourcing } from "@/lib/store";
import {
  computeSourcing,
  type ChannelResult,
  type SourcingAssumptions,
  type SourcingInputs,
} from "@/lib/sourcing-model";
import { Field, Text, Num, Stat, PanelHead } from "../fields";
import { Seal, Chip } from "../seal";
import { useDraft } from "../use-draft";
import { SaveBar } from "../save-bar";

// Display helpers — keep money reading like a ledger.
const inr = (n: number) =>
  "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const usd = (n: number) => "$" + (Number.isFinite(n) ? n : 0).toFixed(2);
const pct = (n: number) => (Number.isFinite(n) ? (n * 100).toFixed(1) : "0.0") + "%";

export function SourcingPanel() {
  const { active, patch } = useStore();
  const { draft, setAll, dirty, saved, flashSaved, discard } = useDraft<Sourcing>(
    active?.sourcing ?? ({} as Sourcing),
    (active?.id ?? "") + ":sourcing"
  );
  const [showAssumptions, setShowAssumptions] = useState(false);
  if (!active) return null;

  const a = draft.assumptions;
  const i = draft.inputs;
  const result = computeSourcing(a, i);

  const setInput = <K extends keyof SourcingInputs>(k: K, v: SourcingInputs[K]) =>
    setAll({ ...draft, inputs: { ...i, [k]: v } });
  const setAssume = <K extends keyof SourcingAssumptions>(k: K, v: SourcingAssumptions[K]) =>
    setAll({ ...draft, assumptions: { ...a, [k]: v } });

  const verdictTone =
    result.verdict === "GO" ? "seal" : result.verdict === "NO_GO" ? "block" : "stamp";
  const verdictMark = result.verdict === "GO" ? "◉" : result.verdict === "NO_GO" ? "✕" : "●";

  return (
    <div>
      <PanelHead
        title="Sourcing model"
        desc="Per-SKU landed cost and channel margins, costed backwards from the selling price. The verdict is GO when at least one channel clears the target margin."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
        {/* ---- Left: SKU inputs ---- */}
        <div className="space-y-5">
          <section className="sheet rounded-sm p-4">
            <p className="eyebrow mb-3">SKU · Identity</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Item name">
                <Text value={i.itemName} onChange={(v) => setInput("itemName", v)} placeholder="Silicone Phone Lanyard" />
              </Field>
              <Field label="Variant / spec">
                <Text value={i.variant} onChange={(v) => setInput("variant", v)} placeholder="laser logo" />
              </Field>
              <Field label="Colour">
                <Text value={i.colour} onChange={(v) => setInput("colour", v)} placeholder="black" />
              </Field>
              <Field label="HSN code">
                <Text value={i.hsnCode} onChange={(v) => setInput("hsnCode", v)} placeholder="3926" />
              </Field>
              <Field label="Size / dimension">
                <Text value={i.size} onChange={(v) => setInput("size", v)} placeholder="84×530 mm" />
              </Field>
              <Field label="Unit weight (g)">
                <Num value={i.unitWeightG} onChange={(v) => setInput("unitWeightG", v)} blankZero />
              </Field>
            </div>
          </section>

          <section className="sheet rounded-sm p-4">
            <p className="eyebrow mb-3">Costing inputs</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="FOB / ex-works ($/piece)">
                <Num value={i.fobUsd} onChange={(v) => setInput("fobUsd", v)} prefix="$" blankZero />
              </Field>
              <Field label="Order qty (pieces)">
                <Num value={i.orderQty} onChange={(v) => setInput("orderQty", v)} blankZero />
              </Field>
              <Field label="Sell price IN (₹ incl GST)">
                <Num value={i.sellPriceInr} onChange={(v) => setInput("sellPriceInr", v)} prefix="₹" blankZero />
              </Field>
              <Field label="Sell price UAE (AED)">
                <Num value={i.sellPriceAed} onChange={(v) => setInput("sellPriceAed", v)} blankZero />
              </Field>
              <Field label="Freight % override" hint="blank = use assumption">
                <Num
                  value={i.freightPctOverride ?? 0}
                  onChange={(v) => setInput("freightPctOverride", v || null)}
                  blankZero
                  step="0.01"
                />
              </Field>
              <Field label="BCD % override" hint="blank = use assumption">
                <Num
                  value={i.bcdPctOverride ?? 0}
                  onChange={(v) => setInput("bcdPctOverride", v || null)}
                  blankZero
                  step="0.01"
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Reference Amazon link">
                <Text
                  value={i.referenceAmazonLink}
                  onChange={(v) => setInput("referenceAmazonLink", v)}
                  placeholder="https://www.amazon.in/s?k=…"
                />
              </Field>
            </div>
          </section>

          {/* ---- Assumptions (collapsible) ---- */}
          <section className="sheet rounded-sm p-4">
            <button
              type="button"
              onClick={() => setShowAssumptions((s) => !s)}
              className="flex w-full items-center justify-between focus:outline-none focus:ring-1 focus:ring-ink"
            >
              <span className="eyebrow">Assumptions · drivers</span>
              <span className="figure text-[12px] text-muted">{showAssumptions ? "Hide −" : "Edit +"}</span>
            </button>
            {showAssumptions && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="USD → INR"><Num value={a.usdToInr} onChange={(v) => setAssume("usdToInr", v)} /></Field>
                <Field label="USD → AED"><Num value={a.usdToAed} onChange={(v) => setAssume("usdToAed", v)} /></Field>
                <Field label="Freight % IN"><Num value={a.freightPctIndia} onChange={(v) => setAssume("freightPctIndia", v)} step="0.01" /></Field>
                <Field label="Clearance %"><Num value={a.clearancePct} onChange={(v) => setAssume("clearancePct", v)} step="0.01" /></Field>
                <Field label="BCD %"><Num value={a.bcdPct} onChange={(v) => setAssume("bcdPct", v)} step="0.01" /></Field>
                <Field label="SWS %"><Num value={a.swsPct} onChange={(v) => setAssume("swsPct", v)} step="0.01" /></Field>
                <Field label="GST sale %"><Num value={a.gstSalePct} onChange={(v) => setAssume("gstSalePct", v)} step="0.01" /></Field>
                <Field label="Amazon referral %"><Num value={a.amazonReferralPct} onChange={(v) => setAssume("amazonReferralPct", v)} step="0.01" /></Field>
                <Field label="Amazon fixed ₹"><Num value={a.amazonFixedFee} onChange={(v) => setAssume("amazonFixedFee", v)} /></Field>
                <Field label="Ad %"><Num value={a.adPct} onChange={(v) => setAssume("adPct", v)} step="0.01" /></Field>
                <Field label="Q-Comm take %"><Num value={a.qCommTakePct} onChange={(v) => setAssume("qCommTakePct", v)} step="0.01" /></Field>
                <Field label="Q-Comm floor %"><Num value={a.qCommFloorPct} onChange={(v) => setAssume("qCommFloorPct", v)} step="0.01" /></Field>
                <Field label="UAE referral %"><Num value={a.uaeReferralPct} onChange={(v) => setAssume("uaeReferralPct", v)} step="0.01" /></Field>
                <Field label="UAE fulfil AED"><Num value={a.uaeFulfilAed} onChange={(v) => setAssume("uaeFulfilAed", v)} /></Field>
                <Field label="UAE duty %"><Num value={a.uaeDutyPct} onChange={(v) => setAssume("uaeDutyPct", v)} step="0.01" /></Field>
                <Field label="UAE VAT %"><Num value={a.uaeVatPct} onChange={(v) => setAssume("uaeVatPct", v)} step="0.01" /></Field>
                <Field label="Freight % UAE"><Num value={a.freightPctUae} onChange={(v) => setAssume("freightPctUae", v)} step="0.01" /></Field>
                <Field label="Target margin %"><Num value={a.targetMarginPct} onChange={(v) => setAssume("targetMarginPct", v)} step="0.01" /></Field>
              </div>
            )}
          </section>
        </div>

        {/* ---- Right: decision + computed figures ---- */}
        <div className="space-y-5">
          <section className="sheet rounded-sm p-5">
            <p className="eyebrow mb-2">Decision</p>
            <div className="flex items-baseline justify-between">
              <Seal label={result.verdict.replace("_", "-")} tone={verdictTone} mark={verdictMark} className="text-[20px] font-semibold" />
              <span className="figure text-[13px] text-muted">
                {result.primaryChannel
                  ? result.channels.find((c) => c.channel === result.primaryChannel)?.label
                  : "—"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="Best contribution" value={pct(result.bestContributionPct)} tone={result.verdict === "GO" ? "go" : result.verdict === "NO_GO" ? "block" : "pending"} />
              <Stat label="Max FOB @ target" value={usd(result.maxFobUsd)} />
            </div>
          </section>

          <section className="sheet rounded-sm p-5">
            <p className="eyebrow mb-3">Landed cost (₹/piece)</p>
            <Row label="CIF" value={inr(result.cifInr)} />
            <Row label="Duty (BCD + SWS)" value={inr(result.dutyInr)} />
            <Row label="Clearance" value={inr(result.clearanceInr)} />
            <div className="my-2 border-t border-rule" />
            <Row label="LANDED / piece" value={inr(result.landedInr)} strong />
            <Row label="Total landed" value={inr(result.totalLandedInr)} hint={`× ${i.orderQty || 0} pcs`} />
          </section>

          <section className="sheet rounded-sm p-5">
            <p className="eyebrow mb-3">Channels · contribution</p>
            <div className="space-y-2.5">
              {result.channels.map((c) => (
                <ChannelRow key={c.channel} c={c} />
              ))}
            </div>
          </section>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        saved={saved}
        onSave={() => {
          patch("sourcing", draft);
          flashSaved();
        }}
        onDiscard={discard}
        tab="pre-order"
      />
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={strong ? "text-[13px] font-semibold text-ink" : "text-[13px] text-muted"}>
        {label}
        {hint && <span className="figure ml-2 text-[11px] text-muted">{hint}</span>}
      </span>
      <span className={`figure ${strong ? "text-[15px] font-semibold text-ink" : "text-[13px] text-body"}`}>
        {value}
      </span>
    </div>
  );
}

function ChannelRow({ c }: { c: ChannelResult }) {
  const tone = c.clearsTarget ? "seal" : c.contributionPct > 0 ? "stamp" : "block";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-body">{c.label}</span>
      <div className="flex items-center gap-3">
        <span className="figure text-[13px] text-ink">{pct(c.contributionPct)}</span>
        <Chip label={c.clearsTarget ? "CLEARS" : c.contributionPct > 0 ? "LOW" : "LOSS"} tone={tone} />
      </div>
    </div>
  );
}
