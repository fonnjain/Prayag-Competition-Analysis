import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEnforceBucketList, getGetBucketEnforcementQueryKey, useGetBucketEnforcement, useGetBucketLists, useReleaseBucketEnforcement,
  bucketEffectShort, type BucketList, type BucketEnforcementEvent,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
        {e.actorLabel}
      </div>
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
  const [showPicker, setShowPicker] = useState(false);
  const [pick, setPick] = useState("");

  if (q.isLoading) return <div className="space-y-2 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (q.isError || !q.data) {
    return <div className="p-8 text-center"><p className="font-semibold text-destructive">Could not load enforcement.</p><Button variant="outline" className="mt-3" onClick={() => q.refetch()}>Retry</Button></div>;
  }
  const { enforced, history, version } = q.data;
  const choices = (lists.data ?? []).filter((l) => l.visibility === "everyone" && l.id !== enforced?.list.id);
  const picked = choices.find((l) => l.id === pick);
  const close = () => { setShowPicker(false); setPick(""); };
  const done = (t: string) => { void qc.invalidateQueries(); toast({ title: t }); close(); };
  const fail = (e: unknown) => { void qc.invalidateQueries(); toast({ title: "Action failed", description: errMessage(e), variant: "destructive" }); };
  const busy = enforceM.isPending || releaseM.isPending;
  const enforce = () => {
    if (!picked || busy) return;
    enforceM.mutate({ data: { listId: picked.id, expectedVersion: version } }, { onSuccess: () => done("List put in force"), onError: fail });
  };
  const release = () => {
    if (busy) return;
    releaseM.mutate({ data: { expectedVersion: version } }, { onSuccess: () => done("List taken out of force"), onError: fail });
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
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setShowPicker(true)} data-testid="button-replace-enforcement">Replace with another list</Button>
              <Button variant="destructive" disabled={busy} onClick={release} data-testid="button-release-enforcement">Take out of force</Button>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-lg border bg-muted/40 p-4" data-testid="panel-enforced-none">
          <p className="font-bold">No list is in force.</p>
          {isAdmin && !showPicker && <Button className="mt-3" onClick={() => setShowPicker(true)} data-testid="button-enforce">Enforce a list</Button>}
        </section>
      )}

      {isAdmin && showPicker && (
        <div className="mt-3 space-y-2 rounded-lg border p-3">
          <label className="block text-sm font-medium" htmlFor="ho-enforce-list">Head Office list</label>
          <select id="ho-enforce-list" value={pick} onChange={e => setPick(e.target.value)} disabled={busy}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid="select-enforce-list">
            <option value="">Choose a list</option>
            {choices.map(l => <option key={l.id} value={l.id}>{l.name} — {l.type === "excluded" ? "Excluded" : "Included"}</option>)}
          </select>
          {picked && <p className="text-sm" data-testid="text-pick-effect">{enforcedEffectText(picked)}</p>}
          {choices.length === 0 && <p className="text-sm text-muted-foreground">No other Head Office lists are available.</p>}
          <div className="flex gap-2">
            <Button disabled={!picked || busy} onClick={enforce} data-testid="button-apply-enforcement">{enforced ? "Replace" : "Enforce"}</Button>
            <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
          </div>
        </div>
      )}
      <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wider text-muted-foreground">Last changes</h3>
      {history.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-no-history">No enforcement events yet.</p> : (
        <ul className="divide-y rounded-lg border">{history.map((e) => <HistoryRow key={e.id} e={e} />)}</ul>
      )}

    </div>
  );
}
