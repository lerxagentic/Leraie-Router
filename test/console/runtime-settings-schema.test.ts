import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { runtimeUpdateBody } from "../../src/console/settings/contracts";

describe("runtimeUpdateBody operational settings", () => {
  test("accepts invoke kill switch and nullable runtime overrides", () => {
    expect(Value.Check(runtimeUpdateBody, { invokeDisabled: true })).toBe(true);
    expect(Value.Check(runtimeUpdateBody, { concurrencyTolerance: null })).toBe(true);
    expect(Value.Check(runtimeUpdateBody, { concurrencyTolerance: 3 })).toBe(true);
    expect(Value.Check(runtimeUpdateBody, { telemetryWindowMinutes: null })).toBe(true);
    expect(Value.Check(runtimeUpdateBody, { telemetryWindowMinutes: 30 })).toBe(true);
  });

  test("rejects invalid runtime overrides", () => {
    expect(Value.Check(runtimeUpdateBody, { concurrencyTolerance: -1 })).toBe(false);
    expect(Value.Check(runtimeUpdateBody, { telemetryWindowMinutes: 0 })).toBe(false);
    expect(Value.Check(runtimeUpdateBody, { telemetryWindowMinutes: "30" })).toBe(false);
  });
});
