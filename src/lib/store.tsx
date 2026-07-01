"use client";

// Client data store, backed by the API (PostgreSQL via Prisma). Loads on mount,
// keeps an optimistic local copy for a snappy UI, and persists every change to
// the server (debounced for edits, immediate for create/delete).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_SOURCING_INPUTS,
  type SourcingAssumptions,
  type SourcingInputs,
} from "./sourcing-model";
import { EMPTY_MARKET_SIZE, type MarketSize } from "./market-size";

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
  // Product payment — the goods deal.
  rateValue: number; // agreed TOTAL product amount at that incoterm
  rateCurrency: CurrencyCode; // currency the product amount is entered in (section default)
  advancePaid: number; // advance already paid toward the product total
  // Shipment payment — freight / forwarder, tracked separately (own currency).
  shipmentValue: number; // agreed TOTAL shipment amount
  shipmentCurrency: CurrencyCode; // currency for the shipment amount (section default)
  shipmentAdvance: number; // advance already paid toward the shipment total
  // Optional per-field currency overrides for the four payment amounts. When a
  // key is absent the amount falls back to its section currency (rate* / shipment*).
  // Keys: "rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance".
  paymentCurrency?: Partial<Record<"rateValue" | "advancePaid" | "shipmentValue" | "shipmentAdvance", CurrencyCode>>;
  moldRequired: boolean;
  packagingDone: boolean; // derived: true once the logo/packaging is APPROVED
  // Packaging / logo design review: upload proofs, then approve or reject.
  packagingMedia: MediaItem[];
  packagingResult: SampleResult; // PENDING / APPROVED / REJECTED
  packagingRejectReason: string;
  orderProcessing: boolean;
  productionStart: string; // ISO date
  productionReady: string; // ISO target date (countdown)
  // Reminder lead times before productionReady (in days). 0 = "every day until".
  // e.g. [3, 1] = remind 3 days before AND 1 day before.
  notifyDaysBefore: number[];
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
  // Shipment lane + dimensions (from the forwarder quote). CBM & weight drive the
  // destination charges (THC/CFS are per CBM or per ton).
  pol: string; // Port of Loading (origin, e.g. Ningbo)
  pod: string; // Port of Discharge (destination, e.g. Nhava Sheva)
  packages: number; // number of packages / cartons
  grossWeightKg: number; // total gross weight in kg
  volumeCbm: number; // total volume in CBM (cubic metres)
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
  // Reminder lead times before the ETA (vessel arrival at port), in days.
  // 0 = "every day until arrival". e.g. [3, 1] = remind 3 days before AND 1 day before.
  notifyEtaDaysBefore: number[];
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
  indiaTransportCost: number; // port → our warehouse (last-mile, ₹)
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

// Actual landed-cost expenses for the Order Summary P&L. These are real amounts
// the team records (vs. the per-unit estimates in Costing). Currency follows the
// product's rate currency. "Final expense" = goods total + all of these.
//
// Freight is itemised to match a forwarder quote: Ocean freight + the India-side
// destination charges (DO / THC / CFS / WGMT) + GST. `freightActual` is kept as a
// legacy single field so older records still load; the UI sums the itemised lines.
export interface Expenses {
  freightActual: number; // legacy single freight figure (migrated/kept)
  // Itemised freight & destination charges.
  oceanFreight: number; // sea freight (POL → POD)
  doCharge: number; // Delivery Order fee
  thcCharge: number; // Terminal Handling Charge
  cfsCharge: number; // Container Freight Station handling
  wgmtCharge: number; // weighment
  gstCharge: number; // GST on the destination charges
  dutyActual: number; // customs duty + IGST paid
  chaCharges: number; // clearing agent / customs broker fees
  lastMileCost: number; // port/warehouse → our warehouse
  otherExpense: number; // misc (inspection, insurance, bank, etc.)
  sellingPriceTotal: number; // expected total revenue (for profit/loss)
  notes: string;
  // Optional per-field currency overrides for the itemised cost lines above.
  // When a field key is absent the amount is taken to be in the product currency
  // (working.rateCurrency), preserving the original single-currency behaviour.
  fieldCurrency?: Partial<Record<ExpenseMoneyField, CurrencyCode>>;
}

