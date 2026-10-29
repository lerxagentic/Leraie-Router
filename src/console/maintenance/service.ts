/**
 * Database Maintenance Engine (9Router Pro parity).
 *
 * Prunes old per-request telemetry events and expired cache entries.
 * Aggregates and quota counters are kept forever.
 */
import type { CartethyiaDatabase } from "../../persistence/postgres";
import { telemetryEvents, consoleSettings } from "../../persistence/schema";
import { eq, lt, and, sql } from "drizzle-orm";
import { globalResponseCache } from "../../transport/cache/response-cache";

const DAY_MS = 24 * 3600 * 1000;

export interface MaintenanceResult {
  readonly cutoff: string;
  readonly prunedTelemetry: number;
  readonly prunedCache: number;
  readonly vacuum: string;
  readonly ranAt: string;
}

export interface MaintenanceConfig {
  readonly enabled?: boolean;
  readonly retentionDays?: number;
  readonly lastRunAt?: string | null;
  readonly lastResult?: MaintenanceResult | null;
}

export async function runDatabaseMaintenance(
  db: CartethyiaDatabase,
  tenantId: string,
  options: { retentionDays?: number } = {},
): Promise<MaintenanceResult> {
  const retention = Math.max(1, options.retentionDays ?? 90);
  const cutoffDate = new Date(Date.now() - retention * DAY_MS);
  const now = new Date().toISOString();

  // 1. Prune old telemetry events
  let prunedTelemetry = 0;
  try {
    const deleted = await db
      .delete(telemetryEvents)
      .where(
        and(
          eq(telemetryEvents.tenantId, tenantId),
          lt(telemetryEvents.createdAt, cutoffDate),
        ),
      )
      .returning({ id: telemetryEvents.id });
    prunedTelemetry = deleted.length;
  } catch (err) {
    // If returning is unsupported or fails, fall back to safe delete
    try {
      await db
        .delete(telemetryEvents)
        .where(
          and(
            eq(telemetryEvents.tenantId, tenantId),
            lt(telemetryEvents.createdAt, cutoffDate),
          ),
        );
    } catch {
      // ignore
    }
  }

  // 2. Prune in-memory response cache
  const cacheStatsBefore = globalResponseCache.getStats();
  // Getting stats already prunes expired items
  const cacheStatsAfter = globalResponseCache.getStats();
  const prunedCache = Math.max(0, cacheStatsBefore.size - cacheStatsAfter.size);

  // 3. Optional vacuum attempt
  let vacuum = "skipped";
  try {
    await db.execute(sql`VACUUM ANALYZE telemetry_events`);
    vacuum = "done";
  } catch {
    vacuum = "skipped";
  }

  const result: MaintenanceResult = {
    cutoff: cutoffDate.toISOString(),
    prunedTelemetry,
    prunedCache,
    vacuum,
    ranAt: now,
  };

  // 4. Update consoleSettings preferences
  try {
    const [row] = await db
      .select({ preferences: consoleSettings.preferences })
      .from(consoleSettings)
      .where(eq(consoleSettings.tenantId, tenantId))
      .limit(1);
    const prefs = (row?.preferences as Record<string, unknown>) ?? {};
    const existingMaint = (prefs["dbMaintenance"] as Record<string, unknown>) ?? {};
    const nextPrefs = {
      ...prefs,
      dbMaintenance: {
        ...existingMaint,
        retentionDays: retention,
        lastRunAt: now,
        lastResult: result as unknown as Record<string, unknown>,
      },
    };
    await db
      .insert(consoleSettings)
      .values({ tenantId, preferences: nextPrefs as any })
      .onConflictDoUpdate({
        target: consoleSettings.tenantId,
        set: { preferences: nextPrefs as any, updatedAt: new Date() },
      });
  } catch {
    // ignore
  }

  return result;
}

export async function getMaintenanceConfig(
  db: CartethyiaDatabase,
  tenantId: string,
): Promise<MaintenanceConfig> {
  const [row] = await db
    .select({ preferences: consoleSettings.preferences })
    .from(consoleSettings)
    .where(eq(consoleSettings.tenantId, tenantId))
    .limit(1);
  const prefs = (row?.preferences as Record<string, unknown>) ?? {};
  const maint = (prefs["dbMaintenance"] as MaintenanceConfig) ?? {};
  return {
    enabled: maint.enabled ?? true,
    retentionDays: maint.retentionDays ?? 90,
    lastRunAt: maint.lastRunAt ?? null,
    lastResult: maint.lastResult ?? null,
  };
}
