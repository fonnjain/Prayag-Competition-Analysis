import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getDownloadBucketTemplateUrl,
  getGetBucketListQueryKey,
  useCreateBucketList,
  useDetachBucketList,
  useGetBucketCatalogue,
  useGetBucketList,
  useGetBucketLists,
  usePreviewBucketList,
  usePreviewBucketUpload,
  useUpdateBucketList,
  type BucketDraft,
  type BucketList,
  type BucketRule,
  BUCKET_TYPE,
  bucketEffectShort,
} from "@workspace/api-client-react";
import { AlertTriangle, ChevronLeft, Download, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CompetitorsTab, competitorScopeLabel, type CompetitorOption, type CompetitorRuleLike } from "@/components/bucket-competitors-tab";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SignInRequired, errMessage, isLive, normName, useBucketUser, type Member, type UploadResult, type UploadStatus } from "@/lib/bucketShared";

const STATUS_LABEL: Record<UploadStatus, string> = {
  matched: "matched",
  space_matched: "matched after removing a space",
  duplicate: "already in this list",
  not_found: "not found in the catalogue",
  inactive: "no longer active",
};
const STATUS_ORDER: UploadStatus[] = ["matched", "space_matched", "duplicate", "not_found", "inactive"];
const uniq = (a: (string | null | undefined)[]) => Array.from(new Set(a.filter((value): value is string => typeof value === "string" && !!value.trim())));
const compOf = (r: BucketRule) => (r as { competitor?: string | null }).competitor;
const isProductRule = (r: BucketRule) => !compOf(r);
const sameRule = (a: BucketRule, b: BucketRule) => !compOf(a) && !compOf(b) && (a.division ?? "") === (b.division ?? "") && (a.category ?? "") === (b.category ?? "") && (a.range ?? "") === (b.range ?? "");
const ruleLabel = (r: BucketRule) => [r.division, r.category, r.range].filter(Boolean).join(" / ");

