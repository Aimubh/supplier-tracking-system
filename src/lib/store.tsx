"use client";

// Client-side data store for the UI-only build. Persists to localStorage so data
// entered in one tab flows to others and survives refresh. Structured to mirror
// the eventual Prisma entities so it can be swapped for a real backend later.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ---- Entity types -------------------------------------------------------------

export type Incoterm = "EXW" | "FOB" | "CIF" | "FCA";
export type SupplierType = "FACTORY" | "TRADING" | "UNKNOWN";
export type VerificationStatus = "UNVERIFIED" | "IN_REVIEW" | "VERIFIED";
export type ComplianceStatus = "BLOCKED" | "CLEARED";
export type LicenceStatus = "NOT_REQUIRED" | "PENDING" | "OBTAINED";
export type Verdict = "GO" | "NO_GO" | "PENDING";
export type QCResult = "PENDING" | "PASS" | "FAIL";
export type PaymentType = "DEPOSIT" | "BALANCE" | "FREIGHT" | "DUTY" | "CHA" | "OTHER";
export type PaymentStatus = "PENDING" | "PAID";
export type Approval = "PENDING" | "APPROVED";
export type SampleResult = "PENDING" | "APPROVED" | "REJECTED";
// Currencies we negotiate / convert between.
export type CurrencyCode = "USD" | "INR" | "CNY";

// A single uploaded media file (photo, video, or PDF), stored inline as a
// base64 data URL. `kind` lets the UI pick the right preview (img / video / pdf).
export interface MediaItem {
  id: string;
  kind: "image" | "video" | "pdf";
  fileName: string;
  fileType: string; // MIME, e.g. image/png, video/mp4, application/pdf
  data: string; // base64 data URL
}

// On-Working flow (production). Captured per product.
export interface Working {
  // Galleries: multiple photos / videos / PDFs each. The old single-image
  // fields below are kept for backward-compat and migrated into these arrays.
  productMedia: MediaItem[];
  sampleMedia: MediaItem[];
  productImage: string; // legacy single image (base64) — migrated to productMedia
  sampleImage: string; // legacy single image (base64) — migrated to sampleMedia
  sampleResult: SampleResult;
  sampleNotes: string;
  rejectReason: string;
  moq: number; // decided order quantity
  moqNote: string;
  rate: Incoterm; // FOB / CIF / EXW / FCA
  rateValue: number; // agreed TOTAL deal amount at that incoterm
  rateCurrency: CurrencyCode; // currency the agreed amount is entered in
  advancePaid: number; // advance already paid toward the total (same currency)
  moldRequired: boolean;
  packagingDone: boolean; // derived: true once the logo/packaging is APPROVED
  // Packaging / logo design review: upload proofs, then approve or reject.
  packagingMedia: MediaItem[];
  packagingResult: SampleResult; // PENDING / APPROVED / REJECTED
  packagingRejectReason: string;
  orderProcessing: boolean;
  productionStart: string; // ISO date
  productionReady: string; // ISO target date (countdown)
  dispatched: boolean;
}

export interface MarketEntry {
  id: string;
  channel: string;
  competitorPrice: number;
  demandPerMonth: number;
}

export interface Supplier {
  name: string;
  type: SupplierType;
  contact: string;
  verification: VerificationStatus;
  notes: string;
}

export interface Compliance {
  hsCode: string;
  dutyRatePct: number;
  igstRatePct: number;
  licenceRequired: boolean;
  licenceStatus: LicenceStatus;
  status: ComplianceStatus;
}

export interface Costing {
  marketplace: string;
  sellingPrice: number; // realistic clearing price
  exWorks: number; // supplier unit price
  freightPerUnit: number;
  referralPct: number;
  fulfilmentFee: number;
  adPct: number; // TACOS
  returnPct: number;
  requiredMarginPct: number;
}

export interface Payment {
  id: string;
  type: PaymentType;
  amount: number;
  currency: string;
  dueDate: string;
  paidDate: string;
  status: PaymentStatus;
  proof: string;
}

