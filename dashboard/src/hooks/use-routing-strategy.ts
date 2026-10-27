import { useEffect, useState } from "react";
import { useProviderRouting, useUpdateProviderRouting } from "./routing";
import { useDebouncedSave } from "./use-debounced-save";
import type { ProviderRoutingResponse } from "../data/contracts";

export type RoutingStrategy = ProviderRoutingResponse["strategy"];

/**
 * Which reading the usage floor compares. Duplicated rather than imported from
 * `src/transport/routing/usage-floor` for the same reason the bypass-provider
 * set below is: importing the backend module graph would pull `node:crypto`
 * into the browser build.
 */
export type UsageFloorUnit = "credit" | "percent";

export const ROUTING_ACTIVE_LABEL = {
  fallback: "Failover",
  roundRobin: "Round robin",
} as const;

// Providers known to not reliably support plain HTTP/S proxying — routing
// for these defaults to bypassProxy on the backend. Dashboard copy of the
// backend `DEFAULT_PROXY_BYPASS_PROVIDER_IDS` (`src/providers/provider-metadata.ts`).
// Intentionally duplicated, not imported: importing the backend value would
// bundle the backend module graph (Elysia + `node:crypto`) into the browser
// build and break Vite dev with "Module node:crypto has been externalized".
// Same precedent as the dashboard `isRecord` copy in `lib/api.ts`.
// This set only decides whether the UI shows an explanatory tip; the backend
// constant is what actually enforces the default. Keep in sync.
export const PROXY_UNSUPPORTED_HINT_PROVIDERS: ReadonlySet<string> = new Set([
  "inferhub",
]);

export interface RoutingStrategyState {
  readonly strategy: RoutingStrategy;
  readonly roundRobinEnabled: boolean;
  readonly setRoundRobinEnabled: (next: boolean) => void;
  readonly rotateCount: number;
  readonly setRotateCount: (next: number) => void;
  readonly maxInflight: number | null;
  readonly bypassProxy: boolean;
  readonly userAgent: string;
  readonly setUserAgent: (next: string) => void;
  /** Global credit limit toggle for every account of this provider/tenant. */
  readonly creditLimitEnabled: boolean;
  readonly setCreditLimitEnabled: (next: boolean) => void;
  /** Global minimum remaining credits to keep on every account; default 200. */
  readonly creditLimit: number;
  readonly setCreditLimit: (next: number) => void;
  /** Minimum remaining allowance to stay routable; `null` = no floor. */
  readonly usageFloor: number | null;
  readonly setUsageFloor: (next: number | null) => void;
  /** Which reading the floor compares: absolute credit or percent. */
  readonly usageFloorUnit: UsageFloorUnit;
  readonly setUsageFloorUnit: (next: UsageFloorUnit) => void;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isSaving: boolean;
  readonly saveFailed: boolean;
  readonly refetch: () => void;
  readonly setMaxInflight: (next: number | null) => void;
  readonly setBypassProxy: (next: boolean) => void;
  readonly assignedPoolId: string | null;
  readonly setAssignedPoolId: (next: string | null) => void;
}

