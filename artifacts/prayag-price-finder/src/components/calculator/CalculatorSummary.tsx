import { forwardRef } from "react";
import { AlertTriangle, Info, Download, FileText, Loader2, Printer } from "lucide-react";
import { formatMoney, formatCount } from "@workspace/formatting";
import { Button } from "@/components/ui/button";
import { calculatorPosition, type ResolvedCalculator, type summarizeCalculator } from "@/lib/calculatorState";
import { PositionBadge } from "./shared";

type Summary = ReturnType<typeof summarizeCalculator>;

export type CalculatorSummaryProps = {
  rows: ResolvedCalculator;
  summary: Summary;
  disclosures: string[];
  onExport: () => void;
  exporting: boolean;
  exportError: string | null;
};

/** Full-width, printable summary. Every brand total is set against our total over the same subset. */
export const CalculatorSummary = forwardRef<HTMLElement, CalculatorSummaryProps>(function CalculatorSummary(
  { rows, summary, disclosures, onExport, exporting, exportError },
  ref,
) {
  const available = rows.filter((r) => r.product);
  const brands = summary.brands.map((b) => b.brand);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="calc-summary-title"
      data-testid="panel-final-summary"
      className="scroll-mt-4 rounded-xl border border-border bg-card shadow-sm outline-none"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-t-xl bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 px-4 py-3 text-white">
        <FileText className="h-4 w-4 text-indigo-300" />
        <h2 id="calc-summary-title" className="text-base font-black tracking-tight">Final Summary</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
          <Button type="button" variant="ghost" size="sm" onClick={() => window.print()} className="h-8 gap-1.5 text-xs text-white hover:bg-white/10 hover:text-white" data-testid="button-print-summary">
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button type="button" size="sm" onClick={onExport} disabled={exporting} className="h-8 gap-1.5 bg-indigo-600 text-xs font-bold hover:bg-indigo-500" data-testid="button-export-calculator">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export Excel
          </Button>
        </div>
      </div>
      {exportError && (
        <p role="alert" className="border-b bg-rose-50 px-4 py-2 text-xs font-medium text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{exportError}</p>
      )}

      <div className="space-y-6 p-3 md:p-4">
        {/* 7.1 Per-product table */}
        <div className="overflow-x-auto rounded-lg border" role="region" aria-label="Per-product comparison" tabIndex={0}>
          <table className="w-full min-w-[720px] border-collapse text-left text-xs" data-testid="table-summary-products">
            <thead className="bg-slate-100/80 text-[10px] uppercase tracking-wider text-slate-600 dark:bg-muted/50 dark:text-muted-foreground">
              <tr>
                <th scope="col" className="px-2.5 py-2 font-bold">Item code</th>
                <th scope="col" className="px-2.5 py-2 font-bold">Product</th>
                <th scope="col" className="px-2.5 py-2 text-right font-bold">Qty</th>
                <th scope="col" className="bg-indigo-50/80 px-2.5 py-2 text-right font-bold text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">Our net total</th>
                {brands.map((b) => <th key={b} scope="col" className="px-2.5 py-2 text-right font-bold">{b}</th>)}
                <th scope="col" className="px-2.5 py-2 font-bold">Best competitor</th>
                <th scope="col" className="px-2.5 py-2 text-right font-bold">Gap vs best</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {available.map((r) => {
                const priced = r.competitors.filter((c) => c.total != null);
                const best = priced.reduce<(typeof priced)[number] | null>((m, c) => (m == null || c.total! < m.total! ? c : m), null);
                const gap = best ? calculatorPosition(r.our.total, best.total) : null;
                return (
                  <tr key={r.block.id} data-testid={`row-summary-${r.block.id}`}>
                    <td className="px-2.5 py-2 font-mono font-black text-primary">{r.block.itemCode}</td>
                    <td className="max-w-[260px] truncate px-2.5 py-2 font-medium" title={r.product?.productName ?? undefined}>
                      {r.product?.productName ?? "Unnamed product"}
                      {r.block.variant !== "Standard" && <span className="ml-1 text-muted-foreground">· {r.block.variant}</span>}
                    </td>
                    <td className="px-2.5 py-2 text-right font-mono tabular-nums">{r.our.quantity ?? "—"}</td>
                    <td className="bg-indigo-50/30 px-2.5 py-2 text-right font-mono font-bold tabular-nums dark:bg-indigo-950/10">{formatMoney(r.our.total)}</td>
                    {brands.map((b) => {
                      const c = r.competitors.find((x) => x.competitor === b);
                      return (
                        <td key={b} className="px-2.5 py-2 text-right font-mono tabular-nums">
                          {c ? (
                            <span className="inline-flex items-center gap-1">
                              {!!c.notes.length && <span title={c.notes.join(" ")}><Info className="h-3 w-3 text-muted-foreground" aria-label={c.notes.join(" ")} /></span>}
                              {!!c.warnings.length && <span title={c.warnings.join(" ")}><AlertTriangle className="h-3 w-3 text-amber-600" aria-label={c.warnings.join(" ")} /></span>}
                              {formatMoney(c.total, "No price")}
                            </span>
                          ) : <span className="text-muted-foreground" aria-label="Not selected">—</span>}
                          {c?.unitMismatch && <span className="block whitespace-pre-wrap text-[10px] text-amber-700">Unit: {c.quote?.unit}</span>}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-2 font-semibold">{best?.competitor ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2.5 py-2 text-right">
                      {gap ? (
                        <span className="inline-flex flex-col items-end gap-0.5">
                          <span className="font-mono tabular-nums">{gap.diffUnit != null ? formatMoney(Math.abs(gap.diffUnit)) : "—"}</span>
                          <PositionBadge direction={gap.direction} label={gap.label} />
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 7.2 Overall totals */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Overall totals</h3>
            <dl className="grid grid-cols-3 gap-2">
              {[
                ["Products compared", formatCount(summary.products), "text-summary-products"],
                ["Total quantity", formatCount(summary.totalQuantity), "text-summary-quantity"],
                ["Our net value", formatMoney(summary.ourValue), "text-summary-our-value"],
              ].map(([k, v, id]) => (
                <div key={k} className="rounded-lg border bg-slate-50/60 p-2.5 dark:bg-muted/20">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 font-mono text-sm font-black tabular-nums md:text-base" data-testid={id}>{v}</dd>
                </div>
              ))}
            </dl>
            <ul className="divide-y rounded-lg border">
              {summary.brands.length === 0 && <li className="p-3 text-xs text-muted-foreground">No competitors selected yet.</li>}
              {summary.brands.map((b) => (
                <li key={b.brand} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs" data-testid={`row-brand-total-${b.brand}`}>
                  <span className="min-w-[96px] font-bold">{b.brand}</span>
                  <span className="text-muted-foreground">compared on <strong className="text-foreground">{b.compared} of {b.products}</strong> products</span>
                  {b.compared > 0 ? (
                    <>
                      <span className="font-mono font-semibold tabular-nums">{formatMoney(b.competitorValue)}</span>
                      <span className="text-muted-foreground">vs our <span className="font-mono tabular-nums text-foreground">{formatMoney(b.ourValue)}</span> on the same {b.compared}</span>
                      <PositionBadge direction={b.position.direction} label={b.position.label} className="ml-auto" />
                    </>
                  ) : (
                    <span className="italic text-muted-foreground">no comparable priced rows</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* 7.3 Position counts + 7.4 disclosures */}
          <div className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Position counts</h3>
              <ul className="divide-y rounded-lg border">
                {summary.brands.length === 0 && <li className="p-3 text-xs text-muted-foreground">Add competitors to see where we win.</li>}
                {summary.brands.map((b) => (
                  <li key={b.brand} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs" data-testid={`row-position-counts-${b.brand}`}>
                    <span className="min-w-[96px] font-bold">{b.brand}</span>
                    <span>we are cheaper on <strong className="text-amber-700 dark:text-amber-300">{b.cheaper}</strong></span>
                    <span>at par on <strong>{b.par}</strong></span>
                    <span>higher on <strong className="text-rose-700 dark:text-rose-300">{b.higher}</strong></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Disclosures</h3>
              <ul className="space-y-1.5 rounded-lg border border-dashed bg-slate-50/60 p-3 text-xs dark:bg-muted/20" data-testid="list-disclosures">
                {disclosures.map((d, i) => (
                  <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
