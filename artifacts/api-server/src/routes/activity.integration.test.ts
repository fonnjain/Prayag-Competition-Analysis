import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityDailySummariesTable,
  activityEventsTable,
  activitySessionDailySummariesTable,
  activitySessionsTable,
  db,
  usersTable,
} from "@workspace/db";
import activityRouter from "./activity.js";

type Role = "admin" | "user" | "counter";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const role = (req.headers["x-test-role"] ?? "user") as Role;
  const userId = String(req.headers["x-test-user-id"] ?? "activity-test-user");
  req.isAuthenticated = (() => true) as never;
  req.user = {
    id: userId,
    email: `${userId}@example.test`,
    mustChangePassword: false,
    role,
  };
  next();
});
app.use(activityRouter);

const request = supertest(app);
let testUserId = "";
let sequence = 0;

function isoAt(base: number, seconds: number): string {
  return new Date(base + seconds * 1000).toISOString();
}

function event(
  sessionId: string,
  eventId: string,
  eventType: string,
  occurredAt: string,
  options: {
    state?: "active" | "idle";
    appSlug?: string;
    pagePath?: string;
  } = {},
) {
  return {
    eventId,
    sessionId,
    appSlug: options.appSlug ?? "price-finder",
    eventType,
    occurredAt,
    pagePath: options.pagePath ?? "/price-finder",
    ...(options.state ? { state: options.state } : {}),
  };
}

function eventsAs(
  role: Role,
  userId: string,
  payload: Record<string, unknown>[],
) {
  return request
    .post("/activity/events")
    .set("x-test-role", role)
    .set("x-test-user-id", userId)
    .send({ events: payload });
}

function reportAs(role: Role, path: string) {
  return request
    .get(path)
    .set("x-test-role", role)
    .set("x-test-user-id", testUserId);
}

async function activityRows() {
  const [sessions, daily, sessionDaily, events] = await Promise.all([
    db.select().from(activitySessionsTable).where(eq(activitySessionsTable.userId, testUserId)),
    db
      .select()
      .from(activityDailySummariesTable)
      .where(eq(activityDailySummariesTable.userId, testUserId)),
    db
      .select()
      .from(activitySessionDailySummariesTable)
      .where(eq(activitySessionDailySummariesTable.userId, testUserId)),
    db.select().from(activityEventsTable).where(eq(activityEventsTable.userId, testUserId)),
  ]);
  return { sessions, daily, sessionDaily, events };
}

beforeEach(async () => {
  sequence += 1;
  testUserId = `activity-test-user-${Date.now()}-${sequence}`;
  await db.insert(usersTable).values({
    id: testUserId,
    email: `${testUserId}@example.test`,
    role: "user",
  });
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await db
    .delete(activityEventsTable)
    .where(eq(activityEventsTable.userId, testUserId));
  await db
    .delete(activitySessionDailySummariesTable)
    .where(eq(activitySessionDailySummariesTable.userId, testUserId));
  await db
    .delete(activityDailySummariesTable)
    .where(eq(activityDailySummariesTable.userId, testUserId));
  await db
    .delete(activitySessionsTable)
    .where(eq(activitySessionsTable.userId, testUserId));
  await db.delete(usersTable).where(eq(usersTable.id, testUserId));
});

