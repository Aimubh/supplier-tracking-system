"use client";

import { Plus, Trash2 } from "lucide-react";
import { useStore, type MarketEntry } from "@/lib/store";
import { computeCosting } from "@/lib/costing";
import { Field, Text, Num, Select, Toggle, Stat, PanelHead } from "../fields";
import { useDraft } from "../use-draft";
import { SaveBar } from "../save-bar";

// ---- Step 1: Market check -----------------------------------------------------
export function MarketPanel() {
  const { active, patch, uid } = useStore();
  const { draft, setAll, dirty, saved, flashSaved, discard } = useDraft(
    active?.market ?? [],
    (active?.id ?? "") + ":market"
  );
  if (!active) return null;

  const add = () =>
    setAll([...draft, { id: uid("m"), channel: "", competitorPrice: 0, demandPerMonth: 0 }]);
  const update = (id: string, k: keyof MarketEntry, v: string | number) =>
    setAll(draft.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const remove = (id: string) => setAll(draft.filter((r) => r.id !== id));

  return (
    <div>
      <PanelHead
        title="Market check"
        desc="Competitor prices and realistic demand on each channel we'd sell on. This sets the selling price we cost backwards from."
        right={
          <button
            onClick={add}
            className="flex items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-[12px] font-semibold text-ink ring-1 ring-inset ring-line hover:bg-surface"
          >
            <Plus className="h-3.5 w-3.5" /> Add channel
          </button>
        }
      />
      {draft.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center text-[13px] text-muted">
          No channels yet. Add the marketplaces you'd sell this on.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_140px_140px_40px] gap-3 px-1">
            <span className="eyebrow">Channel</span>
            <span className="eyebrow">Competitor ₹</span>
            <span className="eyebrow">Demand / mo</span>
            <span />
          </div>
          {draft.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_140px_140px_40px] items-center gap-3">
              <Text value={r.channel} onChange={(v) => update(r.id, "channel", v)} placeholder="Amazon IN" />
              <Num value={r.competitorPrice} onChange={(v) => update(r.id, "competitorPrice", v)} prefix="₹" />
              <Num value={r.demandPerMonth} onChange={(v) => update(r.id, "demandPerMonth", v)} />
              <button onClick={() => remove(r.id)} className="text-line-strong hover:text-block">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <SaveBar
        dirty={dirty}
        saved={saved}
        onSave={() => {
          patch("market", draft);
          flashSaved();
        }}
        onDiscard={discard}
        tab="pre-order"
      />
    </div>
  );
}

// ---- Step 2: Supplier vetting -------------------------------------------------
export function SupplierPanel() {
  const { active, patch } = useStore();
  const { draft, setField, dirty, saved, flashSaved, discard } = useDraft(
    active?.supplier ?? ({} as NonNullable<typeof active>["supplier"]),
    (active?.id ?? "") + ":supplier"
  );
  if (!active) return null;
  const s = draft;

  return (
    <div>
      <PanelHead
        title="Find and vet the supplier"
        desc="Confirm it's a real factory, not a middleman. Verification is a gate input for ordering."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company name">
          <Text value={s.name} onChange={(v) => setField("name", v)} placeholder="Shenzhen … Co., Ltd" />
        </Field>
        <Field label="Type">
          <Select
            value={s.type}
            onChange={(v) => setField("type", v)}
            options={[
              { value: "FACTORY", label: "Factory" },
              { value: "TRADING", label: "Trading company" },
              { value: "UNKNOWN", label: "Unknown" },
            ]}
          />
        </Field>
        <Field label="Contact (WeChat / email)">
          <Text value={s.contact} onChange={(v) => setField("contact", v)} placeholder="wechat / email" />
        </Field>
        <Field label="Verification status">
          <Select
            value={s.verification}
            onChange={(v) => setField("verification", v)}
            options={[
              { value: "UNVERIFIED", label: "Unverified" },
              { value: "IN_REVIEW", label: "In review" },
              { value: "VERIFIED", label: "Verified" },
            ]}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Notes / red flags">
          <textarea
            value={s.notes}
            onChange={(e) => setField("notes", e.target.value)}
            rows={3}
            placeholder="Business licence checked, track record, audit…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          />
        </Field>
      </div>
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("supplier", draft); flashSaved(); }} onDiscard={discard} tab="pre-order" />
    </div>
  );
}

