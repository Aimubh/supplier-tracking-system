// Enrichment for the Sourcing Model: turn the raw fields a scraper returns
// (title, specs, price, country, image) into the per-SKU inputs the model needs.
//
// IMPORTANT: HSN code and unit weight are NOT reliably available on Alibaba, so
// they are *estimated* here (HSN from a keyword→code map; weight from category +
// dimensions). Every estimate is flagged so the UI can mark it "verify" — these
// must never silently feed a wrong duty into a real order.

import type { SourcingInputs } from "./sourcing-model";

// The raw shape we accept from the Vendex scraper (a subset of its SupplierResult).
export interface ScrapedProduct {
  productName?: string;
  productDescription?: string;
  unitPriceUSD?: number;
  priceRangeMin?: number;
  country?: string;
  moq?: number;
  productImageUrl?: string;
  productProperties?: Record<string, unknown>;
}

// Keyword → HSN map, aligned with the HSN codes used in the LAZERECOM workbook.
// First match wins; order matters (more specific terms first).
const HSN_RULES: { hsn: string; keywords: string[] }[] = [
  { hsn: "7013", keywords: ["glass", "tumbler", "mug glass", "coffee cup", "glassware"] },
  { hsn: "6307", keywords: ["towel", "napkin", "microfiber", "cloth", "wipe"] },
  { hsn: "3924", keywords: ["food box", "lunch box", "container", "coaster", "tableware", "kitchenware", "cup", "bottle", "collapsible"] },
  { hsn: "3926", keywords: ["silicone", "plastic", "lanyard", "strap", "gloves", "phone", "case", "holder"] },
  { hsn: "4202", keywords: ["bag", "pouch", "backpack", "wallet", "case bag"] },
  { hsn: "8513", keywords: ["torch", "flashlight", "lamp", "led light"] },
  { hsn: "9503", keywords: ["toy", "puzzle", "game"] },
];

// Rough per-category density / base-weight hints for estimating unit weight (g)
// when only a size string is available. Deliberately conservative.
const WEIGHT_HINTS: { match: string[]; base: number }[] = [
  { match: ["glass", "ceramic"], base: 250 },
  { match: ["lunch box", "container", "food box"], base: 180 },
  { match: ["gloves", "towel", "napkin"], base: 60 },
  { match: ["lanyard", "strap", "coaster"], base: 25 },
  { match: ["bottle", "cup", "tumbler"], base: 120 },
];

export interface EnrichmentFlags {
  hsnEstimated: boolean;
  weightEstimated: boolean;
  colourParsed: boolean;
}

export interface EnrichedResult {
  inputs: Partial<SourcingInputs>;
  flags: EnrichmentFlags;
}

function lc(s: string | undefined): string {
  return (s ?? "").toLowerCase();
}

// Guess an HSN code from the product name/description.
export function guessHsn(text: string): { hsn: string; estimated: boolean } {
  const t = lc(text);
  for (const rule of HSN_RULES) {
    if (rule.keywords.some((k) => t.includes(k))) return { hsn: rule.hsn, estimated: true };
  }
  return { hsn: "", estimated: true };
}

// Pull a colour word out of the title/description if present.
const COLOURS = [
  "black", "white", "grey", "gray", "silver", "gold", "red", "blue", "green",
  "yellow", "pink", "purple", "orange", "brown", "beige", "transparent", "clear",
];
export function parseColour(text: string): string {
  const t = lc(text);
  return COLOURS.find((c) => t.includes(c)) ?? "";
}

// Pull a dimension/size token (e.g. "84×530 mm", "12 oz", "1.4 L", "350 ml").
export function parseDimension(text: string): string {
  const t = text ?? "";
  const patterns = [
    /\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?(\s*[x×]\s*\d+(\.\d+)?)?\s*(mm|cm|m)?/i,
    /\d+(\.\d+)?\s*(oz|ml|l|litre|liter)\b/i,
    /ø\s*\d+(\.\d+)?\s*mm/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[0].trim();
  }
  return "";
}

// Estimate unit weight (g) from the category + any dimension hint.
export function estimateWeight(text: string): { grams: number; estimated: boolean } {
  const t = lc(text);
  const hint = WEIGHT_HINTS.find((h) => h.match.some((m) => t.includes(m)));
  return { grams: hint ? hint.base : 0, estimated: true };
}

// Read a value from the scraper's real product_properties (DataHub item
// properties), matching any of the given key fragments case-insensitively.
function propLookup(props: Record<string, unknown> | undefined, keys: string[]): string {
  if (!props) return "";
  const entries = Object.entries(props);
  for (const k of keys) {
    const hit = entries.find(([name]) => name.toLowerCase().includes(k.toLowerCase()));
    if (hit && hit[1] != null && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  return "";
}

// Parse a weight string like "7", "7 kg", "300 g", "0.3kg" → grams.
function weightToGrams(raw: string): number {
  const s = raw.toLowerCase().replace(/,/g, "");
  const m = s.match(/([\d.]+)\s*(kg|g|gram|grams)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  // If unit is grams use as-is; otherwise (kg or bare number) treat as kg→g when
  // it has a kg hint, else assume the figure is already grams only for small <... ambiguous.
  if (/g\b|gram/.test(s) && !/kg/.test(s)) return Math.round(n);
  if (/kg/.test(s)) return Math.round(n * 1000);
  // bare number: weight props on Alibaba are usually kg → convert
  return Math.round(n * 1000);
}

// Map a scraped product into partial Sourcing inputs + flags. Prefers the real
// structured properties from the scraper; falls back to parsing the title.
export function enrichScraped(p: ScrapedProduct): EnrichedResult {
  const text = `${p.productName ?? ""} ${p.productDescription ?? ""}`;
  const props = p.productProperties;

  // Colour: real property first, else parse from title.
  const realColour = propLookup(props, ["color", "colour"]);
  const colour = realColour || parseColour(text);

  // Dimension: real "Single package size" / "dimensions" / "size", else parse.
  const realDim = propLookup(props, ["single package size", "dimensions", "size", "product size"]);
  const dim = realDim || parseDimension(text);

  // Weight: real "weight (kg)" / "gross weight", else estimate from category.
  const realWeightRaw = propLookup(props, ["gross weight", "weight (kg)", "weight(kg)", "weight", "net weight"]);
  let weightG = 0;
  let weightEstimated = true;
  if (realWeightRaw) {
    weightG = weightToGrams(realWeightRaw);
    weightEstimated = false;
  } else {
    weightG = estimateWeight(text).grams;
  }

  // HSN still guessed (Alibaba never provides it). Use material prop if present
  // to improve the guess.
  const material = propLookup(props, ["material"]);
  const hsn = guessHsn(`${text} ${material}`);

  // Prefer the lowest tier price as the FOB the model costs from.
  const fob = p.priceRangeMin && p.priceRangeMin > 0 ? p.priceRangeMin : p.unitPriceUSD ?? 0;

  return {
    inputs: {
      itemName: p.productName ?? "",
      colour,
      hsnCode: hsn.hsn,
      size: dim,
      unitWeightG: weightG,
      fobUsd: fob,
      orderQty: p.moq && p.moq > 0 ? p.moq : 0,
    },
    flags: {
      hsnEstimated: hsn.estimated,
      weightEstimated,
      colourParsed: colour !== "",
    },
  };
}
