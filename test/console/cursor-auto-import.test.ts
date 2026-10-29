import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  extractCursorTokens,
  getCursorCandidatePaths,
} from "../../src/console/providers/oauth/cursor-auto-import";

const TEST_DIR = "/tmp/cursor-autoimport-test";
const TEST_DB = join(TEST_DIR, "state.vscdb");

describe("Cursor IDE OAuth Auto-Import", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("extracts access token and machine id from exact keys", () => {
    const db = new Database(TEST_DB);
    db.run("CREATE TABLE itemTable (key TEXT, value TEXT)");
    db.run("INSERT INTO itemTable VALUES (?, ?)", ["cursorAuth/accessToken", '"test-access-token"']);
    db.run("INSERT INTO itemTable VALUES (?, ?)", ["storage.serviceMachineId", '"test-machine-id"']);
    db.close();

    const { accessToken, machineId } = extractCursorTokens(TEST_DB);
    expect(accessToken).toBe("test-access-token");
    expect(machineId).toBe("test-machine-id");
  });

  it("falls back to fuzzy LIKE queries when exact keys are missing", () => {
    const db = new Database(TEST_DB);
    db.run("CREATE TABLE itemTable (key TEXT, value TEXT)");
    db.run("INSERT INTO itemTable VALUES (?, ?)", ["cursorAuth/v2/user_accesstoken_key", "fuzzy-token"]);
    db.run("INSERT INTO itemTable VALUES (?, ?)", ["telemetry.app_machineid", "fuzzy-machine"]);
    db.close();

    const { accessToken, machineId } = extractCursorTokens(TEST_DB);
    expect(accessToken).toBe("fuzzy-token");
    expect(machineId).toBe("fuzzy-machine");
  });

  it("returns candidates for current platform", () => {
    const paths = getCursorCandidatePaths();
    expect(paths.length).toBeGreaterThan(0);
  });
});
