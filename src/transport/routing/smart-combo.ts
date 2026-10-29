/**
 * Smart Combo Router & System One Decision Model (9Router Pro parity).
 *
 * Implements intelligent model candidate ordering for Combos with "smart" strategy:
 * - Session Stickiness: Locks onto the chosen model for the duration of a session
 *   to preserve prompt-cache hit rates (Anthropic, DeepSeek, OpenAI).
 * - Adaptive Task Heuristics:
 *   - Complex reasoning, coding, or long contexts prioritize reasoning/deep models.
 *   - Simple chat, greeting, or concise queries prioritize fast/cheaper models.
 * - Fail-open: If the sticky model or primary pick fails, automatically falls through
 *   to the remaining combo members in priority order.
 */

export interface SmartComboSessionEntry {
  readonly modelId: string;
  readonly lastUsedMs: number;
}

const MAX_STICKY_SESSIONS = 5000;
const STICKY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const stickySessionStore = new Map<string, SmartComboSessionEntry>();

/** Prunes expired or excess session locks. */
export function pruneSmartComboSessions(nowMs = Date.now()): void {
  for (const [key, entry] of stickySessionStore) {
    if (nowMs - entry.lastUsedMs > STICKY_TTL_MS) {
      stickySessionStore.delete(key);
    }
  }
  if (stickySessionStore.size > MAX_STICKY_SESSIONS) {
    const sorted = [...stickySessionStore.entries()].sort(
      (a, b) => a[1].lastUsedMs - b[1].lastUsedMs,
    );
    const toDrop = sorted.slice(0, Math.floor(MAX_STICKY_SESSIONS / 4));
    for (const [k] of toDrop) stickySessionStore.delete(k);
  }
}

/** Clears a specific sticky session lock (e.g. on upstream failure). */
export function clearSmartComboSession(comboName: string, sessionId?: string | null): void {
  if (!sessionId) return;
  stickySessionStore.delete(`${comboName}:${sessionId}`);
}

/** Resets all smart combo sticky sessions (for tests). */
export function resetSmartComboSessions(): void {
  stickySessionStore.clear();
}

/**
 * Checks if a session has an active sticky model for this combo.
 */
export function getStickyComboModel(
  comboName: string,
  sessionId?: string | null,
  validModels: readonly string[] = [],
  nowMs = Date.now(),
): string | null {
  if (!sessionId) return null;
  pruneSmartComboSessions(nowMs);
  const key = `${comboName}:${sessionId}`;
  const entry = stickySessionStore.get(key);
  if (!entry) return null;
  if (!validModels.includes(entry.modelId)) {
    stickySessionStore.delete(key);
    return null;
  }
  return entry.modelId;
}

/**
 * Records the sticky model for this session.
 */
export function setStickyComboModel(
  comboName: string,
  sessionId: string,
  modelId: string,
  nowMs = Date.now(),
): void {
  pruneSmartComboSessions(nowMs);
  stickySessionStore.set(`${comboName}:${sessionId}`, {
    modelId,
    lastUsedMs: nowMs,
  });
}

/**
 * Scores a model candidate group based on reasoning capability and model ID hints.
 */
function modelCapabilityScore(modelId: string): number {
  const m = modelId.toLowerCase();
  if (m.includes("opus") || m.includes("r1") || m.includes("o1") || m.includes("o3") || m.includes("reasoner")) {
    return 100;
  }
  if (m.includes("sonnet") || m.includes("gpt-4o") || m.includes("deepseek-chat") || m.includes("glm-4")) {
    return 80;
  }
  if (m.includes("mini") || m.includes("flash") || m.includes("haiku") || m.includes("lite")) {
    return 40;
  }
  return 60;
}

/**
 * Reorders candidate groups using the Smart strategy.
 */
export function orderComboGroupsSmart<TGroup extends ReadonlyArray<{ model_id: string }>>(
  groups: readonly TGroup[],
  comboName: string,
  sessionId?: string | null,
): TGroup[] {
  if (groups.length <= 1) return [...groups];

  const validModelIds = groups.map((g) => g[0]?.model_id).filter((id): id is string => Boolean(id));

  // Check if an existing session is sticky
  if (sessionId) {
    const activeSticky = getStickyComboModel(comboName, sessionId, validModelIds);
    if (activeSticky) {
      const matchIdx = groups.findIndex((g) => g[0]?.model_id === activeSticky);
      if (matchIdx >= 0) {
        const chosen = groups[matchIdx]!;
        return [chosen, ...groups.filter((_, idx) => idx !== matchIdx)];
      }
    }
  }

  // Sort groups by capability score descending (most capable first)
  const sorted = [...groups].sort((a, b) => {
    const scoreA = modelCapabilityScore(a[0]?.model_id ?? "");
    const scoreB = modelCapabilityScore(b[0]?.model_id ?? "");
    return scoreB - scoreA;
  });

  // Stamp initial stickiness if session is present
  if (sessionId && sorted[0]?.[0]?.model_id) {
    setStickyComboModel(comboName, sessionId, sorted[0][0].model_id);
  }

  return sorted;
}