export interface PurchaseOrder {
  poNumber: string;
  quantity: number;
  unitPrice: number;
  moqConfirmed: boolean;
  incoterm: Incoterm;
  paymentSplit: string; // e.g. "30 / 70"
}

export interface Production {
  moldRequired: boolean;
  moldStatus: string;
  packagingApproved: boolean;
  packagingNote: string;
  ppSample: Approval;
}

export interface QualityInspection {
  inspector: string;
  result: QCResult;
  defectRatePct: number;
  notes: string;
}

export interface Logistics {
  vessel: string;
  containerNo: string;
  blNumber: string;
  // Shipping agent / freight forwarder handling the dispatch.
  shippingAgentName: string;
  shippingAgentNumber: string;
  shippingAgentContact: string;
  // movement to the ship (ordered)
  mLoading: boolean;
  mToPort: boolean;
  mUnloadedAtPort: boolean;
  mLoadedToShip: boolean;
  // export documentation (to load goods onto the ship)
  ciCollected: boolean;
  packingListCollected: boolean;
  cooCollected: boolean; // certificate of origin
  shippingBill: boolean; // shipping bill / export declaration
  lcPayment: boolean; // LC / payment proof
  insurance: boolean; // marine insurance certificate
  fumigation: boolean; // fumigation / phytosanitary
  inspectionCert: boolean; // inspection / test certificate
  etd: string;
  eta: string;
  arrived: boolean;
  // customs clearance (India)
  chaName: string;
  chaNumber: string; // CHA phone
  chaContact: string; // CHA contact person
  chaAppointed: boolean;
  // Import General Manifest — the vessel's cargo list filed with customs;
  // the BOE is filed against it.
  igmNumber: string;
  igmDate: string;
  igmLineNo: string; // line / item no. for this container
  boeNumber: string;
  boeDate: string;
  clearancePort: string;
  boeFiled: boolean;
  assessed: boolean;
  assessableValue: number;
  bcdAmount: number; // basic customs duty
  swsAmount: number; // social welfare surcharge
  dutyPaid: number; // legacy/general duty paid flag amount (kept)
  igstPaid: number;
  dutyCharged: boolean; // duty + IGST paid
  examDone: boolean;
  portDays: number; // demurrage flag
  outOfCharge: boolean;
  outOfChargeDate: string;
  // clearance documents
  docBoE: boolean;
  docDO: boolean; // delivery order
  docInvoice: boolean;
  docPackingList: boolean;
  docCoo: boolean;
  docLicence: boolean; // import licence / BIS
  docInsurance: boolean;
  docIec: boolean; // import-export code on file
  docTechWriteup: boolean;
  // uploaded document scans/photos/videos/PDFs, keyed by the doc field name.
  // Each doc can hold several files. (Migrated from the old single-string map.)
  docImages: Record<string, MediaItem[]>;
  // last-mile + GRN
  chassisNo: string;
  orderedQty: number;
  receivedQty: number;
  invoicedQty: number;
  handedToInventory: boolean;
}

// Standalone directory of factories and trading companies. Lives at the top
// level (not per product) because the same supplier is reused across many
// products — this is the reusable address book the sourcing team works from.
// A single product catalog the company has shared with us. A company can keep
// several (e.g. one per range). Each is tagged with the category it covers.
export interface CatalogItem {
  id: string;
  fileName: string;
  fileData: string; // base64 data URL (image or PDF)
  fileType: string; // MIME, e.g. application/pdf, image/png
  category: string; // chosen from PRODUCT_CATEGORIES after upload
  uploadedAt: number;
}

export interface Manufacturer {
  id: string;
  name: string;
  type: SupplierType; // FACTORY / TRADING / UNKNOWN
  verification: VerificationStatus;
  city: string; // e.g. Shenzhen, Yiwu
  address: string; // full street address
  productLines: string; // what they make / trade
  // Business certification (e.g. business licence) — number + photo/scan.
  certNumber: string;
  certImage: string; // base64 data URL of the certificate photo/scan
  // Representative who we deal with.
  repName: string;
  repNumber: string; // phone
  repWechat: string; // WeChat ID
  repWechatQr: string; // base64 data URL of the WeChat QR code
  website: string;
  moq: string; // typical MOQ as free text (varies per item)
  rating: number; // 0–5, our own working rating
  notes: string;
  catalogs: CatalogItem[];
  createdAt: number;
}

