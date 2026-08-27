import { useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  ChevronDown,
  Clock3,
  Eye,
  LoaderCircle,
  MousePointerClick,
  X,
} from "lucide-react";
import {
  useGetAdminActivityDetail,
  useGetAdminActivitySummary,
  type AdminActivitySummary,
} from "@workspace/api-client-react";

type UserOption = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function isoDateInWorkspaceTimezone(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return isoDateInWorkspaceTimezone(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function displayName(user: UserOption): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email;
}

function describeEvent(event: {
  eventType: string;
  pagePath?: string | null;
  action?: string | null;
  state?: string | null;
}) {
  if (event.eventType === "page_view") return `Visited ${event.pagePath ?? "a page"}`;
  if (event.eventType === "action") {
    return (event.action ?? "Completed an action")
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  if (event.eventType === "session_start") return "Started a session";
  if (event.eventType === "session_end") return "Ended a session";
  if (event.eventType === "state_change") {
    return event.state === "idle" ? "Became idle" : "Became active";
  }
  return "Activity heartbeat";
}

function DetailDialog({
  row,
  user,
  onClose,
}: {
  row: AdminActivitySummary;
  user: UserOption | undefined;
  onClose: () => void;
}) {
  const detail = useGetAdminActivityDetail(
    { userId: row.userId, date: row.activityDate },
  );
  const meaningfulEvents = (detail.data?.events ?? []).filter(
    (event) => event.eventType !== "heartbeat",
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
      <div className="mx-auto my-8 w-full max-w-3xl rounded-2xl border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Daily activity · {formatDate(row.activityDate)}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{user ? displayName(user) : row.userName}</h2>
            <p className="text-sm text-muted-foreground">{row.email}</p>
          </div>
          <button
            onClick={onClose}
            title="Close activity details"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {detail.isLoading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading activity details…
          </div>
        ) : detail.isError ? (
          <p className="p-8 text-center text-sm text-destructive">Could not load activity details.</p>
        ) : (
          <div className="space-y-6 p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Active time" value={formatDuration(row.activeSeconds)} tone="text-emerald-700" />
              <Metric label="Idle time" value={formatDuration(row.idleSeconds)} tone="text-amber-700" />
              <Metric label="Sessions" value={String(row.sessionCount)} tone="text-primary" />
            </div>

            <section>
              <h3 className="mb-3 text-sm font-semibold">Sessions</h3>
              {(detail.data?.sessions ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No sessions recorded.</p>
              ) : (
                <div className="space-y-2">
                  {detail.data?.sessions.map((session) => (
                    <div key={session.id} className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium capitalize">{session.appSlug.replace(/-/g, " ")}</span>
                        <span className="text-xs text-muted-foreground">{formatDuration(session.activeSeconds)} active · {formatDuration(session.idleSeconds)} idle</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTimestamp(session.startedAt)} — {session.endedAt ? formatTimestamp(session.endedAt) : `last seen ${formatTimestamp(session.lastSeenAt)}`}
                      </p>
                      {session.lastPagePath && <p className="mt-1 font-mono text-xs text-muted-foreground">{session.lastPagePath}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold">Pages and actions</h3>
              {meaningfulEvents.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No page visits or actions recorded.</p>
              ) : (
                <ol className="max-h-96 divide-y overflow-y-auto rounded-lg border">
                  {meaningfulEvents.map((event) => (
                    <li key={event.eventId} className="flex gap-3 px-4 py-3 text-sm">
                      <span className="mt-0.5 text-primary">
                        {event.eventType === "page_view" ? <Eye className="h-4 w-4" /> : <MousePointerClick className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p>{describeEvent(event)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatTimestamp(event.occurredAt)} · {event.appSlug.replace(/-/g, " ")}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

export function ActivityPanel({ users }: { users: UserOption[] }) {
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(() => daysAgo(0));
  const [userId, setUserId] = useState("");
  const [selected, setSelected] = useState<AdminActivitySummary | null>(null);
  const params = { from, to, ...(userId ? { userId } : {}) };
  const summary = useGetAdminActivitySummary(params);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Activity className="h-5 w-5 text-primary" /> User activity
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Active and idle time use the Asia/Kolkata workday. Idle begins after five minutes without interaction.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Clock3 className="h-3.5 w-3.5" /> {summary.data?.timezone ?? "Asia/Kolkata"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">From</span>
            <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">To</span>
            <input type="date" value={to} min={from} max={daysAgo(0)} onChange={(event) => setTo(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">User</span>
            <span className="relative block">
              <select value={userId} onChange={(event) => setUserId(event.target.value)} className="h-9 w-full appearance-none rounded-md border bg-background px-2 pr-8 text-sm">
                <option value="">All users</option>
                {users.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-muted-foreground" />
            </span>
          </label>
        </div>
      </div>

      {summary.isLoading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading activity…
        </div>
      ) : summary.isError ? (
        <div className="p-8 text-center text-sm text-destructive">Could not load activity. Admin access is required.</div>
      ) : (summary.data?.rows.length ?? 0) === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <CalendarDays className="mx-auto mb-2 h-5 w-5" />
          No tracked activity for this selection yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Idle</th>
                <th className="px-4 py-3 font-medium">Sessions</th>
                <th className="px-4 py-3 font-medium">Pages</th>
                <th className="px-4 py-3 font-medium">Actions</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.data?.rows.map((row) => (
                <tr key={`${row.userId}-${row.activityDate}`} className="hover:bg-accent/30">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{formatDate(row.activityDate)}</td>
                  <td className="px-4 py-3"><p className="font-medium">{row.userName}</p><p className="text-xs text-muted-foreground">{row.email}</p></td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-emerald-700">{formatDuration(row.activeSeconds)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-amber-700">{formatDuration(row.idleSeconds)}</td>
                  <td className="px-4 py-3">{row.sessionCount}</td>
                  <td className="px-4 py-3">{row.pageViewCount}</td>
                  <td className="px-4 py-3">{row.actionCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatTimestamp(row.lastActivityAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setSelected(row)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent">View day</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DetailDialog row={selected} user={usersById.get(selected.userId)} onClose={() => setSelected(null)} />}
    </section>
  );
}