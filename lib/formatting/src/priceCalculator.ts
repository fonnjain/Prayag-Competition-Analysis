/** Pure, shared invoice arithmetic. No settings, prices or state are written. */
export type CalculatorBlock = {
  id: string; itemCode: string | null; variant: string; discount: string; quantity: string;
  /** Basket-only assertions. Undefined MRP means use the freshly resolved app value. */
  mrp?: string; adHocProduct?: boolean; description?: string;
  competitors: { id: string; competitor: string | null; discount: string; mrp?: string; adHoc?: boolean }[];
};
export type CalculatorPriceState = "App" | "Edited" | "Entered";
export const CALCULATOR_SCOPE_DISCLOSURE = "This calculator searches the full product catalogue and all competitors, without bucket or company filters, and allows one-off competitors and products typed in by hand. It is a quoting aid, not a source of record.";
export const CALCULATOR_AD_HOC_NOTE = "price entered by user — basis and unit unverified";
export const calculatorAssertedBanner = (count: number) => `This comparison includes ${count} hand-entered or edited ${count === 1 ? "price. This figure is" : "prices. These figures are"} unverified.`;
/** Deliberate one-off Astral and recorded Astral are different basket identities. */
export const calculatorCompetitorKey = (c: { competitor: string | null; adHoc?: boolean }) => JSON.stringify([!!c.adHoc, c.competitor]);
export function mrpError(value: string): string | null {
  return !/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0
    ? "MRP must be a positive number with at most 2 decimal places." : null;
}
export function calculatorPriceInput(appPrice: number | null, entered?: string) {
  const priceState: CalculatorPriceState = appPrice == null ? "Entered"
    : entered === undefined || (mrpError(entered) === null && Number(entered) === appPrice) ? "App" : "Edited";
  const error = entered === undefined ? appPrice == null ? mrpError("") : null : mrpError(entered);
  return { priceState, appPrice, effectivePrice: error ? null : entered === undefined ? appPrice : Number(entered), error };
}
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
  const misplaced = (value: string) => /^(?:mrp|net|verify|ex[\s-]*gst|rate\s*\(\s*ex[\s-]*gst\s*\))$/.test(value);
  const ourRecorded = !!ourUnit && !misplaced(ourUnit), theirRecorded = !!theirUnit && !misplaced(theirUnit);
  // Missing/legacy basis-in-unit values are information, not a physical mismatch.
  // Only two usable, recorded units can produce the amber "units differ" state.
  const unitStatus: "same" | "not-recorded" | "differs" = !ourRecorded || !theirRecorded
    ? "not-recorded" : ourUnit !== theirUnit ? "differs" : "same";
  const unitNote = unitStatus === "not-recorded"
    ? !ourRecorded && !theirRecorded ? "Our and competitor units not recorded."
      : !theirRecorded ? "Competitor unit not recorded." : "Our unit not recorded." : null;
  const unitWarning = unitStatus === "differs"
    ? `Units differ: competitor ${theirs.unit}; ours ${ours.unit}.` : null;
  return { basisMismatch: basisWarning !== null, unitMismatch: unitStatus === "differs",
    unitNotRecorded: unitStatus === "not-recorded", unitStatus, basisWarning, unitWarning, unitNote };
}
export type CalculatorEvidence = {
  itemCode: string; productName: string | null; division: string | null; category: string | null;
  priceBasis: string; basis?: string | null; unit?: string | null; prayag: CalculatorPrice;
  /** Presence only, never a restricted quote or brand. Separates absence from filtering. */
  hasRecordedCompetitorPrice?: boolean;
  variants: (CalculatorPrice & { variant: string; basis?: string | null })[];
  competitors: (CalculatorPrice & { competitor: string; priceBasis: string; basis?: string | null; unit?: string | null;
    basisMismatch: boolean; unitMismatch?: boolean; unitNotRecorded?: boolean; unitStatus?: "same" | "not-recorded" | "differs";
    basisWarning?: string | null; unitWarning?: string | null; unitNote?: string | null })[];
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
export function resolveCalculator(blocks: CalculatorBlock[], evidence: CalculatorEvidence[], catalogueCodes?: readonly string[]) {
  const byCode = new Map(evidence.map(p => [p.itemCode, p]));
  const knownCodes = new Set(catalogueCodes ?? evidence.map(p => p.itemCode));
  return blocks.filter(b => b.itemCode).map(block => {
    const recorded = byCode.get(block.itemCode!);
    const adHocProduct = !knownCodes.has(block.itemCode!) && !recorded && block.adHocProduct === true && !!block.description?.trim();
    const product: CalculatorEvidence | undefined = recorded ?? (adHocProduct ? {
      itemCode: block.itemCode!, productName: block.description!, division: null, category: null,
      priceBasis: "basis not recorded · unit not recorded", basis: null, unit: null,
      prayag: { price: null, effectiveDate: null }, variants: [{ variant: "Standard", price: null, effectiveDate: null, basis: null }],
      competitors: [], hasRecordedCompetitorPrice: false,
    } : undefined);
    const price = product?.variants.find(v => v.variant === block.variant);
    // A missing variant is missing evidence, never a Standard-price fallback.
    const ourInput = calculatorPriceInput(price?.price ?? null, block.mrp);
    const ourRow = calculatorRow(product ? ourInput.effectivePrice : null, block.discount, block.quantity);
    const our = { ...ourRow, ...ourInput, errors: { ...ourRow.errors, mrp: product ? ourInput.error : null } };
    const ourPriceBasis = product && "basis" in product
      ? `${(price && "basis" in price ? price.basis : product.basis) || "basis not recorded"} · ${product.unit || "unit not recorded"}`
      : product?.priceBasis ?? "basis not recorded";
    const competitors = block.competitors.filter(c => c.competitor).map(c => {
      const quote = c.adHoc ? undefined : product?.competitors.find(q => q.competitor === c.competitor);
      const input = calculatorPriceInput(quote?.price ?? null, c.mrp);
      const row = calculatorRow(product ? input.effectivePrice : null, c.discount, block.quantity);
      const checks = c.adHoc ? { basisMismatch: false, unitMismatch: false, unitNotRecorded: true,
        basisWarning: null, unitWarning: null, unitNote: "Competitor unit not recorded." }
        : product && quote && "basis" in product && "basis" in quote
        ? compareCalculatorMetadata({ basis: price && "basis" in price ? price.basis ?? null : product.basis ?? null, unit: product.unit ?? null },
          { basis: quote.basis ?? null, unit: quote.unit ?? null })
        : { basisMismatch: !!quote?.basisMismatch, unitMismatch: !!quote?.unitMismatch && !quote?.unitNotRecorded,
          unitNotRecorded: !!quote?.unitNotRecorded,
          basisWarning: quote?.basisWarning ?? "Different price basis — check before relying on this",
          unitWarning: quote?.unitWarning ?? "Units differ — check the recorded units",
          unitNote: quote?.unitNote ?? "Competitor unit not recorded." };
      const variantMismatch = !!quote && block.variant !== "Standard";
      const variantWarning = variantMismatch ? `Competitor colour variant is not recorded; comparison with ${block.variant} is unconfirmed.` : null;
      const notes = [...(checks.unitNotRecorded ? [checks.unitNote!] : []),
        ...(c.adHoc ? [CALCULATOR_AD_HOC_NOTE] : [])];
      const warnings = [
        ...(checks.basisMismatch ? [checks.basisWarning!] : []),
        ...(checks.unitMismatch ? [checks.unitWarning!] : []),
        ...(variantWarning ? [variantWarning] : []),
      ];
      return { ...c, quote, ...row, ...input, errors: { ...row.errors, mrp: input.error },
        position: calculatorPosition(our.netUnit, row.netUnit),
        diffTotal: our.total == null || row.total == null ? null : Math.round((row.total - our.total) * 100) / 100,
        basisMismatch: checks.basisMismatch, unitMismatch: checks.unitMismatch, unitNotRecorded: checks.unitNotRecorded,
        basisWarning: checks.basisWarning, unitWarning: checks.unitWarning, variantWarning,
        variantMismatch, warnings, notes };
    });
    return { block, product, adHocProduct, price, our, ourPriceBasis, competitors };
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
  const brands = [...new Map(available.flatMap(r => r.competitors.map(c => [calculatorCompetitorKey(c), c] as const))).entries()]
    .sort((a, b) => a[1].competitor!.localeCompare(b[1].competitor!) || Number(!!a[1].adHoc) - Number(!!b[1].adHoc));
  const prices = available.flatMap(r => [r.our, ...r.competitors]).filter(p => p.effectivePrice != null);
  const priceCounts = { App: 0, Edited: 0, Entered: 0 };
  prices.forEach(p => { priceCounts[p.priceState]++; });
  const adHocProducts = available.filter(r => r.adHocProduct).length;
  return {
    priceCounts, assertedPrices: priceCounts.Edited + priceCounts.Entered, adHocProducts,
    adHocCompetitors: [...new Set(available.flatMap(r => r.competitors.filter(c => c.adHoc).map(c => c.competitor!)))],
    products: available.length,
    totalQuantity: available.reduce((n, r) => n + (r.our.quantity ?? 0), 0),
    ourValue: available.reduce((n, r) => addMoney(n, r.our.total ?? 0), 0),
    noCompetitorSelected: available.filter(r => !r.competitors.length).length,
    noCompetitorRecorded: available.filter(r => !(r.product!.hasRecordedCompetitorPrice ?? r.product!.competitors.length > 0)).length,
    noOurPrice: available.filter(r => r.our.total == null).length,
    unavailableProducts: rows.length - available.length,
    basisMismatchRows: available.reduce((n, r) => n + r.competitors.filter(c => c.basisMismatch).length, 0),
    unitMismatchRows: available.reduce((n, r) => n + r.competitors.filter(c => c.unitMismatch).length, 0),
    unitNotRecordedRows: available.reduce((n, r) => n + r.competitors.filter(c => c.unitNotRecorded).length, 0),
    variantMismatchRows: available.reduce((n, r) => n + r.competitors.filter(c => c.variantMismatch).length, 0),
    brands: brands.map(([key, selected]) => {
      const brand = selected.competitor!;
      const pairs = available.flatMap(r => {
        const c = r.competitors.find(c => calculatorCompetitorKey(c) === key);
        return c?.total != null && r.our.total != null ? [{ r, c }] : [];
      });
      const ourValue = pairs.reduce((n, p) => addMoney(n, p.r.our.total!), 0);
      const competitorValue = pairs.reduce((n, p) => addMoney(n, p.c.total!), 0);
      return { brand, key, adHoc: !!selected.adHoc, adHocProducts, compared: pairs.length, products: available.length,
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
    ...(summary.unitMismatchRows ? [`${summary.unitMismatchRows} ${summary.unitMismatchRows === 1 ? "row has a different recorded unit" : "rows have different recorded units"} — see the units shown on each row.`] : []),
    ...(summary.unitNotRecordedRows ? [`${summary.unitNotRecordedRows} rows: unit not recorded (information only).`] : []),
    ...(summary.variantMismatchRows ? [`${summary.variantMismatchRows} rows compare a colour variant without confirmed competitor variant evidence.`] : []),
    ...(summary.noOurPrice ? [`${summary.noOurPrice} products have no usable Prayag price and are excluded from value comparisons.`] : []),
    ...(summary.unavailableProducts ? [`${summary.unavailableProducts} products are unavailable under the current date.`] : []),
    CALCULATOR_SCOPE_DISCLOSURE,
  ];
}