// Product categories for tagging an uploaded catalog. Edit to match the business.
export const PRODUCT_CATEGORIES = [
  "Kitchenware",
  "Home & Living",
  "Toys & Games",
  "Electronics & Gadgets",
  "Beauty & Personal Care",
  "Apparel & Accessories",
  "Sports & Outdoors",
  "Stationery & Office",
  "Pet Supplies",
  "Tools & Hardware",
  "Baby & Kids",
  "Packaging & Logistics",
  "Other",
] as const;

export interface Product {
  id: string;
  name: string;
  category: string;
  createdAt: number;
  filed: boolean; // filed to the dashboard & removed from the active process
  filedAt: number | null;
  market: MarketEntry[];
  supplier: Supplier;
  compliance: Compliance;
  costing: Costing;
  po: PurchaseOrder;
  payments: Payment[];
  production: Production;
  qc: QualityInspection;
  logistics: Logistics;
  working: Working;
}

// ---- Defaults -----------------------------------------------------------------

let seq = 0;
function uid(prefix = "id") {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function blankProduct(name: string): Product {
  return {
    id: uid("p"),
    name,
    category: "",
    createdAt: Date.now(),
    filed: false,
    filedAt: null,
    market: [],
    supplier: { name: "", type: "UNKNOWN", contact: "", verification: "UNVERIFIED", notes: "" },
    compliance: {
      hsCode: "",
      dutyRatePct: 0,
      igstRatePct: 18,
      licenceRequired: false,
      licenceStatus: "NOT_REQUIRED",
      status: "BLOCKED",
    },
    costing: {
      marketplace: "AMAZON_IN",
      sellingPrice: 0,
      exWorks: 0,
      freightPerUnit: 0,
      referralPct: 15,
      fulfilmentFee: 0,
      adPct: 10,
      returnPct: 5,
      requiredMarginPct: 20,
    },
    po: {
      poNumber: "",
      quantity: 0,
      unitPrice: 0,
      moqConfirmed: false,
      incoterm: "FOB",
      paymentSplit: "30 / 70",
    },
    payments: [],
    production: {
      moldRequired: false,
      moldStatus: "",
      packagingApproved: false,
      packagingNote: "",
      ppSample: "PENDING",
    },
    qc: { inspector: "", result: "PENDING", defectRatePct: 0, notes: "" },
    logistics: {
      vessel: "",
      containerNo: "",
      blNumber: "",
      shippingAgentName: "",
      shippingAgentNumber: "",
      shippingAgentContact: "",
      mLoading: false,
      mToPort: false,
      mUnloadedAtPort: false,
      mLoadedToShip: false,
      ciCollected: false,
      packingListCollected: false,
      cooCollected: false,
      shippingBill: false,
      lcPayment: false,
      insurance: false,
      fumigation: false,
      inspectionCert: false,
      etd: "",
      eta: "",
      arrived: false,
      chaName: "",
      chaNumber: "",
      chaContact: "",
      chaAppointed: false,
      igmNumber: "",
      igmDate: "",
      igmLineNo: "",
      boeNumber: "",
      boeDate: "",
      clearancePort: "",
      boeFiled: false,
      assessed: false,
      assessableValue: 0,
      bcdAmount: 0,
      swsAmount: 0,
      dutyPaid: 0,
      igstPaid: 0,
      dutyCharged: false,
      examDone: false,
      portDays: 0,
      outOfCharge: false,
      outOfChargeDate: "",
      docBoE: false,
      docDO: false,
      docInvoice: false,
      docPackingList: false,
      docCoo: false,
      docLicence: false,
      docInsurance: false,
      docIec: false,
      docTechWriteup: false,
      docImages: {},
      chassisNo: "",
      orderedQty: 0,
      receivedQty: 0,
      invoicedQty: 0,
      handedToInventory: false,
    },
    working: {
      productMedia: [],
      sampleMedia: [],
      productImage: "",
      sampleImage: "",
      sampleResult: "PENDING",
      sampleNotes: "",
      rejectReason: "",
      moq: 0,
      moqNote: "",
      rate: "FOB",
      rateValue: 0,
      rateCurrency: "USD",
      advancePaid: 0,
      moldRequired: false,
      packagingDone: false,
      packagingMedia: [],
      packagingResult: "PENDING",
      packagingRejectReason: "",
      orderProcessing: false,
      productionStart: "",
      productionReady: "",
      dispatched: false,
    },
  };
}

export function blankManufacturer(name = ""): Manufacturer {
  return {
    id: uid("mfr"),
    name,
    type: "FACTORY",
    verification: "UNVERIFIED",
    city: "",
    address: "",
    productLines: "",
    certNumber: "",
    certImage: "",
    repName: "",
    repNumber: "",
    repWechat: "",
    repWechatQr: "",
    website: "",
    moq: "",
    rating: 0,
    notes: "",
    catalogs: [],
    createdAt: Date.now(),
  };
}

// Deep-merge a stored product onto a fresh blank so any newly-added fields
// (top-level or one level of nested objects) get sensible defaults. Guards
// against undefined nested values like `logistics.docImages` on old records.
function migrateProduct(stored: Partial<Product> | undefined): Product {
  const base = blankProduct(stored?.name ?? "Untitled product");
  if (!stored) return base;
  const merged: Product = { ...base, ...stored } as Product;
  // Re-merge nested object slices so missing keys fall back to defaults.
  const nestedKeys: (keyof Product)[] = [
    "supplier",
    "compliance",
    "costing",
    "po",
    "production",
    "qc",
    "logistics",
    "working",
  ];
  const mergedRec = merged as unknown as Record<string, unknown>;
  const storedRec = stored as unknown as Record<string, unknown>;
  for (const k of nestedKeys) {
    const sv = storedRec[k as string];
    if (sv && typeof sv === "object" && !Array.isArray(sv)) {
      mergedRec[k as string] = {
        ...(base[k] as object),
        ...(sv as object),
      };
    }
  }
  // Ensure the docImages map exists, and migrate old string entries (one base64
  // image per doc) into MediaItem arrays so several files per doc are supported.
  merged.logistics.docImages = normalizeDocImages(merged.logistics.docImages);
  // Arrays default to empty if missing.
  merged.market = Array.isArray(stored.market) ? stored.market : base.market;
  merged.payments = Array.isArray(stored.payments) ? stored.payments : base.payments;

  // Media galleries: keep stored arrays, and fold any legacy single image into
  // the matching gallery so older records don't lose their photo.
  merged.working.productMedia = Array.isArray(merged.working.productMedia)
    ? merged.working.productMedia
    : [];
  merged.working.sampleMedia = Array.isArray(merged.working.sampleMedia)
    ? merged.working.sampleMedia
    : [];
  merged.working.packagingMedia = Array.isArray(merged.working.packagingMedia)
    ? merged.working.packagingMedia
    : [];
  // Older records used a boolean packagingDone; map it to the result enum.
  if (!merged.working.packagingResult) {
    merged.working.packagingResult = merged.working.packagingDone ? "APPROVED" : "PENDING";
  }
  if (merged.working.productMedia.length === 0 && merged.working.productImage) {
    merged.working.productMedia = [legacyImageItem(merged.working.productImage)];
  }
  if (merged.working.sampleMedia.length === 0 && merged.working.sampleImage) {
    merged.working.sampleMedia = [legacyImageItem(merged.working.sampleImage)];
  }
  return merged;
}

// Wrap a legacy single base64 image into a MediaItem.
function legacyImageItem(data: string): MediaItem {
  return { id: uid("media"), kind: "image", fileName: "image", fileType: "image/*", data };
}

// Accept either the old shape (Record<string,string>) or the new one
// (Record<string,MediaItem[]>) and always return the new shape.
function normalizeDocImages(
  raw: Record<string, unknown> | undefined
): Record<string, MediaItem[]> {
  const out: Record<string, MediaItem[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      out[key] = val as MediaItem[];
    } else if (typeof val === "string" && val) {
      out[key] = [legacyImageItem(val)];
    }
  }
  return out;
}

