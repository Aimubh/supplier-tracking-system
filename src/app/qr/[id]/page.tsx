"use client";

// Public product page shown when a generated QR is scanned. No login. Renders the
// product's photos + videos and formatted details, branded with the Lazer logo.

import { useEffect, useState } from "react";

interface Media { kind: string; fileType: string; fileName: string; data: string }
interface ProductView {
  id: string; name: string; category: string; supplier: string; supplierState: string;
  owner: string; moq: number; rate: number; rateCurrency: string;
  sampleCharges: number; sampleCurrency: string; orderDate: string; receivedDate: string;
  media: Media[];
}

const SYM: Record<string, string> = { INR: "₹", USD: "$", CNY: "¥" };

export default function QrProductPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<ProductView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/qr/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "Product not found" : "Couldn't load"))))
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [params.id]);

  const money = (n: number, c: string) => `${SYM[c] ?? ""}${n.toLocaleString("en-IN")}`;

  return (
    <main style={{ background: "#f4f3ee", minHeight: "100vh", margin: 0 }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px 48px" }}>
        {/* Brand header */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16, borderBottom: "2px solid #15130e" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lazer-logo.svg" alt="Lazer Believe" style={{ height: 40, width: "auto" }} />
        </header>

        {err && (
          <div style={{ marginTop: 40, textAlign: "center", color: "#b3412c", fontFamily: "sans-serif" }}>
            <p style={{ fontSize: 18, fontWeight: 600 }}>{err}</p>
            <p style={{ color: "#6f6a5c", fontSize: 14 }}>This QR may be invalid or the product was removed.</p>
          </div>
        )}

        {!err && !data && (
          <p style={{ marginTop: 40, textAlign: "center", color: "#6f6a5c", fontFamily: "sans-serif" }}>Loading…</p>
        )}

        {data && (
          <div style={{ fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif", color: "#15130e" }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", margin: "20px 0 2px" }}>{data.name}</h1>
            {data.category && <p style={{ color: "#6f6a5c", fontSize: 14, margin: 0 }}>{data.category}</p>}

            {/* Media gallery */}
            {data.media.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginTop: 18 }}>
                {data.media.map((m, i) =>
                  m.kind === "video" ? (
                    <video key={i} src={m.data} controls style={{ width: "100%", borderRadius: 10, background: "#000", aspectRatio: "1", objectFit: "cover" }} />
                  ) : m.kind === "pdf" ? (
                    <a key={i} href={m.data} target="_blank" rel="noreferrer"
                       style={{ display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1", borderRadius: 10, background: "#fff", border: "1px solid #dad5c7", color: "#15130e", textDecoration: "none", fontSize: 13, textAlign: "center", padding: 8 }}>
                      📄 {m.fileName || "PDF"}
                    </a>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={m.data} alt={m.fileName || "photo"} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, border: "1px solid #dad5c7" }} />
                  )
                )}
              </div>
            )}

            {/* Details */}
            <section style={{ marginTop: 24, background: "#fff", border: "1px solid #dad5c7", borderRadius: 12, padding: "6px 18px" }}>
              <Row label="Supplier" value={data.supplier + (data.supplierState ? ` · ${data.supplierState}` : "") || "—"} />
              <Row label="MOQ" value={data.moq > 0 ? data.moq.toLocaleString("en-IN") : "—"} />
              <Row label="Rate" value={data.rate > 0 ? money(data.rate, data.rateCurrency) : "—"} />
              <Row label="Sample charges" value={data.sampleCharges > 0 ? money(data.sampleCharges, data.sampleCurrency) : "—"} />
              <Row label="Owner" value={data.owner || "—"} />
              <Row label="Order date" value={data.orderDate || "—"} />
              <Row label="Received" value={data.receivedDate || "—"} last />
            </section>

            <p style={{ marginTop: 22, textAlign: "center", color: "#9a9486", fontSize: 12 }}>
              Lazer Ecommerce Ventures Pvt. Ltd. · www.BrowseBazaar.com
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: last ? "none" : "1px solid #eee" }}>
      <span style={{ color: "#6f6a5c", fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
