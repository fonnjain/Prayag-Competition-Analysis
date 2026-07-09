// Length-based price normalization.
//
// Competitor and Prayag prices are quoted on different bases for length-based
// products (pipes/coils): some per piece for a standard pack length ("3 Mtr"),
// some per running metre, some per foot. To compare like-for-like we reduce
// every length-based price to a price per 1 metre before computing diff%.
//
// Ground truth: Prayag MRP is per-piece and scales linearly with pack length
// (PS-1 3 MTR = 237, PS-1S 5 MTR = 395 → both exactly ₹79/m), so dividing a
// per-piece price by its pack length yields a valid per-metre price.
//
// When the basis cannot be determined confidently (ambiguous unit, or several
// pack lengths in one description) we DO NOT guess — the row is flagged
// `ambiguous` for manual review instead of producing a misleading number.

const FT_TO_M = 0.3048;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Human-friendly length label, e.g. 3 → "3 m", 1.8288 → "6 ft".
function fmtLen(m: number): string {
  const ft = m / FT_TO_M;
  if (Math.abs(ft - Math.round(ft)) < 1e-6 && Math.abs(m - Math.round(m)) > 1e-6) {
    return `${Math.round(ft)} ft`;
  }
  return `${round2(m)} m`;
}

// Parse every distinct length (in metres) mentioned in a text blob. Recognises
// "N mtr/metre/meter", a bare "N m" (guarded against "mm"), and "N ft/feet/foot"
// (converted via 1 ft = 0.3048 m). The apostrophe (') is intentionally NOT
// treated as feet because in these sheets sizes like 2-1/2'x2" mean inches.
export function parseLengthsMetres(text: string): number[] {
  const s = (text || "").replace(/\u2044/g, "/").toLowerCase();
  const found = new Set<number>();

  let m: RegExpExecArray | null;

  // Several lengths sharing one trailing unit, e.g. "3 & 5 mtr", "3, 5 & 6 m",
  // "3 and 5 mtr". Each listed number is its own length (so the row is later
  // flagged ambiguous), not just the last one before the unit word.
  const listRe =
    /((?:\d+(?:\.\d+)?\s*(?:&|and|,|\+)\s*)+\d+(?:\.\d+)?)\s*(mtrs?|metres?|meters?|ft|feet|foot)\b/g;
  while ((m = listRe.exec(s)) !== null) {
    const nums = m[1]!.match(/\d+(?:\.\d+)?/g) ?? [];
    const isFt = /^f/.test(m[2]!);
    for (const n of nums) found.add(round4(parseFloat(n) * (isFt ? FT_TO_M : 1)));
  }

  const mtrRe = /(\d+(?:\.\d+)?)\s*(?:mtrs?|metres?|meters?)\b/g;
  while ((m = mtrRe.exec(s)) !== null) found.add(round4(parseFloat(m[1]!)));

  // Bare "m" length (e.g. "3m") — require a word boundary and ensure the next
  // char is not another "m", so "15 mm" (millimetres) is never read as metres.
  const mBareRe = /(\d+(?:\.\d+)?)\s*m\b(?!m)/g;
  while ((m = mBareRe.exec(s)) !== null) found.add(round4(parseFloat(m[1]!)));

  const ftRe = /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\b/g;
  while ((m = ftRe.exec(s)) !== null) found.add(round4(parseFloat(m[1]!) * FT_TO_M));

  return [...found];
}

export type NormStatus = "normalized" | "not_length" | "ambiguous";

export interface NormResult {
  status: NormStatus;
  // Price per 1 metre when status === "normalized", else null.
  perMetre: number | null;
  // The pack length used to normalize (metres), when known.
  lengthM: number | null;
  // Human note describing how it was normalized, or why it is ambiguous.
  note: string | null;
}

