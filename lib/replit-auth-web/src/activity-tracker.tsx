import { useEffect } from "react";
import type { AuthUser } from "@workspace/api-client-react";

const SID_KEY = "prayag_sid";
const IDLE_AFTER_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const FLUSH_MS = 15 * 1000;
const ACTION_NAME = /^[a-z0-9][a-z0-9_.-]*$/;

type ActivityState = "active" | "idle";
type ActivityEventType =
  | "session_start"
  | "session_end"
  | "heartbeat"
  | "page_view"
  | "action"
  | "state_change";

type QueuedActivityEvent = {
  eventId: string;
  sessionId: string;
  appSlug: string;
  eventType: ActivityEventType;
  occurredAt: string;
  pagePath: string | null;
  action: string | null;
  state: ActivityState | null;
};

type ActivityRecorder = {
  recordAction: (action: string) => void;
};

let currentRecorder: ActivityRecorder | null = null;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getPagePath(): string {
  const path = window.location.pathname || "/";
  return path.length <= 500 ? path : path.slice(0, 500);
}

function getAuthHeaders(): Record<string, string> {
  try {
    const sid = localStorage.getItem(SID_KEY);
    return sid ? { Authorization: `Bearer ${sid}` } : {};
  } catch {
    return {};
  }
}

/**
 * Record an intentional, static action label from any workspace component.
 * Labels are restricted to safe identifiers; no form values or user-entered
 * text are ever included.
 */
export function trackActivity(action: string): void {
  if (ACTION_NAME.test(action)) currentRecorder?.recordAction(action);
}

export function ActivityTracker({
  user,
  appSlug,
}: {
  user: AuthUser | null;
  appSlug: string;
}) {
  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    const sessionId = newId();
    const events: QueuedActivityEvent[] = [];
    let state: ActivityState = document.hidden ? "idle" : "active";
    let lastInteractionAt = Date.now();
    let ended = false;
    let flushing = false;

    const enqueue = (
      eventType: ActivityEventType,
      details: Partial<Pick<QueuedActivityEvent, "action" | "state" | "pagePath">> = {},
    ) => {
      if (ended && eventType !== "session_end") return;
      events.push({
        eventId: newId(),
        sessionId,
        appSlug,
        eventType,
        occurredAt: new Date().toISOString(),
        pagePath: details.pagePath ?? getPagePath(),
        action: details.action ?? null,
        state: details.state ?? null,
      });
    };

    const flush = (keepalive = false) => {
      if (flushing || events.length === 0) return;
      flushing = true;
      const batch = events.splice(0, 50);
      void fetch("/api/activity/events", {
        method: "POST",
        credentials: "include",
        keepalive,
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ events: batch }),
      })
        .then((response) => {
          if (!response.ok && !keepalive) events.unshift(...batch);
        })
        .catch(() => {
          if (!keepalive) events.unshift(...batch);
        })
        .finally(() => {
          flushing = false;
          if (!keepalive && events.length >= 50) flush();
        });
    };

    const changeState = (nextState: ActivityState) => {
      if (state === nextState) return;
      state = nextState;
      enqueue("state_change", { state });
    };

    const checkIdle = () => {
      if (state === "active" && Date.now() - lastInteractionAt >= IDLE_AFTER_MS) {
        changeState("idle");
      }
    };

    const registerInteraction = () => {
      lastInteractionAt = Date.now();
      if (!document.hidden) changeState("active");
    };

    const recordPageView = () => enqueue("page_view");
    const recordDataAction = (event: MouseEvent) => {
      const source = event.target;
      if (!(source instanceof Element)) return;
      const marker = source.closest<HTMLElement>("[data-activity]");
      // Form markers are recorded by the submit handler below. Ignoring them
      // here avoids double-counting a submit button click as both click + submit.
      if (marker?.tagName === "FORM") return;
      const action = marker?.dataset.activity;
      if (action) trackActivity(action);
    };
    const recordFormAction = (event: SubmitEvent) => {
      const source = event.target;
      if (!(source instanceof Element)) return;
      const action = source.closest<HTMLElement>("[data-activity]")?.dataset.activity;
      if (action) trackActivity(action);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        changeState("idle");
        flush();
      } else {
        registerInteraction();
        recordPageView();
      }
    };
    const endSession = () => {
      if (ended) return;
      checkIdle();
      ended = true;
      enqueue("session_end", { state });
      flush(true);
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const historyChanged = () => {
      recordPageView();
      flush();
    };
    window.history.pushState = function (...args) {
      originalPushState.apply(this, args);
      historyChanged();
    };
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      historyChanged();
    };

    currentRecorder = {
      recordAction(action) {
        enqueue("action", { action });
        flush();
      },
    };
    enqueue("session_start", { state });
    recordPageView();
    flush();

    const interactionEvents = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"];
    interactionEvents.forEach((name) => window.addEventListener(name, registerInteraction, { passive: true }));
    document.addEventListener("click", recordDataAction);
    document.addEventListener("submit", recordFormAction);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("popstate", historyChanged);
    window.addEventListener("pagehide", endSession);

    const idleTimer = window.setInterval(checkIdle, 10 * 1000);
    const heartbeatTimer = window.setInterval(() => {
      checkIdle();
      enqueue("heartbeat", { state });
      flush();
    }, HEARTBEAT_MS);
    const flushTimer = window.setInterval(() => flush(), FLUSH_MS);

    return () => {
      currentRecorder = null;
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      interactionEvents.forEach((name) => window.removeEventListener(name, registerInteraction));
      document.removeEventListener("click", recordDataAction);
      document.removeEventListener("submit", recordFormAction);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("popstate", historyChanged);
      window.removeEventListener("pagehide", endSession);
      window.clearInterval(idleTimer);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(flushTimer);
      endSession();
    };
  }, [appSlug, user?.id]);

  return null;
}