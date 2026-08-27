import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  activityDailySummariesTable,
  activityEventsTable,
  activitySessionDailySummariesTable,
  activitySessionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/authMiddleware";

const router: IRouter = Router();

const WORKSPACE_TIMEZONE = "Asia/Kolkata";
const LOCAL_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_HEARTBEAT_INTERVAL_SECONDS = 90;
const EVENT_TYPES = new Set([
  "session_start",
  "session_end",
  "heartbeat",
  "page_view",
  "action",
  "state_change",
]);
const SAFE_STATES = new Set(["active", "idle"]);
const SAFE_APP_SLUG = /^[a-z0-9-]{1,40}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_APPS = new Set(["home", "product-db", "analysis", "price-finder"]);
const APP_PATH_PREFIXES: Record<string, string> = {
  home: "/",
  "product-db": "/product-db",
  analysis: "/analysis",
  "price-finder": "/price-finder",
};
const KNOWN_ACTIONS = new Set([
  "admin.create_user",
  "admin.activity_export_pdf",
  "admin.open_create_user",
  "admin.remove_user",
  "admin.reset_user_password",
  "analysis.export_csv",
  "analysis.export_excel",
  "analysis.save_discounts",
  "catalog.save_mrp",
  "competitor_import.approve",
  "competitor_import.discard",
  "competitor_import.upload",
  "mrp_import.upload",
  "mrp_revision.apply",
  "mrp_revision.discard",
  "mrp_revision.preview",
  "mrp_revision.rollback",
  "price_finder.compare_selected",
]);
const MAX_SESSIONS_PER_USER_DAY = 50;
const MAX_EVENTS_PER_SESSION_MINUTE = 24;
const MAX_PAGE_VIEWS_PER_SESSION_DAY = 240;
const MAX_PAGE_VIEWS_PER_USER_DAY = 1_000;
const MAX_ACTIONS_PER_USER_DAY = 100;

type ActivityInput = {
  eventId: string;
  sessionId: string;
  appSlug: string;
  eventType: string;
  occurredAt: string;
  pagePath?: string | null;
  action?: string | null;
  state?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DailyDelta = {
  activeSeconds?: number;
  idleSeconds?: number;
  sessionCount?: number;
  pageViewCount?: number;
  actionCount?: number;
};

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localDateFor(value: Date): string {
  return new Date(value.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

function localDayStart(value: string): Date {
  return new Date(`${value}T00:00:00+05:30`);
}

function splitDuration(start: Date, end: Date): Array<{ date: string; seconds: number }> {
  if (end <= start) return [];

  const parts: Array<{ date: string; seconds: number }> = [];
  const cappedEnd = new Date(
    Math.min(end.getTime(), start.getTime() + MAX_HEARTBEAT_INTERVAL_SECONDS * 1000),
  );
  let cursor = start;
  while (cursor < cappedEnd) {
    const date = localDateFor(cursor);
    const nextBoundary = localDayStart(addDays(date, 1));
    const segmentEnd = nextBoundary < cappedEnd ? nextBoundary : cappedEnd;
    const seconds = Math.max(
      0,
      Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000),
    );
    if (seconds > 0) parts.push({ date, seconds });
    cursor = segmentEnd;
  }
  return parts;
}

function asIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = localDayStart(value);
  return !Number.isNaN(parsed.getTime()) && localDateFor(parsed) === value;
}

function pathMatchesApp(appSlug: string, pagePath: string | null | undefined): boolean {
  if (!pagePath) return true;
  const prefix = APP_PATH_PREFIXES[appSlug];
  return prefix === "/" || pagePath === prefix || pagePath.startsWith(`${prefix}/`);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function safePdfText(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?");
}

function formatPdfTimestamp(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: WORKSPACE_TIMEZONE,
  }).format(value);
}

