import React, { useState } from "react";
import {
  Users,
  UserPlus,
  Trash2,
  KeyRound,
  Shield,
  ShieldOff,
  Search,
  X,
  AlertCircle,
  ChevronLeft,
  FileSpreadsheet,
  Upload,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminUsers,
  useCreateAdminUser,
  useDeleteAdminUser,
  useResetAdminUserPassword,
  useUpdateAdminUserRole,
  usePreviewAdminUserImport,
  useImportAdminUsers,
  getListAdminUsersQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminUserImportPreview,
  AdminUserImportResult,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ActivityPanel } from "@/components/activity-panel";

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "admin" | "user" | "counter";
  createdAt: string;
};

// ── Small helpers ──────────────────────────────────────────────────────────────

function initials(u: AdminUser) {
  const parts = [u.firstName, u.lastName].filter(Boolean);
  if (parts.length) return parts.map((p) => p![0]).join("").toUpperCase();
  return u.email[0].toUpperCase();
}

function displayName(u: AdminUser) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || u.email;
}

function UserImportPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const previewImport = usePreviewAdminUserImport();
  const importUsers = useImportAdminUsers();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<AdminUserImportPreview | null>(null);
  const [result, setResult] = useState<AdminUserImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setError(null);
  }

  async function runPreview() {
    if (!file) return;
    setError(null);
    try {
      setPreview(await previewImport.mutateAsync({ data: { file } }));
      setResult(null);
      setConfirmed(false);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Could not preview this workbook.");
    }
  }

  async function confirmImport() {
    if (!file || !preview || !confirmed || password.length < 8) return;
    setError(null);
    try {
      const imported = await importUsers.mutateAsync({
        data: {
          file,
          password,
          previewToken: preview.previewToken,
          confirmed: true,
        },
      });
      setResult(imported);
      setPreview(null);
      setConfirmed(false);
      setPassword("");
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Could not import these users.");
    }
  }

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div className="flex gap-3">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">Import salesperson users</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Preview an Excel or CSV list before creating missing normal-user accounts.
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-accent">
          <X className="h-4 w-4" />
          <span className="sr-only">Close import</span>
        </button>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Salesperson workbook</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The Users sheet must contain name and email columns.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Temporary password</label>
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Applied only to new accounts. Every imported user must replace it at first sign-in.
            </p>
          </div>
        </div>

        {!result && (
          <button
            type="button"
            onClick={runPreview}
            disabled={!file || previewImport.isPending || importUsers.isPending}
            data-activity="admin.preview_user_import"
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {previewImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {previewImport.isPending ? "Checking workbook…" : preview ? "Preview again" : "Preview users"}
          </button>
        )}

        {preview && (
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div>
              <p className="text-sm font-semibold">Review before import</p>
              <p className="text-xs text-muted-foreground">{preview.fileName} · {preview.totalRows} populated rows</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["New users", preview.newUsers, "text-primary"],
                ["Already exist", preview.existingUsers, ""],
                ["Duplicate rows", preview.duplicateRows, preview.duplicateRows ? "text-amber-700" : ""],
                ["Invalid rows", preview.invalidRows, preview.invalidRows ? "text-destructive" : ""],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-md border bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={cn("text-xl font-bold", tone)}>{value}</p>
                </div>
              ))}
            </div>
            {preview.issues.length > 0 && (
              <div className="max-h-44 overflow-auto rounded-md border bg-background">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Reason</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.issues.map((issue) => (
                      <tr key={`${issue.row}-${issue.email ?? ""}`}>
                        <td className="px-3 py-2">{issue.row}</td>
                        <td className="px-3 py-2"><p>{issue.name || "—"}</p><p className="text-muted-foreground">{issue.email || "—"}</p></td>
                        <td className="px-3 py-2 text-amber-800">{issue.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
              <span>I confirm that only the {preview.newUsers} missing accounts should be created as normal users. Existing accounts must remain unchanged.</span>
            </label>
            <button
              type="button"
              onClick={confirmImport}
              disabled={!confirmed || preview.newUsers === 0 || password.length < 8 || importUsers.isPending}
              data-activity="admin.confirm_user_import"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {importUsers.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {importUsers.isPending ? "Creating accounts…" : `Create ${preview.newUsers} users`}
            </button>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-950">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" />Import complete</div>
            <p className="mt-2 text-sm">
              Created {result.created} accounts. Skipped {result.skippedExisting} existing accounts, {result.skippedDuplicates} duplicate rows, and {result.invalidRows} invalid rows.
            </p>
            <p className="mt-1 text-xs">New accounts are normal users and must change the temporary password at first sign-in.</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Add-user dialog ────────────────────────────────────────────────────────────

function AddUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateAdminUser();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("pRAYAG@2026");
  const [role, setRole] = useState<"admin" | "user" | "counter">("user");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        data: { email, firstName: firstName || null, lastName: lastName || null, password, role },
      });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to create user.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-background border shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-semibold text-lg">Add new user</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form data-activity="admin.create_user" onSubmit={submit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                placeholder="Priya"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                placeholder="Sharma"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Email <span className="text-destructive">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              placeholder="name@prayagindia.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Password <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">Minimum 8 characters. The user can change it after signing in.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Role</label>
            <div className="flex gap-3">
              {(["user", "counter", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 rounded-xl border px-4 py-3 text-left transition-all",
                    role === r
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  <p className="font-medium capitalize">{r}</p>
                  <p className="text-xs mt-0.5 text-muted-foreground">
                    {r === "admin"
                      ? "Full access including user management"
                      : r === "counter"
                        ? "Price Finder and product comparison only"
                        : "Price Finder and product comparison only"}
                  </p>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {create.isPending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Reset-password dialog ──────────────────────────────────────────────────────

function ResetPasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const resetPwd = useResetAdminUserPassword();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await resetPwd.mutateAsync({ id: user.id, data: { password } });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to reset password.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background border shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-semibold">Reset password</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          {done ? (
            <div className="text-center py-4 space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-6 h-6 text-primary" />
              </div>
              <p className="font-medium">Password updated</p>
              <p className="text-sm text-muted-foreground">
                {displayName(user)} can now sign in with the new password.
              </p>
              <button
                onClick={onClose}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form data-activity="admin.reset_user_password" onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Set a new password for <strong>{displayName(user)}</strong>.
              </p>
              <div>
                <label className="block text-sm font-medium mb-1">New password</label>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Minimum 8 characters"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetPwd.isPending}
                  className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {resetPwd.isPending ? "Saving…" : "Reset password"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete-confirm dialog ──────────────────────────────────────────────────────

function DeleteDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useDeleteAdminUser();
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      await del.mutateAsync({ id: user.id });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to delete user.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background border shadow-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <p className="font-semibold">Remove user?</p>
            <p className="text-sm text-muted-foreground mt-1">
              <strong>{displayName(user)}</strong> will lose access to the workspace immediately. This cannot be undone.
            </p>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            data-activity="admin.remove_user"
            disabled={del.isPending}
            className="flex-1 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {del.isPending ? "Removing…" : "Remove user"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── User row ───────────────────────────────────────────────────────────────────

function UserRow({
  user,
  currentUserId,
  onResetPassword,
  onDelete,
}: {
  user: AdminUser;
  currentUserId: string;
  onResetPassword: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const updateRole = useUpdateAdminUserRole();
  const isSelf = user.id === currentUserId;

  async function changeRole(role: AdminUser["role"]) {
    await updateRole.mutateAsync({ id: user.id, data: { role } });
    await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors rounded-lg">
      {/* Avatar */}
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
          user.role === "admin"
            ? "bg-primary/10 text-primary"
            : user.role === "counter"
              ? "bg-amber-100 text-amber-800"
              : "bg-muted text-muted-foreground",
        )}
      >
        {initials(user)}
      </div>

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {displayName(user)}
          {isSelf && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">(you)</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      </div>

      {/* Role badge */}
      <span
        className={cn(
          "hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0",
          user.role === "admin"
            ? "bg-primary/10 text-primary"
            : user.role === "counter"
              ? "bg-amber-100 text-amber-800"
              : "bg-muted text-muted-foreground",
        )}
      >
        {user.role === "admin" ? <Shield className="w-3 h-3" /> : user.role === "counter" ? <Search className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
        {user.role === "admin" ? "Admin" : user.role === "counter" ? "Counter" : "User"}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <select
          value={user.role}
          onChange={(event) => changeRole(event.target.value as AdminUser["role"])}
          disabled={isSelf || updateRole.isPending}
          className={cn(
            "rounded-md border bg-background px-2 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isSelf
              ? "opacity-30 cursor-not-allowed"
              : "text-foreground",
          )}
        >
          <option value="admin">Admin</option>
          <option value="user">User</option>
          <option value="counter">Counter</option>
        </select>
        <button
          onClick={onResetPassword}
          title="Reset password"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <KeyRound className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          disabled={isSelf}
          title="Remove user"
          className={cn(
            "rounded-md p-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isSelf
              ? "opacity-30 cursor-not-allowed text-muted-foreground"
              : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
          )}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const { data, isLoading, isError } = useListAdminUsers();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const users = (data?.users ?? []) as AdminUser[];
  const admins = users.filter((u) => u.role === "admin");
  const normal = users.filter((u) => u.role === "user");
  const counters = users.filter((u) => u.role === "counter");

  return (
    <div className="flex flex-col">
      {/* Back link */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>

      {/* Page body */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 space-y-6">
        {/* Title row */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" />
              Workspace users
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage who has access to Prayag's internal workspace.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setShowImport((open) => !open)}
              data-activity="admin.open_user_import"
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Import users
            </button>
            <button
              onClick={() => setShowAdd(true)}
              data-activity="admin.open_create_user"
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Add user
            </button>
          </div>
        </div>

        {showImport && <UserImportPanel onClose={() => setShowImport(false)} />}

        {/* Content */}
        {isLoading ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground text-sm">
            Loading users…
          </div>
        ) : isError ? (
          <div className="rounded-xl border bg-card p-8 text-center text-destructive text-sm flex items-center justify-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Could not load users. Admin access is required.
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden">
            {/* Admins */}
            {admins.length > 0 && (
              <div>
                <div className="px-4 py-2.5 bg-primary/5 border-b flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                    Admins · {admins.length}
                  </span>
                </div>
                <div className="divide-y">
                  {admins.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      currentUserId={currentUser?.id ?? ""}
                      onResetPassword={() => setResetTarget(u)}
                      onDelete={() => setDeleteTarget(u)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Normal users */}
            {normal.length > 0 && (
              <div className={admins.length > 0 ? "border-t" : ""}>
                <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Users · {normal.length}
                  </span>
                </div>
                <div className="divide-y">
                  {normal.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      currentUserId={currentUser?.id ?? ""}
                      onResetPassword={() => setResetTarget(u)}
                      onDelete={() => setDeleteTarget(u)}
                    />
                  ))}
                </div>
              </div>
            )}

            {counters.length > 0 && (
              <div className={admins.length > 0 || normal.length > 0 ? "border-t" : ""}>
                <div className="px-4 py-2.5 bg-amber-50 border-b flex items-center gap-2">
                  <Search className="w-4 h-4 text-amber-700" />
                  <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                    Counter access · {counters.length}
                  </span>
                </div>
                <div className="divide-y">
                  {counters.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      currentUserId={currentUser?.id ?? ""}
                      onResetPassword={() => setResetTarget(u)}
                      onDelete={() => setDeleteTarget(u)}
                    />
                  ))}
                </div>
              </div>
            )}

            {users.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No users yet.</p>
            )}
          </div>
        )}

        <ActivityPanel users={users} />

        {/* Legend */}
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-1">
          <p><strong className="text-foreground">Admin</strong> — full workspace access + user management</p>
          <p><strong className="text-foreground">User</strong> — Price Finder search, browse, comparison, and export only</p>
          <p><strong className="text-foreground">Counter</strong> — legacy Price Finder-only access</p>
        </div>
      </main>

      {/* Dialogs */}
      {showAdd && <AddUserDialog onClose={() => setShowAdd(false)} />}
      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />}
      {deleteTarget && <DeleteDialog user={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}
