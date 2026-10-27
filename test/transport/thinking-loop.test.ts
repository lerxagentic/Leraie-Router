import { describe, expect, test } from "bun:test";
import {
  ThinkingLoopDetector,
} from "../../src/transport/dispatch/streaming/thinking-loop";

function feed(detector: ThinkingLoopDetector, text: string, chunk = 64): string | undefined {
  for (let i = 0; i < text.length; i += chunk) {
    const hit = detector.push(text.slice(i, i + chunk));
    if (hit !== undefined) return hit;
  }
  return detector.flush();
}

const HEALTHY_REASONING = [
  "Let me work through the caching layer first. The read path checks the LRU and falls back to the database when the key misses.",
  "The `cache.get(key)` call returns undefined on a miss, which the caller then treats as a cold read and repopulates from the origin.",
  "Next, I need to consider eviction. A write-heavy workload will thrash a small cache, so the size bound matters more than the TTL here.",
  "Looking at the migration, the index on `tenant_id` covers the lookup but not the sort, so the planner may still scan and sort in memory.",
  "I should verify whether the row estimate is stale. Autovacuum last ran overnight, so the statistics may not reflect today's inserts.",
  "Another angle: the retry wrapper swallows the connection error and retries three times, which multiplies the observed latency by four.",
  "That explains the timeout reports. The fix is to bound the retry budget and surface the first failure instead of hiding it.",
  "Then there is the connection pool. Twenty connections shared across eight workers means a slow query starves every other caller.",
  "The queue depth metric confirms it: it climbs steadily through the incident window and only drains after the deploy finishes.",
  "I will check the response shape the client expects, since a missing field would fail validation downstream rather than degrade.",
  "One more check: the tool result is truncated at eight kilobytes, which hides the tail of any long file the model asked to read.",
  "Reading the schema again, the foreign key on `sessions.tenant_id` has no index of its own, so cascade deletes walk the whole table.",
  "That would show up as a lock wait during cleanup, which matches the slow query log entries clustered around the maintenance window.",
  "So the plan is: bound the retry budget, raise the pool size for the migration job only, and add the missing index.",
  "Before I commit to that, I want to rule out the simpler explanation — that the client itself retries on a 502 and triples the load.",
  "The access log settles it: one request per client id in the window, so the multiplication is entirely server side and ours to fix.",
].join("\n\n");

describe("thinking-loop detector", () => {
  test("never fires on healthy reasoning (the happy-path pin)", () => {
    expect(HEALTHY_REASONING.length).toBeGreaterThan(2000);
    const detector = new ThinkingLoopDetector();
    expect(feed(detector, HEALTHY_REASONING)).toBeUndefined();
    expect(detector.detected).toBe(false);
  });

  test("fires on an exact repeated cycle and reports it idempotently", () => {
    const detector = new ThinkingLoopDetector();
    const first = feed(detector, "Let me reconsider. ".repeat(200));
    expect(first).toBeDefined();
    expect(detector.detected).toBe(true);
    expect(detector.push("Let me reconsider. ")).toBe(first);
    expect(detector.flush()).toBe(first);
  });

  test("fires on near-duplicate paraphrased segments", () => {
    const base =
      "I need to confirm that the response handling is complete before I move on to the next step, and that the rendering path stays safe for the caller to reuse across turns without leaking any state between them, because a leak here would corrupt the following request in ways that are very hard to reproduce later in the session lifecycle.";
    const drift = base.replace("stays safe", "remains safe");
    const varied = [
      "First I will check the cache layer, because a cold read here doubles the observed latency and masks the real problem.",
      "The migration added an index on tenant_id, which covers the lookup but leaves the sort ordering to the planner.",
      "Retry budgets matter: three retries on a connection error multiply the tail latency by four and hide the first failure.",
      "Autovacuum statistics may be stale, so the row estimate the planner uses could be far from today's actual row count.",
      "The caller swallows the error, so the client sees a timeout rather than the underlying validation failure.",
      "I should also confirm the response shape the client validates against, since one missing field fails the whole check.",
      "There is a second consideration: the tool result is truncated at eight kilobytes, which hides the tail of long output.",
      "Finally, the ordering guarantee matters only within a single partition, so cross-partition reads are not comparable.",
    ];
    const detector = new ThinkingLoopDetector();
    const stream = [...varied, base, drift, base, drift].join("\n\n") + "\n\n";
    expect(feed(detector, stream, 50)).toBeDefined();
    expect(detector.detected).toBe(true);
  });

  test("does not fire on a short legitimate repetition", () => {
    const detector = new ThinkingLoopDetector();
    expect(feed(detector, "Wait, let me re-read that. ".repeat(3))).toBeUndefined();
    expect(detector.detected).toBe(false);
  });

  test("disabled config reports nothing", () => {
    const detector = new ThinkingLoopDetector({ enabled: false });
    expect(feed(detector, "Let me reconsider. ".repeat(400))).toBeUndefined();
    expect(detector.detected).toBe(false);
  });
});
