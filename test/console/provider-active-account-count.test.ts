/**
 * `listProviders` must report how many *active* credentials each provider
 * holds.
 *
 * The usage topology renders one node per provider and labels it with that
 * count, so the number has to come from the catalog response rather than a
 * hardcoded map in the dashboard. Two properties matter:
 *
 * - Only `active` accounts count. A `disabled`/`expired`/`cooldown` row must
 *   not make a provider look dispatchable when it has no usable credential.
 * - The count is per provider. A tenant with 191 grok accounts and 4 codebuddy
 *   accounts must not report one number for both, and a provider with no
 *   accounts reports `0` rather than being omitted (the dashboard needs the
 *   explicit zero to distinguish "no keys" from "unknown provider").
 */
import { describe, expect, test } from "bun:test";
import { createProviderCatalogOperations } from "../../src/console/providers/catalog/provider-operations";
import type {
  ProviderAccountResponse,
  ProviderCatalogStore,
  ProviderRecord,
} from "../../src/console/providers/catalog/contracts";
import type { AccessDecision } from "../../src/security/access-control";
import type { ProviderRegistry } from "../../src/providers/provider-registry";

const TENANT = "tenant-active-count";

function record(providerId: string, requiresAccount = true): ProviderRecord {
  return {
    providerId,
    displayName: providerId,
    enabled: true,
    isBuiltIn: true,
    requiresAccount,
    supportsModelDiscovery: true,
    tenantId: TENANT,
  };
}

/** Minimal account row: only the fields `listProviders` reads. */
function account(providerId: string, status: string): ProviderAccountResponse {
  return { providerId, status } as ProviderAccountResponse;
}

/** In-memory store; only the two methods `listProviders` calls are exercised. */
function storeOf(
  records: readonly ProviderRecord[],
  accounts: readonly ProviderAccountResponse[],
): ProviderCatalogStore {
  return {
    list: async () => records,
    listAllAccounts: async () => accounts,
  } as unknown as ProviderCatalogStore;
}

/** Registry with no OAuth client, so capability attachment stays trivial. */
const registry = {
  resolveModelDiscovery: async () => undefined,
  resolveLoginClient: async () => undefined,
} as unknown as ProviderRegistry;

const access: AccessDecision = {
  id: "test-key",
  tenantId: TENANT,
  scopes: ["providers:read"],
  admissionIdentity: "test-key",
};

function listProviders(store: ProviderCatalogStore) {
  return createProviderCatalogOperations({
    store,
    accessResolver: () => access,
    providerRegistry: registry,
  }).listProviders(access);
}

describe("provider catalog active account counts", () => {
  test("counts only active accounts per provider", async () => {
    const providers = await listProviders(
      storeOf(
        [record("grok"), record("cb"), record("kiro")],
        [
          ...Array.from({ length: 3 }, () => account("grok", "active")),
          account("grok", "disabled"),
          account("grok", "expired"),
          ...Array.from({ length: 2 }, () => account("cb", "active")),
          account("kiro", "cooldown"),
        ],
      ),
    );

    const byId = new Map(providers.map((p) => [p.providerId, p.activeAccountCount]));
    expect(byId.get("grok")).toBe(3);
    expect(byId.get("cb")).toBe(2);
    // A provider whose only account is unusable still reports an explicit 0.
    expect(byId.get("kiro")).toBe(0);
  });

  test("reports 0 for a provider with no accounts", async () => {
    const providers = await listProviders(storeOf([record("dahl")], []));
    expect(providers[0]?.activeAccountCount).toBe(0);
    expect(providers[0]?.configured).toBe(false);
  });

  test("marks configured when any account exists, active or not", async () => {
    const providers = await listProviders(
      storeOf([record("kiro")], [account("kiro", "expired")]),
    );
    expect(providers[0]?.configured).toBe(true);
    expect(providers[0]?.activeAccountCount).toBe(0);
  });
});
