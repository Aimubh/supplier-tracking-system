"use client";

import clsx from "clsx";
import { Check, Lock } from "lucide-react";
import { useStore, type Logistics, type MediaItem } from "@/lib/store";
import { Field, Text, Num, Toggle, Stat, PanelHead } from "../fields";
import { DocRow } from "../doc-row";
import { useDraft } from "../use-draft";
import { SaveBar } from "../save-bar";

// Shared: a draft over the active product's `logistics` slice.
function useLogisticsDraft() {
  const { active, patch, uid } = useStore();
  const d = useDraft<Logistics>(
    active?.logistics ?? ({} as Logistics),
    (active?.id ?? "") + ":logistics"
  );
  return { active, patch, uid, ...d };
}

// ---- Step 1: Dispatch & documentation -----------------------------------------
const MOVEMENT: { key: keyof Logistics; label: string; hint: string }[] = [
  { key: "mLoading", label: "Loading", hint: "Goods being loaded at the factory / warehouse." },
  { key: "mToPort", label: "On the way to port", hint: "In transit from the factory to the port." },
  { key: "mUnloadedAtPort", label: "Unloaded at the port", hint: "Arrived and unloaded at the port yard." },
  { key: "mLoadedToShip", label: "Loaded to the ship", hint: "Containers loaded onto the vessel." },
];

const DOCS: { key: keyof Logistics; label: string; critical?: boolean }[] = [
  { key: "ciCollected", label: "Commercial Invoice (CI)" },
  { key: "packingListCollected", label: "Packing List" },
  { key: "blNumber", label: "Bill of Lading (B/L)", critical: true },
  { key: "cooCollected", label: "Certificate of Origin (COO)" },
  { key: "shippingBill", label: "Shipping Bill / Export declaration" },
  { key: "lcPayment", label: "Letter of Credit / payment proof" },
  { key: "insurance", label: "Marine Insurance certificate" },
  { key: "fumigation", label: "Fumigation / Phytosanitary certificate" },
  { key: "inspectionCert", label: "Inspection / Test certificate" },
];

