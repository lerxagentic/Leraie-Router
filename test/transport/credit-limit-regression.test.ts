import { describe, expect, test } from "bun:test";
import { EligibilityEvaluator } from "../../src/transport/routing/router";
import type { RouteCandidate } from "../../src/transport/routing/route-model";

function candidate(overrides: Record<string, unknown>): RouteCandidate {
  return {
    provider_id: "workbuddy",
    model_id: "deepseek-v4.1-flash",
    wire_family: "openai-chat",
    endpoint: "/v2/chat/completions",
    capability_profile: {},
    ...overrides,
  } as unknown as RouteCandidate;
}

describe("eligibility keeps the existing credit limit intact", () => {
  test("a candidate at or below the global credit limit is excluded", () => {
    const evaluator = new EligibilityEvaluator();
    const decision = evaluator.evaluate(
      candidate({ credit_limit_enabled: true, credit_limit: 200, last_remaining_credit: 150 }),
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("credit_floor_reached");
  });

  test("a candidate with no fetched balance stays eligible", () => {
    const evaluator = new EligibilityEvaluator();
    const decision = evaluator.evaluate(
      candidate({ credit_limit_enabled: true, credit_limit: 200 }),
    );
    expect(decision.eligible).toBe(true);
  });

  test("the credit limit is skipped when the toggle is off", () => {
    const evaluator = new EligibilityEvaluator();
    const decision = evaluator.evaluate(
      candidate({
        credit_limit_enabled: false,
        credit_limit: 200,
        last_remaining_credit: 10,
      }),
    );
    expect(decision.eligible).toBe(true);
  });
});
