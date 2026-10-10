/**
 * Telemetry retention cutoff semantics.
 *
 * The retention sweep deletes events older than a cutoff. Two properties decide
 * whether "keep everything" is expressible safely:
 *
 * - `0` must mean "no cutoff", not "cutoff = now". A cutoff of `Date.now()`
 *   would delete every row, so unlimited retention has to be a distinct value
 *   the caller can detect and skip on.
 * - A positive value must be a real rolling window, so the sweep actually
 *   converges instead of running unbounded.
 *
 * These are read from the environment per call, so the suite sets the variable
 * around each assertion rather than relying on module-level state.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  resolveTelemetryRetentionCutoff,
  resolveTelemetryRetentionDays,
} from "../../src/config";

const KEY = "CARTETHYIA_TELEMETRY_RETENTION_DAYS";

const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("telemetry retention cutoff", () => {
  test("a positive window yields a cutoff that many days in the past", () => {
    process.env[KEY] = "60";
    expect(resolveTelemetryRetentionDays()).toBe(60);
    const cutoff = resolveTelemetryRetentionCutoff();
    expect(cutoff).toBeInstanceOf(Date);
    const days = (Date.now() - cutoff!.getTime()) / 86_400_000;
    // Allow a second of slack for the clock moving between the two calls.
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
  });

  test("zero disables retention and yields NO cutoff", () => {
    process.env[KEY] = "0";
    expect(resolveTelemetryRetentionDays()).toBe(0);
    // The critical assertion: undefined, never a date. A date here would make
    // the sweep delete every event.
    expect(resolveTelemetryRetentionCutoff()).toBeUndefined();
  });

  test("an absent value falls back to the default window, not unlimited", () => {
    delete process.env[KEY];
    const days = resolveTelemetryRetentionDays();
    expect(days).toBeGreaterThan(0);
    expect(resolveTelemetryRetentionCutoff()).toBeInstanceOf(Date);
  });

  test("a negative value is rejected rather than silently disabling retention", () => {
    process.env[KEY] = "-1";
    expect(() => resolveTelemetryRetentionDays()).toThrow();
  });

  test("an absurdly large value is rejected", () => {
    process.env[KEY] = "999999";
    expect(() => resolveTelemetryRetentionDays()).toThrow();
  });
});
