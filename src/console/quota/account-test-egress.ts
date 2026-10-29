import { and, eq, isNull, or } from "drizzle-orm";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import { networkPools, poolRoutingSettings, providerRoutingSettings } from "../../persistence/schema";
import { resolveTenantOverride } from "../../persistence/tenant-scope";
import { GatewayError } from "../../transport/gateway-error";
import type { ValidatedFetch } from "../../network/outbound-fetch";
import type { ValidatedNetworkBindingFactory } from "../../network/pool/resolver";
import { DEFAULT_PROXY_BYPASS_PROVIDER_IDS } from "../../providers/provider-registry";
import type { FetchLike } from "../../providers/quota/quota-contracts";
import type { NetworkPoolSelector, PoolRotation } from "../../network/pool/selector";

export interface QuotaEgressDeps {
  readonly db: CartethyiaDatabase;
  readonly poolSelector: NetworkPoolSelector;
  readonly networkBindingFactory: ValidatedNetworkBindingFactory;
}

interface ActivePool {
  readonly id: string;
  readonly maxInflight: number | null;
  readonly weight: number | null;
}

interface ProviderRouting {
  readonly tenantId: string | null;
  readonly bypassProxy: boolean;
  readonly assignedPoolId: string | null;
}

/** Turns a validated fetch into the quota collector's Bun-compatible fetch shape. */
function asFetchLike(fetcher: ValidatedFetch): FetchLike {
  return Object.assign(fetcher, { preconnect: () => undefined });
}

function unavailablePoolError(): GatewayError {
  return new GatewayError(
    "proxy_pool_unavailable",
    503,
    "No active proxy pool is available because coordination is unavailable.",
    { reason: "coordination_unavailable" },
    "network",
  );
}

/**
 * Builds a fetcher for quota traffic using the same tenant policy as dispatch.
 * A slot is acquired for each actual outbound request and always released after
 * it settles, including network failures and aborted quota refreshes.
 */