describe("activity accounting", () => {
  it("charges active, idle, and active intervals to the prior state", async () => {
    const base = Date.parse("2026-08-27T10:00:00.000Z");
    const sessionId = `activity-transition-session-${sequence}`;
    const sendAt = async (seconds: number, payload: Record<string, unknown>) => {
      vi.setSystemTime(new Date(base + seconds * 1000));
      return eventsAs("user", testUserId, [payload]);
    };

    expect(
      (await sendAt(0, event(sessionId, `transition-start-${sequence}`, "session_start", isoAt(base, 0), { state: "active" }))).body,
    ).toEqual({ accepted: 1 });
    expect(
      (await sendAt(30, event(sessionId, `transition-idle-${sequence}`, "state_change", isoAt(base, 30), { state: "idle" }))).body,
    ).toEqual({ accepted: 1 });
    expect(
      (await sendAt(50, event(sessionId, `transition-heartbeat-${sequence}`, "heartbeat", isoAt(base, 50)))).body,
    ).toEqual({ accepted: 1 });
    expect(
      (await sendAt(80, event(sessionId, `transition-active-${sequence}`, "state_change", isoAt(base, 80), { state: "active" }))).body,
    ).toEqual({ accepted: 1 });
    expect(
      (await sendAt(100, event(sessionId, `transition-end-${sequence}`, "session_end", isoAt(base, 100)))).body,
    ).toEqual({ accepted: 1 });

    const rows = await activityRows();
    expect(rows.sessions).toHaveLength(1);
    expect(rows.sessions[0]).toMatchObject({
      activeSeconds: 50,
      idleSeconds: 50,
      lastState: "active",
    });
    expect(rows.daily).toHaveLength(1);
    expect(rows.daily[0]).toMatchObject({
      activityDate: "2026-08-27",
      activeSeconds: 50,
      idleSeconds: 50,
      sessionCount: 1,
    });
    expect(rows.sessionDaily).toHaveLength(1);
    expect(rows.sessionDaily[0]).toMatchObject({
      activityDate: "2026-08-27",
      activeSeconds: 50,
      idleSeconds: 50,
    });
  });

  it("splits a session across the Asia/Kolkata day boundary in summaries and drill-down", async () => {
    const boundary = Date.parse("2026-08-27T18:30:00.000Z");
    const sessionId = `activity-midnight-session-${sequence}`;
    vi.setSystemTime(new Date(boundary - 10_000));
    const start = await eventsAs("user", testUserId, [
      event(sessionId, `midnight-start-${sequence}`, "session_start", "1999-01-01T00:00:00.000Z", {
        state: "active",
      }),
    ]);
    expect(start.body).toEqual({ accepted: 1 });

    vi.setSystemTime(new Date(boundary + 10_000));
    const heartbeat = await eventsAs("user", testUserId, [
      event(sessionId, `midnight-heartbeat-${sequence}`, "heartbeat", "1999-01-01T00:00:01.000Z"),
    ]);
    expect(heartbeat.body).toEqual({ accepted: 1 });

    const summary = await reportAs(
      "admin",
      "/admin/activity/summary?from=2026-08-27&to=2026-08-28",
    );
    expect(summary.status).toBe(200);
    expect(summary.body.timezone).toBe("Asia/Kolkata");
    expect(summary.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityDate: "2026-08-27",
          activeSeconds: 10,
          idleSeconds: 0,
          sessionCount: 1,
        }),
        expect.objectContaining({
          activityDate: "2026-08-28",
          activeSeconds: 10,
          idleSeconds: 0,
          sessionCount: 0,
        }),
      ]),
    );

    const previousDay = await reportAs(
      "admin",
      `/admin/activity/detail?userId=${encodeURIComponent(testUserId)}&date=2026-08-27`,
    );
    const nextDay = await reportAs(
      "admin",
      `/admin/activity/detail?userId=${encodeURIComponent(testUserId)}&date=2026-08-28`,
    );
    expect(previousDay.status).toBe(200);
    expect(nextDay.status).toBe(200);
    expect(previousDay.body.sessions).toEqual([
      expect.objectContaining({
        id: sessionId,
        activeSeconds: 10,
        idleSeconds: 0,
      }),
    ]);
    expect(nextDay.body.sessions).toEqual([
      expect.objectContaining({
        id: sessionId,
        activeSeconds: 10,
        idleSeconds: 0,
      }),
    ]);
    expect(previousDay.body.events).toHaveLength(1);
    expect(previousDay.body.events[0].eventType).toBe("session_start");
    expect(nextDay.body.events).toHaveLength(1);
    expect(nextDay.body.events[0].eventType).toBe("heartbeat");
  });

  it("ignores duplicate late retries without double-counting or changing the latest state", async () => {
    const base = Date.parse("2026-08-27T10:00:00.000Z");
    const sessionId = `activity-late-session-${sequence}`;
    const start = async (seconds: number) => {
      vi.setSystemTime(new Date(base + seconds * 1000));
    };

    await start(0);
    await eventsAs("user", testUserId, [
      event(sessionId, `late-start-${sequence}`, "session_start", isoAt(base, 0), { state: "active" }),
    ]);
    await start(10);
    const stateChange = event(
      sessionId,
      `late-state-${sequence}`,
      "state_change",
      isoAt(base, 10),
      { state: "idle" },
    );
    expect((await eventsAs("user", testUserId, [stateChange])).body).toEqual({ accepted: 1 });
    await start(20);
    expect(
      (await eventsAs("user", testUserId, [
        event(sessionId, `late-heartbeat-${sequence}`, "heartbeat", isoAt(base, 20)),
      ])).body,
    ).toEqual({ accepted: 1 });

    await start(30);
    const duplicateRetry = {
      ...stateChange,
      occurredAt: "1999-01-01T00:00:00.000Z",
      state: "active",
    };
    expect((await eventsAs("user", testUserId, [duplicateRetry])).body).toEqual({ accepted: 0 });

    await start(40);
    expect(
      (await eventsAs("user", testUserId, [
        event(sessionId, `late-end-${sequence}`, "session_end", isoAt(base, 40)),
      ])).body,
    ).toEqual({ accepted: 1 });

    const rows = await activityRows();
    expect(rows.events).toHaveLength(4);
    expect(rows.sessions[0]).toMatchObject({
      activeSeconds: 10,
      idleSeconds: 30,
      lastSeenAt: new Date(base + 40_000),
      lastState: "idle",
    });
  });

  it("limits counter telemetry to Price Finder while administrators retain report access", async () => {
    await db
      .update(usersTable)
      .set({ role: "counter" })
      .where(eq(usersTable.id, testUserId));
    const sessionId = `activity-counter-session-${sequence}`;
    vi.setSystemTime(new Date("2026-08-27T10:00:00.000Z"));

    const allowed = await eventsAs("counter", testUserId, [
      event(sessionId, `counter-finder-${sequence}`, "session_start", "2026-08-27T10:00:00.000Z", {
        appSlug: "price-finder",
      }),
    ]);
    expect(allowed.status).toBe(202);
    expect(allowed.body).toEqual({ accepted: 1 });

    const denied = await eventsAs("counter", testUserId, [
      event(
        `activity-counter-denied-session-${sequence}`,
        `counter-home-${sequence}`,
        "session_start",
        "2026-08-27T10:00:00.000Z",
        { appSlug: "home", pagePath: "/" },
      ),
    ]);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/Price Finder/);

    const counterSummary = await reportAs("counter", "/admin/activity/summary?from=2026-08-27&to=2026-08-27");
    expect(counterSummary.status).toBe(403);
    const adminSummary = await reportAs(
      "admin",
      `/admin/activity/summary?from=2026-08-27&to=2026-08-27&userId=${encodeURIComponent(testUserId)}`,
    );
    expect(adminSummary.status).toBe(200);
    expect(adminSummary.body.rows).toEqual([
      expect.objectContaining({
        userId: testUserId,
        activityDate: "2026-08-27",
        sessionCount: 1,
      }),
    ]);
    const adminDetail = await reportAs(
      "admin",
      `/admin/activity/detail?userId=${encodeURIComponent(testUserId)}&date=2026-08-27`,
    );
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.sessions).toHaveLength(1);
  });
});