export function DispatchDocsPanel() {
  const { active, patch, uid, draft, setField, dirty, saved, flashSaved, discard } = useLogisticsDraft();
  if (!active) return null;
  const l = draft;
  const setDocFiles = (key: string, items: MediaItem[]) => {
    const next = { ...(l.docImages ?? {}) };
    if (items.length) next[key] = items;
    else delete next[key];
    setField("docImages", next);
  };
  const moveDone = MOVEMENT.filter((m) => l[m.key]).length;
  const docDone = DOCS.filter((d) => (d.key === "blNumber" ? !!l.blNumber : l[d.key])).length;

  return (
    <div>
      <PanelHead
        title="Dispatch and Documentation"
        desc="Move the goods to the ship and collect every export document. The Bill of Lading releases the goods — without it, nothing moves."
        right={
          <div className="flex gap-2">
            <span className="figure rounded-full bg-surface px-3 py-1.5 text-[11px] text-body ring-1 ring-inset ring-line">Movement {moveDone}/{MOVEMENT.length}</span>
            <span className="figure rounded-full bg-surface px-3 py-1.5 text-[11px] text-body ring-1 ring-inset ring-line">Docs {docDone}/{DOCS.length}</span>
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Vessel"><Text value={l.vessel} onChange={(v) => setField("vessel", v)} placeholder="MV …" /></Field>
        <Field label="Container no."><Text value={l.containerNo} onChange={(v) => setField("containerNo", v)} placeholder="MSCU…" /></Field>
        <Field label="Bill of Lading no." hint="no B/L, no delivery"><Text value={l.blNumber} onChange={(v) => setField("blNumber", v)} placeholder="B/L number" /></Field>
      </div>

      {/* Shipping agent */}
      <div className="mb-6 rounded-md border border-line bg-surface p-4">
        <p className="eyebrow mb-3">Shipping agent</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name"><Text value={l.shippingAgentName} onChange={(v) => setField("shippingAgentName", v)} placeholder="agent / forwarder" /></Field>
          <Field label="Number"><Text value={l.shippingAgentNumber} onChange={(v) => setField("shippingAgentNumber", v)} placeholder="phone" /></Field>
          <Field label="Contact person"><Text value={l.shippingAgentContact} onChange={(v) => setField("shippingAgentContact", v)} placeholder="who we deal with" /></Field>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="eyebrow mb-3">Movement to the ship</p>
          <ol className="space-y-1">
            {MOVEMENT.map((m, i) => {
              const on = !!l[m.key];
              const prevDone = i === 0 || !!l[MOVEMENT[i - 1].key];
              const locked = !on && !prevDone;
              return (
                <li key={m.key} className="relative flex gap-3">
                  <div className="flex flex-col items-center">
                    <button onClick={() => !locked && setField(m.key, !on as never)} disabled={locked}
                      className={clsx("z-10 flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold transition",
                        on ? "bg-go text-white" : locked ? "cursor-not-allowed bg-surface text-line-strong" : "bg-white text-body ring-1 ring-inset ring-line hover:bg-surface")}>
                      {on ? <Check className="h-4 w-4" strokeWidth={3} /> : locked ? <Lock className="h-3 w-3" /> : i + 1}
                    </button>
                    {i < MOVEMENT.length - 1 && <span className={clsx("w-px flex-1", on ? "bg-go/40" : "bg-surface")} style={{ minHeight: 26 }} />}
                  </div>
                  <button onClick={() => !locked && setField(m.key, !on as never)} disabled={locked} className="-mt-0.5 mb-2 flex-1 text-left disabled:cursor-not-allowed">
                    <p className={clsx("text-[14px] font-semibold", on ? "text-ink" : locked ? "text-line-strong" : "text-body")}>{m.label}</p>
                    <p className="text-[11px] text-muted">{m.hint}</p>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <p className="eyebrow mb-3">Export documentation</p>
          <div className="space-y-1.5">
            {DOCS.map((d) => {
              const isBL = d.key === "blNumber";
              const on = isBL ? !!l.blNumber : !!l[d.key];
              return (
                <DocRow key={d.key} label={d.label} critical={d.critical} collected={on}
                  items={l.docImages?.[d.key] ?? []} uid={uid} toggleLocked={isBL}
                  onChange={(items) => { setDocFiles(d.key, items); if (!isBL) setField(d.key, (items.length > 0) as never); }}
                />
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted">Upload a scan to tick a document automatically. The B/L ticks once its number is entered above.</p>
        </div>
      </div>
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("logistics", draft); flashSaved(); }} onDiscard={discard} tab="post-order" />
    </div>
  );
}

// Small section divider used inside combined panels.
function SubHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 mt-7 border-t border-line pt-5 first:mt-0 first:border-0 first:pt-0">
      <h3 className="font-display text-[16px] font-medium text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

// ---- Step 2: Custom Clearance (Unloading state + Customs clearance) ------------
const CLEARANCE: { key: keyof Logistics; label: string; hint: string }[] = [
  { key: "chaAppointed", label: "CHA appointed", hint: "Customs House Agent assigned to clear the consignment." },
  { key: "boeFiled", label: "Bill of Entry filed", hint: "BOE submitted on ICEGATE against the IGM." },
  { key: "assessed", label: "Assessed by customs", hint: "Classification & value assessed; duty determined." },
  { key: "dutyCharged", label: "Duty & IGST paid", hint: "Customs duty, surcharge and IGST paid." },
  { key: "examDone", label: "Examination done", hint: "Physical / risk-based examination complete." },
  { key: "outOfCharge", label: "Out of Charge", hint: "Goods released by customs for delivery." },
];

const CLEARANCE_DOCS: { key: keyof Logistics; label: string; critical?: boolean }[] = [
  { key: "docBoE", label: "Bill of Entry (BOE)", critical: true },
  { key: "docDO", label: "Delivery Order (from line/agent)" },
  { key: "docInvoice", label: "Commercial Invoice" },
  { key: "docPackingList", label: "Packing List" },
  { key: "docCoo", label: "Certificate of Origin (duty benefit)" },
  { key: "docLicence", label: "Import licence / BIS certificate (if applicable)" },
  { key: "docInsurance", label: "Insurance certificate" },
  { key: "docIec", label: "IEC (Import-Export Code) on file" },
  { key: "docTechWriteup", label: "Technical write-up / catalog (if asked)" },
];

export function CustomClearancePanel() {
  const { active, patch, uid, draft, setField, dirty, saved, flashSaved, discard } = useLogisticsDraft();
  if (!active) return null;
  const l = draft;
  const setDocFiles = (key: string, items: MediaItem[]) => {
    const next = { ...(l.docImages ?? {}) };
    if (items.length) next[key] = items;
    else delete next[key];
    setField("docImages", next);
  };
  const totalPayable = (l.bcdAmount || 0) + (l.swsAmount || 0) + (l.igstPaid || 0);
  const stepsDone = CLEARANCE.filter((s) => l[s.key]).length;
  const docsDone = CLEARANCE_DOCS.filter((d) => l[d.key]).length;
  const demurrageRisk = l.portDays >= 4 && !l.outOfCharge;

  return (
    <div>
      <PanelHead
        title="Custom Clearance"
        desc="Sea transit & unloading at the port, then appoint a CHA, file the Bill of Entry, pay duty + IGST, clear examination, and get Out of Charge."
        right={
          <div className="flex gap-2">
            <span className="figure rounded-full bg-surface px-3 py-1.5 text-[11px] text-body ring-1 ring-inset ring-line">Clearance {stepsDone}/{CLEARANCE.length}</span>
            <span className="figure rounded-full bg-surface px-3 py-1.5 text-[11px] text-body ring-1 ring-inset ring-line">Docs {docsDone}/{CLEARANCE_DOCS.length}</span>
          </div>
        }
      />

      {/* Unloading state */}
      <SubHead title="Unloading state" hint="Sea transit, vessel arrival and unloading at the Indian port." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ETD (departure)"><Text value={l.etd} onChange={(v) => setField("etd", v)} placeholder="2026-07-01" /></Field>
        <Field label="ETA (arrival)"><Text value={l.eta} onChange={(v) => setField("eta", v)} placeholder="2026-07-22" /></Field>
      </div>
      <div className="mt-4"><Toggle on={l.arrived} onChange={(v) => setField("arrived", v)} label="Vessel arrived & unloaded at port" /></div>

      {/* Customs clearance */}
      <SubHead title="Customs clearance (India)" hint="After arrival: appoint a CHA, file the Bill of Entry against the IGM, pay duty + IGST, clear examination, and get Out of Charge." />

      {/* CHA — clearing agent */}
      <div className="mb-5 rounded-md border border-line bg-surface p-4">
        <p className="eyebrow mb-3">CHA (Customs House Agent)</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name"><Text value={l.chaName} onChange={(v) => setField("chaName", v)} placeholder="clearing agent" /></Field>
          <Field label="Number"><Text value={l.chaNumber} onChange={(v) => setField("chaNumber", v)} placeholder="phone" /></Field>
          <Field label="Contact person"><Text value={l.chaContact} onChange={(v) => setField("chaContact", v)} placeholder="who we deal with" /></Field>
        </div>
      </div>

      {/* IGM — import general manifest */}
      <div className="mb-5 rounded-md border border-line bg-surface p-4">
        <p className="eyebrow mb-3">IGM (Import General Manifest)</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="IGM number"><Text value={l.igmNumber} onChange={(v) => setField("igmNumber", v)} placeholder="manifest no." /></Field>
          <Field label="IGM date">
            <input type="date" value={l.igmDate} onChange={(e) => setField("igmDate", e.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
          </Field>
          <Field label="IGM line / item no."><Text value={l.igmLineNo} onChange={(v) => setField("igmLineNo", v)} placeholder="line no. for this container" /></Field>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Port of clearance"><Text value={l.clearancePort} onChange={(v) => setField("clearancePort", v)} placeholder="Nhava Sheva / Mundra" /></Field>
        <Field label="Bill of Entry no."><Text value={l.boeNumber} onChange={(v) => setField("boeNumber", v)} placeholder="BOE number" /></Field>
        <Field label="BOE date">
          <input type="date" value={l.boeDate} onChange={(e) => setField("boeDate", e.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
        </Field>
        <Field label="Days in port" hint="demurrage flag"><Num value={l.portDays} onChange={(v) => setField("portDays", v)} blankZero placeholder="0" /></Field>
        <Field label="Out of Charge date">
          <input type="date" value={l.outOfChargeDate} onChange={(e) => setField("outOfChargeDate", e.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
        </Field>
      </div>
      {demurrageRisk && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-pending/20 bg-pending/5 px-3 py-2 text-[12px] text-pending">
          <Lock className="h-3.5 w-3.5" />{l.portDays} days in port and not yet cleared — demurrage charges may be accruing.
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="eyebrow mb-3">Clearance progress</p>
          <ol className="space-y-1">
            {CLEARANCE.map((s, i) => {
              const on = !!l[s.key];
              const prevDone = i === 0 || !!l[CLEARANCE[i - 1].key];
              const locked = !on && !prevDone;
              return (
                <li key={s.key} className="relative flex gap-3">
                  <div className="flex flex-col items-center">
                    <button onClick={() => !locked && setField(s.key, !on as never)} disabled={locked}
                      className={clsx("z-10 flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold transition",
                        on ? "bg-go text-white" : locked ? "cursor-not-allowed bg-surface text-line-strong" : "bg-white text-body ring-1 ring-inset ring-line hover:bg-surface")}>
                      {on ? <Check className="h-4 w-4" strokeWidth={3} /> : locked ? <Lock className="h-3 w-3" /> : i + 1}
                    </button>
                    {i < CLEARANCE.length - 1 && <span className={clsx("w-px flex-1", on ? "bg-go/40" : "bg-surface")} style={{ minHeight: 26 }} />}
                  </div>
                  <button onClick={() => !locked && setField(s.key, !on as never)} disabled={locked} className="-mt-0.5 mb-2 flex-1 text-left disabled:cursor-not-allowed">
                    <p className={clsx("text-[14px] font-semibold", on ? "text-ink" : locked ? "text-line-strong" : "text-body")}>{s.label}</p>
                    <p className="text-[11px] text-muted">{s.hint}</p>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <p className="eyebrow mb-3">Clearance documents</p>
          <div className="space-y-1.5">
            {CLEARANCE_DOCS.map((d) => {
              const on = !!l[d.key];
              return (
                <DocRow key={d.key} label={d.label} critical={d.critical} collected={on}
                  items={l.docImages?.[d.key] ?? []} uid={uid}
                  onChange={(items) => { setDocFiles(d.key, items); setField(d.key, (items.length > 0) as never); }}
                />
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted">Upload a scan to tick a document automatically; click a thumbnail to view it.</p>
        </div>
      </div>
      <div className="mt-6">
        <p className="eyebrow mb-3">Duty & charges</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Assessable value (₹)"><Num value={l.assessableValue} onChange={(v) => setField("assessableValue", v)} prefix="₹" /></Field>
          <Field label="Basic customs duty (₹)"><Num value={l.bcdAmount} onChange={(v) => setField("bcdAmount", v)} prefix="₹" /></Field>
          <Field label="Social Welfare Surcharge (₹)"><Num value={l.swsAmount} onChange={(v) => setField("swsAmount", v)} prefix="₹" /></Field>
          <Field label="IGST (₹)"><Num value={l.igstPaid} onChange={(v) => setField("igstPaid", v)} prefix="₹" /></Field>
        </div>
        <div className="mt-4 sm:max-w-xs">
          <Stat label="Total duty payable" value={`₹${totalPayable.toLocaleString()}`} tone={l.dutyCharged ? "go" : "pending"} />
        </div>
      </div>
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("logistics", draft); flashSaved(); }} onDiscard={discard} tab="post-order" />
    </div>
  );
}

// ---- Step 3: Product arrival & GRN --------------------------------------------
export function ArrivalPanel() {
  const { active, patch, draft, setField, dirty, saved, flashSaved, discard } = useLogisticsDraft();
  if (!active) return null;
  const l = draft;
  const variance = l.receivedQty - l.orderedQty;
  const reconciled = l.orderedQty > 0 && l.receivedQty === l.orderedQty && l.invoicedQty === l.orderedQty;

  return (
    <div>
      <PanelHead
        title="Product arrival state"
        desc="Last-mile to our warehouse, then the GRN: a three-way check of ordered vs received vs invoiced before handoff to inventory."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vehicle chassis no." hint="track the last-mile vehicle"><Text value={l.chassisNo} onChange={(v) => setField("chassisNo", v)} placeholder="chassis / vehicle no." /></Field>
      </div>
      <p className="eyebrow mb-2 mt-5">Goods Received Note — 3-way reconciliation</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Ordered qty"><Num value={l.orderedQty} onChange={(v) => setField("orderedQty", v)} /></Field>
        <Field label="Received qty"><Num value={l.receivedQty} onChange={(v) => setField("receivedQty", v)} /></Field>
        <Field label="Invoiced qty"><Num value={l.invoicedQty} onChange={(v) => setField("invoicedQty", v)} /></Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label="Variance" value={variance === 0 ? "0 — matched" : variance > 0 ? `+${variance}` : `${variance}`} tone={variance === 0 ? "go" : "block"} />
        <Stat label="Reconciled" value={reconciled ? "Yes" : "No"} tone={reconciled ? "go" : "pending"} />
      </div>
      <div className="mt-5">
        <Toggle on={l.handedToInventory} onChange={(v) => setField("handedToInventory", v)} label="Handed over to inventory system (pipeline closes)" />
      </div>
      <SaveBar dirty={dirty} saved={saved} onSave={() => { patch("logistics", draft); flashSaved(); }} onDiscard={discard} tab="post-order" />
    </div>
  );
}
