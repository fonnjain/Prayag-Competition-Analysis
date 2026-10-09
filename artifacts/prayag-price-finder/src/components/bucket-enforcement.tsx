import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEnforceBucketList, getGetBucketEnforcementQueryKey, useGetBucketEnforcement, useGetBucketLists, useReleaseBucketEnforcement,
  bucketEffectShort, type BucketList, type BucketEnforcementEvent,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { competitorScopeLabel, type CompetitorRuleLike } from "@/components/bucket-competitors-tab";
import { useToast } from "@/hooks/use-toast";
import { errMessage } from "@/lib/bucketShared";

export const fmtIST = (s?: string) =>
  s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "";

export function enforcedEffectText(l: Pick<BucketList, "type" | "count" | "rules" | "competitorRules" | "competitorPriceCount" | "noCompetitorPriceCount" | "productFilterApplied">): string {
  const parts: string[] = [];
  parts.push(l.productFilterApplied === false ? "No product filter applies." : bucketEffectShort(l.type, l.count) + ".");
  const cr = l.competitorRules ?? (l.rules ?? []).filter((r) => r.competitor);
  if (cr.length) {
    const scopes = cr.map((r) => competitorScopeLabel(r as unknown as CompetitorRuleLike)).join("; ");
    parts.push(`${l.type === "included" ? "Omits" : "Ignores"} ${(l.competitorPriceCount ?? 0).toLocaleString()} competitor quotes (${scopes})${(l.noCompetitorPriceCount ?? 0) > 0 ? `; ${l.noCompetitorPriceCount} products would lose their last quote` : ""}.`);
  }
  return parts.join(" ") + " Applies to every user on every comparison and cannot be switched off by them.";
}

const ACTION: Record<string, string> = { enforced: "Put in force", replaced: "Replaced", released: "Taken out of force", edited: "Edited while in force" };

function HistoricalDefinition({ snapshot }: { snapshot: Record<string, unknown> }) {
  const codes = Array.isArray(snapshot.resolvedProductCodes)
    ? snapshot.resolvedProductCodes.filter((code): code is string => typeof code === "string") : [];
  const rules = Array.isArray(snapshot.resolvedCompetitorRules)
    ? snapshot.resolvedCompetitorRules.filter((r): r is CompetitorRuleLike =>
      !!r && typeof r === "object" && typeof r.competitor === "string") : [];
  const scopes = Array.isArray(snapshot.compiledCompetitorScopes)
    ? snapshot.compiledCompetitorScopes.filter((s): s is { competitor: string; codes: string[] | null } =>
      !!s && typeof s === "object" && typeof s.competitor === "string" && (s.codes === null || Array.isArray(s.codes))) : [];
  return (
    <div className="space-y-1 text-xs">
      <p>Product rule: {snapshot.productFilterApplied === false ? "none; all products remain eligible" :
        `${snapshot.type === "included" ? "Included" : "Excluded"} ${codes.length} product codes at this time`}</p>
      {snapshot.productFilterApplied !== false && codes.length > 0 &&
        <p className="max-h-28 overflow-auto break-words">Product codes: {codes.join(", ")}</p>}
      <p>Competitor rules: {rules.length ? rules.map(r => competitorScopeLabel(r)).join("; ") : "none; all competitors remain eligible"}</p>
      {scopes.filter(s => s.codes !== null).map((s, i) =>
        <p key={`${s.competitor}-${i}`} className="max-h-28 overflow-auto break-words">
          {s.competitor} covered these product codes at this time: {s.codes!.join(", ")}
        </p>)}
    </div>
  );
}

