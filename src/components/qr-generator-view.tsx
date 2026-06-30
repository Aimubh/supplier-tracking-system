"use client";

// QR Generator — for products we ALREADY have a sample of. Fill the details,
// click Generate: it (1) renders a QR code that encodes those details (scan it to
// see them), and (2) creates a pipeline product with the sample pre-approved and
// Pre-Order skipped, then jumps to On-Working. Branded with the Lazer Believe logo.

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import Image from "next/image";
import { QrCode, ArrowRight, Download, Loader2, CheckCircle2 } from "lucide-react";
import { useStore, blankProduct, type CurrencyCode, type MediaItem, type QrGen } from "@/lib/store";
import { MediaUpload } from "./media-upload";
import { PageHeader } from "./page-header";

const CURRENCIES: CurrencyCode[] = ["INR", "USD", "CNY"];

export function QrGeneratorView() {
  const { addProductFull, uid } = useStore();
  const router = useRouter();

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [orderDate, setOrderDate] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [productName, setProductName] = useState("");
  const [moq, setMoq] = useState(0);
  const [rate, setRate] = useState(0);
  const [rateCurrency, setRateCurrency] = useState<CurrencyCode>("INR");
  const [sampleCharges, setSampleCharges] = useState(0);
  const [sampleCurrency, setSampleCurrency] = useState<CurrencyCode>("INR");
  const [supplierName, setSupplierName] = useState("");
  const [supplierState, setSupplierState] = useState("");

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canGenerate = productName.trim().length > 0 && supplierName.trim().length > 0;

  async function handleGenerate() {
    if (!canGenerate || busy) return;
    setBusy(true);
    try {
      const g: QrGen = {
        skippedPreOrder: true,
        orderDate, receivedDate, ownerName,
        productName: productName.trim(),
        moq, rate, rateCurrency, sampleCharges, sampleCurrency,
        supplierName: supplierName.trim(), supplierState,
        createdAt: Date.now(),
      };

      // 1) Build a pipeline product first (we need its id for the QR URL):
      //    sample APPROVED, Pre-Order skipped.
      const p = blankProduct(g.productName);
      p.qrGen = g;
      p.supplier = { ...p.supplier, name: g.supplierName, notes: g.supplierState ? `State: ${g.supplierState}` : "" };
      p.working = {
        ...p.working,
        productMedia: media,
        sampleResult: "APPROVED",
        moq: g.moq,
        rateValue: g.rate,
        rateCurrency: g.rateCurrency,
        productionStart: g.orderDate,
      };
      // Record sample charges as an expense line so it shows in Order Summary.
      p.expenses = { ...p.expenses, otherExpense: g.sampleCharges };

      const id = addProductFull(p);
      setCreatedId(id);

      // 2) Render the QR encoding the public scan-page URL. Scanning opens a
      //    branded webpage with the photos, videos and details.
      const scanUrl = `${window.location.origin}/qr/${id}`;
      const dataUrl = await QRCode.toDataURL(scanUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
        color: { dark: "#15130e", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } finally {
      setBusy(false);
    }
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${productName.trim() || "product"}-qr.png`;
    a.click();
  }

  function printLabel() {
    if (!qrDataUrl) return;
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    // Escape user-entered text before interpolating into the print HTML (XSS).
    const esc = (s: string) =>
      String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const meta = `${esc(supplierName)}${supplierState ? " · " + esc(supplierState) : ""} · MOQ ${moq} · ${rate} ${esc(rateCurrency)}`;
    w.document.write(`<!doctype html><html><head><title>${esc(productName)} — QR Label</title>
      <style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;text-align:center;padding:32px;color:#15130e}
      .logo{font-weight:800;font-size:26px;letter-spacing:-1px}.logo small{display:block;font-size:11px;letter-spacing:6px;font-weight:600;margin-top:2px}
      img{width:280px;height:280px;margin:18px auto}.name{font-size:18px;font-weight:700;margin-top:8px}
      .meta{font-size:12px;color:#555;margin-top:4px}</style></head><body>
      <div class="logo">Lazer<small>BELIEVE</small></div>
      <img src="${qrDataUrl}" alt="QR"/>
      <div class="name">${esc(productName)}</div>
      <div class="meta">${meta}</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
  }

  function goOnWorking() {
    router.push("/on-working");
  }

  return (
    <main className="px-7 py-6">
      <PageHeader
        eyebrow="Fast-track"
        section="Have a sample"
        title="QR Generator"
        subtitle="Already holding a sample? Log its details, generate a scannable QR, and jump straight to On-Working — Pre-Order is skipped."
      />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT — the form */}
        <div className="rounded-lg border border-line bg-white p-5">
          <p className="eyebrow mb-4">Product details</p>

          <div className="mb-4">
            <MediaUpload label="Photos / videos (multiple)" items={media} onChange={setMedia} uid={uid} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Product name *"><Text value={productName} onChange={setProductName} placeholder="e.g. 6-colour gel pen" /></Field>
            <Field label="Owner name"><Text value={ownerName} onChange={setOwnerName} placeholder="who logged it" /></Field>
            <Field label="Date of order"><DateInput value={orderDate} onChange={setOrderDate} /></Field>
            <Field label="Date received"><DateInput value={receivedDate} onChange={setReceivedDate} /></Field>
            <Field label="MOQ"><Num value={moq} onChange={setMoq} /></Field>
            <Field label="Rate (per unit)"><Money value={rate} onChange={setRate} cur={rateCurrency} onCur={setRateCurrency} /></Field>
            <Field label="Sample charges"><Money value={sampleCharges} onChange={setSampleCharges} cur={sampleCurrency} onCur={setSampleCurrency} /></Field>
            <div />
            <Field label="Supplier name *"><Text value={supplierName} onChange={setSupplierName} placeholder="factory / trader" /></Field>
            <Field label="Supplier state / region"><Text value={supplierState} onChange={setSupplierState} placeholder="e.g. Zhejiang" /></Field>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!canGenerate || busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-[14px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            {busy ? "Generating…" : "Generate QR & create product"}
          </button>
          {!canGenerate && <p className="mt-2 text-[11px] text-muted">Product name and supplier name are required.</p>}
        </div>

        {/* RIGHT — QR result + branding */}
        <div className="rounded-lg border border-line bg-white p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <Image src="/lazer-logo.svg" alt="Lazer Believe" width={132} height={40} className="text-ink" priority />
          </div>

          {qrDataUrl ? (
            <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Product QR" className="h-56 w-56 rounded-md border border-line" />
              <p className="mt-3 text-center text-[13px] font-medium text-ink">{productName}</p>
              <p className="text-center text-[11.5px] text-muted">Scan to see the product details</p>

              <div className="mt-4 grid w-full grid-cols-2 gap-2">
                <button onClick={downloadQr} className="flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] font-medium text-ink transition hover:bg-surface">
                  <Download className="h-3.5 w-3.5" /> PNG
                </button>
                <button onClick={printLabel} className="flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] font-medium text-ink transition hover:bg-surface">
                  <QrCode className="h-3.5 w-3.5" /> Print label
                </button>
              </div>

              {createdId && (
                <div className="mt-4 w-full rounded-md bg-go/10 px-3 py-2.5 ring-1 ring-inset ring-go/20">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-go">
                    <CheckCircle2 className="h-4 w-4" /> Product created · Pre-Order skipped
                  </p>
                </div>
              )}

              <button
                onClick={goOnWorking}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-brand-600"
              >
                Go to On-Working <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line py-16 text-center">
              <QrCode className="h-10 w-10 text-line-strong" />
              <p className="mt-3 max-w-[16rem] text-[12.5px] text-muted">
                Fill the details and click Generate. The QR encodes them; scanning it shows the product.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---- small field helpers (match the app's white form style) ------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">{label}</span>
      {children}
    </label>
  );
}
function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="h-10 w-full rounded-sm border border-line bg-white px-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
  );
}
function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} placeholder="0"
      className="figure h-10 w-full rounded-sm border border-line bg-white px-3 text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
  );
}
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-sm border border-line bg-white px-3 text-[13px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
  );
}
function Money({ value, onChange, cur, onCur }: { value: number; onChange: (v: number) => void; cur: CurrencyCode; onCur: (c: CurrencyCode) => void }) {
  const sym = { INR: "₹", USD: "$", CNY: "¥" }[cur];
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{sym}</span>
      <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} placeholder="0"
        className="figure h-10 w-full rounded-sm border border-line bg-white pl-7 pr-[64px] text-[14px] text-ink focus:border-link focus:outline-none focus:ring-2 focus:ring-link/15" />
      <select value={cur} onChange={(e) => onCur(e.target.value as CurrencyCode)}
        className="absolute right-1.5 top-1/2 h-7 -translate-y-1/2 cursor-pointer appearance-none rounded-sm border border-line bg-surface px-1.5 text-[10.5px] font-semibold text-ink focus:outline-none">
        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}