async function buildActivityPdf({
  from,
  to,
  userId,
}: {
  from: string;
  to: string;
  userId?: string;
}): Promise<Uint8Array> {
  const [rows, events] = await Promise.all([
    db
      .select({
        activityDate: activityDailySummariesTable.activityDate,
        userId: activityDailySummariesTable.userId,
        userName: sql<string>`coalesce(nullif(trim(concat(${usersTable.firstName}, ' ', ${usersTable.lastName})), ''), ${usersTable.email})`,
        email: usersTable.email,
        activeSeconds: activityDailySummariesTable.activeSeconds,
        idleSeconds: activityDailySummariesTable.idleSeconds,
        sessionCount: activityDailySummariesTable.sessionCount,
        pageViewCount: activityDailySummariesTable.pageViewCount,
        actionCount: activityDailySummariesTable.actionCount,
        lastActivityAt: activityDailySummariesTable.lastActivityAt,
      })
      .from(activityDailySummariesTable)
      .innerJoin(usersTable, eq(usersTable.id, activityDailySummariesTable.userId))
      .where(
        and(
          gte(activityDailySummariesTable.activityDate, from),
          lte(activityDailySummariesTable.activityDate, to),
          userId ? eq(activityDailySummariesTable.userId, userId) : undefined,
        ),
      )
      .orderBy(desc(activityDailySummariesTable.activityDate), asc(usersTable.email)),
    db
      .select({
        activityDate: activityEventsTable.activityDate,
        userName: sql<string>`coalesce(nullif(trim(concat(${usersTable.firstName}, ' ', ${usersTable.lastName})), ''), ${usersTable.email})`,
        email: usersTable.email,
        appSlug: activityEventsTable.appSlug,
        eventType: activityEventsTable.eventType,
        occurredAt: activityEventsTable.occurredAt,
        pagePath: activityEventsTable.pagePath,
        action: activityEventsTable.action,
        state: activityEventsTable.state,
      })
      .from(activityEventsTable)
      .innerJoin(usersTable, eq(usersTable.id, activityEventsTable.userId))
      .where(
        and(
          gte(activityEventsTable.activityDate, from),
          lte(activityEventsTable.activityDate, to),
          userId ? eq(activityEventsTable.userId, userId) : undefined,
          sql`${activityEventsTable.eventType} <> 'heartbeat'`,
        ),
      )
      .orderBy(
        desc(activityEventsTable.activityDate),
        asc(usersTable.email),
        asc(activityEventsTable.occurredAt),
      )
      .limit(20_000),
  ]);

  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const margin = 42;
  const pageWidth = 612;
  let page: PDFPage = document.addPage([pageWidth, 792]);
  let cursorY = 748;

  const line = (text: string, font: PDFFont = regular, size = 9, color = rgb(0.1, 0.1, 0.1)) => {
    const maxWidth = pageWidth - margin * 2;
    const words = safePdfText(text).split(/\s+/);
    let current = "";
    const lines: string[] = [];
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);

    for (const entry of lines) {
      if (cursorY < 48) {
        page = document.addPage([pageWidth, 792]);
        cursorY = 748;
      }
      page.drawText(entry, { x: margin, y: cursorY, size, font, color });
      cursorY -= size + 4;
    }
  };

  line("Prayag Polymers — User Activity Audit Report", bold, 16, rgb(0, 0.39, 0.34));
  line(`Reporting period: ${from} to ${to} · Timezone: ${WORKSPACE_TIMEZONE}`, regular, 9);
  line(`Generated: ${formatPdfTimestamp(new Date())}${userId ? ` · Filtered user ID: ${userId}` : " · All users"}`, regular, 9);
  cursorY -= 8;
  line("Daily summary", bold, 12, rgb(0, 0.39, 0.34));
  if (rows.length === 0) {
    line("No tracked activity exists for the selected period.", regular, 9, rgb(0.35, 0.35, 0.35));
  } else {
    for (const row of rows) {
      line(
        `${row.activityDate} | ${row.userName || row.email || "Unknown user"} (${row.email ?? ""}) | Active ${formatDuration(row.activeSeconds)} | Idle ${formatDuration(row.idleSeconds)} | Sessions ${row.sessionCount} | Pages ${row.pageViewCount} | Actions ${row.actionCount}`,
      );
    }
  }

  cursorY -= 8;
  line("Audit trail — pages, actions, sessions, and activity-state changes", bold, 12, rgb(0, 0.39, 0.34));
  if (events.length === 0) {
    line("No auditable page visits or actions exist for the selected period.", regular, 9, rgb(0.35, 0.35, 0.35));
  } else {
    for (const event of events) {
      const label =
        event.eventType === "page_view"
          ? `Visited ${event.pagePath ?? "a page"}`
          : event.eventType === "action"
            ? (event.action ?? "Completed an action").replace(/[._-]+/g, " ")
            : event.eventType === "state_change"
              ? `Became ${event.state ?? "active"}`
              : event.eventType === "session_start"
                ? "Started a session"
                : "Ended a session";
      line(
        `${event.activityDate} · ${formatPdfTimestamp(event.occurredAt)} · ${event.userName || event.email || "Unknown user"} · ${event.appSlug.replace(/-/g, " ")} · ${label}`,
      );
    }
  }
  if (events.length === 20_000) {
    cursorY -= 4;
    line("The audit trail is limited to the first 20,000 non-heartbeat events.", regular, 8, rgb(0.35, 0.35, 0.35));
  }

  return document.save();
}

