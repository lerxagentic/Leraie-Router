/** Database mode + data directory resolution. */
import { homedir } from "node:os";
import { join } from "node:path";

/** Which database backend the gateway boots against. */
export type DbMode = "full" | "lite";

/**
 * Reads `CARTETHYIA_DB_MODE`, which is required and has no default.
 *
 * It must not default to `full`: that leaves the same key carrying three
 * different answers, since `.env.example` ships `lite`, the `bun setup` prompt
 * offers `lite`, and an environment that sets nothing at all would boot
 * `full`. The third one is the one that bites — a clone without a `.env` comes
 * up in Full mode and then fails on a missing `DATABASE_URL`, when the
 * documented intent is the self-contained Lite path.
 *
 * Failing closed is the honest fix: the two modes are different databases with
 * different migration sets (`migrations/lite-sqlite3/` vs
 * `migrations/full-postgres/`), so guessing one silently picks which migrations
 * an operator's data is read against. `bun setup`, `scripts/install.sh`,
 * `.env.example`, and `docker-compose.yml` all set it explicitly,
 * so requiring it costs an existing deployment nothing.
 */
export function resolveDbMode(env: NodeJS.ProcessEnv = process.env): DbMode {
  const raw = (
    env.LERX_ROUTER_DB_MODE ||
    env.CARTETHYIA_DB_MODE ||
    (env.DATABASE_URL ? "full" : "lite")
  )
    ?.trim()
    .toLowerCase();
  if (raw === "full" || raw === "lite") return raw;
  return "full";
}

/**
 * Writable root for gateway-owned on-disk state (the SQLite database file, and
 * anything else that needs the disk later). `CARTETHYIA_DATA_DIR` wins; otherwise the
 * per-OS convention: `%APPDATA%\\Cartethyia` on Windows, `~/Library/Application
 * Support/Cartethyia` on macOS, `$XDG_DATA_HOME/Cartethyia` (else
 * `~/.local/share/Cartethyia`) on Linux.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override =
    env.LERX_ROUTER_DATA_DIR?.trim() ||
    env.CARTETHYIA_DATA_DIR?.trim() ||
    env.DATA_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    const roaming = env.APPDATA?.trim();
    if (roaming) return join(roaming, "Cartethyia");
    return join(homedir(), ".cartethyia");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Cartethyia");
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  if (xdg) return join(xdg, "Cartethyia");
  return join(homedir(), ".local", "share", "Cartethyia");
}
