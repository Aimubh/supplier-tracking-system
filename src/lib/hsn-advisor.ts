// HSN code advisor for the Sourcing Model.
//
// Given a product (name / description / material keywords), suggest the top
// candidate Indian HSN codes ranked by how well they FIT the product, each with
// its customs duty (BCD + SWS) and GST so the user can see the landed-cost
// impact and pick the correct code that is also favourable.
//
// ⚠️ LEGAL NOTE: the HSN code must be the one that CORRECTLY describes the goods.
// This advisor narrows the field and surfaces duty — it does NOT license picking
// a cheaper-but-wrong code (misclassification is a customs offence). Always
// confirm the final code + current rate on ICEGATE / with your CHA before
// ordering. Rates here are indicative (verify before relying on them).

export interface HsnEntry {
  hsn: string; // 4-digit heading (or more specific where useful)
  title: string; // plain description
  bcdPct: number; // Basic Customs Duty (fraction, e.g. 0.10)
  gstPct: number; // GST on sale (fraction)
  keywords: string[]; // terms that indicate this heading
  materials: string[]; // material signals that indicate this heading
}

// Curated reference for the categories Lazer sources (mirrors the workbook's
// 3924 / 7013 / 3926 / 6307 usage, plus common adjacent headings). SWS is a flat
// 10% of BCD across the board (added at calc time).
export const HSN_TABLE: HsnEntry[] = [
  {
    hsn: "3924",
    title: "Tableware, kitchenware & household articles of plastic",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["lunch box", "food box", "container", "coaster", "tableware", "kitchenware", "cup", "bottle", "collapsible", "storage box", "tray", "bowl"],
    materials: ["plastic", "silicone", "pp", "ps", "abs", "melamine"],
  },
  {
    hsn: "3926",
    title: "Other articles of plastics",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["lanyard", "strap", "gloves", "phone holder", "case", "clip", "hook", "buckle", "fastener", "stationery"],
    materials: ["plastic", "silicone", "pvc", "tpu", "acrylic"],
  },
  {
    hsn: "7013",
    title: "Glassware for table / kitchen / household",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["glass cup", "tumbler", "glassware", "glass jar", "glass bottle", "coffee glass", "mug"],
    materials: ["glass", "borosilicate"],
  },
  {
    hsn: "6307",
    title: "Other made-up textile articles",
    bcdPct: 0.1, gstPct: 0.12,
    keywords: ["towel", "napkin", "microfiber cloth", "wipe", "pouch", "cleaning cloth", "mask"],
    materials: ["textile", "microfiber", "cotton", "polyester", "fabric"],
  },
  {
    hsn: "4202",
    title: "Bags, cases, pouches (travel / cosmetic / similar)",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["bag", "backpack", "wallet", "handbag", "cosmetic bag", "travel case", "pouch bag", "toiletry"],
    materials: ["leather", "pu", "nylon", "polyester", "canvas"],
  },
  {
    hsn: "3923",
    title: "Plastic articles for packing / conveyance of goods",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["packaging", "bottle pump", "spray bottle", "jar", "tube", "dispenser", "lid", "cap"],
    materials: ["plastic", "pet", "hdpe"],
  },
  {
    hsn: "8513",
    title: "Portable electric lamps (battery / torch)",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["torch", "flashlight", "led light", "headlamp", "lantern"],
    materials: ["plastic", "aluminium", "metal"],
  },
  {
    hsn: "8516",
    title: "Electric heating / kitchen appliances",
    bcdPct: 0.2, gstPct: 0.18,
    keywords: ["heater", "kettle", "iron", "hair dryer", "toaster", "blender", "grill"],
    materials: ["plastic", "metal", "steel"],
  },
  {
    hsn: "9503",
    title: "Toys, puzzles & models",
    bcdPct: 0.6, gstPct: 0.12,
    keywords: ["toy", "puzzle", "doll", "building blocks", "game", "model kit"],
    materials: ["plastic", "wood"],
  },
  {
    hsn: "8536",
    title: "Electrical apparatus (switches, connectors, plugs ≤1000V)",
    bcdPct: 0.1, gstPct: 0.18,
    keywords: ["cable", "connector", "plug", "socket", "charger cable", "adapter"],
    materials: ["plastic", "copper", "metal"],
  },
];

export interface HsnCandidate {
  hsn: string;
  title: string;
  bcdPct: number;
  swsPct: number; // SWS = 10% of BCD
  gstPct: number;
  effectiveDutyPct: number; // BCD + SWS as a fraction of CIF
  score: number; // 0–100 fit
  reasons: string[];
  isLowestDuty: boolean; // among the candidates
}

const lc = (s: string) => (s ?? "").toLowerCase();

// Rank HSN headings by how well they fit the product text + material.
// Returns the top N candidates (default 3), each with duty + a fit score.
export function suggestHsn(
  text: string,
  material = "",
  topN = 3
): HsnCandidate[] {
  const hay = lc(`${text} ${material}`);
  const mat = lc(material);

  const scored = HSN_TABLE.map((e) => {
    let score = 0;
    const reasons: string[] = [];

    const kwHits = e.keywords.filter((k) => hay.includes(k));
    if (kwHits.length) {
      score += Math.min(kwHits.length * 30, 70);
      reasons.push(`Matches: ${kwHits.slice(0, 3).join(", ")}`);
    }
    const matHits = e.materials.filter((m) => mat.includes(m) || hay.includes(m));
    if (matHits.length) {
      score += Math.min(matHits.length * 15, 30);
      reasons.push(`Material fits: ${matHits.slice(0, 2).join(", ")}`);
    }
    return { e, score, reasons };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  if (scored.length === 0) return [];

  const minDuty = Math.min(...scored.map((x) => x.e.bcdPct * (1 + 0.1)));

  return scored.map((x) => {
    const swsPct = 0.1; // 10% of BCD
    const effectiveDutyPct = x.e.bcdPct * (1 + swsPct);
    return {
      hsn: x.e.hsn,
      title: x.e.title,
      bcdPct: x.e.bcdPct,
      swsPct,
      gstPct: x.e.gstPct,
      effectiveDutyPct,
      score: Math.min(Math.round(x.score), 100),
      reasons: x.reasons,
      isLowestDuty: Math.abs(effectiveDutyPct - minDuty) < 1e-9,
    };
  });
}