function normaliseEvent(value: unknown): ActivityInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ActivityInput>;
  if (
    typeof input.eventId !== "string" ||
    !SAFE_ID.test(input.eventId) ||
    typeof input.sessionId !== "string" ||
    !SAFE_ID.test(input.sessionId) ||
    typeof input.appSlug !== "string" ||
    !SAFE_APP_SLUG.test(input.appSlug) ||
    typeof input.eventType !== "string" ||
    !EVENT_TYPES.has(input.eventType) ||
    typeof input.occurredAt !== "string"
  ) {
    return null;
  }

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return null;

  const pagePath =
    input.pagePath == null
      ? null
      : typeof input.pagePath === "string" &&
          input.pagePath.startsWith("/") &&
          input.pagePath.length <= 500 &&
          !/[\u0000-\u001f]/.test(input.pagePath)
        ? input.pagePath
        : null;
  const action =
    input.action == null
      ? null
      : typeof input.action === "string" &&
          input.action.length <= 120 &&
          /^[a-z0-9][a-z0-9_.-]*$/.test(input.action)
        ? input.action
        : null;
  const state =
    input.state == null
      ? null
      : typeof input.state === "string" && SAFE_STATES.has(input.state)
        ? input.state
        : null;
  if (input.eventType === "state_change" && state === null) return null;

  return {
    eventId: input.eventId,
    sessionId: input.sessionId,
    appSlug: input.appSlug,
    eventType: input.eventType,
    occurredAt: occurredAt.toISOString(),
    pagePath,
    action,
    state,
    metadata: null,
  };
}

async function upsertDaily(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  activityDate: string,
  occurredAt: Date,
  delta: DailyDelta,
) {
  await tx
    .insert(activityDailySummariesTable)
    .values({
      userId,
      activityDate,
      activeSeconds: delta.activeSeconds ?? 0,
      idleSeconds: delta.idleSeconds ?? 0,
      sessionCount: delta.sessionCount ?? 0,
      pageViewCount: delta.pageViewCount ?? 0,
      actionCount: delta.actionCount ?? 0,
      lastActivityAt: occurredAt,
    })
    .onConflictDoUpdate({
      target: [activityDailySummariesTable.userId, activityDailySummariesTable.activityDate],
      set: {
        activeSeconds: sql`${activityDailySummariesTable.activeSeconds} + ${delta.activeSeconds ?? 0}`,
        idleSeconds: sql`${activityDailySummariesTable.idleSeconds} + ${delta.idleSeconds ?? 0}`,
        sessionCount: sql`${activityDailySummariesTable.sessionCount} + ${delta.sessionCount ?? 0}`,
        pageViewCount: sql`${activityDailySummariesTable.pageViewCount} + ${delta.pageViewCount ?? 0}`,
        actionCount: sql`${activityDailySummariesTable.actionCount} + ${delta.actionCount ?? 0}`,
        lastActivityAt: sql`GREATEST(COALESCE(${activityDailySummariesTable.lastActivityAt}, ${occurredAt}), ${occurredAt})`,
        updatedAt: new Date(),
      },
    });
}

async function applyDuration(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  sessionId: string,
  start: Date,
  end: Date,
  state: string,
) {
  for (const segment of splitDuration(start, end)) {
    await upsertDaily(tx, userId, segment.date, end, {
      [state === "idle" ? "idleSeconds" : "activeSeconds"]: segment.seconds,
    });
    await tx
      .insert(activitySessionDailySummariesTable)
      .values({
        sessionId,
        userId,
        activityDate: segment.date,
        activeSeconds: state === "idle" ? 0 : segment.seconds,
        idleSeconds: state === "idle" ? segment.seconds : 0,
      })
      .onConflictDoUpdate({
        target: [
          activitySessionDailySummariesTable.sessionId,
          activitySessionDailySummariesTable.activityDate,
        ],
        set: {
          activeSeconds: sql`${activitySessionDailySummariesTable.activeSeconds} + ${
            state === "idle" ? 0 : segment.seconds
          }`,
          idleSeconds: sql`${activitySessionDailySummariesTable.idleSeconds} + ${
            state === "idle" ? segment.seconds : 0
          }`,
          updatedAt: new Date(),
        },
      });
  }
}