function HistoryRow({ e }: { e: BucketEnforcementEvent }) {
  return (
    <li className="p-3 text-sm" data-testid={`row-enforcement-event-${e.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <strong>{ACTION[e.action] ?? e.action}</strong>
        <span>{e.listName}</span>
        {e.action === "replaced" && e.previousListName && <span className="text-muted-foreground">replacing {e.previousListName}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{fmtIST(e.occurredAt)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {e.actorLabel} - {e.listType === "included" ? "Included" : "Excluded"}, {e.itemCount.toLocaleString()} items, {e.competitorCount.toLocaleString()} competitors, {e.competitorPriceCount.toLocaleString()} quotes (at the time)
      </div>
      <div className="mt-1">Reason: {e.reason}</div>
      {Number(e.snapshot?.noCompetitorPriceCount ?? 0) > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          {Number(e.snapshot!.noCompetitorPriceCount)} products had no competitor price under this filter (at the time)
        </div>
      )}
      <details className="mt-2 rounded border px-2 py-1">
        <summary className="cursor-pointer text-xs font-medium">View saved rule at this time</summary>
        <HistoricalDefinition snapshot={e.snapshot ?? {}} />
        {e.beforeSnapshot && <>
          <p className="mt-2 text-xs font-medium">Before this edit</p>
          <HistoricalDefinition snapshot={e.beforeSnapshot} />
        </>}
      </details>
    </li>
  );
}

export function EnforcementTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetBucketEnforcement({ query: { queryKey: getGetBucketEnforcementQueryKey(), refetchInterval: 5000, refetchOnWindowFocus: true, staleTime: 0 } });
  const lists = useGetBucketLists({ query: { enabled: isAdmin, queryKey: ["bucket-lists-enforce-picker"] } });
  const enforceM = useEnforceBucketList();
  const releaseM = useReleaseBucketEnforcement();
  const [snap, setSnap] = useState<null | { mode: "enforce" | "release"; version: number; prevId: string | null; prevName: string | null }>(null);
  const mode = snap?.mode ?? null;
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");

  if (q.isLoading) return <div className="space-y-2 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (q.isError || !q.data) {
    return <div className="p-8 text-center"><p className="font-semibold text-destructive">Could not load enforcement.</p><Button variant="outline" className="mt-3" onClick={() => q.refetch()}>Retry</Button></div>;
  }
  const { enforced, history, version } = q.data;
  const choices = (lists.data ?? []).filter((l) => l.visibility === "everyone");
  const picked = choices.find((l) => l.id === pick);
  const open = (m: "enforce" | "release") => setSnap({ mode: m, version, prevId: enforced?.list.id ?? null, prevName: enforced?.list.name ?? null });
  const stale = !!snap && (snap.version !== version || snap.prevId !== (enforced?.list.id ?? null));
  const close = () => { setSnap(null); setReason(""); setPick(""); };
  const done = (t: string) => { void qc.invalidateQueries(); toast({ title: t }); close(); };
  const fail = (e: unknown) => toast({ title: "Action failed", description: errMessage(e), variant: "destructive" });
  const ok = !stale && !!snap && !!reason.trim() && (mode === "release" || !!picked);
  const submit = () => {
    if (!ok || !snap) return;
    if (mode === "enforce") enforceM.mutate({ data: { listId: pick, reason: reason.trim(), expectedVersion: snap.version } }, { onSuccess: () => done("List put in force"), onError: fail });
    else releaseM.mutate({ data: { reason: reason.trim(), expectedVersion: snap.version } }, { onSuccess: () => done("List taken out of force"), onError: fail });
  };

  return (
    <div className="p-4" data-testid="panel-enforcement">
      {enforced ? (
        <section className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4" data-testid="panel-enforced-current">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">In force now</div>
          <h2 className="text-lg font-black" data-testid="text-enforced-name">{enforced.list.name}</h2>
          <p className="text-sm font-semibold">{enforced.list.type === "included" ? "Included" : "Excluded"} list</p>
          <p className="mt-1 text-sm" data-testid="text-enforced-effect">{enforcedEffectText(enforced.list)}</p>
          <p className="mt-2 text-xs text-muted-foreground">By {enforced.actorLabel}, {fmtIST(enforced.enforcedAt)}</p>
          <p className="mt-1 text-sm">Reason: {enforced.reason}</p>
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={() => open("enforce")} data-testid="button-replace-enforcement">Replace with another list</Button>
              <Button variant="destructive" onClick={() => open("release")} data-testid="button-release-enforcement">Take out of force</Button>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-lg border bg-muted/40 p-4" data-testid="panel-enforced-none">
          <p className="font-bold">No list is in force.</p>
          {isAdmin && <Button className="mt-3" onClick={() => open("enforce")} data-testid="button-enforce">Enforce a list</Button>}
        </section>
      )}

      <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wider text-muted-foreground">History, newest first</h3>
      {history.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-no-history">No enforcement events yet.</p> : (
        <ul className="divide-y rounded-lg border">{history.map((e) => <HistoryRow key={e.id} e={e} />)}</ul>
      )}

      <AlertDialog open={!!mode && isAdmin} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mode === "release" ? `Take "${snap?.prevName}" out of force?` : snap?.prevName ? "Replace the list in force" : "Enforce a list"}</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "release"
                ? "Everyone stops being filtered by this list. Their own filters apply again."
                : snap?.prevName
                ? <>This replaces <strong>{snap.prevName}</strong> (previous) with <strong>{picked?.name ?? "the list you pick"}</strong> (replacement) for every user.</>
                : "Pick a Head Office list (visible to everyone). It will apply to every user."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {stale && <p className="rounded border border-red-400 bg-red-100 p-2 text-sm text-red-950" data-testid="text-enforcement-stale">Enforcement changed while this dialog was open{enforced ? ` (now in force: ${enforced.list.name})` : " (nothing is in force now)"}. Cancel and reopen to act on the current state. Your reason is kept until you cancel.</p>}
          {mode === "enforce" && (
            <>
              <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid="select-enforce-list">
                <option value="">Choose a list</option>
                {choices.filter((l) => l.id !== snap?.prevId).map((l) => <option key={l.id} value={l.id}>{l.name} - {l.type === "excluded" ? "Excluded" : "Included"}</option>)}
              </select>
              {picked && <p className="text-sm" data-testid="text-pick-effect">{enforcedEffectText(picked)}</p>}
            </>
          )}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" maxLength={2000} data-testid="input-enforcement-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={!ok || enforceM.isPending || releaseM.isPending} onClick={submit} data-testid="button-confirm-enforcement">
              {mode === "release" ? "Take out of force" : snap?.prevName ? "Replace" : "Enforce"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
