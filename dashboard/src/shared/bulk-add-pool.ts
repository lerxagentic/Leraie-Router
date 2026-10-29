/**
 * Bounded Concurrency Worker Pool for Bulk Add API Keys (9Router Pro parity).
 *
 * Overlaps up to 6 workers concurrently to validate and insert keys in parallel
 * without stalling browser UI or overwhelming connection limits.
 */

export interface BulkAddEntry {
  readonly name: string;
  readonly apiKey: string;
  readonly providerSpecificData?: Record<string, unknown> | undefined;
}

export interface BulkPoolProgress {
  readonly done: number;
  readonly total: number;
  readonly current: string;
  readonly success: number;
  readonly failed: number;
}

export function planBulkAdd(
  lines: readonly string[],
  existingNames: readonly string[] = [],
): BulkAddEntry[] {
  const used = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const out: BulkAddEntry[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("|");
    let base = "Key";
    let apiKey = "";

    if (parts.length >= 2) {
      base = parts[0]?.trim() || "Key";
      apiKey = parts.slice(1).join("|").trim();
    } else {
      apiKey = parts[0]?.trim() || "";
    }
    if (!apiKey) continue;

    let idx = 1;
    let name = "";
    for (;;) {
      name = `${base} ${idx}`;
      if (!used.has(name.toLowerCase())) break;
      idx += 1;
    }
    used.add(name.toLowerCase());
    out.push({ name, apiKey });
  }

  return out;
}

export async function runBulkPool(
  entries: readonly BulkAddEntry[],
  worker: (entry: BulkAddEntry) => Promise<boolean>,
  opts: {
    readonly concurrency?: number;
    readonly onProgress?: (p: BulkPoolProgress) => void;
  } = {},
): Promise<{ success: number; failed: number }> {
  const { concurrency = 6, onProgress } = opts;
  const total = entries.length;
  let success = 0;
  let failed = 0;
  let done = 0;
  let next = 0;

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, total)) },
    async () => {
      while (next < total) {
        const entry = entries[next++];
        if (!entry) break;
        let ok = false;
        try {
          ok = (await worker(entry)) === true;
        } catch {
          ok = false;
        }
        if (ok) success++;
        else failed++;
        done++;
        if (onProgress) {
          onProgress({ done, total, current: entry.name, success, failed });
        }
      }
    },
  );

  await Promise.all(runners);
  return { success, failed };
}
