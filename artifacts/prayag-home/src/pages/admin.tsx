import React, { useState } from "react";
import {
  Users,
  UserPlus,
  Trash2,
  KeyRound,
  Shield,
  ShieldOff,
  Hexagon,
  LogOut,
  Home as HomeIcon,
  PackageSearch,
  BarChart3,
  Search,
  X,
  AlertCircle,
  ChevronLeft,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminUsers,
  useCreateAdminUser,
  useDeleteAdminUser,
  useResetAdminUserPassword,
  useUpdateAdminUserRole,
  getListAdminUsersQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "admin" | "user";
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

// ── Add-user dialog ────────────────────────────────────────────────────────────

function AddUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useCreateAdminUser();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("pRAYAG@2026");
  const [role, setRole] = useState<"admin" | "user">("user");
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
        <form onSubmit={submit} className="p-6 space-y-4">
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
              {(["user", "admin"] as const).map((r) => (
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
                      : "Standard workspace access"}
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
            <form onSubmit={submit} className="space-y-4">
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

  async function toggleRole() {
    const next = user.role === "admin" ? "user" : "admin";
    await updateRole.mutateAsync({ id: user.id, data: { role: next } });
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
            : "bg-muted text-muted-foreground",
        )}
      >
        {user.role === "admin" ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
        {user.role === "admin" ? "Admin" : "User"}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={toggleRole}
          disabled={isSelf || updateRole.isPending}
          title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
          className={cn(
            "rounded-md p-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isSelf
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-accent text-muted-foreground hover:text-foreground",
          )}
        >
          {user.role === "admin" ? (
            <ShieldOff className="w-4 h-4" />
          ) : (
            <Shield className="w-4 h-4" />
          )}
        </button>
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
  const { user: currentUser, logout } = useAuth();
  const { data, isLoading, isError } = useListAdminUsers();
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const users = (data?.users ?? []) as AdminUser[];
  const admins = users.filter((u) => u.role === "admin");
  const normal = users.filter((u) => u.role === "user");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-20 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14 max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shadow-sm">
              <Hexagon className="w-4 h-4 text-white" strokeWidth={2} />
            </div>
            <div className="leading-none">
              <span className="font-bold text-sm">Prayag</span>
              <span className="text-[10px] text-muted-foreground block">User Management</span>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {[
              { href: "/", label: "Home", icon: HomeIcon },
              { href: "/product-db/", label: "Product DB", icon: PackageSearch },
              { href: "/analysis/", label: "Analysis", icon: BarChart3 },
              { href: "/price-finder/", label: "Price Finder", icon: Search },
            ].map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Icon className="w-4 h-4" />
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {[currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(" ") || currentUser?.email}
            </span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Back link */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-6">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to home
        </a>
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
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add user
          </button>
        </div>

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

            {users.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No users yet.</p>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-1">
          <p><strong className="text-foreground">Admin</strong> — full workspace access + user management</p>
          <p><strong className="text-foreground">User</strong> — standard workspace access (all apps, no user management)</p>
        </div>
      </main>

      {/* Dialogs */}
      {showAdd && <AddUserDialog onClose={() => setShowAdd(false)} />}
      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />}
      {deleteTarget && <DeleteDialog user={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}
