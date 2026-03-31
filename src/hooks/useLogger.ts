import { useCallback, useEffect, useRef } from "react";
import { useCognitoUser } from "./useCognitoUser";

type EventType = "search" | "click" | "column_click" | "row_click" | "filter" | "page_view" | "register";

interface LogData {
  query?: string;
  columnName?: string;
  rowId?: string | number;
  elementId?: string;
  filters?: Record<string, unknown>;
  action?: string;
  [key: string]: unknown;
}

// Generated once per page load — lives in module scope, survives re-renders
const SESSION_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export function useLogger() {
  const { userName, userEmail } = useCognitoUser();

  // Keep latest user info in a ref so all log functions stay stable (no deps change)
  const userRef = useRef({ userName, userEmail });
  useEffect(() => {
    userRef.current = { userName, userEmail };
  }, [userName, userEmail]);

  // Fire-and-forget POST — never throws, never blocks
  const log = useCallback((eventType: EventType, data: LogData) => {
    void fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        userEmail: userRef.current.userEmail || "anonymous",
        userName: userRef.current.userName || "anonymous",
        data,
        timestamp: new Date().toISOString(),
        sessionId: SESSION_ID,
      }),
    }).catch(() => {
      // silently discard — never surface errors to the UI
    });
  }, []); // stable: userRef is a ref, never changes identity

  const logSearch = useCallback(
    (query: string, filters?: Record<string, unknown>) => {
      log("search", { query, ...(filters ? { filters } : {}) });
    },
    [log]
  );

  const logClick = useCallback(
    (elementId: string, extra?: Record<string, unknown>) => {
      log("click", { elementId, ...extra });
    },
    [log]
  );

  const logColumnClick = useCallback(
    (columnName: string, extra?: Record<string, unknown>) => {
      log("column_click", { columnName, ...extra });
    },
    [log]
  );

  const logRowClick = useCallback(
    (rowId: string | number, extra?: Record<string, unknown>) => {
      log("row_click", { rowId, ...extra });
    },
    [log]
  );

  const logFilter = useCallback(
    (columnName: string, extra?: Record<string, unknown>) => {
      log("filter", { columnName, ...extra });
    },
    [log]
  );

  const logPageView = useCallback(
    (extra?: Record<string, unknown>) => {
      log("page_view", { ...extra });
    },
    [log]
  );

  const logRegister = useCallback(
    (extra?: Record<string, unknown>) => {
      log("register", { ...extra });
    },
    [log]
  );

  return { logSearch, logClick, logColumnClick, logRowClick, logFilter, logPageView, logRegister };
}