// The money-bearing expense fields that may carry a per-field currency override.
export type ExpenseMoneyField =
  | "oceanFreight" | "doCharge" | "thcCharge" | "cfsCharge" | "wgmtCharge" | "gstCharge"
  | "dutyActual" | "chaCharges" | "lastMileCost" | "otherExpense" | "sellingPriceTotal";

// Per-SKU sourcing & margin model (Pre-Order). Mirrors the LAZERECOM workbook:
// editable assumptions + per-SKU inputs; the verdict/landed cost are computed by
// src/lib/sourcing-model.ts and never stored (always derived from these).
// A supplier returned by the scrape/search — kept so the user can click through
// and verify each result themselves.
export interface SourcingSupplier {
  name: string;
  title: string;
  priceUsd: number | null;
  priceInr: number | null;
  reviews: number | null;
  rating: number | null;
  country: string;
  url: string;
  image: string;
  platform: string; // "alibaba" (FOB) | "google_lens" (retail)
}

export interface Sourcing {
  assumptions: SourcingAssumptions;
  inputs: SourcingInputs;
  suppliers: SourcingSupplier[]; // all results from the last fetch (for verification)
  marketSize: MarketSize; // ecom market snapshot (fetched on demand)
  // Provenance / confidence flags from the auto-fill (which fields were guessed).
  sourceUrl: string; // the pasted reel/Alibaba link
  supplierName: string; // top supplier from the scrape
  supplierProductUrl: string; // the Alibaba product page the data was scraped from
  supplierCountry: string; // top supplier's country
  supplierImageUrl: string; // product image from the scrape
  supplierCount: number; // how many suppliers the scrape returned
  hsnEstimated: boolean;
  weightEstimated: boolean;
}

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
  expenses: Expenses;
  sourcing: Sourcing;
  // Set when the product was created via the QR Generator (sample already in
  // hand → Pre-Order skipped). Optional so existing products stay valid.
  qrGen?: QrGen;
  // Runtime-only flags from the light list (NOT persisted). _light = media was
  // stripped for the list payload (load the full record before editing/saving);
  // _hasPhoto = a product image exists on the server (loads on open).
  _light?: boolean;
  _hasPhoto?: boolean;
}

