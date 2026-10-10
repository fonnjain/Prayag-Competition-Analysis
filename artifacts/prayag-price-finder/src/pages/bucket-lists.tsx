import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getExportBucketListUrl,
  getGetBucketListsQueryKey,
  useActiveBucket,
  useDeleteBucketList,
  useGetBucketLists,
  useMoveBucketToHo,
  useMoveBucketToMy,
  useSetActiveBucket,
  useUpdateBucketList,
  BUCKET_TYPE,
  bucketKind,
  type BucketList,
} from "@workspace/api-client-react";
import { Plus, Download, Eye, Copy, Pencil, Trash2, Check, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EnforcementTab } from "@/components/bucket-enforcement";
import { SignInRequired, errMessage, useBucketUser } from "@/lib/bucketShared";

type Chip = "all" | "ho" | "mine" | "enforced";
type TypeChip = "all" | "included" | "excluded";

export function TypeBadge({ type }: { type?: string }) {
  const t = BUCKET_TYPE[bucketKind(type)];
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", t.badgeClass)}>
      {t.label}
    </span>
  );
}

export default function BucketListsPage() {
  const { user, isLoading: authLoading } = useBucketUser();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [chip, setChip] = useState<Chip>("all");
  const [typeChip, setTypeChip] = useState<TypeChip>("all");
  const [search, setSearch] = useState("");
  const [del, setDel] = useState<BucketList | null>(null);
  const [rename, setRename] = useState<BucketList | null>(null);
  const [newName, setNewName] = useState("");
  const signedIn = !!user;

  const params = {
    owner: chip === "ho" ? "ho" : chip === "mine" ? "mine" : "all",
    type: typeChip,
  } as const;
  const { data, isLoading, isError, refetch } = useGetBucketLists(params, {
    query: { queryKey: [...getGetBucketListsQueryKey(params), user?.id ?? "none"], enabled: signedIn },
  });
  const moveHo = useMoveBucketToHo();
  const moveMy = useMoveBucketToMy();
  const isAdmin = user?.role === "admin";
  const moving = moveHo.isPending || moveMy.isPending;
  const move = (l: BucketList, toHo: boolean) => {
    if (moving) return;
    (toHo ? moveHo : moveMy).mutate({ id: l.id }, {
      onSuccess: (r) => { toast({ title: r.message }); void qc.invalidateQueries(); },
      onError: (e) => { toast({ title: "Could not move list", description: errMessage(e), variant: "destructive" }); void qc.invalidateQueries(); },
    });
  };
  const active = useActiveBucket(user?.id);
  const { setListActive, isPending: settingActive } = useSetActiveBucket();
  const deleteM = useDeleteBucketList();
  const updateM = useUpdateBucketList();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((l) => {
      const ho = l.visibility === "everyone";
      if (typeChip !== "all" && bucketKind(l.type) !== typeChip) return false;
      if (chip === "ho" && !ho) return false;
      if (chip === "mine" && (ho || l.ownerId !== user?.id || l.visibility !== "only_me")) return false;
      return !q || (l.name ?? "").toLowerCase().includes(q);
    });
  }, [data, chip, typeChip, search, user?.id]);

  if (!authLoading && !signedIn) return <SignInRequired title="Bucket lists" />;

  const refresh = () => qc.invalidateQueries({ queryKey: getGetBucketListsQueryKey() });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Bucket lists</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Saved product sets you can switch on as a filter. An Included list shows only its products; an Excluded list hides them.
          </p>
        </div>
        <Link href="/bucket-lists/edit" data-testid="link-new-bucket"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" /> New bucket list
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {([["all", "All"], ["ho", "HO lists"], ["mine", "My lists"], ["enforced", "HO Enforced"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setChip(k)} data-testid={`chip-${k}`}
            className={cn("rounded-full border px-3.5 py-1 text-sm font-semibold transition-colors",
              chip === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
            {label}
          </button>
        ))}
        {chip !== "enforced" && <><span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" aria-hidden />
        {([["all", "All"], ["included", "Included"], ["excluded", "Excluded"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTypeChip(k)} data-testid={`chip-type-${k}`}
            className={cn("rounded-full border-2 px-3.5 py-1 text-sm font-semibold transition-colors",
              typeChip === k
                ? (k === "all" ? "border-primary bg-primary text-primary-foreground" : cn(BUCKET_TYPE[k].cardOnClass, "text-foreground"))
                : "bg-card hover:bg-accent")}>
            {label}
          </button>
        ))}</>}
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name"
          className="ml-auto h-9 w-full sm:w-64" data-testid="input-search-bucket" />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-sm">
        {chip === "enforced" ? <EnforcementTab isAdmin={user?.role === "admin"} userId={user?.id} /> : isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : isError ? (
          <div className="p-8 text-center">
            <p className="font-semibold text-destructive">Could not load bucket lists.</p>
            <Button variant="outline" className="mt-3" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (data ?? []).length === 0 && chip === "all" && typeChip === "all" && !search.trim() ? (
          <div className="p-10 text-center" data-testid="empty-bucket-lists">
            <Bookmark className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-bold">No bucket lists yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              A bucket list is a named, saved set of products. Switch one on and every comparison shows only those products, or everything except them.
            </p>
            <Link href="/bucket-lists/edit" className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" /> New bucket list
            </Link>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{chip === "ho" ? "No HO lists" : chip === "mine" ? "No lists of yours" : "No lists"}{typeChip !== "all" ? ` of type ${typeChip}` : ""}{search.trim() ? " match this search" : ""}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2 text-right">Items</th><th className="px-3 py-2">Divisions</th>
                <th className="px-3 py-2">Last changed</th><th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => {
                const ho = l.visibility === "everyone";
                const isActive = active.personalLists.some((p) => p.id === l.id);
                const enforcedHere = !!l.isEnforced || active.enforcedList?.id === l.id;
                const comps = Array.from(new Set((l.competitorRules ?? []).map((r) => r.competitor).filter(Boolean))) as string[];
                const nComp = l.competitorCount ?? comps.length;
                const divs = (l.divisions ?? []).map((d) => `${d.division} (${d.count})`);
                const divText = divs.length ? divs.join(", ") : comps.length ? comps.join(", ") : "\u2014";
                return (
                  <tr key={l.id} data-testid={`row-bucket-${l.id}`} className={cn("align-top", isActive && "bg-primary/5")}>
                    <td className="px-3 py-3">
                      <div className="font-bold">{l.name}</div>
                      {l.isEnforced && <span className="mr-1 inline-block rounded bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground" data-testid={`badge-enforced-${l.id}`}>Enforced</span>}
                      {isActive && <div className="text-xs font-semibold text-primary">Active filter</div>}
                      {l.parentName && <div className="text-xs text-muted-foreground">Based on {l.parentName}</div>}
                    </td>
                    <td className="px-3 py-3"><TypeBadge type={l.type} /></td>
                    <td className="px-3 py-3">
                      <span className={cn("rounded px-2 py-0.5 text-[11px] font-bold", ho ? "bg-indigo-200 text-indigo-950" : "bg-emerald-200 text-emerald-950")}>
                        {ho ? "HO" : "Mine"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono" data-testid={`text-items-${l.id}`}>{`${l.count} ${l.count === 1 ? "product" : "products"} \u00b7 ${nComp} ${nComp === 1 ? "competitor" : "competitors"}`}</td>
                    <td className="max-w-[220px] px-3 py-3 text-xs text-muted-foreground">{divText}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {l.updatedBy ?? ""}<br />{l.updatedAt ? new Date(l.updatedAt).toLocaleString() : ""}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {enforcedHere ? (
                          <span className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-semibold text-muted-foreground" data-testid={`text-enforced-${l.id}`}>Enforced by Head Office</span>
                        ) : (
                          <Button size="sm" variant={isActive ? "secondary" : "default"} disabled={settingActive}
                            data-testid={`button-use-${l.id}`}
                            onClick={() => setListActive(l.id, !isActive, (message) => {
                              toast({ title: isActive ? `Removed ${l.name}` : `Now filtering with ${l.name}`, description: message });
                              const ret = new URLSearchParams(window.location.search).get("return");
                              if (!isActive && ret && ret.startsWith("/") && !ret.startsWith("//")) window.location.assign(ret);
                            }, (e) => toast({ title: "Could not change filter", description: errMessage(e), variant: "destructive" }))}>
                            {isActive ? <><Check className="mr-1 h-3.5 w-3.5" />In use - remove</> : l.type === "excluded" ? "Add as exclusion" : "Use as filter"}
                          </Button>
                        )}
                        <Link href={`/bucket-lists/edit?id=${l.id}&view=1`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-accent" data-testid={`link-view-${l.id}`}>
                          <Eye className="h-3.5 w-3.5" /> View items
                        </Link>
                        <Link href={`/bucket-lists/edit?parent=${l.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-accent" data-testid={`link-copy-${l.id}`}>
                          <Copy className="h-3.5 w-3.5" /> Copy and edit
                        </Link>
                        <a href={getExportBucketListUrl(l.id)} download className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-accent" data-testid={`link-export-${l.id}`}>
                          <Download className="h-3.5 w-3.5" /> Export to Excel
                        </a>
                        {isAdmin && (ho ? (
                          enforcedHere || l.affectsEnforced
                            ? <span className="text-xs text-muted-foreground" data-testid={`text-move-blocked-${l.id}`}>Take it out of force before moving to My lists.</span>
                            : <Button size="sm" variant="outline" disabled={moving} data-testid={`button-move-my-${l.id}`} onClick={() => move(l, false)}>Move to my lists</Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={moving} data-testid={`button-move-ho-${l.id}`} onClick={() => move(l, true)}>Move to HO lists</Button>
                        ))}
                        {l.canEdit && (
                          <>
                            <Link href={`/bucket-lists/edit?id=${l.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-accent" data-testid={`link-edit-${l.id}`}>
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </Link>
                            <Button size="sm" variant="outline" data-testid={`button-rename-${l.id}`} onClick={() => { setRename(l); setNewName(l.name ?? ""); }}>Rename</Button>
                            <Button size="sm" variant="outline" className="text-destructive" data-testid={`button-delete-${l.id}`} disabled={l.isEnforced || l.affectsEnforced} title={l.isEnforced ? "In force. Take it out of force first." : l.affectsEnforced ? `Protected: it feeds ${l.enforcedListName}. Take that list out of force first.` : undefined} onClick={() => setDel(l)}>
                              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                            </Button>
                            {(l.isEnforced || l.affectsEnforced) && <div className="w-full text-xs text-muted-foreground" data-testid={`text-delete-blocked-${l.id}`}>{l.isEnforced ? "Cannot delete: in force. Take it out of force first." : `Cannot delete: it feeds the enforced list ${l.enforcedListName}. Take that list out of force first.`}</div>}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{del?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the list and its {del?.count} items from the list only. No product and no price is deleted. Lists based on it are detached and keep their members.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete" onClick={() => {
              if (!del) return;
              deleteM.mutate({ id: del.id }, {
                onSuccess: () => { toast({ title: "List deleted" }); void qc.invalidateQueries(); },
                onError: (e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }),
              });
              setDel(null);
            }}>Delete list</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename list</AlertDialogTitle>
            <AlertDialogDescription>Only the name changes. Items stay as they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="input-rename" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!newName.trim()} onClick={() => {
              if (!rename) return;
              updateM.mutate({ id: rename.id, data: { name: newName } }, {
                onSuccess: () => { refresh(); void qc.invalidateQueries(); toast({ title: "Renamed" }); },
                onError: (e) => toast({ title: "Rename failed", description: errMessage(e), variant: "destructive" }),
              });
              setRename(null);
            }}>Save name</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