export default function BucketEditorPage() {
  const { user, isLoading: authLoading } = useBucketUser();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const sp = useMemo(() => new URLSearchParams(search), [search]);
  const editId = sp.get("id") ?? sp.get("edit");
  const parentParam = sp.get("parent");
  const codeParams = useMemo(() => sp.getAll("code"), [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const signedIn = !!user;
  const isAdmin = user?.role === "admin";

  const existing = useGetBucketList(editId ?? "", {
    query: { queryKey: [...getGetBucketListQueryKey(editId ?? ""), user?.id ?? "none"], enabled: signedIn && !!editId },
  });
  const allLists = useGetBucketLists(undefined, { query: { enabled: signedIn, queryKey: ["bucket-lists-all", user?.id ?? "none"] } });
  const catalogue = useGetBucketCatalogue({ query: { enabled: signedIn, queryKey: ["bucket-catalogue", user?.id ?? "none"] } });

  const [draft, setDraft] = useState<BucketDraft>({
    name: "", description: "", type: "excluded", visibility: "only_me", parentId: null,
    rules: [], addedCodes: [], removedCodes: [],
  });
  const [ready, setReady] = useState(false);
  const initFor = useRef<string | null>(null);
  const [preview, setPreview] = useState<BucketList | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; existing?: { id: string; name: string } } | null>(null);
  const [confirmZero, setConfirmZero] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [tab, setTab] = useState<"pick" | "upload" | "competitors">("pick");

  const previewM = usePreviewBucketList();
  const previewRef = useRef(previewM.mutate);
  previewRef.current = previewM.mutate;
  const createM = useCreateBucketList();
  const updateM = useUpdateBucketList();
  const detachM = useDetachBucketList();
  const uploadM = usePreviewBucketUpload();

  const detail = existing.data;
  const definitionFingerprint = (value: typeof draft | NonNullable<typeof detail>) => JSON.stringify({
    name: value.name ?? "", description: value.description ?? "", type: value.type, visibility: value.visibility,
    parentId: value.parentId ?? null, rules: value.rules ?? [],
    addedCodes: [...(value.addedCodes ?? [])].sort(), removedCodes: [...(value.removedCodes ?? [])].sort(),
  });
  const unsavedChanges = !!detail && definitionFingerprint(draft) !== definitionFingerprint(detail);
  const readOnly = !!editId && (sp.get("view") === "1" || (!!detail && !detail.canEdit));

  // Review panel sizing: bound to the visible viewport from its real top offset.
  const asideRef = useRef<HTMLElement | null>(null);
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [panelH, setPanelH] = useState<number | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => setWide(mq.matches);
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);
  useEffect(() => {
    if (!wide) { setPanelH(null); return; }
    const measure = () => {
      const el = asideRef.current;
      if (!el) return;
      const scroller = el.closest("main")?.getBoundingClientRect().top ?? 0;
      const top = Math.max(el.getBoundingClientRect().top, scroller + 16);
      const h = Math.max(300, Math.floor(window.innerHeight - top - 16));
      setPanelH((prev) => (prev === h ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [wide, ready]);

  // Init once per route target
  useEffect(() => {
    if (!signedIn) return;
    const key = `${editId ?? ""}|${parentParam ?? ""}|${codeParams.join(",")}`;
    if (editId) {
      if (detail && initFor.current !== key) {
        initFor.current = key;
        setDraft({
          name: detail.name ?? "", description: detail.description ?? "", type: detail.type ?? "excluded",
          visibility: detail.visibility ?? "only_me", parentId: detail.parentId ?? null,
          rules: detail.rules ?? [], addedCodes: detail.addedCodes ?? [], removedCodes: detail.removedCodes ?? [],
        });
        setReady(true);
      }
    } else if (initFor.current !== key) {
      initFor.current = key;
      setDraft((d) => ({ ...d, parentId: parentParam, addedCodes: parentParam ? [] : uniq(codeParams), removedCodes: [] }));
      setReady(true);
    }
  }, [signedIn, editId, detail, parentParam, codeParams]);

  // Live server-resolved preview
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      previewRef.current({ data: JSON.parse(draftKey) as BucketDraft }, {
        onSuccess: (r) => { setPreview(r); setPreviewError(null); },
        onError: (e) => setPreviewError(errMessage(e)),
      });
    }, 350);
    return () => clearTimeout(t);
  }, [draftKey, ready]);

  const set = (patch: Partial<BucketDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const rules = draft.rules ?? [];
  const added = draft.addedCodes ?? [];
  const removed = draft.removedCodes ?? [];

  const addCodes = (codes: string[]) =>
    setDraft((d) => ({
      ...d,
      addedCodes: uniq([...(d.addedCodes ?? []), ...codes]),
      removedCodes: (d.removedCodes ?? []).filter((c) => !codes.includes(c)),
    }));
  const removeCode = (code: string) =>
    setDraft((d) => {
      const stillCovered = (d.rules ?? []).some(isProductRule) || !!d.parentId;
      return {
        ...d,
        addedCodes: (d.addedCodes ?? []).filter((c) => c !== code),
        removedCodes: stillCovered ? uniq([...(d.removedCodes ?? []), code]) : d.removedCodes,
      };
    });
  const removeCategory = (division: string, category: string) =>
    setDraft((d) => {
      const nc = normName(category);
      const members = (preview?.members ?? []) as unknown as Member[];
      const codes = members.filter((m) => m.division === division && normName(m.category) === nc).map((m) => m.itemCode);
      const nextRules = (d.rules ?? []).filter((r) => !(isProductRule(r) && r.division === division && r.category && normName(r.category) === nc));
      const covered = nextRules.some(isProductRule) || !!d.parentId;
      return {
        ...d,
        rules: nextRules,
        addedCodes: (d.addedCodes ?? []).filter((c) => !codes.includes(c)),
        removedCodes: covered ? uniq([...(d.removedCodes ?? []), ...codes]) : d.removedCodes,
      };
    });
  const clearMissing = () =>
    setDraft((d) => {
      const miss = ((preview?.members ?? []) as unknown as Member[]).filter((m) => m.missing).map((m) => m.itemCode);
      return { ...d, addedCodes: (d.addedCodes ?? []).filter((c) => !miss.includes(c)), removedCodes: (d.removedCodes ?? []).filter((c) => !miss.includes(c)) };
    });

  // Name conflicts (same owner)
  const cleanName = draft.name?.trim().replace(/\s+/g, " ") ?? "";
  const conflict = useMemo(() => {
    if (!cleanName) return null;
    return (allLists.data ?? []).find((l) => l.id !== editId && l.ownerId === user?.id && normName(l.name ?? "") === normName(cleanName)) ?? null;
  }, [allLists.data, cleanName, editId, user?.id]);

  const members = ((preview?.members ?? []) as unknown as Member[]);
  const divisions = (preview?.divisions ?? []) as unknown as { division: string; count: number }[];
  const ruleCounts = (preview?.ruleCounts ?? []) as unknown as { rule: BucketRule; count: number }[];
  const hasItems = rules.length + added.length > 0 || !!draft.parentId;
  const canSave = !readOnly && !!cleanName && hasItems && !conflict && !createM.isPending && !updateM.isPending;
  const zeroIncluded = draft.type === "included" && preview?.productFilterApplied !== false && (preview?.count ?? 1) === 0;

  const doSave = () => {
    setSaveError(null);
    const body: BucketDraft = { ...draft, name: cleanName, visibility: isAdmin ? draft.visibility : "only_me" };
    const onSuccess = () => {
      void qc.invalidateQueries();
      toast({ title: "Bucket list saved" });
      setLocation("/bucket-lists");
    };
    const onError = (e: unknown) => {
      const data = (e as { data?: { code?: string; existingList?: { id: string; name: string } } })?.data;
      setSaveError({
        message: errMessage(e),
        existing: data?.code === "BUCKET_NAME_EXISTS" ? data.existingList : undefined,
      });
    };
    if (editId) updateM.mutate({ id: editId, data: body }, { onSuccess, onError });
    else createM.mutate({ data: body }, { onSuccess, onError });
  };
  const onSaveClick = () => (zeroIncluded ? setConfirmZero(true) : doSave());

  if (!authLoading && !signedIn) return <SignInRequired title="Create a bucket list" />;
  if (editId && existing.isError) {
    return (
      <div className="mx-auto max-w-lg p-10 text-center">
        <p className="font-bold text-destructive">This list could not be opened.</p>
        <p className="mt-1 text-sm text-muted-foreground">{errMessage(existing.error)}</p>
        <Link href="/bucket-lists" className="mt-4 inline-block underline">Back to bucket lists</Link>
      </div>
    );
  }
  if (!ready) return <div className="space-y-3 p-8"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;

  const kindT = BUCKET_TYPE[draft.type === "included" ? "included" : "excluded"];
  const disabledReason = canSave ? "" : conflict ? "Name already used by another of your lists." : !cleanName ? "Enter a name to save." : !hasItems ? "Add at least one item to save." : "";
  const actionFooter = (
    <div className="shrink-0 border-t-2 bg-card p-3 shadow-[0_-4px_10px_rgba(0,0,0,0.06)]" data-testid="panel-save-footer">
      {saveError && (
        <p className="mb-2 text-sm text-destructive" data-testid="text-save-error">
          {saveError.message}{" "}
          {saveError.existing && <Link href={`/bucket-lists/edit?id=${saveError.existing.id}`} className="underline" data-testid="link-existing-list">Open "{saveError.existing.name}"</Link>}
        </p>
      )}
      <div className="mb-2 flex items-center gap-2 text-sm" data-testid="text-live-effect">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", kindT.badgeClass)}>{kindT.label}</span>
        <strong>{preview ? bucketEffectShort(draft.type, preview.count) : "Resolving..."}</strong>
        <span className="ml-auto text-xs text-muted-foreground" data-testid="text-item-count">{members.length.toLocaleString()} item{members.length === 1 ? "" : "s"}</span>
      </div>
      {!canSave && disabledReason && <p className="mb-2 truncate text-xs text-muted-foreground" data-testid="text-save-disabled-reason">{disabledReason}</p>}
      <Button className="w-full" disabled={!canSave} onClick={onSaveClick} data-testid="button-save-bucket">
        {createM.isPending || updateM.isPending ? "Saving..." : "Save bucket list"}
      </Button>
    </div>
  );

  const parentName = detail?.parentName ?? preview?.parentName ?? (allLists.data ?? []).find((l) => l.id === draft.parentId)?.name;

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <Link href="/bucket-lists" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Bucket lists
      </Link>
      <h1 className="mb-4 mt-1 text-2xl font-black tracking-tight">
        {readOnly ? "View bucket list" : editId ? "Edit bucket list" : "New bucket list"}
      </h1>
      {readOnly && <p className="mb-3 rounded border bg-muted p-3 text-sm" data-testid="text-readonly">You are viewing this list read-only. Only the owner can edit it. Use Copy and edit to start your own.</p>}
      {detail?.detachedNotice && <p className="mb-3 rounded border border-amber-400 bg-amber-100 p-3 text-sm text-amber-950" data-testid="text-detached-notice">{detail.detachedNotice}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Block one */}
          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">1. Name and type</h2>
            <label className="text-sm font-semibold">Name</label>
            <Input value={draft.name ?? ""} disabled={readOnly} onChange={(e) => set({ name: e.target.value })} data-testid="input-bucket-name" className="mt-1" />
            {conflict && (
              <p className="mt-1 text-sm text-destructive" data-testid="text-name-conflict">
                You already have a list called "{conflict.name}". <Link className="underline" href={`/bucket-lists/edit?id=${conflict.id}`}>Open it</Link>
              </p>
            )}
            <label className="mt-3 block text-sm font-semibold">Description (optional)</label>
            <Textarea value={draft.description ?? ""} disabled={readOnly} onChange={(e) => set({ description: e.target.value })} className="mt-1" rows={2} data-testid="input-bucket-description" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {([["included", "Included", "Show only these items"], ["excluded", "Excluded", "Hide these items"]] as const).map(([v, t, s]) => (
                <button key={v} type="button" disabled={readOnly} onClick={() => set({ type: v })} data-testid={`card-type-${v}`}
                  className={cn("rounded-lg border-2 p-4 text-left transition-colors",
                    draft.type === v ? BUCKET_TYPE[v].cardOnClass : "bg-background hover:bg-accent")}>
                  <div className="text-lg font-black">{t}</div>
                  <div className="text-sm text-muted-foreground">{s}</div>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <label className="text-sm font-semibold">Visibility</label>
              {isAdmin && !readOnly ? (
                <div className="mt-1 flex gap-2">
                  {([["only_me", "Only me"], ["everyone", "Everyone (Head Office list)"]] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => set({ visibility: v })} data-testid={`button-visibility-${v}`}
                      className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", draft.visibility === v ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{l}</button>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm" data-testid="text-visibility-fixed">
                  <strong>{draft.visibility === "everyone" ? "Everyone" : "Only me"}</strong>
                  <span className="text-muted-foreground"> - {isAdmin ? "" : "Your lists are private to you. Only an administrator can share a list with everyone."}</span>
                </p>
              )}
            </div>
            {!editId && (
              <div className="mt-3">
                <label className="text-sm font-semibold">Start from</label>
                <select value={draft.parentId ?? ""} disabled={!!editId} onChange={(e) => set({ parentId: e.target.value || null, addedCodes: [], removedCodes: [] })}
                  className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" data-testid="select-parent">
                  <option value="">Blank</option>
                  {(allLists.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} - {l.type === "excluded" ? "Excluded" : "Included"}</option>)}
                </select>
              </div>
            )}
            {draft.parentId && (
              <div className="mt-3 rounded-md border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-950" data-testid="text-parent-line">
                Based on <strong>{parentName ?? "parent list"}</strong>. {added.length} items added, {removed.length} removed. It stays linked: changes to the original reach this list.
                {editId && !readOnly && (
                  <>
                    <Button size="sm" variant="outline" className="ml-3" disabled={!editId || unsavedChanges || detachM.isPending} onClick={() => setConfirmDetach(true)} data-testid="button-detach">Detach from the original</Button>
                    {(!editId || unsavedChanges) && <span className="mt-2 block text-xs text-muted-foreground">Save your changes before detaching.</span>}
                  </>
                )}
              </div>
            )}
          </section>

          {/* Block two */}
          {!readOnly && (
            <section className="rounded-xl border bg-card p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">2. Add items</h2>
              <div className="mb-3 flex gap-2">
                {([["pick", "Pick from the catalogue"], ["upload", "Upload from Excel"], ["competitors", "Competitors"]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setTab(k)} data-testid={`tab-${k}`}
                    className={cn("rounded-md border px-3 py-1.5 text-sm font-semibold", tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{l}</button>
                ))}
              </div>
              {tab === "pick" ? (
                <Picker
                  loading={catalogue.isLoading} error={catalogue.isError} retry={() => catalogue.refetch()}
                  products={(catalogue.data?.products ?? []) as unknown as Member[]}
                  rangeDivisions={(catalogue.data?.rangeDivisions ?? []) as string[]}
                  selected={new Set(added)} onAddCodes={addCodes}
                  onAddRule={(r) => setDraft((d) => ({ ...d, rules: [...(d.rules ?? []).filter((x) => !sameRule(x, r)), r] }))}
                />
              ) : tab === "competitors" ? (
                <CompetitorsTab
                  options={((catalogue.data?.competitors ?? []) as CompetitorOption[])}
                  loading={catalogue.isLoading} error={catalogue.isError} retry={() => catalogue.refetch()}
                  onAdd={(rs) => setDraft((d) => ({ ...d, rules: [...(d.rules ?? []), ...(rs as unknown as BucketRule[])] }))}
                />
              ) : (
                <UploadTab draft={draft} onAdd={addCodes} uploadM={uploadM} />
              )}
            </section>
          )}
        </div>

        {/* Block three: summary */}
        <aside ref={asideRef} className="lg:sticky lg:top-4 lg:self-start" data-testid="panel-summary">
          <section
            className="flex flex-col overflow-hidden rounded-xl border-2 border-primary/30 bg-card shadow-sm"
            style={wide && panelH ? { height: panelH } : undefined}
          >
            <div className={cn("min-h-0 p-4", wide ? "flex-1 overflow-y-auto" : "max-h-[60dvh] overflow-y-auto")} data-testid="region-summary-scroll">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">3. Review</h2>
            {previewError ? (
              <p className="text-sm text-destructive">Could not resolve the list: {previewError}</p>
            ) : !preview ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <p className="text-base" data-testid="text-summary-sentence">
                  {preview.productFilterApplied === false
                    ? <>No product filter applies: <strong>all products</strong> are shown.</>
                    : draft.type === "excluded"
                    ? <>This list will hide <strong>{preview.count.toLocaleString()}</strong> of <strong>{(preview.totalProducts ?? 0).toLocaleString()}</strong> products from every comparison.</>
                    : <>This list will show only <strong>{preview.count.toLocaleString()}</strong> products.</>}
                </p>
                {zeroIncluded && (
                  <p className="mt-2 flex gap-2 rounded border border-red-400 bg-red-100 p-2 text-sm text-red-950" data-testid="warn-zero-included">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> This Included list resolves to 0 products. Using it would make every screen empty.
                  </p>
                )}
                {(preview.missingCount ?? 0) > 0 && (
                  <p className="mt-2 rounded border border-amber-400 bg-amber-100 p-2 text-sm text-amber-950" data-testid="notice-missing">
                    {preview.missingCount} items are no longer in the catalogue.
                    {!readOnly && <button type="button" onClick={clearMissing} className="ml-2 font-bold underline" data-testid="button-clear-missing">Clear them</button>}
                  </p>
                )}
                {(preview.activeCount ?? preview.count) !== preview.count && (
                  <p className="mt-1 text-xs text-muted-foreground">{preview.activeCount} of these are active products.</p>
                )}
                {divisions.length > 0 && (
                  <div className="mt-3">
                    <h3 className="text-xs font-bold uppercase text-muted-foreground">By division</h3>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {divisions.map((d) => <li key={d.division} className="flex justify-between"><span>{d.division}</span><span className="font-mono">{d.count}</span></li>)}
                    </ul>
                  </div>
                )}
                {(rules.some(isProductRule)) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {rules.map((r, i) => {
                      if (!isProductRule(r)) return null;
                      const c = ruleCounts.find((x) => x.rule && sameRule(x.rule, r))?.count ?? ruleCounts[i]?.count ?? 0;
                      return (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-950" data-testid={`chip-rule-${i}`}>
                          All {ruleLabel(r)} ({c} products, updates automatically)
                          {!readOnly && <button type="button" aria-label="Remove rule" onClick={() => set({ rules: rules.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></button>}
                        </span>
                      );
                    })}
                  </div>
                )}
                {(() => {
                  const pv = preview;
                  const cr = pv.competitorRules ?? [];
                  if (cr.length === 0 && !rules.some((x) => !isProductRule(x))) return null;
                  const competitorKey = (r: BucketRule) => JSON.stringify([r.competitor, r.scope ?? "everywhere",
                    [...(r.divisions ?? [])].sort(), [...(r.categories ?? [])].sort()]);
                  const localKeys = new Set(rules.filter(r => !isProductRule(r)).map(competitorKey));
                  return (
                    <div className="mt-3" data-testid="section-competitor-summary">
                      <h3 className="text-xs font-bold uppercase text-muted-foreground">Competitor prices ignored</h3>
                      <p className="mt-1 text-sm" data-testid="text-competitor-effect">
                        {pv.productFilterApplied === false ? "No product filter applies. " : ""}
                        {draft.type === "included" ? "Omits " : "Ignores "}<strong>{(pv.competitorPriceCount ?? 0).toLocaleString()}</strong> competitor quotes
                        {(pv.noCompetitorPriceCount ?? 0) > 0 && <>; <strong>{pv.noCompetitorPriceCount}</strong> products would lose their last quote</>}.
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(draft.parentId ? cr.filter(r => !localKeys.has(competitorKey(r))) : []).map((r, i) => (
                          <span key={`inh-${i}`} className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-semibold" data-testid={`chip-inherited-competitor-${i}`}>{competitorScopeLabel(r as CompetitorRuleLike)} (inherited)</span>
                        ))}
                        {rules.map((r, i) => isProductRule(r) ? null : (
                          <span key={`loc-${i}`} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", ["bg-amber-100 text-amber-950", "bg-sky-100 text-sky-950", "bg-emerald-100 text-emerald-950", "bg-rose-100 text-rose-950"][i % 4])} data-testid={`chip-competitor-${i}`}>
                            {competitorScopeLabel(r as CompetitorRuleLike)}
                            {!readOnly && <button type="button" aria-label={`Remove rule ${competitorScopeLabel(r as CompetitorRuleLike)}`} onClick={() => set({ rules: rules.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></button>}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {!readOnly && Array.from(new Set(members.filter((m) => m.category).map((m) => `${m.division}||${m.category}`))).length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-semibold">Remove all from a category</summary>
                    <div className="mt-1 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                      {Array.from(new Set(members.map((m) => `${m.division}||${m.category}`))).map((k) => {
                        const [dv, ct] = k.split("||");
                        return <button key={k} type="button" onClick={() => removeCategory(dv, ct)} className="rounded border px-2 py-0.5 text-xs hover:bg-destructive/10" data-testid={`button-remove-category-${ct}`}>Remove all {ct}</button>;
                      })}
                    </div>
                  </details>
                )}
                <h3 className="mt-3 text-xs font-bold uppercase text-muted-foreground">Items ({members.length})</h3>
                <ul className="mt-1 divide-y rounded border text-xs">
                  {members.length === 0 && <li className="p-3 text-muted-foreground">No products yet.</li>}
                  {members.slice(0, 500).map((m) => (
                    <li key={m.itemCode} className="flex items-center gap-2 px-2 py-1.5" data-testid={`item-${m.itemCode}`}>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono font-bold">{m.itemCode}</span>{" "}
                        <span className="text-muted-foreground">{m.missing ? "(not in catalogue) " : !isLive(m) ? "(inactive or retired) " : ""}{m.productName}</span>
                      </div>
                      {!readOnly && <button type="button" aria-label={`Remove ${m.itemCode}`} onClick={() => removeCode(m.itemCode)} className="rounded p-1 hover:bg-destructive/10"><X className="h-3.5 w-3.5" /></button>}
                    </li>
                  ))}
                </ul>
                {members.length > 500 && <p className="mt-1 text-xs text-muted-foreground">Showing the first 500 of {members.length}.</p>}
              </>
            )}
            </div>
            {!readOnly && wide && actionFooter}
          </section>
          {!readOnly && !wide && <div className="sticky bottom-0 z-20 -mx-4 mt-3 md:-mx-6">{actionFooter}</div>}
        </aside>
      </div>

      <AlertDialog open={confirmZero} onOpenChange={setConfirmZero}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This Included list has 0 products</AlertDialogTitle>
            <AlertDialogDescription>If you use it as a filter, every screen will be empty. Save anyway?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => doSave()} data-testid="button-confirm-zero">Save anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDetach} onOpenChange={setConfirmDetach}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach from {parentName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The current {preview?.count ?? ""} members are copied into this list and the link is removed. It will never change on its own again. This cannot be undone; you would have to start again.{detail?.affectsEnforced && <> This changes the enforced list "{detail.enforcedListName}" for every user.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-detach" onClick={() => {
              if (!editId) return;
              const onSuccess = (r: BucketList) => {
                  void qc.invalidateQueries();
                  initFor.current = null;
                  setDraft({ name: r.name ?? "", description: r.description ?? "", type: r.type, visibility: r.visibility, parentId: null, rules: r.rules ?? [], addedCodes: r.addedCodes ?? [], removedCodes: r.removedCodes ?? [] });
                  toast({ title: "Detached. This list is now frozen." });
              };
              const onError = (e: unknown) => toast({ title: "Detach failed", description: errMessage(e), variant: "destructive" });
              detachM.mutate({ id: editId }, { onSuccess, onError });
            }}>Detach</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Chip({ label, onClear, testid }: { label: string; onClear: () => void; testid: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary" data-testid={testid}>
      {label}
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onClear}><X className="h-3 w-3" /></button>
    </span>
  );
}

function Picker({ products, rangeDivisions, selected, onAddCodes, onAddRule, loading, error, retry }: {
  products: Member[]; rangeDivisions: string[]; selected: Set<string>;
  onAddCodes: (c: string[]) => void; onAddRule: (r: BucketRule) => void;
  loading: boolean; error: boolean; retry: () => void;
}) {
  const [division, setDivision] = useState("");
  const [category, setCategory] = useState("");
  const [range, setRange] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const divisions = useMemo(() => uniq(products.map((p) => p.division)).sort(), [products]);
  const categories = useMemo(() => uniq(products.filter((p) => !division || p.division === division).map((p) => p.category)).sort(), [products, division]);
  const ranges = useMemo(() => uniq(products.filter((p) => p.division === division && (!category || p.category === category)).map((p) => p.seriesRange ?? "").filter(Boolean)).sort(), [products, division, category]);
  const showRange = !!division && rangeDivisions.includes(division);
  const matching = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) =>
      (!division || p.division === division) && (!category || p.category === category) &&
      (!range || p.seriesRange === range) &&
      (!s || p.itemCode.toLowerCase().includes(s) || (p.productName ?? "").toLowerCase().includes(s)));
  }, [products, division, category, range, q]);

  const liveMatching = matching.filter(isLive);
  const inactiveCount = matching.length - liveMatching.length;
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (error) return <div className="text-sm"><span className="text-destructive">Could not load the catalogue.</span> <button className="underline" onClick={retry}>Retry</button></div>;

  const sel = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={sel} value={division} onChange={(e) => { setDivision(e.target.value); setCategory(""); setRange(""); }} data-testid="select-division">
          <option value="">All divisions</option>{divisions.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className={sel} value={category} onChange={(e) => { setCategory(e.target.value); setRange(""); }} data-testid="select-category">
          <option value="">All categories</option>{categories.map((d) => <option key={d}>{d}</option>)}
        </select>
        {showRange ? (
          <select className={sel} value={range} onChange={(e) => setRange(e.target.value)} data-testid="select-range">
            <option value="">All ranges</option>{ranges.map((d) => <option key={d}>{d}</option>)}
          </select>
        ) : <div className="flex items-center text-xs text-muted-foreground">Range applies to three divisions only.</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {division && <Chip label={division} testid="chip-division" onClear={() => { setDivision(""); setCategory(""); setRange(""); }} />}
        {category && <Chip label={category} testid="chip-category" onClear={() => { setCategory(""); setRange(""); }} />}
        {range && <Chip label={range} testid="chip-range" onClear={() => setRange("")} />}
        {q && <Chip label={`Search: ${q}`} testid="chip-search" onClear={() => setQ("")} />}
      </div>
      <Input className="mt-2" placeholder="Search code or product name" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-picker-search" />

      {division && (
        <div className="mt-3 rounded-md border bg-muted/50 p-3 text-sm">
          <p>Add the whole {[division, category, range].filter(Boolean).join(" / ")} as a rule. <strong>New products added to this category later will be included automatically.</strong></p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" data-testid="button-add-rule" onClick={() => onAddRule({ division, ...(category ? { category } : {}), ...(range ? { range } : {}) })}>Add as rule (updates automatically)</Button>
            <Button size="sm" variant="outline" data-testid="button-add-fixed" onClick={() => onAddCodes(liveMatching.map((m) => m.itemCode))}>Add as a fixed list of {liveMatching.length} codes</Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="outline" data-testid="button-select-all" onClick={() => setPicked(new Set(liveMatching.map((m) => m.itemCode)))}>Select all {liveMatching.length.toLocaleString()} matching</Button>
        <Button size="sm" disabled={picked.size === 0} data-testid="button-add-selected" onClick={() => { onAddCodes(Array.from(picked)); setPicked(new Set()); }}>Add selected ({picked.size})</Button>
        {picked.size > 0 && <button type="button" className="underline" onClick={() => setPicked(new Set())}>Clear selection</button>}
      </div>
      {inactiveCount > 0 && <p className="mt-1 text-xs text-amber-800" data-testid="text-picker-inactive">{inactiveCount} matching products are inactive or retired. They are shown but not selected by Select all or the fixed list; tick them individually to keep them.</p>}
      <div className="mt-2 max-h-80 overflow-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left"><tr><th className="w-8 p-2"></th><th className="p-2">Code</th><th className="p-2">Product</th><th className="p-2">Category</th><th className="p-2">Range</th></tr></thead>
          <tbody className="divide-y">
            {matching.slice(0, 300).map((p) => {
              const inList = selected.has(p.itemCode);
              return (
                <tr key={p.itemCode} className={cn(inList && "bg-emerald-50")}>
                  <td className="p-2"><Checkbox checked={picked.has(p.itemCode)} onCheckedChange={(c) => setPicked((s) => { const n = new Set(s); if (c) n.add(p.itemCode); else n.delete(p.itemCode); return n; })} aria-label={`Select ${p.itemCode}`} /></td>
                  <td className="p-2 font-mono font-bold">{p.itemCode}{inList && <span className="ml-1 font-sans text-[10px] text-emerald-700">in list</span>}{!isLive(p) && <span className="ml-1 font-sans text-[10px] text-amber-800">inactive</span>}</td>
                  <td className="p-2">{p.productName}</td><td className="p-2">{p.category}</td><td className="p-2">{p.seriesRange ?? ""}</td>
                </tr>
              );
            })}
            {matching.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No products match.</td></tr>}
          </tbody>
        </table>
      </div>
      {matching.length > 300 && <p className="mt-1 text-xs text-muted-foreground">Showing 300 of {matching.length.toLocaleString()}. Select all picks every match.</p>}
    </div>
  );
}

function UploadTab({ draft, onAdd, uploadM }: {
  draft: BucketDraft; onAdd: (c: string[]) => void; uploadM: ReturnType<typeof usePreviewBucketUpload>;
}) {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { toast } = useToast();

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setResult(null);
    uploadM.mutate({ data: { file: f, draft: JSON.stringify(draft) } }, {
      onSuccess: (r) => setResult(r as unknown as UploadResult),
      onError: (e) => setErr(errMessage(e)),
    });
  };
  const downloadNotFound = () => {
    if (!result) return;
    const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lines = ["row,item_code,reason", ...result.rows.filter((r) => r.status === "not_found").map((r) => [r.row, r.inputCode, r.reason].map(q).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "bucket-upload-not-found.csv";
    a.click();
  };
  const inactive = result?.rows.filter((r) => r.status === "inactive" && r.itemCode) ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <a href={getDownloadBucketTemplateUrl()} download className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent" data-testid="link-template">
          <Download className="h-4 w-4" /> Download template
        </a>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Upload className="h-4 w-4" /> Choose .xlsx or .csv
          <input type="file" accept=".xlsx,.csv" className="hidden" data-testid="input-upload-file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <span className="text-xs text-muted-foreground">Codes are read from the item_code column. Nothing is added until you press Add these.</span>
      </div>
      {uploadM.isPending && <Skeleton className="mt-3 h-24 w-full" />}
      {err && <p className="mt-3 text-sm text-destructive" data-testid="text-upload-error">{err}</p>}
      {result && (
        <div className="mt-3" data-testid="upload-preview">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {STATUS_ORDER.map((s) => (
              <div key={s} className={cn("flex justify-between rounded border px-3 py-1.5 text-sm", s === "not_found" && result.counts[s] > 0 && "border-red-400 bg-red-50", s === "inactive" && result.counts[s] > 0 && "border-amber-400 bg-amber-50")}>
                <span>{STATUS_LABEL[s]}</span><strong className="font-mono" data-testid={`count-${s}`}>{result.counts[s] ?? 0}</strong>
              </div>
            ))}
          </div>
          <div className="mt-2 max-h-72 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Row</th><th className="p-2">In file</th><th className="p-2">Result</th><th className="p-2">Product</th></tr></thead>
              <tbody className="divide-y">
                {result.rows.map((r) => (
                  <tr key={`${r.row}-${r.inputCode}`} data-testid={`upload-row-${r.row}`}>
                    <td className="p-2">{r.row}</td>
                    <td className="p-2 font-mono">{r.inputCode}</td>
                    <td className="p-2">
                      <span className="font-semibold">{STATUS_LABEL[r.status]}</span>
                      {r.status === "space_matched" && r.itemCode && <div className="font-mono text-amber-800">"{r.inputCode}" matched to "{r.itemCode}"</div>}
                      {r.status !== "space_matched" && r.itemCode && r.itemCode !== r.inputCode && <div className="font-mono">{r.inputCode} to {r.itemCode}</div>}
                      {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
                    </td>
                    <td className="p-2">{r.productName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={result.addableCodes.length === 0} data-testid="button-add-these" onClick={() => { onAdd(result.addableCodes); toast({ title: `Added ${result.addableCodes.length} codes` }); setResult(null); }}>
              Add these ({result.addableCodes.length})
            </Button>
            {inactive.length > 0 && (
              <Button variant="outline" data-testid="button-keep-inactive" onClick={() => { onAdd(inactive.map((r) => r.itemCode as string)); toast({ title: `Kept ${inactive.length} inactive codes` }); }}>
                Also keep {inactive.length} inactive codes
              </Button>
            )}
            {result.counts.not_found > 0 && <Button variant="outline" onClick={downloadNotFound} data-testid="button-download-not-found">Download not-found rows</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