export function useRoutingStrategy(providerId: string, allowUserAgent: boolean): RoutingStrategyState {
  const query = useProviderRouting(providerId);
  const mutation = useUpdateProviderRouting();
  const [strategy, setStrategyState] = useState<RoutingStrategy>("fallback");
  const [rotateCount, setRotateCountState] = useState(1);
  const [maxInflight, setMaxInflightState] = useState<number | null>(null);
  const [bypassProxy, setBypassProxyState] = useState(true);
  const [assignedPoolId, setAssignedPoolIdState] = useState<string | null>(null);
  const [userAgent, setUserAgentState] = useState("codex_cli_rs/0.156.1");
  const [creditLimitEnabled, setCreditLimitEnabledState] = useState(true);
  const [creditLimit, setCreditLimitState] = useState(200);
  const [usageFloor, setUsageFloorState] = useState<number | null>(null);
  const [usageFloorUnit, setUsageFloorUnitState] = useState<UsageFloorUnit>("percent");

  useEffect(() => {
    if (!query.data) return;
    setStrategyState(query.data.strategy);
    setRotateCountState(query.data.rotateCount);
    setMaxInflightState(query.data.maxInflight);
    setBypassProxyState(query.data.bypassProxy ?? true);
    setAssignedPoolIdState((query.data as unknown as { assignedPoolId?: string | null }).assignedPoolId ?? null);
    setUserAgentState(query.data.userAgent);
    setCreditLimitEnabledState(query.data.creditLimitEnabled);
    setCreditLimitState(query.data.creditLimit);
    setUsageFloorState(query.data.usageFloor ?? null);
    setUsageFloorUnitState(query.data.usageFloorUnit ?? "percent");
  }, [query.data]);

  const save = (next: {
    strategy: RoutingStrategy;
    rotateCount: number;
    maxInflight: number | null;
    bypassProxy: boolean;
    assignedPoolId: string | null;
    userAgent: string;
    creditLimitEnabled: boolean;
    creditLimit: number;
    /** Omitted by the older call sites; the current state is used then. */
    usageFloor?: number | null;
    usageFloorUnit?: UsageFloorUnit;
  }) => {
    const nextFloor = next.usageFloor === undefined ? usageFloor : next.usageFloor;
    const nextFloorUnit = next.usageFloorUnit ?? usageFloorUnit;
    mutation.mutate(
      {
        providerId,
        request: {
          enabled: true,
          strategy: next.strategy,
          rotateCount: next.rotateCount,
          maxInflight: next.maxInflight,
          bypassProxy: next.bypassProxy,
          assignedPoolId: next.assignedPoolId,
          creditLimitEnabled: next.creditLimitEnabled,
          creditLimit: next.creditLimit,
          usageFloor: nextFloor,
          usageFloorUnit: nextFloorUnit,
          ...(allowUserAgent ? { userAgent: next.userAgent } : {}),
        },
      },
      {
        onError: () => {
          if (!query.data) return;
          setStrategyState(query.data.strategy);
          setRotateCountState(query.data.rotateCount);
          setBypassProxyState(query.data.bypassProxy);
          setAssignedPoolIdState((query.data as unknown as { assignedPoolId?: string | null }).assignedPoolId ?? null);
          setUserAgentState(query.data.userAgent);
          setCreditLimitEnabledState(query.data.creditLimitEnabled);
          setCreditLimitState(query.data.creditLimit);
          setUsageFloorState(query.data.usageFloor ?? null);
          setUsageFloorUnitState(query.data.usageFloorUnit ?? "percent");
        },
      },
    );
  };
  const scheduleMaxInflightSave = useDebouncedSave((next: number | null) =>
    save({
      strategy,
      rotateCount,
      maxInflight: next,
      bypassProxy,
      assignedPoolId,
      userAgent,
      creditLimitEnabled,
      creditLimit,
    }),
  );
  const scheduleRotateCountSave = useDebouncedSave((next: number) =>
    save({
      strategy,
      rotateCount: next,
      maxInflight,
      bypassProxy,
      assignedPoolId,
      userAgent,
      creditLimitEnabled,
      creditLimit,
    }),
  );
  const scheduleUserAgentSave = useDebouncedSave((next: string) =>
    save({
      strategy,
      rotateCount,
      maxInflight,
      bypassProxy,
      assignedPoolId,
      userAgent: next,
      creditLimitEnabled,
      creditLimit,
    }),
  );
  const scheduleCreditLimitSave = useDebouncedSave((next: number) =>
    save({
      strategy,
      rotateCount,
      maxInflight,
      bypassProxy,
      assignedPoolId,
      userAgent,
      creditLimitEnabled,
      creditLimit: next,
    }),
  );

  return {
    strategy,
    maxInflight,
    bypassProxy,
    assignedPoolId,
    userAgent,
    creditLimitEnabled,
    creditLimit,
    usageFloor,
    usageFloorUnit,
    isLoading: query.isPending,
    isError: query.isError,
    isSaving: mutation.isPending,
    saveFailed: mutation.isError,
    refetch: () => query.refetch(),
    setMaxInflight: (next) => {
      setMaxInflightState(next);
      scheduleMaxInflightSave(next);
    },
    setUserAgent: (next) => {
      setUserAgentState(next);
      scheduleUserAgentSave(next);
    },
    setAssignedPoolId: (next) => {
      setAssignedPoolIdState(next);
      const nextBypass = next === null;
      setBypassProxyState(nextBypass);
      save({
        strategy,
        rotateCount,
        maxInflight,
        bypassProxy: nextBypass,
        assignedPoolId: next,
        userAgent,
        creditLimitEnabled,
        creditLimit,
      });
    },
    setBypassProxy: (next) => {
      setBypassProxyState(next);
      const nextPoolId = next ? null : assignedPoolId;
      if (next) setAssignedPoolIdState(null);
      save({
        strategy,
        rotateCount,
        maxInflight,
        bypassProxy: next,
        assignedPoolId: nextPoolId,
        userAgent,
        creditLimitEnabled,
        creditLimit,
      });
    },
    setCreditLimitEnabled: (next) => {
      setCreditLimitEnabledState(next);
      save({
        strategy,
        rotateCount,
        maxInflight,
        bypassProxy,
        assignedPoolId,
        userAgent,
        creditLimitEnabled: next,
        creditLimit,
      });
    },
    setCreditLimit: (next) => {
      setCreditLimitState(next);
      scheduleCreditLimitSave(next);
    },
    setUsageFloor: (next) => {
      setUsageFloorState(next);
      save({
        strategy,
        rotateCount,
        maxInflight,
        bypassProxy,
        assignedPoolId,
        userAgent,
        creditLimitEnabled,
        creditLimit,
        usageFloor: next,
        usageFloorUnit,
      });
    },
    setUsageFloorUnit: (next) => {
      setUsageFloorUnitState(next);
      save({
        strategy,
        rotateCount,
        maxInflight,
        bypassProxy,
        assignedPoolId,
        userAgent,
        creditLimitEnabled,
        creditLimit,
        usageFloor,
        usageFloorUnit: next,
      });
    },
    roundRobinEnabled: strategy === "round_robin",
    setRoundRobinEnabled: (next) => {
      const resolved: RoutingStrategy = next ? "round_robin" : "fallback";
      setStrategyState(resolved);
      save({
        strategy: resolved,
        rotateCount,
        maxInflight,
        bypassProxy,
        assignedPoolId,
        userAgent,
        creditLimitEnabled,
        creditLimit,
      });
    },
    rotateCount,
    setRotateCount: (next) => {
      setRotateCountState(next);
      scheduleRotateCountSave(next);
    },
  };
}
