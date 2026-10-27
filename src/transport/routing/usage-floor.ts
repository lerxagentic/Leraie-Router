/**
 * Per-provider usage floor.
 *
 * An account whose remaining allowance is at or below its provider's floor is
 * excluded from routing, so the request fails over to the next account instead
 * of spending the last of a balance the operator wanted to keep. Two units:
 *
 * - `credit` compares the summed absolute remaining credit.
 * - `percent` compares that same pooled balance as a percentage.
 *
 * Only *pooled* windows count. A window classified `independent` is its own
 * quota — a 5-hour rate limit, or a monthly allowance that bonus credit
 * supplements — and an exhausted one does not mean the account cannot serve:
 * WorkBuddy accounts routinely sit at 0% monthly while their bonus packs carry
 * the traffic. Gating on those would take working accounts out of service.
 *
 * The floor is opt-in. With no floor configured, routing behaves exactly as it
 * did before this feature existed; a reading that was never fetched is likewise
 * unknown rather than exhausted, because excluding on absence would park a
 * healthy account merely because the quota sweep had not run yet.
 */
import {
  pooledRemainingCredit,
  pooledRemainingPercent,
  type ProviderQuotaWindow,
} from "../../providers/quota/quota-contracts";

export type UsageFloorUnit = "credit" | "percent";

export interface UsageFloorPolicy {
  /** Minimum remaining allowance to stay routable; `null` = no floor. */
  readonly floor: number | null;
  readonly unit: UsageFloorUnit;
}

/** The routing-setting fields the floor reads; absent rows are allowed. */
export interface UsageFloorSettingRow {
  readonly usageFloor?: number | null;
  readonly usageFloorUnit?: string | null;
}

/**
 * Resolves the effective floor: the tenant row wins over the global row, and an
 * unconfigured provider has no floor at all. An unconfigured unit defaults to
 * `percent`, the unit that works for providers that only report utilization.
 */
export function resolveUsageFloor(
  tenantSetting: UsageFloorSettingRow | undefined,
  globalSetting: UsageFloorSettingRow | undefined,
): UsageFloorPolicy | undefined {
  const floor = tenantSetting?.usageFloor ?? globalSetting?.usageFloor;
  if (floor === undefined || floor === null) return undefined;
  const unit = tenantSetting?.usageFloorUnit ?? globalSetting?.usageFloorUnit;
  return { floor, unit: unit === "credit" ? "credit" : "percent" };
}

/**
 * True when the account's pooled remaining allowance is at or below the floor.
 *
 * Returns `false` for every case the floor cannot judge — no policy, no reading,
 * or no pooled balance at all — so enabling the feature can only ever *skip* an
 * account the operator explicitly asked to keep back, never fail a request that
 * used to succeed.
 */
export function belowUsageFloor(
  policy: UsageFloorPolicy | undefined,
  windows: readonly ProviderQuotaWindow[] | undefined,
): boolean {
  if (policy === undefined || policy.floor === null) return false;
  if (windows === undefined || windows.length === 0) return false;
  const remaining =
    policy.unit === "credit" ? pooledRemainingCredit(windows) : pooledRemainingPercent(windows);
  if (remaining === null) return false;
  return remaining <= policy.floor;
}
