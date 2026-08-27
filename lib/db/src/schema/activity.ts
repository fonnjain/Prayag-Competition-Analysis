import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * One browser tab's authenticated usage. A session is intentionally scoped to
 * a tab so that the server can add active/idle time without pretending that
 * simultaneous tabs are one continuous session.
 */
export const activitySessionsTable = pgTable(
  "activity_sessions",
  {
    id: varchar("id", { length: 80 }).primaryKey(),
    userId: varchar("user_id").notNull(),
    appSlug: text("app_slug").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastState: text("last_state").notNull().default("active"),
    activeSeconds: integer("active_seconds").notNull().default(0),
    idleSeconds: integer("idle_seconds").notNull().default(0),
    lastPagePath: text("last_page_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activity_sessions_user_started_idx").on(table.userId, table.startedAt),
    index("activity_sessions_user_last_activity_idx").on(
      table.userId,
      table.lastActivityAt,
    ),
  ],
);

export const activityEventsTable = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    eventId: varchar("event_id", { length: 80 }).notNull(),
    sessionId: varchar("session_id", { length: 80 }).notNull(),
    userId: varchar("user_id").notNull(),
    appSlug: text("app_slug").notNull(),
    eventType: text("event_type").notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    pagePath: text("page_path"),
    action: text("action"),
    state: text("state"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_events_event_id_idx").on(table.eventId),
    index("activity_events_user_date_idx").on(table.userId, table.activityDate),
    index("activity_events_session_occurred_idx").on(
      table.sessionId,
      table.occurredAt,
    ),
  ],
);

/**
 * Daily workspace-local rollups. Raw event timestamps remain UTC-aware while
 * activityDate is grouped in Asia/Kolkata for the admin report.
 */
export const activityDailySummariesTable = pgTable(
  "activity_daily_summaries",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    activeSeconds: integer("active_seconds").notNull().default(0),
    idleSeconds: integer("idle_seconds").notNull().default(0),
    sessionCount: integer("session_count").notNull().default(0),
    pageViewCount: integer("page_view_count").notNull().default(0),
    actionCount: integer("action_count").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_daily_user_date_idx").on(table.userId, table.activityDate),
    index("activity_daily_date_idx").on(table.activityDate),
  ],
);

export type ActivitySession = typeof activitySessionsTable.$inferSelect;
export type ActivityEvent = typeof activityEventsTable.$inferSelect;
export type ActivityDailySummary = typeof activityDailySummariesTable.$inferSelect;

/** Per-session daily totals keep the administrator's drill-down aligned with
 * the selected workspace-local day rather than the session's lifetime. */
export const activitySessionDailySummariesTable = pgTable(
  "activity_session_daily_summaries",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("session_id", { length: 80 }).notNull(),
    userId: varchar("user_id").notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    activeSeconds: integer("active_seconds").notNull().default(0),
    idleSeconds: integer("idle_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_session_daily_session_date_idx").on(
      table.sessionId,
      table.activityDate,
    ),
    index("activity_session_daily_user_date_idx").on(table.userId, table.activityDate),
  ],
);