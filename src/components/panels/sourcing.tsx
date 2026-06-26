"use client";

// Sourcing Model panel (Pre-Order). Paste an Instagram/Alibaba link → the Vendex
// scraper finds the top supplier → SKU fields auto-fill (with HSN/weight guessed)
// → the model computes landed cost, channel margins and a GO/NO-GO verdict. A
// Market Size lookup scrapes Amazon.in for demand/competition and produces a
// SELL / CAUTION / AVOID recommendation. All auto-filled fields stay editable.

import { useState } from "react";
import { Search, Sparkles, AlertTriangle, Loader2, ExternalLink, Link as LinkIcon, Image as ImageIcon } from "lucide-react";
import { useStore, type Sourcing } from "@/lib/store";
import {
  computeSourcing,
  type ChannelResult,
  type SourcingAssumptions,
  type SourcingInputs,
} from "@/lib/sourcing-model";
import { recommend, type MarketSize } from "@/lib/market-size";
import type { HsnCandidate } from "@/lib/hsn-advisor";
import { Field, Text, Num, Stat, PanelHead } from "../fields";
import { Seal, Chip } from "../seal";
import { useDraft } from "../use-draft";
import { SaveBar } from "../save-bar";

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
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [hsnLoading, setHsnLoading] = useState(false);
  const [hsnCandidates, setHsnCandidates] = useState<HsnCandidate[] | null>(null);

  if (!active) return null;

  const a = draft.assumptions;
  const i = draft.inputs;
  const result = computeSourcing(a, i);
  const rec = recommend(draft.marketSize, result.bestContributionPct);

  const setInput = <K extends keyof SourcingInputs>(k: K, v: SourcingInputs[K]) =>
    setAll({ ...draft, inputs: { ...i, [k]: v } });
  const setAssume = <K extends keyof SourcingAssumptions>(k: K, v: SourcingAssumptions[K]) =>
    setAll({ ...draft, assumptions: { ...a, [k]: v } });

  // ---- Auto-fill from a pasted link (calls the Vendex bridge) ----
  async function autoFill() {
    if (!/^https?:\/\//i.test(link)) {
      setFetchMsg({ tone: "err", text: "Paste a valid http(s) link first." });
      return;
    }
    setFetching(true);
    setFetchMsg({ tone: "ok", text: "Scraping the top supplier… this can take up to ~2 min." });
    try {
      const res = await fetch("/api/sourcing/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchMsg({ tone: "err", text: data.error ?? "Fetch failed." });
        return;
      }
      // Merge the scraped inputs over the current ones; keep user-entered sells.
      setAll({
        ...draft,
        inputs: { ...i, ...data.inputs },
        sourceUrl: link,
        supplierName: data.raw?.supplierName ?? "",
        supplierProductUrl: data.raw?.productUrl ?? "",
        supplierCountry: data.raw?.country ?? "",
        supplierImageUrl: data.raw?.productImageUrl ?? "",
        supplierCount: data.supplierCount ?? 0,
        hsnEstimated: data.flags?.hsnEstimated ?? true,
        weightEstimated: data.flags?.weightEstimated ?? true,
      });
      setFetchMsg(
        data.lowConfidence
          ? { tone: "warn", text: data.note || "Low-confidence scrape — verify the fields." }
          : { tone: "ok", text: `Filled from “${data.raw?.supplierName || "supplier"}”. Verify HSN & weight (estimated).` }
      );
    } catch {
      setFetchMsg({ tone: "err", text: "Could not reach the scraper service." });
    } finally {
      setFetching(false);
    }
  }

  // ---- Auto-fill from an uploaded product image ----
  async function autoFillFromImage(file: File) {
    setFetching(true);
    setFetchMsg({ tone: "ok", text: `Searching Alibaba by image “${file.name}”…` });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", i.itemName || "");
      const res = await fetch("/api/sourcing/fetch-image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setFetchMsg({ tone: "err", text: data.error ?? "Image search failed." });
        return;
      }
      setAll({
        ...draft,
        inputs: { ...i, ...data.inputs },
        sourceUrl: data.raw?.productImageUrl ?? "",
        supplierName: data.raw?.supplierName ?? "",
        supplierProductUrl: data.raw?.productUrl ?? "",
        supplierCountry: data.raw?.country ?? "",
        supplierImageUrl: data.raw?.productImageUrl ?? "",
        supplierCount: data.supplierCount ?? 0,
        hsnEstimated: data.flags?.hsnEstimated ?? true,
        weightEstimated: data.flags?.weightEstimated ?? true,
      });
      setFetchMsg({
        tone: "ok",
        text: `Found ${data.supplierCount ?? 1} match(es) — filled from “${data.raw?.supplierName || "supplier"}”. Verify HSN & weight.`,
      });
    } catch {
      setFetchMsg({ tone: "err", text: "Could not reach the scraper service." });
    } finally {
      setFetching(false);
    }
  }

  // ---- Market size lookup ----
  async function fetchMarket() {
    const query = i.itemName || draft.supplierName;
    if (!query) {
      setFetchMsg({ tone: "err", text: "Add an item name first (or auto-fill)." });
      return;
    }
    setMarketLoading(true);
    try {
      const res = await fetch("/api/sourcing/market-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Prefer the product image (Google Lens → real price/reviews); query is
        // the Amazon-scrape fallback.
        body: JSON.stringify({ query, imageUrl: draft.supplierImageUrl || "" }),
      });
      const ms: MarketSize = await res.json();
      setAll({ ...draft, marketSize: ms });
    } catch {
      // leave existing snapshot
    } finally {
      setMarketLoading(false);
    }
  }

  // ---- HSN advisor: suggest top-3 codes for the current product ----
  async function suggestHsnCodes() {
    if (!i.itemName && !i.variant) {
      setFetchMsg({ tone: "err", text: "Add an item name first, then suggest HSN." });
      return;
    }
    setHsnLoading(true);
    try {
      const res = await fetch("/api/sourcing/hsn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: i.itemName,
          description: `${i.variant} ${i.colour} ${i.size}`,
          imageUrl: draft.supplierImageUrl || "",
        }),
      });
      const data = await res.json();
      setHsnCandidates(data.candidates ?? []);
    } catch {
      setHsnCandidates([]);
    } finally {
      setHsnLoading(false);
    }
  }

  const verdictTone =
    result.verdict === "GO" ? "seal" : result.verdict === "NO_GO" ? "block" : "stamp";
  const verdictMark = result.verdict === "GO" ? "◉" : result.verdict === "NO_GO" ? "✕" : "●";
  const recTone =
    rec.verdict === "SELL" ? "seal" : rec.verdict === "AVOID" ? "block" : rec.verdict === "CAUTION" ? "stamp" : "neutral";

  return (
    <div>
      <PanelHead
        title="Sourcing model"
        desc="Paste a reel or Alibaba link to auto-fill the top supplier, then review the landed cost, channel margins and market size. The verdict is GO when a channel clears the target margin."
      />

      {/* ---- Auto-fill bar: paste a link OR upload a product image ---- */}
      <div className="sheet mb-5 rounded-sm p-4">
        <p className="eyebrow mb-2">Auto-fill from a link or image</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.instagram.com/reel/…  or  https://www.alibaba.com/product-detail/…"
            className="h-11 flex-1 rounded-sm border border-line bg-white px-3.5 text-[14px] text-ink placeholder:text-line-strong focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15"
          />
          <button
            onClick={autoFill}
            disabled={fetching}
            className="flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {fetching ? "Working…" : "Fetch supplier"}
          </button>
          <label
            className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-[13px] font-semibold text-ink ${
              fetching ? "pointer-events-none opacity-60" : "hover:bg-surface-strong"
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            Upload image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={fetching}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) autoFillFromImage(f);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">
          Tip: uploading a clear product photo is faster and more reliable than a reel.
        </p>
        {fetchMsg && (
          <p
            className={`mt-2 flex items-center gap-1.5 text-[12.5px] ${
              fetchMsg.tone === "err" ? "text-block" : fetchMsg.tone === "warn" ? "text-pending" : "text-muted"
            }`}
          >
            {fetchMsg.tone === "warn" && <AlertTriangle className="h-3.5 w-3.5" />}
            {fetchMsg.text}
          </p>
        )}

        {/* Provenance: which supplier + product page the data came from. */}
        {(draft.supplierProductUrl || draft.sourceUrl) && (
          <div className="mt-3 flex items-start gap-3 border-t border-rule pt-3">
            {draft.supplierImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.supplierImageUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-sm border border-line object-cover"
              />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[12.5px] text-body">
                <span className="text-muted">Top supplier: </span>
                <span className="font-semibold text-ink">{draft.supplierName || "—"}</span>
                {draft.supplierCountry && <span className="text-muted"> · {draft.supplierCountry}</span>}
                {draft.supplierCount > 1 && (
                  <span className="figure ml-1 text-[11px] text-muted">(+{draft.supplierCount - 1} more)</span>
                )}
              </p>
              {draft.supplierProductUrl && (
                <a
                  href={draft.supplierProductUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-[12px] text-link hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{draft.supplierProductUrl}</span>
                </a>
              )}
              {draft.sourceUrl && (
                <a
                  href={draft.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-[11.5px] text-muted hover:underline"
                >
                  <LinkIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">from: {draft.sourceUrl}</span>
                </a>
              )}
            </div>
          </div>
        )}
      </div>

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
              <Field label="HSN code" hint={draft.hsnEstimated ? "estimated — verify" : undefined}>
                <Text value={i.hsnCode} onChange={(v) => setInput("hsnCode", v)} placeholder="3926" />
              </Field>
              <Field label="Size / dimension">
                <Text value={i.size} onChange={(v) => setInput("size", v)} placeholder="84×530 mm" />
              </Field>
              <Field label="Unit weight (g)" hint={draft.weightEstimated ? "estimated — verify" : undefined}>
                <Num value={i.unitWeightG} onChange={(v) => setInput("unitWeightG", v)} blankZero />
              </Field>
            </div>

            {/* HSN advisor — suggest the best-fit codes with their duty */}
            <div className="mt-3 border-t border-rule pt-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow">HSN advisor</span>
                <button
                  onClick={suggestHsnCodes}
                  disabled={hsnLoading}
                  className="flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink disabled:opacity-60"
                >
                  {hsnLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {hsnLoading ? "Finding…" : "Suggest HSN"}
                </button>
              </div>
              {hsnCandidates && hsnCandidates.length === 0 && (
                <p className="mt-2 text-[12px] text-muted">No confident match — add material/use to the name and retry.</p>
              )}
              {hsnCandidates && hsnCandidates.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {hsnCandidates.map((c, n) => (
                    <button
                      key={c.hsn}
                      onClick={() => setInput("hsnCode", c.hsn)}
                      className={`flex w-full items-start justify-between gap-3 rounded-sm border px-3 py-2 text-left transition hover:bg-surface ${
                        i.hsnCode === c.hsn ? "border-ink bg-surface" : "border-line"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                          <span className="figure">{c.hsn}</span>
                          {n === 0 && <Chip label="BEST FIT" tone="seal" />}
                          {c.isLowestDuty && <Chip label="LOWEST DUTY" tone="stamp" />}
                        </p>
                        <p className="truncate text-[11.5px] text-muted">{c.title}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="figure text-[13px] font-semibold text-ink">
                          {result.cifInr > 0 ? inr(result.cifInr * c.effectiveDutyPct) : pct(c.effectiveDutyPct)}
                          <span className="text-[10px] font-normal text-muted"> /pc duty</span>
                        </p>
                        <p className="figure text-[11px] text-muted">
                          {result.cifInr > 0 && i.orderQty > 0
                            ? `${inr(result.cifInr * c.effectiveDutyPct * i.orderQty)} total`
                            : `duty ${pct(c.effectiveDutyPct)}`}
                        </p>
                        <p className="figure text-[10px] text-muted">{pct(c.effectiveDutyPct)} · GST {pct(c.gstPct)}</p>
                      </div>
                    </button>
                  ))}
                  <p className="flex items-start gap-1.5 text-[11px] text-pending">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Advisory — confirm the correct code on ICEGATE / with your CHA before ordering.
                  </p>
                </div>
              )}
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
                <Num value={i.freightPctOverride ?? 0} onChange={(v) => setInput("freightPctOverride", v || null)} blankZero step="0.01" />
              </Field>
              <Field label="BCD % override" hint="blank = use assumption">
                <Num value={i.bcdPctOverride ?? 0} onChange={(v) => setInput("bcdPctOverride", v || null)} blankZero step="0.01" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Reference Amazon link">
                <Text value={i.referenceAmazonLink} onChange={(v) => setInput("referenceAmazonLink", v)} placeholder="https://www.amazon.in/s?k=…" />
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

          {/* ---- Market size ---- */}
          <section className="sheet rounded-sm p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="eyebrow">Market size · India · UAE · USA</span>
              <button
                onClick={fetchMarket}
                disabled={marketLoading}
                className="flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink disabled:opacity-60"
              >
                {marketLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {marketLoading ? "Checking…" : "Check market"}
              </button>
            </div>

            <div className="mb-3 flex items-baseline justify-between">
              <Seal
                label={rec.verdict}
                tone={recTone}
                mark={rec.verdict === "SELL" ? "◉" : rec.verdict === "AVOID" ? "✕" : "●"}
                className="text-[18px] font-semibold"
              />
              {draft.marketSize.fetchedAt != null && (
                <span className="figure text-[12px] text-muted">score {rec.score}/100</span>
              )}
            </div>

            {draft.marketSize.fetchedAt == null ? (
              <p className="text-[12.5px] text-muted">Run a market check to gauge demand and competition.</p>
            ) : (
              <>
                {/* 3-market retail comparison */}
                {draft.marketSize.comparison && (
                  <div className="mb-3 overflow-hidden rounded-sm border border-rule">
                    <div className="grid grid-cols-[64px_1fr_1fr] bg-surface text-[11px]">
                      <span className="eyebrow px-2 py-1.5">Market</span>
                      <span className="eyebrow px-2 py-1.5 text-right">Typical price</span>
                      <span className="eyebrow px-2 py-1.5 text-right">In ₹</span>
                    </div>
                    {([
                      ["India", draft.marketSize.comparison.india],
                      ["UAE", draft.marketSize.comparison.uae],
                      ["USA", draft.marketSize.comparison.usa],
                    ] as const).map(([name, r]) => (
                      <div key={name} className="grid grid-cols-[64px_1fr_1fr] border-t border-rule text-[12.5px]">
                        <span className="px-2 py-1.5 font-semibold text-ink">{name}</span>
                        <span className="figure px-2 py-1.5 text-right text-body">
                          {r.avgPrice != null ? `${r.currency} ${r.avgPrice.toLocaleString("en-IN")}` : "—"}
                        </span>
                        <span className="figure px-2 py-1.5 text-right text-ink">
                          {r.avgPriceInr != null ? inr(r.avgPriceInr) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="IN listings" value={String(draft.marketSize.resultCount)} />
                  <Stat label="IN reviews" value={draft.marketSize.totalReviews.toLocaleString("en-IN")} />
                  <Stat label="IN avg ₹" value={draft.marketSize.avgPriceInr != null ? inr(draft.marketSize.avgPriceInr) : "—"} />
                </div>
                <ul className="mt-3 space-y-1">
                  {rec.reasons.map((r, n) => (
                    <li key={n} className="flex gap-1.5 text-[12px] text-muted">
                      <span className="text-line-strong">·</span> {r}
                    </li>
                  ))}
                </ul>
                {draft.marketSize.note && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-pending">
                    <AlertTriangle className="h-3.5 w-3.5" /> {draft.marketSize.note}
                  </p>
                )}
              </>
            )}
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

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={strong ? "text-[13px] font-semibold text-ink" : "text-[13px] text-muted"}>
        {label}
        {hint && <span className="figure ml-2 text-[11px] text-muted">{hint}</span>}
      </span>
      <span className={`figure ${strong ? "text-[15px] font-semibold text-ink" : "text-[13px] text-body"}`}>{value}</span>
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
