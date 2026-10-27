import { describe, expect, test } from "bun:test";
import { createQuotaEgressFetcher } from "../../src/console/quota/account-test-egress";
import { NetworkPoolSelector } from "../../src/network/pool/selector";
import { networkPools, poolRoutingSettings, providerRoutingSettings } from "../../src/persistence/schema";

function database(rows: {
  readonly routing?: readonly { tenantId: string | null; bypassProxy: boolean | null; assignedPoolId: string | null }[];
  readonly pools?: readonly { id: string; maxInflight: number | null; weight: number | null }[];
  readonly poolRouting?: readonly { strategy: "least_loaded" | "round_robin"; rotateCount: number | null }[];
}) {
  return {
    select() {
      return {
        from(table: unknown) {
          const result =
            table === providerRoutingSettings
              ? rows.routing ?? []
              : table === networkPools
                ? rows.pools ?? []
                : table === poolRoutingSettings
                  ? rows.poolRouting ?? []
                  : [];
          return {
            where() { return this; },
            limit() { return Promise.resolve(result); },
            then(resolve: (value: typeof result) => unknown) { return Promise.resolve(result).then(resolve); },
          };
        },
      };
    },
  };
}

describe("quota egress", () => {
  test("uses the dispatch-selected pool and releases its slot after a quota request", async () => {
    const selector = new NetworkPoolSelector();
    const calls: string[] = [];
    const fetcher = createQuotaEgressFetcher({
      db: database({
        routing: [{ tenantId: "tenant-a", bypassProxy: false, assignedPoolId: "pool-b" }],
        pools: [
          { id: "pool-a", maxInflight: 1, weight: 100 },
          { id: "pool-b", maxInflight: 1, weight: 100 },
        ],
        poolRouting: [{ strategy: "round_robin", rotateCount: 1 }],
      }) as never,
      poolSelector: selector,
      networkBindingFactory: {
        fetch(poolId?: string) {
          return async () => {
            calls.push(poolId ?? "direct");
            return new Response("ok");
          };
        },
      } as never,
    });

    await (await fetcher("account-a", "tenant-a", "provider-a"))("https://quota.example.test");

    expect(calls).toEqual(["pool-b"]);
    expect(selector.getInflight("pool-b")).toBe(0);
  });

  test("bypasses pools when dispatch bypass is enabled", async () => {
    const calls: string[] = [];
    const fetcher = createQuotaEgressFetcher({
      db: database({
        routing: [{ tenantId: "tenant-a", bypassProxy: true, assignedPoolId: null }],
        pools: [{ id: "pool-a", maxInflight: 1, weight: 100 }],
      }) as never,
      poolSelector: new NetworkPoolSelector(),
      networkBindingFactory: {
        fetch(poolId?: string) {
          return async () => {
            calls.push(poolId ?? "direct");
            return new Response("ok");
          };
        },
      } as never,
    });

    await (await fetcher("account-a", "tenant-a", "provider-a"))("https://quota.example.test");

    expect(calls).toEqual(["direct"]);
  });
});
