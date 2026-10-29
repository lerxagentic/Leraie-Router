/**
 * Cursor IDE OAuth Auto-Import (9Router Pro parity).
 *
 * Scans local storage databases (`state.vscdb`) across macOS, Windows, and Linux
 * to auto-extract Cursor access tokens and machine IDs.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];

export interface CursorAutoImportResult {
  readonly found: boolean;
  readonly accessToken?: string;
  readonly machineId?: string;
  readonly error?: string;
  readonly windowsManual?: boolean;
  readonly checkedLocations?: string[];
}

export function getCursorCandidatePaths(platform: string = process.platform): string[] {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
      join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
    ];
  }

  if (platform === "win32") {
    const appData = process.env["APPDATA"] || join(home, "AppData", "Roaming");
    const localAppData = process.env["LOCALAPPDATA"] || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

function normalizeToken(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

export function extractCursorTokens(dbPath: string): { accessToken: string | null; machineId: string | null } {
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });

    let accessToken: string | null = null;
    for (const key of ACCESS_TOKEN_KEYS) {
      try {
        const row = db.query<{ value: string }, [string]>("SELECT value FROM itemTable WHERE key = ? LIMIT 1").get(key);
        if (row?.value) {
          accessToken = normalizeToken(row.value);
          if (accessToken) break;
        }
      } catch {
        // continue
      }
    }

    let machineId: string | null = null;
    for (const key of MACHINE_ID_KEYS) {
      try {
        const row = db.query<{ value: string }, [string]>("SELECT value FROM itemTable WHERE key = ? LIMIT 1").get(key);
        if (row?.value) {
          machineId = normalizeToken(row.value);
          if (machineId) break;
        }
      } catch {
        // continue
      }
    }

    // Fuzzy fallback: if exact keys missing, search by LIKE
    if (!accessToken) {
      try {
        const rows = db.query<{ key: string; value: string }, [string]>("SELECT key, value FROM itemTable WHERE key LIKE ? LIMIT 5").all("%accesstoken%");
        for (const r of rows) {
          const val = normalizeToken(r.value);
          if (val) {
            accessToken = val;
            break;
          }
        }
      } catch {
        // continue
      }
    }

    if (!machineId) {
      try {
        const rows = db.query<{ key: string; value: string }, [string]>("SELECT key, value FROM itemTable WHERE key LIKE ? LIMIT 5").all("%machineid%");
        for (const r of rows) {
          const val = normalizeToken(r.value);
          if (val) {
            machineId = val;
            break;
          }
        }
      } catch {
        // continue
      }
    }

    return { accessToken, machineId };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
}

export function performCursorAutoImport(): CursorAutoImportResult {
  const candidates = getCursorCandidatePaths();
  let dbPath: string | null = null;

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dbPath = candidate;
      break;
    }
  }

  if (!dbPath) {
    return {
      found: false,
      windowsManual: true,
      error: `Cursor database (state.vscdb) not found. Checked locations:\n${candidates.join("\n")}`,
      checkedLocations: candidates,
    };
  }

  try {
    const { accessToken, machineId } = extractCursorTokens(dbPath);
    if (accessToken && machineId) {
      return {
        found: true,
        accessToken,
        machineId,
      };
    }
    return {
      found: false,
      windowsManual: true,
      error: "Found Cursor database, but login tokens were empty. Log in to Cursor IDE first.",
    };
  } catch (err) {
    return {
      found: false,
      windowsManual: true,
      error: `Failed to read Cursor database: ${(err as Error).message}`,
    };
  }
}
