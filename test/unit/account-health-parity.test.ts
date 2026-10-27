import { expect, test } from "bun:test";
import { classifyAccountError } from "../../src/providers/operations/account-health-service";

const buddy = { origin: "upstream", scope: "account", providerId: "cb", credentialEvidence: true } as const;

test("buddy account restriction in nested displayMsg disables the account", () => {
  const result = classifyAccountError(new Error("request illegal"), {
    ...buddy,
    providerCode: "11140",
    upstreamBody: { displayMsg: { en: "Your account has been restricted due to unusual activity" } },
  });
  expect(result.category).toBe("policy_blocked_banned");
  expect(result.status).toBe("disabled");
  expect(result.retryAt).toBeNull();
  expect(result.mutatesAccount).toBe(true);
});

test("buddy invalid request does not mutate account health", () => {
  const result = classifyAccountError(new Error("request illegal"), { ...buddy, providerCode: "11-128" });
  expect(result.category).toBe("policy_blocked_invalid_request");
  expect(result.mutatesAccount).toBe(false);
  expect(result.retryAt).toBeNull();
});

test("structured reset windows drive quota cooldown", () => {
  const before = Date.now();
  const result = classifyAccountError(new Error("quota exceeded"), {
    ...buddy,
    statusCode: 429,
    upstreamBody: { error: { reset: { seconds: 90 } } },
  });
  expect(result.deadlineStated).toBe(true);
  expect(result.cooldownMs).toBe(90_000);
  expect(result.retryAt?.getTime()).toBeGreaterThanOrEqual(before + 89_000);
});

test("local gateway capacity 429 never mutates account health", () => {
  const result = classifyAccountError(new Error("gateway max inflight capacity reached"), {
    origin: "cartethyia",
    scope: "account",
    statusCode: 429,
    providerId: "cb",
    credentialEvidence: true,
  });
  expect(result.mutatesAccount).toBe(false);
});
