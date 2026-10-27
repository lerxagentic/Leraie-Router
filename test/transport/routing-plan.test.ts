/**
 * Route planning: eligibility ordering, failover status codes, and combo
 * expansion.
 *
 * These pin the invariants `RoutingEngine.plan()` owes a caller, each of which
 * was previously unenforced — the suite had no test that called `plan()` at all,
 * which is how all of them survived:
 *
 * - a slow-lane account is deprioritized, never excluded (it still serves on
 *   spare capacity), and an all-slow pool still dials;
 * - an account already at its admission ceiling is tried behind one with room,
 *   because the gateway already knows the answer admission would give;
 * - a time-bounded exclusion answers 429 with the reset it actually observed,
 *   while an exclusion with no reset stays 503;
 * - provider round-robin rotation cannot undo any of that ordering;
 * - a combo naming one model twice is planned once.
 *
 * Every assertion names the account or model reached, not merely that a request
 * succeeded: "it worked" is compatible with dialing the wrong account.
 */
import { describe, expect, test } from "bun:test";
import { InMemoryAdmissionController } from "../../src/transport/routing/router";
import { resolveAliasTarget, RoutingEngine } from "../../src/transport/routing/router";
import { sharedClaudeSlowLanes } from "../../src/providers/integrations/claude/claude-slow-lane";
import type {
  RouteCandidate,
  RouteSnapshot,
} from "../../src/transport/routing/route-model";

function candidate(accountId: string, overrides: Record<string, unknown> = {}): RouteCandidate {
  return {
    provider_id: "p",
    model_id: "m",
    wire_family: "chat",
    endpoint: "/v1/chat/completions",
    capability_profile: {},
    provider_account_id: accountId,
    ...overrides,
  } as unknown as RouteCandidate;
}

function snapshot(
  candidates: readonly RouteCandidate[],
  overrides: Record<string, unknown> = {},
): RouteSnapshot {
  return {
    revision: 1,
    candidates,
    aliases: {},
    combos: {},
    created_at: Date.now(),
    ...overrides,
  } as unknown as RouteSnapshot;
}

/** Round-robin rotation with a one-request stride, so every plan advances. */
const ROTATING_PROVIDER = {
  __global__: {
    p: {
      strategy: "round_robin",
      rotateCount: 1,
      maxInflight: null,
      maxInflightPerProxy: null,
      usageFloor: null,
      usageFloorUnit: "percent",
      enabled: true,
      skipProxy: true,
    },
  },
};

const order = (plan: { candidates: readonly RouteCandidate[] }): (string | undefined)[] =>
  plan.candidates.map((entry) => entry.provider_account_id);

describe("slow-lane ordering", () => {
  test("a lane-active account is ordered behind a fresh sibling", async () => {
    const laneAccount = `slow-${crypto.randomUUID()}`;
    sharedClaudeSlowLanes.observe(laneAccount, {
      offer: "treatment",
      status: "active",
      unifiedLimitClaim: false,
      overageInUse: false,
      unifiedResetAtSec: Math.floor(Date.now() / 1000) + 3600,
    });
    const plan = await new RoutingEngine().plan(
      "p/m",
      snapshot([candidate(laneAccount), candidate("fresh")]),
      null,
    );
    expect(order(plan)).toEqual(["fresh", laneAccount]);
  });

  test("an all-slow pool still plans instead of answering 429", async () => {
    const laneAccount = `slow-${crypto.randomUUID()}`;
    sharedClaudeSlowLanes.observe(laneAccount, {
      offer: "treatment",
      status: "active",
      unifiedLimitClaim: false,
      overageInUse: false,
      unifiedResetAtSec: Math.floor(Date.now() / 1000) + 3600,
    });
    // Slow counts as servable: excluding it would park a credential that still
    // answers on spare capacity.
    const plan = await new RoutingEngine().plan("p/m", snapshot([candidate(laneAccount)]), null);
    expect(order(plan)).toEqual([laneAccount]);
  });
});