// Details captured by the QR Generator tab. These are encoded into the QR code
// and shown when it's scanned. The product is created with the sample APPROVED
// and Pre-Order skipped, then the user is taken to On-Working.
export interface QrGen {
  skippedPreOrder: boolean;
  orderDate: string; // ISO date
  receivedDate: string; // ISO date the sample was received
  ownerName: string; // who logged it
  productName: string;
  moq: number;
  rate: number; // per-unit / agreed rate
  rateCurrency: CurrencyCode;
  sampleCharges: number;
  sampleCurrency: CurrencyCode;
  supplierName: string;
  supplierState: string; // supplier's state / region
  createdAt: number;
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
      pol: "",
      pod: "",
      packages: 0,
      grossWeightKg: 0,
      volumeCbm: 0,
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
      notifyEtaDaysBefore: [],
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
      indiaTransportCost: 0,
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
      rateCurrency: "INR",
      advancePaid: 0,
      shipmentValue: 0,
      shipmentCurrency: "INR",
      shipmentAdvance: 0,
      moldRequired: false,
      packagingDone: false,
      packagingMedia: [],
      packagingResult: "PENDING",
      packagingRejectReason: "",
      orderProcessing: false,
      productionStart: "",
      productionReady: "",
      notifyDaysBefore: [],
      dispatched: false,
    },
    expenses: {
      freightActual: 0,
      oceanFreight: 0,
      doCharge: 0,
      thcCharge: 0,
      cfsCharge: 0,
      wgmtCharge: 0,
      gstCharge: 0,
      dutyActual: 0,
      chaCharges: 0,
      lastMileCost: 0,
      otherExpense: 0,
      sellingPriceTotal: 0,
      notes: "",
    },
    sourcing: {
      assumptions: { ...DEFAULT_ASSUMPTIONS },
      inputs: { ...DEFAULT_SOURCING_INPUTS },
      suppliers: [],
      marketSize: { ...EMPTY_MARKET_SIZE },
      sourceUrl: "",
      supplierName: "",
      supplierProductUrl: "",
      supplierCountry: "",
      supplierImageUrl: "",
      supplierCount: 0,
      hsnEstimated: false,
      weightEstimated: false,
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
// Strip runtime-only flags (_light/_thumb) before persisting, so they never
// land in the DB JSON.
function stripRuntimeFlags(p: Product): Product {
  const { _light, _hasPhoto, ...rest } = p as Product & { _light?: boolean; _hasPhoto?: boolean };
  void _light;
  void _hasPhoto;
  return rest as Product;
}

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
    "expenses",
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
  // Sourcing is two-level (assumptions + inputs); deep-merge each so older rows
  // (and any new fields added later) always fall back to the model defaults.
  merged.sourcing = {
    assumptions: { ...base.sourcing.assumptions, ...(stored.sourcing?.assumptions ?? {}) },
    inputs: { ...base.sourcing.inputs, ...(stored.sourcing?.inputs ?? {}) },
    suppliers: Array.isArray(stored.sourcing?.suppliers) ? stored.sourcing.suppliers : [],
    marketSize: { ...base.sourcing.marketSize, ...(stored.sourcing?.marketSize ?? {}) },
    sourceUrl: stored.sourcing?.sourceUrl ?? "",
    supplierName: stored.sourcing?.supplierName ?? "",
    supplierProductUrl: stored.sourcing?.supplierProductUrl ?? "",
    supplierCountry: stored.sourcing?.supplierCountry ?? "",
    supplierImageUrl: stored.sourcing?.supplierImageUrl ?? "",
    supplierCount: stored.sourcing?.supplierCount ?? 0,
    hsnEstimated: stored.sourcing?.hsnEstimated ?? false,
    weightEstimated: stored.sourcing?.weightEstimated ?? false,
  };

  // Ensure the docImages map exists, and migrate old string entries (one base64
  // image per doc) into MediaItem arrays so several files per doc are supported.
  merged.logistics.docImages = normalizeDocImages(merged.logistics.docImages);
  merged.logistics.notifyEtaDaysBefore = Array.isArray(merged.logistics.notifyEtaDaysBefore)
    ? merged.logistics.notifyEtaDaysBefore
    : [];
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
  merged.working.notifyDaysBefore = Array.isArray(merged.working.notifyDaysBefore)
    ? merged.working.notifyDaysBefore
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
  // Lazily load a product's full media (the list is loaded light). Safe to call
  // whenever a product is opened/viewed; idempotent.
  ensureFull: (id: string) => void;
  addProduct: (name: string) => void;
  // Add a fully-built product (e.g. from the QR Generator, which pre-fills it and
  // skips Pre-Order). Returns the new product id.
  addProductFull: (product: Product) => string;
  removeProduct: (id: string) => void;
  // file a product to the dashboard and clear the active process
  fileProduct: (id: string) => void;
  // reopen a filed product back into the process
  reopenProduct: (id: string) => void;
  // update a slice of the active product
  patch: <K extends keyof Product>(key: K, value: Product[K]) => void;
  // update a slice of any product by id (used by Order Summary, etc.)
  patchProduct: <K extends keyof Product>(id: string, key: K, value: Product[K]) => void;
  uid: (prefix?: string) => string;
  // ---- Manufacturer / trader directory (top-level, reusable) ----
  manufacturers: Manufacturer[];
  addManufacturer: () => string;
  updateManufacturer: (id: string, patch: Partial<Manufacturer>) => void;
  removeManufacturer: (id: string) => void;
}