// ---- Store context ------------------------------------------------------------

interface StoreShape {
  products: Product[];
  activeId: string | null;
  active: Product | null;
  setActiveId: (id: string) => void;
  addProduct: (name: string) => void;
  removeProduct: (id: string) => void;
  // file a product to the dashboard and clear the active process
  fileProduct: (id: string) => void;
  // reopen a filed product back into the process
  reopenProduct: (id: string) => void;
  // update a slice of the active product
  patch: <K extends keyof Product>(key: K, value: Product[K]) => void;
  uid: (prefix?: string) => string;
  // ---- Manufacturer / trader directory (top-level, reusable) ----
  manufacturers: Manufacturer[];
  addManufacturer: () => string;
  updateManufacturer: (id: string, patch: Partial<Manufacturer>) => void;
  removeManufacturer: (id: string) => void;
}

const StoreCtx = createContext<StoreShape | null>(null);

const KEY = "sourcing-tracker:v1";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          products: Product[];
          activeId: string | null;
          manufacturers?: Manufacturer[];
        };
        // Backfill any fields added after a product was first saved (e.g. docImages),
        // so older stored products never hit undefined nested values.
        const migrated = (parsed.products ?? []).map(migrateProduct);
        setProducts(migrated);
        setActiveIdState(parsed.activeId ?? migrated[0]?.id ?? null);
        setManufacturers(parsed.manufacturers ?? []);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Persist on change (after hydration so we don't clobber stored data).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ products, activeId, manufacturers }));
    } catch {
      /* ignore */
    }
  }, [products, activeId, manufacturers, hydrated]);

  const setActiveId = useCallback((id: string) => setActiveIdState(id), []);

  const addProduct = useCallback((name: string) => {
    const p = blankProduct(name || "Untitled product");
    setProducts((prev) => [...prev, p]);
    setActiveIdState(p.id);
  }, []);

  const removeProduct = useCallback((id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setActiveIdState((cur) => (cur === id ? null : cur));
  }, []);

  // Mark a product as filed (it stays on the dashboard) and clear it out of the
  // active process so the panels go empty for the next product.
  const fileProduct = useCallback((id: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, filed: true, filedAt: Date.now() } : p))
    );
    setActiveIdState((cur) => (cur === id ? null : cur));
  }, []);

  // Bring a filed product back into the process for editing.
  const reopenProduct = useCallback((id: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, filed: false, filedAt: null } : p))
    );
    setActiveIdState(id);
  }, []);

  const patch = useCallback(
    <K extends keyof Product>(key: K, value: Product[K]) => {
      setProducts((prev) =>
        prev.map((p) => (p.id === activeId ? { ...p, [key]: value } : p))
      );
    },
    [activeId]
  );

  const addManufacturer = useCallback(() => {
    const m = blankManufacturer();
    setManufacturers((prev) => [m, ...prev]);
    return m.id;
  }, []);

  const updateManufacturer = useCallback((id: string, p: Partial<Manufacturer>) => {
    setManufacturers((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));
  }, []);

  const removeManufacturer = useCallback((id: string) => {
    setManufacturers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const active = useMemo(
    () => products.find((p) => p.id === activeId) ?? null,
    [products, activeId]
  );

  const value: StoreShape = {
    products,
    activeId,
    active,
    setActiveId,
    addProduct,
    removeProduct,
    fileProduct,
    reopenProduct,
    patch,
    uid,
    manufacturers,
    addManufacturer,
    updateManufacturer,
    removeManufacturer,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
