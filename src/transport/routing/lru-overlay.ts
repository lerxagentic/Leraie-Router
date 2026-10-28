/**
 * In-memory last-used overlay for balanced, collision-free account selection.
 * Ported from 9Router Pro (Gienetic).
 *
 * Prevents concurrent requests from piling onto the exact same account/token
 * before database state settles.
 */
const MAX_OVERLAY_ENTRIES = 10_000;
const PRUNE_AGE_MS = 60_000;

export const accountLastUsedOverlay = new Map<string, number>();

/** Stamps an account id as having just handled an attempt. */
export function stampAccountLastUsed(accountId: string | undefined, nowMs: number = Date.now()): void {
  if (!accountId || accountId.length === 0) return;
  accountLastUsedOverlay.set(accountId, nowMs);
  if (accountLastUsedOverlay.size > MAX_OVERLAY_ENTRIES) {
    const cutoff = nowMs - PRUNE_AGE_MS;
    for (const [id, timestamp] of accountLastUsedOverlay) {
      if (timestamp < cutoff) {
        accountLastUsedOverlay.delete(id);
      }
    }
  }
}

/** Sorts a list of candidates by least-recently-used in-memory timestamp ascending. */
export function sortCandidatesByLru<T extends { provider_account_id?: string | null }>(
  candidates: readonly T[],
): T[] {
  if (candidates.length <= 1) return [...candidates];
  return [...candidates].sort((a, b) => {
    const aTime = a.provider_account_id ? (accountLastUsedOverlay.get(a.provider_account_id) ?? 0) : 0;
    const bTime = b.provider_account_id ? (accountLastUsedOverlay.get(b.provider_account_id) ?? 0) : 0;
    return aTime - bTime;
  });
}