const StoreCtx = createContext<StoreShape | null>(null);

// ---- API helpers --------------------------------------------------------------

async function apiGet<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${url} failed`);
  return res.json();
}

function apiSend(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    /* network errors are swallowed; local state stays optimistic */
  });
}

// Per-entity debounced PATCH so rapid edits collapse into one network write.
function useDebouncedSaver(delay = 600) {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const save = useCallback(
    (url: string, body: unknown) => {
      const key = url;
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => apiSend("PATCH", url, body), delay);
    },
    [delay]
  );
  return save;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [, setHydrated] = useState(false);
  const saveProductDebounced = useDebouncedSaver();
  const saveManufacturerDebounced = useDebouncedSaver();

  // Load from the API once on mount. Use the LIGHT list (media stripped) so the
  // payload stays small no matter how many products exist; full media for any one
  // product is fetched lazily by ensureFull() when it's opened.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [prods, mfrs] = await Promise.all([
          apiGet<Partial<Product>>("/api/products?light=1"),
          apiGet<Manufacturer>("/api/manufacturers"),
        ]);
        if (cancelled) return;
        const migrated = prods.map(migrateProduct);
        setProducts(migrated);
        setActiveIdState(migrated[0]?.id ?? null);
        setManufacturers(mfrs);
      } catch {
        /* leave empty on failure */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazily replace a light product with its FULL record (media included). Called
  // when a product is opened/activated. Idempotent: no-op if already full or in
  // flight. Marks the product non-light so autosave is allowed afterwards.
  const fullLoads = useRef<Set<string>>(new Set());
  const ensureFull = useCallback(async (id: string) => {
    if (!id || fullLoads.current.has(id)) return;
    fullLoads.current.add(id);
    try {
      const res = await fetch(`/api/products/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const full = migrateProduct((await res.json()) as Partial<Product>);
      // Merge ONLY the media (previously-stripped) fields from the server into the
      // CURRENT local product, so any edits the user made before the full load
      // finished are preserved (don't overwrite the whole record). Then clear the
      // light flag so autosave is allowed.
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          if (!p._light) return p; // already full (or edited to full) — leave as is
          return {
            ...p,
            _light: false,
            _hasPhoto: undefined,
            working: {
              ...p.working,
              productMedia: full.working.productMedia,
              sampleMedia: full.working.sampleMedia,
              packagingMedia: full.working.packagingMedia,
              productImage: full.working.productImage,
              sampleImage: full.working.sampleImage,
            },
            logistics: { ...p.logistics, docImages: full.logistics.docImages },
            sourcing: full.sourcing ?? p.sourcing,
          };
        })
      );
    } catch {
      fullLoads.current.delete(id); // allow a retry on failure
    }
  }, []);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    void ensureFull(id);
  }, [ensureFull]);

  const addProduct = useCallback((name: string) => {
    const p = blankProduct(name || "Untitled product");
    setProducts((prev) => [...prev, p]);
    setActiveIdState(p.id);
    apiSend("POST", "/api/products", p);
  }, []);

  // Persist a pre-built product (QR Generator path). Caller has already shaped it
  // (sample approved, pre-order skipped, etc.). Makes it the active product.
  const addProductFull = useCallback((product: Product) => {
    setProducts((prev) => [...prev, product]);
    setActiveIdState(product.id);
    apiSend("POST", "/api/products", product);
    return product.id;
  }, []);

  const removeProduct = useCallback(async (id: string) => {
    // Snapshot for rollback if the server rejects the delete.
    let snapshot: Product[] = [];
    setProducts((prev) => {
      snapshot = prev;
      return prev.filter((p) => p.id !== id);
    });
    setActiveIdState((cur) => (cur === id ? null : cur));
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Server refused (auth/other). Put the product back and tell the user.
        setProducts(snapshot);
        const msg = res.status === 403
          ? "You don't have permission to delete products."
          : res.status === 401
          ? "Your session expired — please sign in again."
          : `Delete failed (HTTP ${res.status}).`;
        if (typeof window !== "undefined") window.alert(msg);
      }
    } catch {
      // Network error — restore and warn.
      setProducts(snapshot);
      if (typeof window !== "undefined") window.alert("Delete failed — network error. Please try again.");
    }
  }, []);

  // Mark a product as filed (it stays on the dashboard) and clear it out of the
  // active process so the panels go empty for the next product.
  const fileProduct = useCallback((id: string) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, filed: true, filedAt: Date.now() };
        // Never PATCH a _light product (its media is stripped → would wipe the DB).
        // Toggle `filed` directly on the server instead; the full media is untouched.
        if (p._light) {
          apiSend("PATCH", `/api/products/${id}`, { id, filed: true, filedAt: next.filedAt });
        } else {
          apiSend("PATCH", `/api/products/${id}`, stripRuntimeFlags(next));
        }
        return next;
      })
    );
    setActiveIdState((cur) => (cur === id ? null : cur));
  }, []);

  // Bring a filed product back into the process for editing.
  const reopenProduct = useCallback((id: string) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, filed: false, filedAt: null };
        // Flags-only PATCH for light products (don't wipe stripped media).
        if (p._light) {
          apiSend("PATCH", `/api/products/${id}`, { id, filed: false, filedAt: null });
        } else {
          apiSend("PATCH", `/api/products/${id}`, stripRuntimeFlags(next));
        }
        return next;
      })
    );
    setActiveId(id); // makes it active → triggers ensureFull to load full media
  }, [setActiveId]);

  const patch = useCallback(
    <K extends keyof Product>(key: K, value: Product[K]) => {
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== activeId) return p;
          const next = { ...p, [key]: value };
          // Don't autosave while media is still stripped (_light) — that would
          // persist empty media. ensureFull() (triggered on open) fills it first.
          if (p._light) {
            void ensureFull(p.id);
          } else {
            saveProductDebounced(`/api/products/${p.id}`, stripRuntimeFlags(next));
          }
          return next;
        })
      );
    },
    [activeId, saveProductDebounced, ensureFull]
  );

  const patchProduct = useCallback(
    <K extends keyof Product>(id: string, key: K, value: Product[K]) => {
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const next = { ...p, [key]: value };
          if (p._light) {
            void ensureFull(p.id); // load full media before any save
          } else {
            saveProductDebounced(`/api/products/${p.id}`, stripRuntimeFlags(next));
          }
          return next;
        })
      );
    },
    [saveProductDebounced, ensureFull]
  );

  const addManufacturer = useCallback(() => {
    const m = blankManufacturer();
    setManufacturers((prev) => [m, ...prev]);
    apiSend("POST", "/api/manufacturers", m);
    return m.id;
  }, []);

  const updateManufacturer = useCallback(
    (id: string, p: Partial<Manufacturer>) => {
      setManufacturers((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const next = { ...m, ...p };
          saveManufacturerDebounced(`/api/manufacturers/${id}`, next);
          return next;
        })
      );
    },
    [saveManufacturerDebounced]
  );

  const removeManufacturer = useCallback((id: string) => {
    setManufacturers((prev) => prev.filter((m) => m.id !== id));
    apiSend("DELETE", `/api/manufacturers/${id}`);
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
    ensureFull: (id: string) => void ensureFull(id),
    addProduct,
    addProductFull,
    removeProduct,
    fileProduct,
    reopenProduct,
    patch,
    patchProduct,
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