describe("saturated ordering", () => {
  test("an account at its ceiling is ordered behind one with room", async () => {
    const full = candidate("full", { max_inflight: 1 });
    const room = candidate("room", { max_inflight: 1 });
    const controller = new InMemoryAdmissionController();
    const engine = new RoutingEngine(controller);
    // Occupy the only slot in `full`'s bucket, as a live request would.
    const held = await engine.reserve(await engine.plan("p/m", snapshot([full, room]), null));
    const plan = await engine.plan("p/m", snapshot([full, room]), null);
    await engine.release(held);
    expect(order(plan)).toEqual(["room", "full"]);
  });

  test("provider rotation cannot float a saturated account back to the front", async () => {
    const full = candidate("full", { max_inflight: 1 });
    const room = candidate("room", { max_inflight: 1 });
    const engine = new RoutingEngine(new InMemoryAdmissionController());
    const withRotation = () => snapshot([full, room], { providerRouting: ROTATING_PROVIDER });
    const held = await engine.reserve(await engine.plan("p/m", withRotation(), null));
    // Loop the trigger: rotation advances per plan, so the first call alone would
    // look correct while the second silently undid the ordering.
    const firstAttempts: (string | undefined)[] = [];
    for (let index = 0; index < 4; index += 1) {
      firstAttempts.push(order(await engine.plan("p/m", withRotation(), null))[0]);
    }
    await engine.release(held);
    expect(firstAttempts).toEqual(["room", "room", "room", "room"]);
  });

  test("a candidate that is both lane-active and saturated is planned exactly once", async () => {
    // The partitions overlap: an account can hold several states at once. Emitting
    // it once per matching predicate duplicated it in the plan, and the attempt
    // loop then dialed the same account several times for one request.
    const both = `both-${crypto.randomUUID()}`;
    sharedClaudeSlowLanes.observe(both, {
      offer: "treatment",
      status: "active",
      unifiedLimitClaim: false,
      overageInUse: false,
      unifiedResetAtSec: Math.floor(Date.now() / 1000) + 3600,
    });
    const bothCandidate = candidate(both, { max_inflight: 1 });
    const fresh = candidate("fresh", { max_inflight: 1 });
    const engine = new RoutingEngine(new InMemoryAdmissionController());
    const held = await engine.reserve(await engine.plan("p/m", snapshot([bothCandidate]), null));
    const plan = await engine.plan("p/m", snapshot([bothCandidate, fresh]), null);
    await engine.release(held);
    const reached = order(plan);
    expect(reached).toEqual(["fresh", both]);
  });
});

describe("time-bounded exclusions answer 429, not 503", () => {
  test("an all-model-cooldown model is rate limited", async () => {
    const error = await new RoutingEngine()
      .plan(
        "p/m",
        snapshot([
          candidate("cool", {
            health_status: "model_cooldown",
            cooldown_until: Date.now() + 600_000,
          }),
        ]),
        null,
      )
      .catch((caught) => caught);
    expect(error.status).toBe(429);
    expect(error.code).toBe("accounts_rate_limited");
  });

  test("the 429 quotes the reset that was actually observed", async () => {
    const error = await new RoutingEngine()
      .plan(
        "p/m",
        snapshot([
          candidate("cool", {
            health_status: "cooldown",
            cooldown_kind: "hard",
            cooldown_until: Date.now() + 600_000,
          }),
        ]),
        null,
      )
      .catch((caught) => caught);
    expect(error.status).toBe(429);
    expect(typeof error.details.retryAfterMs).toBe("number");
    expect(error.details.retryAfterMs).toBeGreaterThan(500_000);
  });

  test("an exclusion with no reset stays 503 and invents no hint", async () => {
    // `disabled` is an operator decision with no deadline, so there is nothing to
    // retry against and a fabricated backoff would be worse than none.
    const error = await new RoutingEngine()
      .plan("p/m", snapshot([candidate("gone", { health_status: "disabled" })]), null)
      .catch((caught) => caught);
    expect(error.status).toBe(503);
    expect(error.details.retryAfterMs).toBeUndefined();
  });
});

describe("combo expansion", () => {
  test("a combo naming one model twice plans it once", async () => {
    // Deduping the model-id list does not cover this: the duplication appears in
    // the candidate list, because `p/m` and `m` resolve to the same candidate.
    const plan = await new RoutingEngine().plan(
      "duo",
      snapshot([candidate("a1")], {
        aliases: { t1: {} },
        combos: { t1: { duo: { members: ["p/m", "m"], strategy: "fallback" } } },
      }),
      "t1",
    );
    expect(plan.candidates.length).toBe(1);
  });
});

describe("alias resolution", () => {
  test("a name reached through an alias resolves like the direct spelling", () => {
    // Resolution is what is under test, not dispatch: `resolveAliasTarget` is the
    // pre-routing resolver the policy checks use, so a name has to normalize the
    // same way whether it was written directly or reached through an alias.
    const snapshotWithAliases = snapshot([candidate("a1")], {
      aliases: { t1: { fast: "claude-opus-5[1m]", opus: "claude-opus-5" } },
    });
    const direct = resolveAliasTarget(snapshotWithAliases, "t1", "claude-opus-5[1m]");
    const throughAlias = resolveAliasTarget(snapshotWithAliases, "t1", "fast");
    expect(throughAlias).toBe(direct);
  });

  test("the family-slot fallback does not turn a plain chain into a cycle", () => {
    // `opus` → `claude-opus-5`, and `claude-opus-5` would normalize back to
    // `opus`. Applying that fallback per hop made this a cycle the operator never
    // wrote; only the variant-suffix rule may apply mid-chain.
    const snapshotWithAliases = snapshot([candidate("a1")], {
      aliases: { t1: { opus: "claude-opus-5", fast: "claude-opus-5" } },
    });
    expect(resolveAliasTarget(snapshotWithAliases, "t1", "opus")).toBe("claude-opus-5");
    expect(resolveAliasTarget(snapshotWithAliases, "t1", "fast")).toBe("claude-opus-5");
  });
});
