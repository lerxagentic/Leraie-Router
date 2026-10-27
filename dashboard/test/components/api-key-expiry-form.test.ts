import { describe, expect, test } from "bun:test";
import { expiryDateFromNow, expiryIso } from "../../src/components/ApiKeyForm";

describe("API-key expiry form helpers", () => {
  test("an empty date clears the expiry instead of inventing one", () => {
    expect(expiryIso("")).toBeNull();
    expect(expiryIso("   ")).toBeNull();
  });

  test("the picked day stays usable until the end of that day", () => {
    const iso = expiryIso("2026-11-30");
    expect(iso).not.toBeNull();
    const instant = new Date(iso as string);
    expect(instant.getFullYear()).toBe(2026);
    expect(instant.getMonth()).toBe(10);
    expect(instant.getDate()).toBe(30);
    // Inclusive day semantics: still valid a minute before local midnight.
    expect(instant.getTime()).toBeGreaterThan(new Date("2026-11-30T23:58:00").getTime());
  });

  test("a malformed date never becomes a silent expiry", () => {
    expect(expiryIso("not-a-date")).toBeNull();
  });

  test("quick picks land exactly N calendar days ahead", () => {
    const now = new Date("2026-10-26T10:00:00");
    expect(expiryDateFromNow(7, now)).toBe("2026-11-02");
    expect(expiryDateFromNow(30, now)).toBe("2026-11-25");
  });
});