// ---- Step 3: Compliance (GATE) ------------------------------------------------
export function CompliancePanel() {
  const { active, patch } = useStore();
  const { draft, setField, dirty, saved, flashSaved, discard } = useDraft(
    active?.compliance ?? ({} as NonNullable<typeof active>["compliance"]),
    (active?.id ?? "") + ":compliance"
  );
  if (!active) return null;
  const c = draft;

  return (
    <div>
      <PanelHead
        title="Check compliance"
        desc="HS code, duty / GST, and whether it needs BIS or an import licence — confirmed BEFORE ordering, not at customs."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="HS code">
          <Text value={c.hsCode} onChange={(v) => setField("hsCode", v)} placeholder="3924.10.00" />
        </Field>
        <Field label="Basic duty %">
          <Num value={c.dutyRatePct} onChange={(v) => setField("dutyRatePct", v)} prefix="%" />
        </Field>
        <Field label="IGST %">
          <Num value={c.igstRatePct} onChange={(v) => setField("igstRatePct", v)} prefix="%" />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <Toggle on={c.licenceRequired} onChange={(v) => setField("licenceRequired", v)} label="BIS / import licence required" />
        {c.licenceRequired && (
          <div className="w-48">
            <Select
              value={c.licenceStatus}
              onChange={(v) => setField("licenceStatus", v)}
              options={[
                { value: "PENDING", label: "Licence pending" },
                { value: "OBTAINED", label: "Licence obtained" },
              ]}
            />
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => setField("status", c.status === "CLEARED" ? "BLOCKED" : "CLEARED")}
          className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition ${
            c.status === "CLEARED"
              ? "bg-go/15 text-go ring-1 ring-inset ring-go/30"
              : "bg-block/15 text-block ring-1 ring-inset ring-block/30"
          }`}
        >
          {c.status === "CLEARED" ? "● Compliance cleared" : "✕ Blocked — mark cleared"}
        </button>
        <span className="text-[12px] text-muted">Ordering is blocked until this clears.</span>
      </div>
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("compliance", draft); flashSaved(); }} onDiscard={discard} tab="pre-order" />
    </div>
  );
}

// ---- Step 4: Costing (GATE) ---------------------------------------------------
export function CostingPanel() {
  const { active, patch } = useStore();
  const { draft, setField, dirty, saved, flashSaved, discard } = useDraft(
    active?.costing ?? ({} as NonNullable<typeof active>["costing"]),
    (active?.id ?? "") + ":costing"
  );
  if (!active) return null;
  const c = draft;
  const r = computeCosting(c, active.compliance.dutyRatePct, active.compliance.igstRatePct);

  return (
    <div>
      <PanelHead
        title="Costing check — go / no-go"
        desc="Work the price backwards: start from the channel selling price, subtract every cost, and the margin decides. Duty & IGST pull from the saved Compliance step."
        right={
          <span
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider ${
              r.verdict === "GO"
                ? "bg-go/15 text-go ring-1 ring-inset ring-go/30"
                : r.verdict === "NO_GO"
                  ? "bg-block/15 text-block ring-1 ring-inset ring-block/30"
                  : "bg-surface text-muted ring-1 ring-inset ring-line"
            }`}
          >
            {r.verdict === "GO" ? "● GO" : r.verdict === "NO_GO" ? "✕ NO-GO" : "— pending"}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Marketplace">
            <Text value={c.marketplace} onChange={(v) => setField("marketplace", v)} placeholder="AMAZON_IN" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Selling price (₹)" hint="realistic clearing price">
              <Num value={c.sellingPrice} onChange={(v) => setField("sellingPrice", v)} prefix="₹" />
            </Field>
            <Field label="Ex-works / unit (₹)" hint="supplier quote">
              <Num value={c.exWorks} onChange={(v) => setField("exWorks", v)} prefix="₹" />
            </Field>
            <Field label="Freight / unit (₹)">
              <Num value={c.freightPerUnit} onChange={(v) => setField("freightPerUnit", v)} prefix="₹" />
            </Field>
            <Field label="Fulfilment fee (₹)">
              <Num value={c.fulfilmentFee} onChange={(v) => setField("fulfilmentFee", v)} prefix="₹" />
            </Field>
            <Field label="Referral %">
              <Num value={c.referralPct} onChange={(v) => setField("referralPct", v)} prefix="%" />
            </Field>
            <Field label="Ad / TACOS %">
              <Num value={c.adPct} onChange={(v) => setField("adPct", v)} prefix="%" />
            </Field>
            <Field label="Returns %">
              <Num value={c.returnPct} onChange={(v) => setField("returnPct", v)} prefix="%" />
            </Field>
            <Field label="Required margin %">
              <Num value={c.requiredMarginPct} onChange={(v) => setField("requiredMarginPct", v)} prefix="%" />
            </Field>
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Landed cost / unit" value={`₹${r.landedCost.toFixed(2)}`} />
            <Stat label="Channel cost / unit" value={`₹${r.channelCost.toFixed(2)}`} />
            <Stat label="Net profit / unit" value={`₹${r.netProfit.toFixed(2)}`} tone={r.netProfit >= 0 ? "go" : "block"} />
            <Stat label="Net margin" value={`${r.netMarginPct.toFixed(1)}%`} tone={r.verdict === "GO" ? "go" : r.verdict === "NO_GO" ? "block" : "default"} />
          </div>
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <p className="eyebrow text-ink">Counter-target price</p>
            <p className="figure mt-1 text-2xl font-semibold text-ink">₹{r.targetLandedCost.toFixed(2)}</p>
            <p className="mt-1 text-[12px] text-muted">
              Max landed cost we can pay and still clear {c.requiredMarginPct}% margin. Negotiate up from here, not down from the quote.
            </p>
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("costing", draft); flashSaved(); }} onDiscard={discard} tab="pre-order" />
    </div>
  );
}
