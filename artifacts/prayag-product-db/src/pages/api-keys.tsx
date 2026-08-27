import { useState } from "react";
import {
  useGetApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useDeleteApiKey,
  getGetApiKeysQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import {
  Key,
  Plus,
  Trash2,
  Ban,
  Copy,
  CheckCircle2,
  Terminal,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@workspace/replit-auth-web";

function errorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "error" in error.data &&
    typeof error.data.error === "string"
  ) {
    return error.data.error;
  }
  return fallback;
}

export default function ApiKeysPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data, isLoading, isError, error } = useGetApiKeys({
    query: {
      queryKey: getGetApiKeysQueryKey(),
      enabled: isAdmin,
    },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const createMutation = useCreateApiKey({
    mutation: {
      onSuccess: (data) => {
        setCreatedSecret(data.key);
        queryClient.invalidateQueries({ queryKey: getGetApiKeysQueryKey() });
        toast({
          title: "API Key created",
          description: "Your new API key has been generated.",
        });
      },
      onError: (error) => {
        toast({
          title: "Creation failed",
          description: errorMessage(error, "Could not create the API key. Please try again."),
          variant: "destructive",
        });
      },
    },
  });

  const revokeMutation = useRevokeApiKey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetApiKeysQueryKey() });
        setRevokeId(null);
        toast({
          title: "API Key revoked",
          description: "The API key has been immediately disabled.",
        });
      },
      onError: (error) => {
        toast({
          title: "Revoke failed",
          description: errorMessage(error, "Could not revoke the API key. Please try again."),
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteApiKey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetApiKeysQueryKey() });
        setDeleteId(null);
        toast({
          title: "API Key deleted",
          description: "The API key has been permanently removed.",
        });
      },
      onError: (error) => {
        toast({
          title: "Delete failed",
          description: errorMessage(error, "Could not delete the API key. Please try again."),
          variant: "destructive",
        });
      },
    },
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    createMutation.mutate({ data: { name: newKeyName.trim() } });
  };

  const handleCopy = async () => {
    if (createdSecret) {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetCreateState = () => {
    setIsCreateOpen(false);
    setNewKeyName("");
    setCreatedSecret(null);
    setCopied(false);
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-3 p-8 pt-28 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <Key className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Administrator access required</h1>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          API keys are sensitive credentials. Only workspace administrators can view existing keys,
          generate new ones, revoke them, or delete them.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-2">
            Manage authentication keys for external systems accessing the Prayag API.
          </p>
        </div>

        <Dialog
          open={isCreateOpen}
          onOpenChange={(open) => {
            if (!open) resetCreateState();
            else setIsCreateOpen(true);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Generate New Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {!createdSecret ? (
              <>
                <DialogHeader>
                  <DialogTitle>Generate New API Key</DialogTitle>
                  <DialogDescription>
                    Create a new key to grant external systems access to the API.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="key-name">Key Name</Label>
                    <Input
                      id="key-name"
                      placeholder="e.g. ERP Integration"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newKeyName.trim() && !createMutation.isPending) {
                          e.preventDefault();
                          handleCreate();
                        }
                      }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!newKeyName.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending ? "Generating..." : "Generate Key"}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>API Key Generated</DialogTitle>
                  <DialogDescription className="text-destructive font-medium flex items-center gap-2 mt-2">
                    <AlertCircle className="w-4 h-4" />
                    Please copy this key now. You won't be able to see it again!
                  </DialogDescription>
                </DialogHeader>
                <div className="py-6 space-y-4">
                  <div className="relative">
                    <div className="flex items-center gap-2 p-4 bg-muted/50 font-mono text-sm border rounded-md break-all">
                      {createdSecret}
                    </div>
                  </div>
                  <Button onClick={handleCopy} className="w-full" variant={copied ? "secondary" : "default"}>
                    {copied ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Copied to clipboard
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Secret Key
                      </>
                    )}
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={resetCreateState} variant="outline" className="w-full">
                    I have saved it securely
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-muted/20">
          <h3 className="font-semibold">Active & Revoked Keys</h3>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading keys...</div>
          ) : isError ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 className="font-medium text-lg">Could not load API keys</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {errorMessage(error, "Please refresh the page and try again.")}
              </p>
            </div>
          ) : !data || data.keys.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Key className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">No API Keys</h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                You haven't generated any API keys yet. Create one to allow external services to connect to the Prayag API.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Prefix</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last Used</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.keys.map((k) => (
                  <tr key={k.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-medium">{k.name}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{k.keyPrefix}••••••••</td>
                    <td className="px-4 py-3">
                      {k.isActive ? (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">Revoked</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDisplayDate(k.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {k.lastUsedAt ? formatDisplayDateTime(k.lastUsedAt) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {k.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-amber-600 hover:text-amber-700 hover:bg-amber-100/50"
                          onClick={() => setRevokeId(k.id)}
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          Revoke
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteId(k.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-muted/30 border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">Developer Reference</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Include your active API key in the <code className="bg-muted px-1.5 py-0.5 rounded">X-API-Key</code> HTTP header to authenticate requests.
        </p>
        
        <div className="bg-black/90 text-zinc-100 p-4 rounded-md font-mono text-sm overflow-x-auto">
          <code>
            <span className="text-pink-400">curl</span> -H <span className="text-amber-300">"X-API-Key: &lt;your_secret_key&gt;"</span> \
            <br />
            &nbsp;&nbsp;{window.location.origin}/api/v1/products
          </code>
        </div>
        
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Available Endpoints:</h4>
          <ul className="text-sm space-y-1.5 text-muted-foreground font-mono">
            <li><span className="font-semibold text-foreground">GET</span> /api/v1/products</li>
            <li><span className="font-semibold text-foreground">GET</span> /api/v1/products/{"{itemCode}"}</li>
            <li><span className="font-semibold text-foreground">GET</span> /api/v1/comparison</li>
            <li><span className="font-semibold text-foreground">GET</span> /api/v1/analysis/overview</li>
          </ul>
        </div>
      </div>

      {/* Revoke Confirmation */}
      <AlertDialog open={revokeId !== null} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will immediately disable the key. Any systems using this key will lose access to the API. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => revokeId && revokeMutation.mutate({ id: revokeId })}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the key from the database, erasing its audit history. If you just want to stop access, consider revoking it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
