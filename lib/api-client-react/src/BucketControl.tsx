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

/** The single bucket filter control for screens A-K. Signed-in only. */
export function BucketControl({ userId }: { userId: string | null | undefined }) {
  const { list, isLoading } = useActiveBucket(userId);
  const { setActive, isPending } = useSetActiveBucket();
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

  if (!userId) return null;

  const choose = (id: string | null) => {
    setErr(null);
    setActive(id, () => setOpen(false), (e) => setErr(errText(e)));
  };
  const clear = () => { setErr(null); setActive(null, undefined, (e) => { setErr(errText(e)); setOpen(true); }); };
  const ret = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname + window.location.search) : "";
  const kind = list ? bucketKind(list.type) : null;
  const t = kind ? BUCKET_TYPE[kind] : null;

  const base: React.CSSProperties = { font: "inherit", cursor: "pointer", color: INK, background: "transparent", border: 0, padding: 0, textAlign: "left" };

  return (
    <div ref={root} data-testid="bucket-control" data-state={isLoading ? "loading" : list ? "active" : "none"} style={{ position: "relative", display: "inline-block", maxWidth: "100%", fontSize: 13, lineHeight: 1.2 }}>
      {list && t ? (
        <div role="status" style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%", background: t.bg, border: `1px solid ${t.border}`, borderLeft: `5px solid ${t.border}`, borderRadius: 6, color: t.text, minHeight: 32 }}>
          <button type="button" data-testid="button-bucket-open" aria-haspopup="menu" aria-expanded={open} title={`${list.name} (${t.label}) - ${bucketEffectShort(list.type, list.count)}`}
            onClick={() => setOpen((o) => !o)}
            style={{ ...base, color: t.text, display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 6px 5px 8px", minWidth: 0 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 9, background: t.dot, flex: "none" }} />
            <strong data-testid="text-bucket-name" style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{list.name}</strong>
            <span data-testid="text-bucket-type" style={{ flex: "none", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", border: `1px solid ${t.border}`, borderRadius: 3, padding: "1px 4px" }}>{t.label}</span>
            <span data-testid="text-bucket-effect" style={{ flex: "none", fontWeight: 600, whiteSpace: "nowrap" }}>{bucketEffectShort(list.type, list.count)}</span>
          </button>
          <button type="button" data-testid="button-bucket-clear" aria-label="Clear bucket list" title="Clear bucket list" disabled={isPending} onClick={clear}
            style={{ ...base, color: t.text, alignSelf: "stretch", padding: "0 9px", fontSize: 18, fontWeight: 700, borderLeft: `1px solid ${t.border}`, opacity: isPending ? 0.5 : 1 }}>
            &times;
          </button>
        </div>
      ) : (
        <button type="button" data-testid="button-bucket-open" disabled={isLoading} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          style={{ ...base, color: MUTED, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, padding: "0 10px", border: "1px dashed #aab4bb", borderRadius: 6 }}>
          <span>Bucket:</span><span style={{ fontWeight: 500 }}>{isLoading ? "Loading…" : "None"}</span><span aria-hidden style={{ fontSize: 10 }}>&#9662;</span>
        </button>
      )}

      {open && (
        <div role="menu" data-testid="menu-bucket" style={{ position: "absolute", top: "calc(100% + 4px)", [alignRight ? "right" : "left"]: 0, zIndex: 60, width: 320, maxWidth: "92vw", maxHeight: "70vh", overflowY: "auto", background: "#ffffff", border: "1px solid #c8d0d5", borderRadius: 8, boxShadow: "0 8px 24px rgba(20,40,50,.18)", color: INK }}>
          {err && <p role="alert" data-testid="text-bucket-error" style={{ margin: 0, padding: "8px 12px", background: "#fee2e2", color: "#7f1d1d", fontSize: 12 }}>{err}</p>}
          <button type="button" role="menuitem" data-testid="option-bucket-none" disabled={isPending} onClick={() => choose(null)}
            style={{ ...base, display: "flex", width: "100%", padding: "9px 12px", fontWeight: list ? 500 : 700, background: list ? "transparent" : "#f1f4f5" }}>
            None{!list && <span style={{ marginLeft: "auto", color: MUTED }}>current</span>}
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
                {groups[k].map((l) => {
                  const ho = l.visibility === "everyone";
                  const on = list?.id === l.id;
                  return (
                    <button key={l.id} type="button" role="menuitem" data-testid={`option-bucket-${l.id}`} disabled={isPending} onClick={() => choose(l.id)}
                      style={{ ...base, display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px 8px 17px", background: on ? tt.bg : "transparent", fontWeight: on ? 700 : 500 }}>
                      {ho && <span data-testid="tag-bucket-ho" style={{ flex: "none", fontSize: 10, fontWeight: 800, background: "#c7d2fe", color: "#1e1b4b", borderRadius: 3, padding: "1px 5px" }}>HO</span>}
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                      <span style={{ flex: "none", color: MUTED, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{(l.activeCount ?? l.count).toLocaleString()} products</span>
                    </button>
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
