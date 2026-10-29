/**
 * Response Cache Engine (9Router Pro parity).
 *
 * Provides exact replays for identical non-streaming chat completions.
 * Non-streaming requests without tool-calls are deterministic candidates for
 * caching. Caching them avoids redundant upstream calls, saving quota and
 * delivering instant 0ms responses.
 */
import { createHash } from "node:crypto";

export interface ResponseCacheConfig {
  readonly enabled?: boolean;
  readonly ttlSeconds?: number;
  readonly maxEntries?: number;
}

export interface CachedResponseEntry {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ResponseCacheStats {
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
}

const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_MAX_ENTRIES = 2000;

export class ResponseCache {
  private readonly store = new Map<string, CachedResponseEntry>();
  private hitsCount = 0;
  private missesCount = 0;

  /**
   * Deterministic recursive JSON stringification with sorted keys.
   */
  static stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => ResponseCache.stableStringify(v)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${ResponseCache.stableStringify(record[k])}`).join(",")}}`;
  }

  /**
   * Builds a canonical SHA-256 cache key for eligible requests.
   * Excludes `stream` and metadata from the hash.
   * Returns null if the request is not cacheable (streaming, tools, or invalid).
   */
  static buildCacheKey(body: unknown): string | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const b = body as Record<string, unknown>;
    // Streaming responses pass through untouched
    if (b["stream"] === true) return null;
    // Tool calls and functions must never be cached (stateful)
    if (b["tools"] || b["tool_choice"] || b["functions"] || b["function_call"]) return null;
    if (typeof b["model"] !== "string" || b["model"].length === 0) return null;
    if (!Array.isArray(b["messages"]) || b["messages"].length === 0) return null;

    // Filter out volatile or transport-only fields
    const { stream: _stream, user: _user, metadata: _meta, ...normalized } = b;
    const canonicalString = ResponseCache.stableStringify(normalized);
    return createHash("sha256").update(canonicalString).digest("hex");
  }

  get(key: string): CachedResponseEntry | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.missesCount++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missesCount++;
      return null;
    }
    this.hitsCount++;
    return entry;
  }

  put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    maxEntries = DEFAULT_MAX_ENTRIES,
  ): void {
    const now = Date.now();
    const effectiveTtl = Math.max(1, ttlSeconds);
    const expiresAt = now + effectiveTtl * 1000;

    // Prune if store reaches capacity
    if (this.store.size >= maxEntries) {
      const pruneBatch = Math.max(1, Math.floor(maxEntries * 0.2));
      let count = 0;
      for (const [k, v] of this.store) {
        if (now > v.expiresAt || count < pruneBatch) {
          this.store.delete(k);
          count++;
        }
      }
    }

    this.store.set(key, {
      bytes,
      contentType,
      createdAt: now,
      expiresAt,
    });
  }

  clear(): void {
    this.store.clear();
    this.hitsCount = 0;
    this.missesCount = 0;
  }

  getStats(): ResponseCacheStats {
    // Prune expired on stat read
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) {
        this.store.delete(k);
      }
    }
    return {
      size: this.store.size,
      hits: this.hitsCount,
      misses: this.missesCount,
    };
  }
}

/** Global shared instance in router memory. */
export const globalResponseCache = new ResponseCache();