router.post("/activity/events", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as { events?: unknown } | null;
  if (!body || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 50) {
    res.status(400).json({ error: "events must contain between 1 and 50 items." });
    return;
  }

  const events = body.events.map(normaliseEvent);
  if (events.some((event): event is null => event === null)) {
    res.status(400).json({ error: "Activity events contain an invalid value." });
    return;
  }
  if ((events as ActivityInput[]).some((event) => !KNOWN_APPS.has(event.appSlug))) {
    res.status(400).json({ error: "Activity events contain an unknown app." });
    return;
  }
  if (
    (role === "counter" || role === "user") &&
    (events as ActivityInput[]).some((event) => event.appSlug !== "price-finder")
  ) {
    res.status(403).json({ error: "This account can only record Price Finder activity." });
    return;
  }
  if (
    (events as ActivityInput[]).some(
      (event) =>
        !pathMatchesApp(event.appSlug, event.pagePath) ||
        (event.eventType === "action" &&
          (!event.action || !KNOWN_ACTIONS.has(event.action))),
    )
  ) {
    res.status(400).json({ error: "Activity events contain an invalid page or action." });
    return;
  }

  let accepted = 0;
  const receivedAt = new Date();
  const activityDate = localDateFor(receivedAt);
  const activityDayStart = localDayStart(activityDate);
  await db.transaction(async (tx) => {
    // Quotas affect a user's whole local day, so serialise all requests for
    // that user/day before evaluating or incrementing their aggregate totals.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${activityDate}`}))`,
    );
    for (const event of events as ActivityInput[]) {
      // Browser clocks are untrusted. Server receipt time is the only source
      // used to calculate durations, dates, and report totals.
      const occurredAt = receivedAt;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${event.sessionId}))`);

      const [duplicate] = await tx
        .select({ id: activityEventsTable.id })
        .from(activityEventsTable)
        .where(eq(activityEventsTable.eventId, event.eventId))
        .limit(1);
      if (duplicate) continue;

      const [existingSession] = await tx
        .select()
        .from(activitySessionsTable)
        .where(eq(activitySessionsTable.id, event.sessionId))
        .limit(1);
      if (
        existingSession &&
        (existingSession.userId !== userId || existingSession.appSlug !== event.appSlug)
      ) {
        continue;
      }
      if (!existingSession && event.eventType !== "session_start") continue;

      if (!existingSession) {
        const [startedToday] = await tx
          .select({ total: count() })
          .from(activitySessionsTable)
          .where(
            and(
              eq(activitySessionsTable.userId, userId),
              gte(activitySessionsTable.startedAt, activityDayStart),
            ),
          );
        if (Number(startedToday.total) >= MAX_SESSIONS_PER_USER_DAY) continue;
      } else {
        const minuteAgo = new Date(receivedAt.getTime() - 60 * 1000);
        const [recentEvents] = await tx
          .select({ total: count() })
          .from(activityEventsTable)
          .where(
            and(
              eq(activityEventsTable.sessionId, event.sessionId),
              gte(activityEventsTable.occurredAt, minuteAgo),
            ),
          );
        if (Number(recentEvents.total) >= MAX_EVENTS_PER_SESSION_MINUTE) continue;

        if (event.eventType === "page_view") {
          const [pageViewsToday] = await tx
            .select({ total: count() })
            .from(activityEventsTable)
            .where(
              and(
                eq(activityEventsTable.sessionId, event.sessionId),
                eq(activityEventsTable.activityDate, activityDate),
                eq(activityEventsTable.eventType, "page_view"),
              ),
            );
          if (Number(pageViewsToday.total) >= MAX_PAGE_VIEWS_PER_SESSION_DAY) continue;
        }
      }

      if (event.eventType === "page_view" || event.eventType === "action") {
        const [daily] = await tx
          .select({
            actionCount: activityDailySummariesTable.actionCount,
            pageViewCount: activityDailySummariesTable.pageViewCount,
          })
          .from(activityDailySummariesTable)
          .where(
            and(
              eq(activityDailySummariesTable.userId, userId),
              eq(activityDailySummariesTable.activityDate, activityDate),
            ),
          )
          .limit(1);
        if (
          (event.eventType === "page_view" &&
            (daily?.pageViewCount ?? 0) >= MAX_PAGE_VIEWS_PER_USER_DAY) ||
          (event.eventType === "action" &&
            (daily?.actionCount ?? 0) >= MAX_ACTIONS_PER_USER_DAY)
        ) {
          continue;
        }
      }

      const [inserted] = await tx
        .insert(activityEventsTable)
        .values({
          eventId: event.eventId,
          sessionId: event.sessionId,
          userId,
          appSlug: event.appSlug,
          eventType: event.eventType,
          activityDate,
          occurredAt,
          pagePath: event.pagePath,
          action: event.action,
          state: event.state,
          metadata: null,
        })
        .onConflictDoNothing({ target: activityEventsTable.eventId })
        .returning({ id: activityEventsTable.id });

      // Browser retries and unload/reconnect races are expected. The unique
      // event id makes retrying a batch harmless.
      if (!inserted) continue;
      accepted += 1;

      const canCarryState =
        event.eventType === "session_start" ||
        event.eventType === "heartbeat" ||
        event.eventType === "state_change" ||
        event.eventType === "session_end";
      const initialState = canCarryState && event.state ? event.state : "active";
      let session = existingSession;
      let createdSession = false;
      if (!session) {
        const [created] = await tx
          .insert(activitySessionsTable)
          .values({
            id: event.sessionId,
            userId,
            appSlug: event.appSlug,
            startedAt: occurredAt,
            lastSeenAt: occurredAt,
            lastActivityAt: occurredAt,
            lastState: initialState,
            lastPagePath: event.pagePath,
          })
          .returning();
        session = created;
        createdSession = true;
      }

      const previousSeenAt = session.lastSeenAt;
      const isTimeEvent =
        event.eventType === "heartbeat" ||
        event.eventType === "session_end" ||
        event.eventType === "state_change";
      const isFreshTimeEvent = isTimeEvent && occurredAt >= previousSeenAt;
      const nextState =
        isFreshTimeEvent && event.state ? event.state : session.lastState;
      if (isTimeEvent && occurredAt > previousSeenAt) {
        await applyDuration(
          tx,
          userId,
          event.sessionId,
          previousSeenAt,
          occurredAt,
          session.lastState,
        );
      }

      const nextActiveSeconds =
        isTimeEvent && occurredAt > previousSeenAt
          ? Math.min(
              MAX_HEARTBEAT_INTERVAL_SECONDS,
              Math.max(0, Math.floor((occurredAt.getTime() - previousSeenAt.getTime()) / 1000)),
            )
          : 0;
      await tx
        .update(activitySessionsTable)
        .set({
          lastSeenAt:
            isTimeEvent && occurredAt > previousSeenAt ? occurredAt : previousSeenAt,
          lastActivityAt:
            occurredAt > session.lastActivityAt ? occurredAt : session.lastActivityAt,
          lastState: nextState,
          lastPagePath: event.pagePath ?? session.lastPagePath,
          activeSeconds: sql`${activitySessionsTable.activeSeconds} + ${
            session.lastState === "idle" ? 0 : nextActiveSeconds
          }`,
          idleSeconds: sql`${activitySessionsTable.idleSeconds} + ${
            session.lastState === "idle" ? nextActiveSeconds : 0
          }`,
          endedAt:
            event.eventType === "session_end" && isFreshTimeEvent
              ? occurredAt
              : session.endedAt,
        })
        .where(eq(activitySessionsTable.id, event.sessionId));

      const dailyDelta: DailyDelta = {};
      if (createdSession) dailyDelta.sessionCount = 1;
      if (event.eventType === "page_view") dailyDelta.pageViewCount = 1;
      if (event.eventType === "action") dailyDelta.actionCount = 1;
      await upsertDaily(tx, userId, activityDate, occurredAt, dailyDelta);
      if (createdSession) {
        await tx
          .insert(activitySessionDailySummariesTable)
          .values({
            sessionId: event.sessionId,
            userId,
            activityDate,
            activeSeconds: 0,
            idleSeconds: 0,
          })
          .onConflictDoNothing({
            target: [
              activitySessionDailySummariesTable.sessionId,
              activitySessionDailySummariesTable.activityDate,
            ],
          });
      }
    }
  });

  res.status(202).json({ accepted });
});

router.get("/admin/activity/summary", requireAdmin, async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  if (!validDate(from) || !validDate(to) || from > to) {
    res.status(400).json({ error: "from and to must be valid ISO dates with from no later than to." });
    return;
  }

  const rows = await db
    .select({
      activityDate: activityDailySummariesTable.activityDate,
      userId: activityDailySummariesTable.userId,
      userName: sql<string>`coalesce(nullif(trim(concat(${usersTable.firstName}, ' ', ${usersTable.lastName})), ''), ${usersTable.email})`,
      email: usersTable.email,
      activeSeconds: activityDailySummariesTable.activeSeconds,
      idleSeconds: activityDailySummariesTable.idleSeconds,
      sessionCount: activityDailySummariesTable.sessionCount,
      pageViewCount: activityDailySummariesTable.pageViewCount,
      actionCount: activityDailySummariesTable.actionCount,
      lastActivityAt: activityDailySummariesTable.lastActivityAt,
    })
    .from(activityDailySummariesTable)
    .innerJoin(usersTable, eq(usersTable.id, activityDailySummariesTable.userId))
    .where(
      and(
        gte(activityDailySummariesTable.activityDate, from),
        lte(activityDailySummariesTable.activityDate, to),
        userId ? eq(activityDailySummariesTable.userId, userId) : undefined,
      ),
    )
    .orderBy(desc(activityDailySummariesTable.activityDate), asc(usersTable.email));

  res.json({
    timezone: WORKSPACE_TIMEZONE,
    rows: rows.map((row) => ({
      ...row,
      email: row.email ?? "",
      lastActivityAt: asIso(row.lastActivityAt),
    })),
  });
});

router.get("/admin/activity/detail", requireAdmin, async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  const date = req.query.date;
  if (!userId || !validDate(date)) {
    res.status(400).json({ error: "userId and date are required." });
    return;
  }

  const [sessions, events] = await Promise.all([
    db
      .select({
        id: activitySessionsTable.id,
        appSlug: activitySessionsTable.appSlug,
        startedAt: activitySessionsTable.startedAt,
        lastSeenAt: activitySessionsTable.lastSeenAt,
        endedAt: activitySessionsTable.endedAt,
        activeSeconds: activitySessionDailySummariesTable.activeSeconds,
        idleSeconds: activitySessionDailySummariesTable.idleSeconds,
        lastState: activitySessionsTable.lastState,
        lastPagePath: activitySessionsTable.lastPagePath,
      })
      .from(activitySessionDailySummariesTable)
      .innerJoin(
        activitySessionsTable,
        eq(activitySessionsTable.id, activitySessionDailySummariesTable.sessionId),
      )
      .where(
        and(
          eq(activitySessionDailySummariesTable.userId, userId),
          eq(activitySessionDailySummariesTable.activityDate, date),
        ),
      )
      .orderBy(desc(activitySessionsTable.startedAt)),
    db
      .select({
        eventId: activityEventsTable.eventId,
        appSlug: activityEventsTable.appSlug,
        eventType: activityEventsTable.eventType,
        occurredAt: activityEventsTable.occurredAt,
        pagePath: activityEventsTable.pagePath,
        action: activityEventsTable.action,
        state: activityEventsTable.state,
      })
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.userId, userId),
          eq(activityEventsTable.activityDate, date),
        ),
      )
      .orderBy(asc(activityEventsTable.occurredAt), asc(activityEventsTable.id)),
  ]);

  res.json({
    timezone: WORKSPACE_TIMEZONE,
    activityDate: date,
    userId,
    sessions: sessions.map((session) => ({
      id: session.id,
      appSlug: session.appSlug,
      startedAt: session.startedAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      endedAt: asIso(session.endedAt),
      activeSeconds: session.activeSeconds,
      idleSeconds: session.idleSeconds,
      lastState: session.lastState,
      lastPagePath: session.lastPagePath,
    })),
    events: events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    })),
  });
});

router.get("/admin/activity/export", requireAdmin, async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  if (!validDate(from) || !validDate(to) || from > to) {
    res.status(400).json({ error: "from and to must be valid ISO dates with from no later than to." });
    return;
  }

  const pdf = await buildActivityPdf({ from, to, userId });
  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="prayag-user-activity-audit.pdf"',
      "Cache-Control": "no-store",
    })
    .send(Buffer.from(pdf));
});

export default router;