import { eq } from "drizzle-orm";
import type { CartethyiaDatabase } from "./postgres";
import { consoleSettings } from "./schema";
import type { ConsoleSettingsPreferences } from "./schema";
import { TtlCache } from "../runtime/ttl-cache";
import { currentSettingsRevision } from "./settings-revision";

/**
 * Preference readers for tenant runtime settings. Cached reads are bounded by
 * tenant and revision so mutations converge without unbounded memory.
 */

/** One tenant's preferences row, or null when never configured. */
export interface PreferencesReader {
  readPreferences(tenantId: string): Promise<ConsoleSettingsPreferences | null>;
}

/** Postgres-backed preferences read. */
export class DrizzlePreferencesReader implements PreferencesReader {
  constructor(private readonly db: CartethyiaDatabase) {}

  async readPreferences(tenantId: string): Promise<ConsoleSettingsPreferences | null> {
    const rows = await this.db
      .select({ preferences: consoleSettings.preferences })
      .from(consoleSettings)
      .where(eq(consoleSettings.tenantId, tenantId))
      .limit(1);
    return rows[0]?.preferences ?? null;
  }
}

export interface CachedPreferencesReaderOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly revision?: () => number;
  readonly now?: () => number;
}

/**
 * Revision-keyed cache over any `PreferencesReader`. A settings mutation bumps
 * the revision, which changes every key — so cached reads converge instantly
 * without waiting out the TTL.
 */
export class CachedPreferencesReader implements PreferencesReader {
  private readonly cache: TtlCache<ConsoleSettingsPreferences | null>;
  private readonly revision: () => number;

  constructor(
    private readonly inner: PreferencesReader,
    opts: CachedPreferencesReaderOptions = {},
  ) {
    this.revision = opts.revision ?? currentSettingsRevision;
    this.cache = new TtlCache<ConsoleSettingsPreferences | null>({
      ttlMs: opts.ttlMs ?? 5_000,
      maxEntries: opts.maxEntries ?? 128,
      now: opts.now ?? Date.now,
    });
  }

  async readPreferences(tenantId: string): Promise<ConsoleSettingsPreferences | null> {
    const cacheKey = `${tenantId}:${this.revision()}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const prefs = await this.inner.readPreferences(tenantId);
    this.cache.set(cacheKey, prefs);
    return prefs;
  }

  /** Test seam: drops all cached entries. */
  clear(): void {
    this.cache.clear();
  }
}


export { currentSettingsRevision, bumpSettingsRevision } from "./settings-revision";
