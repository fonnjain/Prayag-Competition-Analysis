/** Pure, shared invoice arithmetic. No settings, prices or state are written. */
export type CalculatorBlock = {
  id: string; itemCode: string | null; variant: string; discount: string; quantity: string;
  competitors: { id: string; competitor: string | null; discount: string }[];
};
export type CalculatorPrice = { price: number | null; effectiveDate: string | null };
export type CalculatorMetadata = { basis: string | null; unit: string | null };
const basisKey = (value: string | null) => value?.trim().toLowerCase() ?? "";
const knownBases = new Set(["mrp", "net", "ex-gst"]);
const unitKey = (value: string | null) => value?.trim().toLowerCase().replace(/^(nos\.?|pcs\.?|pieces?|each)$/, "each") ?? "";

/** Compare like fields only. Display strings are never comparison inputs.
 * A basis token in a unit field is malformed evidence, not a physical unit.
 * Generic NOS does not prove a specific pipe length; never infer or convert it. */
export function compareCalculatorMetadata(ours: CalculatorMetadata, theirs: CalculatorMetadata) {
  const ourBasis = basisKey(ours.basis), theirBasis = basisKey(theirs.basis);
  const basisWarning = !knownBases.has(ourBasis) || !knownBases.has(theirBasis)
    ? `Price basis not confirmed: ours ${ours.basis?.trim() || "not recorded"}; competitor ${theirs.basis?.trim() || "not recorded"}.`
    : ourBasis !== theirBasis ? `Price basis differs: ours ${ours.basis!.trim()}; competitor ${theirs.basis!.trim()}.` : null;
  const ourUnit = unitKey(ours.unit), theirUnit = unitKey(theirs.unit);
  const misplaced = (value: string) => knownBases.has(value) || value === "verify";
  const unitWarning = misplaced(ourUnit) || misplaced(theirUnit)
    ? `Unit data-shape problem: ${misplaced(ourUnit) ? `our unit field contains price basis "${ours.unit}"` : `competitor unit field contains price basis "${theirs.unit}"`}.`
    : !ourUnit || !theirUnit
      ? `Unit not recorded: ours ${ours.unit?.trim() || "not recorded"}; competitor ${theirs.unit?.trim() || "not recorded"}.`
      : ourUnit !== theirUnit ? `Units not confirmed equivalent: ours ${ours.unit!.trim()}; competitor ${theirs.unit!.trim()}.` : null;
  return { basisMismatch: basisWarning !== null, unitMismatch: unitWarning !== null, basisWarning, unitWarning };
}
export type CalculatorEvidence = {
  itemCode: string; productName: string | null; division: string | null; category: string | null;
  priceBasis: string; basis?: string | null; unit?: string | null; prayag: CalculatorPrice;
  /** Presence only, never a restricted quote or brand. Separates absence from filtering. */
  hasRecordedCompetitorPrice?: boolean;
  variants: (CalculatorPrice & { variant: string; basis?: string | null })[];
  competitors: (CalculatorPrice & { competitor: string; priceBasis: string; basis?: string | null; unit?: string | null;
    basisMismatch: boolean; unitMismatch?: boolean; basisWarning?: string | null; unitWarning?: string | null })[];
};
export function discountError(value: string | number): string | null {
  const s = String(value);
  return !/^\d+(\.\d{1,2})?$/.test(s) || Number(s) > 100
    ? "Discount must be 0–100 with at most 2 decimal places." : null;
}
export function quantityError(value: string | number): string | null {
  const s = String(value), n = Number(s);
  return !/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 1 ? "Quantity must be a whole number of at least 1." : null;
}
function decimalFraction(value: number): [bigint, bigint] {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const [whole, frac = ""] = mantissa.split(".");
  const shift = Number(exponent) - frac.length;
  return shift >= 0 ? [BigInt(whole + frac) * 10n ** BigInt(shift), 1n]
    : [BigInt(whole + frac), 10n ** BigInt(-shift)];
}
export function calculatorRow(mrp: number | null, discount: string | number, quantity: string | number) {
  const errors = { discount: discountError(discount), quantity: quantityError(quantity) };
  if (errors.discount || errors.quantity || mrp == null || !Number.isFinite(mrp) || mrp < 0)
    return { netUnit: null, total: null, quantity: errors.quantity ? null : Number(quantity), errors };
  const [n, d] = decimalFraction(mrp);
  const bps = BigInt(Math.round(Number(discount) * 100));
  const numerator = n * (10000n - bps) * 100n, denominator = d * 10000n;
  // Round at UNIT level first. 92 @33.33%, qty7 = 61.34*7 =429.38, NOT429.35.
  const cents = (2n * numerator + denominator) / (2n * denominator);
  const totalCents = cents * BigInt(Number(quantity));
  if (totalCents > BigInt(Number.MAX_SAFE_INTEGER)) return {
    netUnit: null, total: null, quantity: Number(quantity), errors: { ...errors, quantity: "Total is too large to represent safely." },
  };
  return { netUnit: Number(cents) / 100, total: Number(totalCents) / 100, quantity: Number(quantity), errors };
}
export function calculatorPosition(ours: number | null, theirs: number | null) {
  const diffUnit = ours == null || theirs == null ? null : Math.round((theirs - ours) * 100) / 100;
  const diffPct = diffUnit == null || ours === 0 ? null : diffUnit / ours! * 100;
  const direction = diffUnit == null ? "missing" : diffUnit > .005 ? "above" : diffUnit < -.005 ? "below" : "par";
  return { diffUnit, diffPct, direction, label: direction === "missing" ? "No price" : direction === "par" ? "At par"
    : `${diffPct == null ? "Percentage unavailable" : `${Math.abs(diffPct).toFixed(1)}%`} ${direction} us` };
}
export function resolveCalculator(blocks: CalculatorBlock[], evidence: CalculatorEvidence[]) {
  const byCode = new Map(evidence.map(p => [p.itemCode, p]));
  return blocks.filter(b => b.itemCode).map(block => {
    const product = byCode.get(block.itemCode!);
    const price = product?.variants.find(v => v.variant === block.variant);
    // A missing variant is missing evidence, never a Standard-price fallback.
    const our = calculatorRow(price?.price ?? null, block.discount, block.quantity);
    const ourPriceBasis = product && "basis" in product
      ? `${(price && "basis" in price ? price.basis : product.basis) || "basis not recorded"} · ${product.unit || "unit not recorded"}`
      : product?.priceBasis ?? "basis not recorded";
    const competitors = block.competitors.filter(c => c.competitor).map(c => {
      const quote = product?.competitors.find(q => q.competitor === c.competitor);
      const row = calculatorRow(quote?.price ?? null, c.discount, block.quantity);
      const checks = product && quote && "basis" in product && "basis" in quote
        ? compareCalculatorMetadata({ basis: price && "basis" in price ? price.basis ?? null : product.basis ?? null, unit: product.unit ?? null },
          { basis: quote.basis ?? null, unit: quote.unit ?? null })
        : { basisMismatch: !!quote?.basisMismatch, unitMismatch: !!quote?.unitMismatch,
          basisWarning: quote?.basisWarning ?? "Different price basis — check before relying on this",
          unitWarning: quote?.unitWarning ?? "Unit not confirmed — check before relying on this" };
      const variantMismatch = !!quote && block.variant !== "Standard";
      const warnings = [
        ...(checks.basisMismatch ? [checks.basisWarning!] : []),
        ...(checks.unitMismatch ? [checks.unitWarning!] : []),
        ...(variantMismatch ? [`Competitor colour variant is not recorded; comparison with ${block.variant} is unconfirmed.`] : []),
      ];
      return { ...c, quote, ...row, position: calculatorPosition(our.netUnit, row.netUnit),
        diffTotal: our.total == null || row.total == null ? null : Math.round((row.total - our.total) * 100) / 100,
        basisMismatch: checks.basisMismatch, unitMismatch: checks.unitMismatch, variantMismatch, warnings };
    });
    return { block, product, price, our, ourPriceBasis, competitors };
  });
}
export type ResolvedCalculator = ReturnType<typeof resolveCalculator>;
export function bestCalculatorCompetitor(row: ResolvedCalculator[number]) {
  const priced = row.competitors.filter(c => c.total != null).sort((a, b) => a.total! - b.total!);
  const best = priced[0];
  if (!best) return null;
  const gap = row.our.total == null ? null : Math.round((row.our.total - best.total!) * 100) / 100;
  return { brand: best.competitor!, total: best.total!, gap,
    gapPct: gap == null || best.total === 0 ? null : gap / best.total! * 100 };
}
const addMoney = (a: number, b: number) => (Math.round(a * 100) + Math.round(b * 100)) / 100;
export function summarizeCalculator(rows: ResolvedCalculator) {
  const available = rows.filter(r => r.product);
  const brands = [...new Set(available.flatMap(r => r.competitors.map(c => c.competitor!)))].sort();
  return {
    products: available.length,
    totalQuantity: available.reduce((n, r) => n + (r.our.quantity ?? 0), 0),
    ourValue: available.reduce((n, r) => addMoney(n, r.our.total ?? 0), 0),
    noCompetitorSelected: available.filter(r => !r.competitors.length).length,
    noCompetitorRecorded: available.filter(r => !(r.product!.hasRecordedCompetitorPrice ?? r.product!.competitors.length > 0)).length,
    noOurPrice: available.filter(r => r.our.total == null).length,
    unavailableProducts: rows.length - available.length,
    basisMismatchRows: available.reduce((n, r) => n + r.competitors.filter(c => c.basisMismatch).length, 0),
    unitMismatchRows: available.reduce((n, r) => n + r.competitors.filter(c => c.unitMismatch).length, 0),
    variantMismatchRows: available.reduce((n, r) => n + r.competitors.filter(c => c.variantMismatch).length, 0),
    brands: brands.map(brand => {
      const pairs = available.flatMap(r => {
        const c = r.competitors.find(c => c.competitor === brand);
        return c?.total != null && r.our.total != null ? [{ r, c }] : [];
      });
      const ourValue = pairs.reduce((n, p) => addMoney(n, p.r.our.total!), 0);
      const competitorValue = pairs.reduce((n, p) => addMoney(n, p.c.total!), 0);
      return { brand, compared: pairs.length, products: available.length,
        ourValue: pairs.length ? ourValue : null, competitorValue: pairs.length ? competitorValue : null,
        position: calculatorPosition(pairs.length ? ourValue : null, pairs.length ? competitorValue : null),
        cheaper: pairs.filter(p => p.c.position.direction === "above").length,
        par: pairs.filter(p => p.c.position.direction === "par").length,
        higher: pairs.filter(p => p.c.position.direction === "below").length };
    }),
  };
}
export function calculatorDisclosures(summary: ReturnType<typeof summarizeCalculator>, asOf: string, scope: string[]) {
  const date = asOf.split("-").reverse().join("-");
  return [
    ...(summary.noCompetitorSelected ? [`${summary.noCompetitorSelected} products in this set have no competitor selected.`] : []),
    ...(summary.noCompetitorRecorded ? [`${summary.noCompetitorRecorded} products have no competitor price recorded at all.`] : []),
    `Prices resolved as of ${date}.`,
    ...(summary.basisMismatchRows ? [`${summary.basisMismatchRows} rows have a different or unconfirmed price basis — see the warning marks.`] : []),
    ...(summary.unitMismatchRows ? [`${summary.unitMismatchRows} rows have missing, malformed or unconfirmed unit evidence — see the warning marks.`] : []),
    ...(summary.variantMismatchRows ? [`${summary.variantMismatchRows} rows compare a colour variant without confirmed competitor variant evidence.`] : []),
    ...(summary.noOurPrice ? [`${summary.noOurPrice} products have no usable Prayag price and are excluded from value comparisons.`] : []),
    ...(summary.unavailableProducts ? [`${summary.unavailableProducts} products are unavailable under the current date or scope.`] : []),
    ...scope,
  ];
}
