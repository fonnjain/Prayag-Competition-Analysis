import { useEffect, useMemo, useRef, useState } from "react";
import { getGetBucketListsQueryKey, useGetBucketLists } from "./generated/api";
import { useActiveBucket, useSetActiveBucket } from "./bucket";
import { BUCKET_TYPE, bucketEffectShort, bucketKind, groupBucketChoices } from "./bucketType";

const MUTED = "#5b6670";
const INK = "#1b2b34";

function errText(e: unknown): string {
  const x = e as { data?: { error?: string; message?: string }; message?: string } | null;
  return x?.data?.error ?? x?.data?.message ?? x?.message ?? "Could not change the bucket list.";
}

/** A-K header: locked company layer above the optional personal selector. */
export function BucketControl({ userId }: { userId: string | null | undefined }) {
  const { personalLists, enforcedList, noCompetitorPriceCount, isLoading } = useActiveBucket(userId);
  const { setActive, setListActive, isPending } = useSetActiveBucket();
  const list = personalLists[0] ?? null;
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const lists = useGetBucketLists({
    query: { queryKey: [...getGetBucketListsQueryKey(), userId ?? "none"], enabled: !!userId && open },
  });

  useEffect(() => {
    if (!open) return;
    const r = root.current?.getBoundingClientRect();
    if (r) setAlignRight(r.left + 340 > window.innerWidth);
    const down = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('[data-testid="button-bucket-open"]')?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const groups = useMemo(() => groupBucketChoices(lists.data ?? []), [lists.data]);

  if (!userId && !enforcedList) return null;

  const toggle = (id: string, on: boolean) => {
    setErr(null); setNote(null);
    setListActive(id, on, (m) => { if (m) setNote(m); }, (e) => setErr(errText(e)));
  };
  const clearAll = () => { setErr(null); setNote(null); setActive(null, undefined, (e) => { setErr(errText(e)); setOpen(true); }); };
  const clearOne = (id: string) => { setErr(null); setNote(null); setListActive(id, false, undefined, (e) => { setErr(errText(e)); setOpen(true); }); };
  const effectOf = (l: typeof personalLists[number]) => [
    l.productFilterApplied === false ? "all products" : bucketEffectShort(l.type, l.count),
    ...(l.competitorCount ? [`${l.competitorCount} competitor${l.competitorCount === 1 ? "" : "s"}`] : []),
  ].join(" · ");
  const ret = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname + window.location.search) : "";
  const base: React.CSSProperties = { font: "inherit", cursor: "pointer", color: INK, background: "transparent", border: 0, padding: 0, textAlign: "left" };

  return (
    <div ref={root} data-testid="bucket-control" data-state={isLoading ? "loading" : list || enforcedList ? "active" : "none"} style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: "100%", fontSize: 13, lineHeight: 1.2 }}>
      {enforcedList && (
        <div data-testid="bucket-enforced" title={`Head Office enforced: ${enforcedList.name}. Cannot be cleared here.`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 30, padding: "0 9px", border: "1px solid #9baeb9", borderRadius: 6, background: "#edf2f5", color: INK, maxWidth: "100%" }}>
          <svg aria-hidden="true" width="13" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>
          <strong style={{ fontSize: 11 }}>Enforced</strong>
          <span style={{ fontWeight: 700, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{enforcedList.name}</span>
          <span>{enforcedList.type === "excluded" ? "Excluded" : "Included"}</span>
          <span style={{ color: MUTED, fontSize: 11, whiteSpace: "nowrap" }}>{enforcedList.productFilterApplied === false ? "all products" : bucketEffectShort(enforcedList.type, enforcedList.count)}
            {enforcedList.competitorCount ? ` · ${enforcedList.competitorCount} competitor${enforcedList.competitorCount === 1 ? "" : "s"}` : ""}</span>
        </div>
      )}
      {userId && personalLists.map((l) => {
        const t = BUCKET_TYPE[bucketKind(l.type)];
        return (
          <div key={l.id} role="status" data-testid={`bucket-chip-${l.id}`} style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%", background: t.bg, border: `1px solid ${t.border}`, borderLeft: `5px solid ${t.border}`, borderRadius: 6, color: t.text, minHeight: 32 }}>
            <button type="button" data-testid="button-bucket-open" aria-haspopup="menu" aria-expanded={open} title={`${l.name} (${t.label}) - ${effectOf(l)}`}
              onClick={() => setOpen((o) => !o)}
              style={{ ...base, color: t.text, display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 6px 5px 8px", minWidth: 0 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 9, background: t.dot, flex: "none" }} />
              <strong data-testid="text-bucket-name" style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{l.name}</strong>
              <span data-testid="text-bucket-type" style={{ flex: "none", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", border: `1px solid ${t.border}`, borderRadius: 3, padding: "1px 4px" }}>{t.label}</span>
              <span data-testid="text-bucket-effect" style={{ flex: "none", fontWeight: 600, whiteSpace: "nowrap" }}>{effectOf(l)}</span>
            </button>
            <button type="button" data-testid={`button-bucket-clear-${l.id}`} aria-label={`Clear ${l.name}`} title={`Clear ${l.name}`} disabled={isPending} onClick={() => clearOne(l.id)}
              style={{ ...base, color: t.text, alignSelf: "stretch", padding: "0 9px", fontSize: 18, fontWeight: 700, borderLeft: `1px solid ${t.border}`, opacity: isPending ? 0.5 : 1 }}>
              &times;
            </button>
          </div>
        );
      })}
      {userId && personalLists.length === 0 && (
        <button type="button" data-testid="button-bucket-open" disabled={isLoading} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          style={{ ...base, color: MUTED, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, padding: "0 10px", border: "1px dashed #aab4bb", borderRadius: 6 }}>
          <span>Bucket:</span><span style={{ fontWeight: 500 }}>{isLoading ? "Loading…" : "None"}</span><span aria-hidden style={{ fontSize: 10 }}>&#9662;</span>
        </button>
      )}
      {userId && personalLists.length > 0 && (
        <button type="button" data-testid="button-bucket-add" aria-haspopup="menu" onClick={() => setOpen((o) => !o)} style={{ ...base, color: MUTED, fontSize: 12, textDecoration: "underline" }}>Change lists</button>
      )}
      {!!noCompetitorPriceCount && (
        <div role="status" data-testid="bucket-no-competitor-count" style={{ marginTop: 5, fontSize: 12, color: MUTED, textAlign: "right" }}>
          {noCompetitorPriceCount} products have no competitor price under this filter
        </div>
      )}

      {open && (
        <div role="menu" data-testid="menu-bucket" style={{ position: "absolute", top: "calc(100% + 4px)", [alignRight ? "right" : "left"]: 0, zIndex: 60, width: 320, maxWidth: "92vw", maxHeight: "70vh", overflowY: "auto", background: "#ffffff", border: "1px solid #c8d0d5", borderRadius: 8, boxShadow: "0 8px 24px rgba(20,40,50,.18)", color: INK }}>
          {err && <p role="alert" data-testid="text-bucket-error" style={{ margin: 0, padding: "8px 12px", background: "#fee2e2", color: "#7f1d1d", fontSize: 12 }}>{err}</p>}
          {note && <p role="status" data-testid="text-bucket-note" style={{ margin: 0, padding: "8px 12px", background: "#fef3c7", color: "#78350f", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={note}>{note}</p>}
          <button type="button" role="menuitem" data-testid="option-bucket-none" disabled={isPending || personalLists.length === 0} onClick={clearAll}
            style={{ ...base, display: "flex", width: "100%", padding: "9px 12px", fontWeight: personalLists.length ? 500 : 700, background: personalLists.length ? "transparent" : "#f1f4f5" }}>
            {enforcedList ? "No personal lists (HO rule remains)" : "None"}{personalLists.length === 0 && <span style={{ marginLeft: "auto", color: MUTED }}>current</span>}
          </button>
          {lists.isLoading && <p style={{ margin: 0, padding: "10px 12px", color: MUTED }}>Loading lists...</p>}
          {lists.isError && (
            <p role="alert" style={{ margin: 0, padding: "10px 12px", color: "#7f1d1d" }}>
              Could not load lists. <button type="button" onClick={() => lists.refetch()} style={{ ...base, textDecoration: "underline", fontWeight: 700 }}>Retry</button>
            </p>
          )}
          {!lists.isLoading && !lists.isError && (["included", "excluded"] as const).map((k) => {
            const tt = BUCKET_TYPE[k];
            return (
              <div key={k} data-testid={`group-bucket-${k}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", marginTop: 4, background: tt.soft, borderTop: `1px solid ${tt.border}`, borderLeft: `5px solid ${tt.border}`, color: tt.text, fontSize: 11, fontWeight: 800, letterSpacing: 0.6 }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: tt.dot }} />
                  {tt.heading}<span style={{ fontWeight: 600, letterSpacing: 0 }}>({tt.sub})</span>
                </div>
                {groups[k].length === 0 && <p style={{ margin: 0, padding: "7px 12px 7px 17px", color: MUTED, fontSize: 12 }}>No {tt.label.toLowerCase()} lists.</p>}
                {groups[k].filter((l) => l.id !== enforcedList?.id && !l.isEnforced).map((l) => {
                  const ho = l.visibility === "everyone";
                  const on = personalLists.some((p) => p.id === l.id);
                  const isInc = k === "included";
                  return (
                    <label key={l.id} data-testid={`option-bucket-${l.id}`} style={{ ...base, display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px 8px 17px", background: on ? tt.bg : "transparent", fontWeight: on ? 700 : 500, opacity: isPending ? 0.6 : 1 }}>
                      <input type={isInc ? "radio" : "checkbox"} name={isInc ? "bucket-included" : undefined} checked={on} disabled={isPending}
                        onChange={() => toggle(l.id, !on)} onClick={isInc && on ? () => toggle(l.id, false) : undefined} />
                      {ho && <span data-testid="tag-bucket-ho" style={{ flex: "none", fontSize: 10, fontWeight: 800, background: "#c7d2fe", color: "#1e1b4b", borderRadius: 3, padding: "1px 5px" }}>HO</span>}
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                      <span style={{ flex: "none", color: MUTED, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{(l.activeCount ?? l.count).toLocaleString()} products{l.competitorCount ? ` · ${l.competitorCount} competitor${l.competitorCount === 1 ? "" : "s"}` : ""}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
          <a href={`/price-finder/bucket-lists?return=${ret}`} data-testid="link-choose-bucket"
            style={{ display: "block", padding: "10px 12px", marginTop: 4, borderTop: "1px solid #dde3e6", fontWeight: 700, color: INK, textDecoration: "none" }}>
            Manage bucket lists &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
