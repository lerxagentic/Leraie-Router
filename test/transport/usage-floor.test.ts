import { describe, expect, test } from "bun:test";
import type { ProviderQuotaWindow } from "../../src/providers/quota/quota-contracts";
import { belowUsageFloor, resolveUsageFloor } from "../../src/transport/routing/usage-floor";

function window(overrides: Partial<ProviderQuotaWindow>): ProviderQuotaWindow {
  return {
    kind: "credit",
    label: "Credit",
    usedPercent: null,
    remainingPercent: null,
    resetsAt: null,
    ...overrides,
  };
}

/** The real shape a WorkBuddy account reports: monthly spent, bonus pack left. */
const workbuddyAtZeroMonthly = [
  window({
    kind: "quota:monthly",
    label: "Monthly",
    accounting: "independent",
    usedPercent: 100,
    remainingPercent: 0,
    used: 100,
    limit: 100,
    recurring: true,
  }),
  window({
    kind: "bonus:1",
    label: "Bonus Pack 1",
    accounting: "pooled",
    usedPercent: 38.4,
    remainingPercent: 61.6,
    used: 96,
    limit: 250,
    recurring: false,
  }),
];

describe("usage floor", () => {
  test("no policy means routing is unchanged", () => {
    expect(belowUsageFloor(undefined, workbuddyAtZeroMonthly)).toBe(false);
    expect(belowUsageFloor({ floor: null, unit: "percent" }, workbuddyAtZeroMonthly)).toBe(false);
  });

  test("an exhausted independent window does not park an account with bonus credit", () => {
    // This is the live WorkBuddy case: monthly at 0%, bonus pack at 61.6%.
    // Excluding on the monthly window would take working accounts out of service.
    expect(belowUsageFloor({ floor: 20, unit: "percent" }, workbuddyAtZeroMonthly)).toBe(false);
  });

  test("percent mode compares the pooled balance", () => {
    // 154/250 = 61.6% remaining.
    expect(belowUsageFloor({ floor: 70, unit: "percent" }, workbuddyAtZeroMonthly)).toBe(true);
    expect(belowUsageFloor({ floor: 60, unit: "percent" }, workbuddyAtZeroMonthly)).toBe(false);
  });

  test("credit mode compares the pooled absolute remaining", () => {
    // 250 - 96 = 154 credits left.
    expect(belowUsageFloor({ floor: 200, unit: "credit" }, workbuddyAtZeroMonthly)).toBe(true);
    expect(belowUsageFloor({ floor: 100, unit: "credit" }, workbuddyAtZeroMonthly)).toBe(false);
  });

  test("exactly at the floor is excluded: the floor is a minimum to keep", () => {
    expect(belowUsageFloor({ floor: 154, unit: "credit" }, workbuddyAtZeroMonthly)).toBe(true);
  });

  test("a fully spent pooled balance is excluded", () => {
    const spent = [
      window({ accounting: "pooled", remaining: 0, limit: 250, usedPercent: 100 }),
    ];
    expect(belowUsageFloor({ floor: 1, unit: "credit" }, spent)).toBe(true);
  });

  test("an account with no reading is never excluded", () => {
    expect(belowUsageFloor({ floor: 500, unit: "credit" }, [])).toBe(false);
    expect(belowUsageFloor({ floor: 500, unit: "credit" }, undefined)).toBe(false);
    // Only independent windows: there is no pooled balance to compare.
    expect(
      belowUsageFloor({ floor: 50, unit: "percent" }, [
        window({ accounting: "independent", remainingPercent: 10 }),
      ]),
    ).toBe(false);
  });

  test("percent mode reads a utilization-only window that states no absolute numbers", () => {
    // The OAuth rate-limit shape: `remainingPercent` and nothing else. Before
    // this fallback the floor was silently inert for every such provider —
    // `pooledRemainingPercent` returns null without an absolute limit, and the
    // old code treated that null as "cannot judge" rather than "read the percent".
    const utilizationOnly = [
      window({ accounting: "pooled", usedPercent: 100, remainingPercent: 0 }),
    ];
    expect(belowUsageFloor({ floor: 10, unit: "percent" }, utilizationOnly)).toBe(true);
    expect(belowUsageFloor({ floor: 0, unit: "percent" }, utilizationOnly)).toBe(true);
  });

  test("the utilization fallback takes the lowest pooled window", () => {
    // A floor promises an allowance is kept back, so the window closest to empty
    // is the one that decides.
    const windows = [
      window({ accounting: "pooled", remainingPercent: 80 }),
      window({ accounting: "pooled", remainingPercent: 5 }),
    ];
    expect(belowUsageFloor({ floor: 10, unit: "percent" }, windows)).toBe(true);
    expect(belowUsageFloor({ floor: 4, unit: "percent" }, windows)).toBe(false);
  });

  test("the utilization fallback still ignores independent windows", () => {
    // An exhausted independent window is its own budget; the pooled-only rule
    // above must not be undone by the new fallback.
    const windows = [window({ accounting: "independent", remainingPercent: 0 })];
    expect(belowUsageFloor({ floor: 50, unit: "percent" }, windows)).toBe(false);
  });

  test("an absolute pooled balance outranks the reported percent", () => {
    // Both readings present and disagreeing: the absolute one is derived from the
    // same numbers the credit mode uses, so it stays authoritative.
    const windows = [
      window({ accounting: "pooled", remaining: 10, limit: 100, remainingPercent: 90 }),
    ];
    expect(belowUsageFloor({ floor: 20, unit: "percent" }, windows)).toBe(true);
  });

  test("resolveUsageFloor prefers the tenant row over the global row", () => {
    expect(
      resolveUsageFloor(
        { usageFloor: 10, usageFloorUnit: "percent" },
        { usageFloor: 500, usageFloorUnit: "credit" },
      ),
    ).toEqual({ floor: 10, unit: "percent" });
  });

  test("resolveUsageFloor falls back to the global row, then to no policy", () => {
    expect(resolveUsageFloor(undefined, { usageFloor: 500, usageFloorUnit: "credit" })).toEqual({
      floor: 500,
      unit: "credit",
    });
    expect(resolveUsageFloor(undefined, undefined)).toBeUndefined();
    expect(resolveUsageFloor({ usageFloor: null }, undefined)).toBeUndefined();
  });

  test("an unconfigured unit defaults to percent", () => {
    expect(resolveUsageFloor({ usageFloor: 15 }, undefined)).toEqual({ floor: 15, unit: "percent" });
  });
});
