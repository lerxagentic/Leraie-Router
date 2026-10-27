import { describe, expect, test } from "bun:test";
import { isApiKeyExpired } from "../../src/security/api-key-auth";

describe("API-key expiry", () => {
  test("treats an expiry at the current instant as expired", () => {
    expect(isApiKeyExpired(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  test("keeps an absent or future expiry active", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(isApiKeyExpired(null, now)).toBe(false);
    expect(isApiKeyExpired(new Date("2026-01-01T00:00:01.000Z"), now)).toBe(false);
  });
});
