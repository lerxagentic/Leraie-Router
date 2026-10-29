import { describe, it, expect, beforeEach } from "bun:test";
import {
  applyStickyRandomOrder,
  clearStickyAccount,
  resetAllStickyAccounts,
} from "../../src/transport/routing/lru-overlay";

describe("Sticky-Random routing strategy", () => {
  const accounts = [
    { provider_account_id: "acc_1", name: "Account 1" },
    { provider_account_id: "acc_2", name: "Account 2" },
    { provider_account_id: "acc_3", name: "Account 3" },
  ];
  const routeKey = "tenant1:anthropic:claude-3-5-sonnet";

  beforeEach(() => {
    resetAllStickyAccounts();
  });

  it("picks an account initially and sticks to it on subsequent calls", () => {
    const firstOrder = applyStickyRandomOrder(accounts, routeKey);
    const chosenId = firstOrder[0]!.provider_account_id;
    expect(chosenId).toBeDefined();

    // Next 10 calls must stick to the exact same chosen account
    for (let i = 0; i < 10; i++) {
      const nextOrder = applyStickyRandomOrder(accounts, routeKey);
      expect(nextOrder[0]!.provider_account_id).toBe(chosenId);
    }
  });

  it("re-rolls when the sticky account is cleared (e.g. failure)", () => {
    const firstOrder = applyStickyRandomOrder(accounts, routeKey);
    const chosenId = firstOrder[0]!.provider_account_id;

    // Simulate failure -> clear sticky lock
    clearStickyAccount(routeKey);

    // Remaining candidates without the failed account
    const remaining = accounts.filter((a) => a.provider_account_id !== chosenId);
    const reRollOrder = applyStickyRandomOrder(remaining, routeKey);
    expect(reRollOrder[0]!.provider_account_id).not.toBe(chosenId);
  });
});