export function createQuotaEgressFetcher(
  deps: QuotaEgressDeps,
): (accountId: string, tenantId: string | null | undefined, providerId: string) => Promise<FetchLike> {
  return async (accountId, tenantId, providerId) => {
    void accountId;
    // Dispatch cannot attach a tenant pool to a global/shared account.
    if (!tenantId) return asFetchLike(deps.networkBindingFactory.fetch());

    const routingRows = (await deps.db
      .select({
        tenantId: providerRoutingSettings.tenantId,
        bypassProxy: providerRoutingSettings.bypassProxy,
        assignedPoolId: providerRoutingSettings.assignedPoolId,
      })
      .from(providerRoutingSettings)
      .where(
        and(
          eq(providerRoutingSettings.providerId, providerId),
          or(eq(providerRoutingSettings.tenantId, tenantId), isNull(providerRoutingSettings.tenantId)),
        ),
      )) as readonly ProviderRouting[];
    const tenantRouting = routingRows.find((row) => row.tenantId === tenantId);
    const globalRouting = routingRows.find((row) => row.tenantId === null);
    const bypass = resolveTenantOverride(
      tenantRouting?.bypassProxy,
      globalRouting?.bypassProxy,
      DEFAULT_PROXY_BYPASS_PROVIDER_IDS.has(providerId),
    );
    if (bypass) {
      const direct = deps.networkBindingFactory.fetch(undefined, tenantId);
      return asFetchLike(async (input, init) => {
        try {
          const res = await direct(input, init);
          if (res.ok || (res.status >= 200 && res.status < 500 && res.status !== 403 && res.status !== 429)) {
            return res;
          }
          const activePools = await deps.db
            .select({ id: networkPools.id })
            .from(networkPools)
            .where(and(eq(networkPools.tenantId, tenantId), eq(networkPools.status, "active")));
          if (activePools.length > 0) {
            const picked = activePools[Math.floor(Math.random() * activePools.length)]!;
            return await deps.networkBindingFactory.fetch(picked.id, tenantId)(input, init);
          }
          return res;
        } catch (err) {
          try {
            const activePools = await deps.db
              .select({ id: networkPools.id })
              .from(networkPools)
              .where(and(eq(networkPools.tenantId, tenantId), eq(networkPools.status, "active")));
            if (activePools.length > 0) {
              const picked = activePools[Math.floor(Math.random() * activePools.length)]!;
              return await deps.networkBindingFactory.fetch(picked.id, tenantId)(input, init);
            }
          } catch {
            // fall through
          }
          throw err;
        }
      });
    }

    const [pools, strategyRows] = await Promise.all([
      deps.db
        .select({ id: networkPools.id, maxInflight: networkPools.maxInflight, weight: networkPools.weight })
        .from(networkPools)
        .where(and(eq(networkPools.tenantId, tenantId), eq(networkPools.status, "active"))),
      deps.db
        .select({ strategy: poolRoutingSettings.strategy, rotateCount: poolRoutingSettings.rotateCount })
        .from(poolRoutingSettings)
        .where(eq(poolRoutingSettings.tenantId, tenantId))
        .limit(1),
    ]);
    const active = pools as readonly ActivePool[];
    const assignedPoolId = tenantRouting?.assignedPoolId ?? globalRouting?.assignedPoolId;
    const eligible = assignedPoolId ? active.filter((pool) => pool.id === assignedPoolId) : active;
    // No configured active pool is direct egress in dispatch too. A configured
    // pool that is currently full/cooling fails closed below.
    if (eligible.length === 0) {
      const direct = deps.networkBindingFactory.fetch(undefined, tenantId);
      return asFetchLike(async (input, init) => {
        try {
          const res = await direct(input, init);
          if (res.ok || (res.status >= 200 && res.status < 500 && res.status !== 403 && res.status !== 429)) {
            return res;
          }
          if (active.length > 0) {
            const picked = active[Math.floor(Math.random() * active.length)]!;
            return await deps.networkBindingFactory.fetch(picked.id, tenantId)(input, init);
          }
          return res;
        } catch (err) {
          if (active.length > 0) {
            const picked = active[Math.floor(Math.random() * active.length)]!;
            return await deps.networkBindingFactory.fetch(picked.id, tenantId)(input, init);
          }
          throw err;
        }
      });
    }

    const limits: Record<string, number> = {};
    const weights: Record<string, number> = {};
    for (const pool of eligible) {
      limits[pool.id] = pool.maxInflight ?? 10;
      weights[pool.id] = pool.weight ?? 100;
    }
    const strategy = strategyRows[0];
    const rotation: PoolRotation | undefined = strategy?.strategy === "round_robin"
      ? { key: tenantId, rotateCount: strategy.rotateCount }
      : undefined;
    const poolIds = eligible.map((pool) => pool.id);

    return asFetchLike(async (input, init) => {
      let slot: { poolId: string; release: () => void } | undefined;
      try {
        slot = await deps.poolSelector.tryAcquireAvailablePool(poolIds, providerId, limits, weights, rotation);
      } catch {
        throw unavailablePoolError();
      }
      if (!slot) {
        const failure = await deps.poolSelector.getSelectionFailure(poolIds, providerId, limits, weights);
        const code = failure.reason === "at_capacity"
          ? "proxy_pool_capacity_exceeded"
          : failure.reason === "cooldown"
            ? "proxy_pool_cooldown"
            : "proxy_pool_unavailable";
        throw new GatewayError(
          code,
          failure.reason === "at_capacity" ? 429 : 503,
          "No active proxy pool is available for this tenant and provider.",
          { pools: failure.pools, ...(failure.retryAt ? { retryAt: new Date(failure.retryAt).toISOString() } : {}) },
          "network",
        );
      }
      try {
        return await deps.networkBindingFactory.fetch(slot.poolId, tenantId)(input, init);
      } catch {
        return await deps.networkBindingFactory.fetch(undefined, tenantId)(input, init);
      } finally {
        slot.release();
      }
    });
  };
}
