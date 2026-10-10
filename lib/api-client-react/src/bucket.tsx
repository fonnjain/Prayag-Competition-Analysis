import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatBucketExportDisclosure } from "@workspace/formatting";
import {
  useGetActiveBucketList,
  useSetActiveBucketList,
} from "./generated/api";

export interface ActiveBucketInfo {
  id: string;
  name: string;
  type: "included" | "excluded";
  count: number;
  competitorCount?: number;
  competitorRules?: { competitor?: string; scope?: string; divisions?: string[]; categories?: string[] }[];
  noCompetitorPriceCount?: number;
  productFilterApplied?: boolean;
  /** Effective server disclosure: company first, then personal, never a union. */
  exportDisclosure?: string;
}

export function bucketEffectText(list: ActiveBucketInfo | null): string {
  if (list?.exportDisclosure) return list.exportDisclosure
    + (list.noCompetitorPriceCount ? `\n${list.noCompetitorPriceCount} products have no competitor price under this filter` : "");
  const base = list ? formatBucketExportDisclosure(list) : "";
  if (!list) return base;
  const rules = (list.competitorRules ?? []).map(rule => `${rule.competitor} ${list.type === "excluded" ? "excluded" : "included"} ${
    !rule.scope || rule.scope === "everywhere" ? "everywhere" : `in ${(rule.scope === "division" ? rule.divisions : rule.categories)?.join(", ")}`
  }`);
  return base + (rules.length ? `; ${rules.join("; ")}` : "")
    + (list.productFilterApplied === false ? "; no product filter applied" : "")
    + (list.noCompetitorPriceCount ? `\n${list.noCompetitorPriceCount} products have no competitor price under this filter` : "");
}

/** Company layer is public; personal selection remains identity-scoped. */
const ACTIVE_ROOT = "bucket-active";

let scopeUser: string | null = null;
let scopeSig: string | null = null;

/** Signature of the resolved active membership (id, type, count and the codes themselves). */
function scopeSignature(d: { list?: Record<string, unknown> | null; codes?: string[]; enforced?: Record<string, unknown> | null; enforcementVersion?: number }): string {
  const l = d.list;
  const codes = (d.codes ?? (l?.codes as string[] | undefined) ?? []).slice().sort();
  return JSON.stringify([d.enforcementVersion ?? 0, d.enforced?.id, d.enforced?.activeCount, d.enforced?.competitorRules,
    l?.id, l?.type, l?.activeCount ?? l?.count, codes, l?.competitorRules ?? [], l?.noCompetitorPriceCount ?? 0]);
}

const KEEP = (k: unknown): boolean => {
  const first = String((k as unknown[])[0] ?? "");
  return first.startsWith("bucket-") || first.startsWith("/api/bucket-lists") || first.startsWith("/api/auth");
};

function isScopedKey(key: readonly unknown[]) {
  const meta = String(key[0] ?? "");
  // A different company version must refresh browse badges and the audit tab,
  // not just the price queries. Do not reset editable drafts or active query.
  if (meta === "/api/bucket-lists" || meta === "/api/bucket-lists/enforcement" || meta === "bucket-lists-enforce-picker") return true;
  if (KEEP(key)) return false;
  const path = String(key[0] ?? "");
  return /^\/api\/(?:price-finder\/|analysis\/|mrp-generator\/)/.test(path)
    || path.startsWith("price-finder-")
    || /^\/api\/catalog\/(?:products(?:\/|$)|product$|filters$|comparison(?:\/|$)|mapping-review(?:\/|$))/.test(path);
}
async function resetScoped(qc: ReturnType<typeof useQueryClient>) {
  const predicate = (qq: { queryKey: readonly unknown[] }) => isScopedKey(qq.queryKey);
  await qc.cancelQueries({ predicate });
  await qc.resetQueries({ predicate });
}

