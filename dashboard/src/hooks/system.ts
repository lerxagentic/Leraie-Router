import { consoleRequest, fetchSessionUser } from "../data/api";
import type { ApiErrorShape } from "../data/api";
import { queryKeys } from "../data/query-keys";
import type { SessionUser, UsageDimension } from "../data/contracts";
import { assertAuditListPage, assertSystemHealth, assertUsageBy, assertUsageChart, assertUsageRequestDetail, assertUsageRequests, assertUsageSummary, querySignal } from "./common";
import { DASHBOARD_QUERY_OPTIONS } from "../data/query-policy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * Coalesces live SSE "a request just finished" pushes into one query
 * invalidation per short window, instead of refetching on every event. A
 * burst of concurrent completions would otherwise fire one HTTP refetch per
 * push; the debounce keeps the table reacting within ~150ms of the first
 * event in a burst while still collapsing the rest.
 */
const LIVE_REQUEST_DEBOUNCE_MS = 150;

/**
 * Opens `/live/requests/stream` and invalidates the usage-requests query on
 * every push so the table updates as soon as the gateway finishes a request,
 * instead of waiting on the next 5s poll tick. Falls back silently to the
 * existing `refetchInterval` polling on the query itself if the stream
 * drops — this only ever makes updates arrive *sooner*, never replaces the
 * query as the source of truth.
 */
function useLiveRequestInvalidation(enabled: boolean): void {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let source: EventSource | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      const nextSource = new EventSource("/console/api/live/requests/stream");
      source = nextSource;
      nextSource.addEventListener("request", () => {
        if (stopped) return;
        if (timerRef.current !== undefined) return;
        timerRef.current = setTimeout(() => {
          timerRef.current = undefined;
          void queryClient.invalidateQueries({ queryKey: ["console", "usage", "requests"] });
        }, LIVE_REQUEST_DEBOUNCE_MS);
      });
      nextSource.onerror = () => {
        if (stopped) return;
        nextSource.close();
        if (source === nextSource) source = undefined;
        retryTimer = setTimeout(connect, 5_000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      source?.close();
    };
  }, [enabled, queryClient]);
}


/** Loads the current signed-in console user, including `isPlatformAdmin`,
 * so pages can hide (never solely rely on hiding — the server remains the
 * real enforcement) controls the user's scope cannot use. */
export function useSessionUser() {
  return useQuery<SessionUser | null>({
    queryKey: queryKeys.session.current,
    queryFn: () => fetchSessionUser(),
    staleTime: 60_000,
    gcTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Loads current system health and refreshes it on the dashboard cadence. */
export function useSystemHealth() {
  return useQuery({
    queryKey: queryKeys.system.health,
    queryFn: (context) =>
      consoleRequest<unknown>("/system/health", { signal: querySignal(context) }).then(
        assertSystemHealth,
      ),
    ...DASHBOARD_QUERY_OPTIONS,
    refetchInterval: 15_000,
  });
}

/** Loads the 20-beta-style usage summary for a period. */
export function useUsageSummary(period: string) {
  return useQuery({
    queryKey: queryKeys.usageAnalytics.summary(period),
    queryFn: (context) =>
      consoleRequest<unknown>(`/system/usage/summary?period=${encodeURIComponent(period)}`, {
        signal: querySignal(context),
      }).then(assertUsageSummary),
    ...DASHBOARD_QUERY_OPTIONS,
    refetchInterval: 10_000,
  });
}

/** Loads time-series buckets for the traffic chart. */
export function useUsageChart(period: string) {
  return useQuery({
    queryKey: queryKeys.usageAnalytics.chart(period),
    queryFn: (context) =>
      consoleRequest<unknown>(`/system/usage/chart?period=${encodeURIComponent(period)}`, {
        signal: querySignal(context),
      }).then(assertUsageChart),
    ...DASHBOARD_QUERY_OPTIONS,
    refetchInterval: 10_000,
  });
}

/** Loads one usage breakdown dimension (see `USAGE_DIMENSIONS`). */
export function useUsageBy(period: string, dimension: UsageDimension) {
  return useQuery({
    queryKey: queryKeys.usageAnalytics.by(period, dimension),
    queryFn: (context) =>
      consoleRequest<unknown>(
        `/system/usage/by-${dimension}?period=${encodeURIComponent(period)}`,
        { signal: querySignal(context) },
      ).then(assertUsageBy),
    ...DASHBOARD_QUERY_OPTIONS,
    refetchInterval: 10_000,
  });
}

/** Loads the most recent requests for the live table. */
export function useUsageRequests(
  period: string,
  limit = 50,
  httpStatus?: number | null,
) {
  // SSE push drives the fast path (invalidates within ~150ms of a request
  // finishing); the 5s `refetchInterval` stays as a floor so the table keeps
  // moving if the stream is down or blocked by a proxy.
  useLiveRequestInvalidation(true);
  const statusParam = httpStatus === null || httpStatus === undefined
    ? ""
    : `&httpStatus=${encodeURIComponent(String(httpStatus))}`;
  return useQuery({
    queryKey: queryKeys.usageAnalytics.requests(period, limit, httpStatus),
    queryFn: (context) =>
      consoleRequest<unknown>(
        `/system/usage/requests?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(String(limit))}${statusParam}`,
        { signal: querySignal(context) },
      ).then(assertUsageRequests),
    ...DASHBOARD_QUERY_OPTIONS,
    refetchInterval: 5_000,
  });
}

/** Loads one request's detail for the inspector dialog. */
export function useUsageRequestDetail(requestId: string | null) {
  return useQuery({
    queryKey: queryKeys.usageAnalytics.requestDetail(requestId ?? "_"),
    queryFn: (context) => {
      if (!requestId) throw { status: 400, code: "invalid_request", message: "Request is required" } satisfies ApiErrorShape;
      return consoleRequest<unknown>(`/system/usage/requests/${encodeURIComponent(requestId)}`, {
        signal: querySignal(context),
      }).then(assertUsageRequestDetail);
    },
    enabled: requestId !== null,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useAuditTrail(filters?: {
  action?: string;
  actor?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: queryKeys.audit.list(filters ?? {}),
    queryFn: (context) => {
      const search = new URLSearchParams();
      if (filters?.action) search.set("action", filters.action);
      if (filters?.actor) search.set("actor", filters.actor);
      if (filters?.cursor) search.set("cursor", filters.cursor);
      if (filters?.limit) search.set("limit", String(filters.limit));
      const suffix = search.toString() ? `?${search.toString()}` : "";
      return consoleRequest<unknown>(`/audit${suffix}`, { signal: querySignal(context) }).then(
        assertAuditListPage,
      );
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