// Reduce a single quoted price to a per-metre price, or classify it as a
// non-length product (compare raw) or ambiguous (needs manual review).
export function normalizePerMetre(input: {
  description?: string | null;
  size?: string | null;
  unit?: string | null;
  price: number;
}): NormResult {
  const { price } = input;
  const desc = input.description ?? "";
  const text = `${desc} ${input.size ?? ""}`;
  const u = (input.unit ?? "").toLowerCase();

  if (!(price > 0)) {
    return { status: "ambiguous", perMetre: null, lengthM: null, note: "non-positive price" };
  }

  const lengths = parseLengthsMetres(text);
  const distinct = [...new Set(lengths.map(round4))];
  const isPipe = /\b(pipe|coil|conduit|casing|column\s*pipe)\b/i.test(desc);

  const hasMtrUnit = /\b(mtr|mtrs|metre|metres|meter|meters|rmt|rm)\b|\/\s*mtr|per\s*mtr/.test(u);
  const hasPcUnit = /\b(pc|pcs|piece|pieces|nos?)\b|per\s*pc/.test(u);
  // Type-dependent compound unit, e.g. "per pc (fittings)/mtr (pipe)".
  const typeMixed = u.includes("fitting") && u.includes("pipe");

  // 1) Type-dependent unit: pipes are per metre, fittings are per piece.
  if (typeMixed) {
    if (isPipe) {
      return {
        status: "normalized",
        perMetre: round2(price),
        lengthM: distinct.length === 1 ? distinct[0]! : null,
        note: "per metre (as quoted for pipe)",
      };
    }
    return { status: "not_length", perMetre: null, lengthM: null, note: null };
  }

  // 2) Generic ambiguous unit carrying BOTH metre and piece (e.g. "per mtr/pc").
  if (hasMtrUnit && hasPcUnit) {
    if (distinct.length > 0 || isPipe) {
      return {
        status: "ambiguous",
        perMetre: null,
        lengthM: null,
        note: "unit is per-metre or per-piece",
      };
    }
    return { status: "not_length", perMetre: null, lengthM: null, note: null };
  }

  // 3) Pure per-metre unit: the price is already per metre.
  if (hasMtrUnit) {
    return {
      status: "normalized",
      perMetre: round2(price),
      lengthM: distinct.length === 1 ? distinct[0]! : null,
      note: "per metre (as quoted)",
    };
  }

  // 4) Per-piece or unknown unit: divide by the pack length when there is
  // exactly one. Several lengths ("3 & 5 mtr") cannot be resolved.
  if (distinct.length === 1) {
    const L = distinct[0]!;
    if (L > 0) {
      return {
        status: "normalized",
        perMetre: round2(price / L),
        lengthM: L,
        note: `÷ ${fmtLen(L)} length`,
      };
    }
    return { status: "ambiguous", perMetre: null, lengthM: null, note: "zero length" };
  }
  if (distinct.length > 1) {
    return {
      status: "ambiguous",
      perMetre: null,
      lengthM: null,
      note: `multiple lengths (${distinct.map(fmtLen).join(", ")})`,
    };
  }

  // Length-based wording but no usable length and no per-metre unit.
  if (isPipe) {
    return {
      status: "ambiguous",
      perMetre: null,
      lengthM: null,
      note: "length-based product but no length found",
    };
  }

  // Not a length-based product (fitting etc.) — compare on raw price.
  return { status: "not_length", perMetre: null, lengthM: null, note: null };
}

export interface CompareNorm {
  compPerMetre: number | null;
  prayagPerMetre: number | null;
  perMetreDiffPct: number | null;
  // True when both sides were reduced to per-metre for the comparison.
  lengthNormalized: boolean;
  // True when the basis can't be determined — flag for manual review.
  unitAmbiguous: boolean;
  normalizationNote: string | null;
}

export const NO_NORM: CompareNorm = {
  compPerMetre: null,
  prayagPerMetre: null,
  perMetreDiffPct: null,
  lengthNormalized: false,
  unitAmbiguous: false,
  normalizationNote: null,
};

// Compare a competitor price against the Prayag MRP, normalizing both to a
// per-metre basis when the product is length-based. Returns NO_NORM (raw
// comparison is correct) for non-length products, and flags unitAmbiguous when
// the basis is unclear on either side.
export function computeCompareNorm(args: {
  prayagName: string | null;
  prayagMrp: number | null;
  description: string | null;
  size: string | null;
  unit: string | null;
  price: number;
}): CompareNorm {
  const comp = normalizePerMetre({
    description: args.description,
    size: args.size,
    unit: args.unit,
    price: args.price,
  });

  if (comp.status === "not_length") return NO_NORM;
  if (comp.status === "ambiguous") {
    return { ...NO_NORM, unitAmbiguous: true, normalizationNote: comp.note };
  }

  // Competitor is length-based → reduce Prayag MRP to per-metre too.
  if (args.prayagMrp == null) {
    return {
      ...NO_NORM,
      compPerMetre: comp.perMetre,
      lengthNormalized: true,
      normalizationNote: comp.note,
    };
  }
  const pr = normalizePerMetre({
    description: args.prayagName,
    size: null,
    unit: null,
    price: args.prayagMrp,
  });

  if (pr.status === "not_length") {
    // Competitor is per-metre but the Prayag product is not length-based —
    // the two prices are on different bases, so flag for review.
    return {
      ...NO_NORM,
      compPerMetre: comp.perMetre,
      unitAmbiguous: true,
      normalizationNote: "Prayag product is not length-based but competitor is",
    };
  }
  if (pr.status === "ambiguous" || pr.perMetre == null) {
    return {
      ...NO_NORM,
      compPerMetre: comp.perMetre,
      lengthNormalized: true,
      unitAmbiguous: true,
      normalizationNote: `Prayag pack length unknown (${pr.note ?? "no length in name"})`,
    };
  }

  const compPerMetre = comp.perMetre!;
  const prayagPerMetre = pr.perMetre;
  const perMetreDiffPct =
    compPerMetre > 0
      ? Math.round(((prayagPerMetre - compPerMetre) / compPerMetre) * 1000) / 10
      : null;
  return {
    compPerMetre,
    prayagPerMetre,
    perMetreDiffPct,
    lengthNormalized: true,
    unitAmbiguous: false,
    normalizationNote: comp.note,
  };
}
