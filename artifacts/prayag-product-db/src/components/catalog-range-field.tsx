import { useState } from "react";
import { supportsCatalogRange } from "@workspace/formatting";
import { useAddPriceEditorSeries } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

/** Vocabulary creation is separate from editing the selected product. */
export function CatalogRangeField({ division, value }: { division: string | null; value: string | null }) {
  const { user } = useAuth();
  const add = useAddPriceEditorSeries();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  if (!supportsCatalogRange(division)) return null;
  const submit = () => {
    if (!division || !name.trim() || !reason.trim()) return;
    setError(null);
    add.mutate({ data: { division, name: name.trim(), reason: reason.trim() } }, {
      onSuccess: result => {
        setCreated(`Range “${result.name}” added as an empty option. This product is unchanged.`);
        setOpen(false);
        setName("");
        setReason("");
      },
      onError: e => {
        const existing = (e as { data?: { existingValue?: string } }).data?.existingValue;
        setError(existing ? `Range “${existing}” already exists; nothing was added or selected.` : e.message);
      },
    });
  };
  return <div className="mt-3">
    <label className="block text-sm font-medium">Range <span className="font-normal text-muted-foreground">(Optional)</span>
      <div className="mt-1 flex gap-2">
        <Input aria-label="Product Range" value={value ?? ""} placeholder="No Range" readOnly />
        {user?.role === "admin" && <Button type="button" variant="outline" onClick={() => { setError(null); setCreated(null); setOpen(true); }}>Add</Button>}
      </div>
    </label>
    {created && <p className="mt-2 text-sm text-emerald-800">{created}</p>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Range to {division}</DialogTitle><DialogDescription>Add an empty Range option. This does not change this product, its Category or its prices.</DialogDescription></DialogHeader>
        <label className="text-sm font-medium">Range name<Input value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label>
        <label className="text-sm font-medium">Reason<Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this Range needed?" /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={add.isPending}>Cancel</Button><Button onClick={submit} disabled={!name.trim() || !reason.trim() || add.isPending}>{add.isPending ? "Adding…" : "Add Range"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}