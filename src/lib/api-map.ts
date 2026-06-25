// Maps a full product/manufacturer object (the shape the client store uses) into
// the columns + JSON slices our Prisma schema stores. Shared by the API routes.

export function productToRow(p: Record<string, unknown>) {
  return {
    name: String(p.name ?? "Untitled product"),
    category: String(p.category ?? ""),
    filed: Boolean(p.filed ?? false),
    filedAt: p.filedAt ? new Date(p.filedAt as number) : null,
    market: (p.market ?? []) as object,
    supplier: (p.supplier ?? {}) as object,
    compliance: (p.compliance ?? {}) as object,
    costing: (p.costing ?? {}) as object,
    po: (p.po ?? {}) as object,
    payments: (p.payments ?? []) as object,
    production: (p.production ?? {}) as object,
    qc: (p.qc ?? {}) as object,
    logistics: (p.logistics ?? {}) as object,
    working: (p.working ?? {}) as object,
    expenses: (p.expenses ?? {}) as object,
  };
}

export function manufacturerToRow(m: Record<string, unknown>) {
  return {
    name: String(m.name ?? ""),
    type: String(m.type ?? "FACTORY"),
    verification: String(m.verification ?? "UNVERIFIED"),
    city: String(m.city ?? ""),
    address: String(m.address ?? ""),
    productLines: String(m.productLines ?? ""),
    certNumber: String(m.certNumber ?? ""),
    certImage: String(m.certImage ?? ""),
    repName: String(m.repName ?? ""),
    repNumber: String(m.repNumber ?? ""),
    repWechat: String(m.repWechat ?? ""),
    repWechatQr: String(m.repWechatQr ?? ""),
    website: String(m.website ?? ""),
    moq: String(m.moq ?? ""),
    rating: Number(m.rating ?? 0),
    notes: String(m.notes ?? ""),
    catalogs: (m.catalogs ?? []) as object,
  };
}