export function useActiveBucket(userId: string | null | undefined) {
  const signedIn = !!userId;
  const qc = useQueryClient();
  // Cache key is scoped to the signed-in user id so one user's list can never show for another.
  const key = [ACTIVE_ROOT, userId ?? "anonymous"] as const;
  const q = useGetActiveBucketList({
    query: { queryKey: key as unknown as readonly unknown[], refetchOnWindowFocus: true, refetchInterval: 5000, staleTime: 0 },
  });
  useEffect(() => {
    qc.removeQueries({ queryKey: [ACTIVE_ROOT], predicate: (qq) => qq.queryKey[1] !== (userId ?? "anonymous") });
    qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    const on = () => document.visibilityState === "visible" && qc.invalidateQueries({ queryKey: key });
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const rawNow = q.data as { list?: Record<string, unknown> | null; codes?: string[]; enforced?: Record<string, unknown> | null; enforcementVersion?: number } | undefined;
  const sigNow = q.isSuccess && rawNow ? scopeSignature(rawNow) : null;
  useEffect(() => {
    const who = userId ?? "anonymous";
    if (scopeUser !== null && scopeUser !== who) {
      // Identity changed: drop every scoped result so nothing from the old scope is shown.
      scopeUser = who;
      scopeSig = null;
      resetScoped(qc);
    } else if (scopeUser === null) {
      scopeUser = who;
    }
    if (sigNow !== null) {
      if (scopeSig !== null && scopeSig !== sigNow) resetScoped(qc);
      scopeSig = sigNow;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sigNow]);
  const raw = q.data as { list?: Record<string, unknown> | null; enforced?: Record<string, unknown> | null;
    banner?: string | null; noCompetitorPriceCount?: number } | undefined;
  const info = (l: Record<string, unknown> | null | undefined): ActiveBucketInfo | null => l ? {
    id: String(l.id), name: String(l.name), type: l.type as "included" | "excluded",
    count: Number(l.activeCount ?? l.count ?? 0), competitorCount: Number(l.competitorCount ?? 0),
    competitorRules: l.competitorRules as ActiveBucketInfo["competitorRules"],
    noCompetitorPriceCount: Number(l.noCompetitorPriceCount ?? 0), productFilterApplied: l.productFilterApplied !== false,
  } : null;
  const personalList = info(raw?.list), enforcedList = info(raw?.enforced);
  // Existing export consumers receive the EFFECTIVE disclosure even with no
  // personal selection. Header/picker use personalList explicitly.
  const primary = personalList ?? enforcedList;
  const list = primary ? { ...primary, exportDisclosure: raw?.banner ?? undefined,
    noCompetitorPriceCount: Number(raw?.noCompetitorPriceCount ?? 0) } : null;
  return { list, personalList, enforcedList, noCompetitorPriceCount: Number(raw?.noCompetitorPriceCount ?? 0),
    banner: raw?.banner ?? null, isLoading: q.isLoading, data: raw, scopeKey: sigNow };
}

export function useSetActiveBucket() {
  const qc = useQueryClient();
  const m = useSetActiveBucketList({
    mutation: { onSuccess: () => { void qc.invalidateQueries(); } },
  });
  return {
    setActive: (listId: string | null, onDone?: () => void, onError?: (e: unknown) => void) =>
      m.mutate({ data: { listId } }, { onSuccess: () => onDone?.(), onError: (e) => onError?.(e) }),
    isPending: m.isPending,
  };
}

/** Banner for product and comparison screens (A-K). Always offers a way to choose a list when signed in. */
export function BucketBanner({ userId }: { userId: string | null | undefined }) {
  const { list, banner } = useActiveBucket(userId);
  const { setActive, isPending } = useSetActiveBucket();
  if (!userId) return null;
  const ret = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname + window.location.search) : "";
  const chooseHref = `/price-finder/bucket-lists?return=${ret}`;
  if (!list) {
    return (
      <div data-testid="bucket-banner-none" className="flex items-center gap-3 border-b bg-muted/40 px-4 py-1 text-xs text-muted-foreground">
        <span>No bucket list applied.</span>
        <a href={chooseHref} data-testid="link-choose-bucket" className="font-semibold underline underline-offset-2">Choose bucket</a>
      </div>
    );
  }
  const excl = list.type === "excluded";
  return (
    <div
      role="status"
      data-testid="bucket-banner"
      className={
        "flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-2 text-sm " +
        (excl ? "border-amber-400 bg-amber-100 text-amber-950" : "border-sky-400 bg-sky-100 text-sky-950")
      }
    >
      {banner ? (
        <strong>{banner}</strong>
      ) : (
        <>
          <strong>Showing: {list.name} - {excl ? "Excluded" : "Included"}</strong>
          <span>{list.count} items {excl ? "hidden" : "shown only"}</span>
        </>
      )}
      <button type="button" data-testid="button-bucket-clear" disabled={isPending} onClick={() => setActive(null)} className="font-bold underline underline-offset-2">
        Clear
      </button>
      <a href={chooseHref} data-testid="link-choose-bucket" className="underline underline-offset-2">Choose bucket</a>
    </div>
  );
}

/** Exactly one line for maintenance screens (L-T). */
export function BucketBoundary() {
  return (
    <p data-testid="bucket-boundary" className="px-4 py-1.5 text-xs text-muted-foreground">
      Bucket lists do not apply here.
    </p>
  );
}

/** Explanation for backend BUCKET_FILTERED 404s. */
export function BucketFilteredNotice({ userId }: { userId: string | null | undefined }) {
  const { list, personalList, enforcedList } = useActiveBucket(userId);
  const { setActive, isPending } = useSetActiveBucket();
  return (
    <div data-testid="bucket-filtered-notice" className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">This product is hidden by your active bucket list.</p>
      <p className="mt-1">
        {list ? `${list.name} (${list.type === "excluded" ? "Excluded" : "Included"}) is filtering what you can see. ` : ""}
        {enforcedList ? "The Head Office restriction cannot be cleared here. Clearing a personal list does not override it."
          : "The product exists; clear your personal list to view it."}
      </p>
      {personalList && <button type="button" disabled={isPending} onClick={() => setActive(null)} className="mt-2 font-bold underline">
        Clear personal list
      </button>}
    </div>
  );
}

export function isBucketFiltered(err: unknown): boolean {
  const e = err as { status?: number; data?: { code?: string; error?: string } } | null;
  if (!e || e.status !== 404) return false;
  const d = e.data as { code?: string; error?: string } | string | null | undefined;
  if (typeof d === "string") return d.includes("BUCKET_FILTERED");
  return d?.code === "BUCKET_FILTERED" || d?.error === "BUCKET_FILTERED";
}
