/**
 * Backup and restore operations, plus the import path for a router export.
 *
 * Two things every entry point here has in common:
 *
 * 1. **Nothing is written before the whole payload validates.** Validation
 *    resolves every table and column against the live schema, so a stale or
 *    hostile file fails with the offending name and the database is untouched.
 * 2. **Everything happens in one transaction** (see `store.applyRestore`), so a
 *    mid-restore SQL error rolls back rather than leaving half a
 *    configuration — which is the state that makes an operator's day worse than
 *    a plain failure would.
 *
 * Export is plain JSON at the operator's explicit request. That means the file
 * carries provider credentials and API-key hashes, so it is as sensitive as the
 * database: the layer doc and the dashboard copy say so, and export requires
 * password re-authentication.
 */
import type { CartethyiaDatabase } from "../../persistence/postgres";
import type { Table } from "drizzle-orm";
import {
  models,
  providerAccounts,
  providerOauthStates,
  providerRoutingSettings,
  providers,
  tenantDisabledModels,
} from "../../persistence/schema";
import { ConsoleDomainError } from "../shared/errors";
import { tablesForSection, tableName, TENANT_TABLE } from "./contracts";
import type {
  BackupSection,
  RestoreWarning,
  ValidatedRestore,
  ValidatedTable,
} from "./contracts";
import {
  applyRestore,
  decompressBackup,
  deleteAll,
  exportBackup,
  type DeleteAllResult,
  type DeleteAllScope,
} from "./store";
import { detectFormat, restoreOrder, validateRestorePayload } from "./validate";
import { convert9RouterBackup, type ImportReport } from "./nine-router";
import { convertToNineRouterExport, type NineRouterExportReport } from "./to-nine-router";
import { eq } from "drizzle-orm";

export interface BackupServiceOptions {
  readonly db: CartethyiaDatabase;
  /** Verifies the signed-in operator's console password; supplied by the router. */
  readonly verifyPassword: (password: string) => Promise<boolean>;
}

export interface ExportOptions {
  readonly sections?: readonly BackupSection[];
  readonly password: string;
  /** The tenant whose rows are exported. Never another tenant's. */
  readonly tenantId: string;
  readonly compressed?: boolean;
}

export interface BackupInspectionRow {
  readonly section: string;
  readonly table: string;
  readonly count: number;
  readonly supported: boolean;
}

export interface BackupInspection {
  readonly format: "native" | "nine_router";
  readonly version: number;
  readonly exportedAt: string;
  readonly rows: readonly BackupInspectionRow[];
  readonly total: number;
  readonly warnings: readonly RestoreWarning[];
}

export interface ImportResult {
  readonly restored: Record<string, number>;
  readonly skipped: Record<string, number>;
  readonly warnings?: readonly RestoreWarning[];
  readonly report?: ImportReport;
  readonly format: "native" | "nine_router";
}

export interface BackupRestoreSelection {
  readonly tables?: readonly string[];
}

function restrictToSelection(
  validation: ValidatedRestore,
  selection: BackupRestoreSelection | undefined,
): ValidatedRestore {
  const wanted = selection?.tables;
  if (wanted === undefined || wanted.length === 0) return validation;
  const selected = new Set(wanted);
  const tables = new Map<Table, ValidatedTable>();
  for (const [table, entry] of validation.tables) {
    if (selected.has(tableName(table))) tables.set(table, entry);
  }
  return {
    ...validation,
    tables,
    tenantRows: tables.size > 0 ? validation.tenantRows : [],
  };
}

function toBackupBytes(input: string): Uint8Array {
  if (input.trimStart().startsWith("{")) return Buffer.from(input, "utf8");
  return Buffer.from(input, "base64");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBackupInput(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (input instanceof Uint8Array) return parseBackupText(decompressBackup(input));
  if (input instanceof ArrayBuffer) return parseBackupText(decompressBackup(new Uint8Array(input)));
  if (typeof input === "string") return parseBackupText(decompressBackup(toBackupBytes(input)));
  if (isPlainObject(input) && typeof input["bytes"] === "string" && Object.keys(input).length <= 3) {
    return parseBackupText(decompressBackup(toBackupBytes(input["bytes"])));
  }
  return input;
}

function parseBackupText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConsoleDomainError("invalid_request", 400, "that file is not a JSON backup");
  }
}

async function omitRowsForUnavailableProviders(
  db: CartethyiaDatabase,
  validation: ValidatedRestore,
  tenantId: string,
): Promise<ValidatedRestore> {
  const existingProviders = await db
    .select({ id: providers.id, tenantId: providers.tenantId })
    .from(providers);
  const importedProviders = validation.tables.get(providers)?.rows ?? [];
  const providerIds = new Set([
    ...existingProviders
      .filter((provider) => provider.tenantId === null || provider.tenantId === tenantId)
      .map((provider) => provider.id),
    ...importedProviders.map((provider) => String(provider["id"])),
  ]);
  const tables = new Map(validation.tables);
  const warnings = [...validation.warnings];
  const counts = { ...validation.counts };

  for (const table of [providerAccounts, models, tenantDisabledModels, providerRoutingSettings]) {
    const entry = tables.get(table);
    if (entry === undefined) continue;
    const rows = entry.rows.filter(
      (row) => typeof row["provider_id"] === "string" && providerIds.has(row["provider_id"]),
    );
    if (rows.length === entry.rows.length) continue;
    tables.set(table, { ...entry, rows });
    counts[tableName(table)] = rows.length;
    warnings.push({
      table: tableName(table),
      column: "provider_id",
      reason: "referenced a provider not available in this installation; those rows were skipped",
    });
  }

  const accountRows = tables.get(providerAccounts)?.rows ?? [];
  const replacesTenantAccounts = accountRows.length > 0;
  const existingAccounts = await db
    .select({ id: providerAccounts.id, tenantId: providerAccounts.tenantId })
    .from(providerAccounts);
  const accountIds = new Set(
    existingAccounts
      .filter((account) => !replacesTenantAccounts || account.tenantId !== tenantId)
      .map((account) => account.id),
  );
  for (const account of accountRows) {
    if (typeof account["id"] === "string") accountIds.add(account["id"]);
  }

  const oauthEntry = tables.get(providerOauthStates);
  if (oauthEntry !== undefined) {
    const rows = oauthEntry.rows.filter(
      (row) =>
        typeof row["provider_account_id"] === "string" && accountIds.has(row["provider_account_id"]),
    );
    if (rows.length !== oauthEntry.rows.length) {
      tables.set(providerOauthStates, { ...oauthEntry, rows });
      counts[tableName(providerOauthStates)] = rows.length;
      warnings.push({
        table: tableName(providerOauthStates),
        column: "provider_account_id",
        reason: "referenced an account not restored or available in this installation; those rows were skipped",
      });
    }
  }

  return { ...validation, tables, counts, warnings };
}

function sectionsOrDefault(sections: readonly BackupSection[] | undefined): readonly BackupSection[] {
  if (sections === undefined || sections.length === 0) return ["config"];
  for (const section of sections) {
    if (section !== "config" && section !== "telemetry") {
      throw new ConsoleDomainError("invalid_request", 400, `unknown backup section "${String(section)}"`);
    }
  }
  return sections;
}

export class BackupService {
  constructor(private readonly options: BackupServiceOptions) {}

  async export(options: ExportOptions): Promise<{ payload: unknown; counts: Record<string, number> }> {
    if (!(await this.options.verifyPassword(options.password))) {
      throw new ConsoleDomainError("unauthorized", 401, "password is incorrect");
    }
    const sections = sectionsOrDefault(options.sections);
    const { payload, counts } = await exportBackup(
      this.options.db,
      sections.flatMap((section) => tablesForSection(section)),
      options.tenantId,
    );
    return { payload, counts };
  }

  /**
   * Restores a payload, detecting its format first.
   *
   * A native payload is validated as-is. A router export is converted first —
   * and conversion is itself validation, because it refuses provider ids it
   * cannot map rather than guessing — then the converted payload goes through
   * the identical validation and transaction as a native one. There is one
   * write path, not two.
   *
   * `tenantId` is the restoring tenant, and it is the *only* tenant any write
   * can reach: the payload cannot name a different one, because every table is
   * filtered by ownership and the tenant row is forced to this id.
   */
  async restore(
    password: unknown,
    payload: unknown,
    tenantId: string,
    selection?: BackupRestoreSelection,
  ): Promise<ImportResult> {
    if (typeof password !== "string" || !(await this.options.verifyPassword(password))) {
      throw new ConsoleDomainError("unauthorized", 401, "password is incorrect");
    }

    const detected = detectFormat(normalizeBackupInput(payload));
    if (detected.kind === "unknown") {
      throw new ConsoleDomainError("invalid_request", 400, detected.reason);
    }

    if (detected.kind === "nine_router") {
      const { payload: converted, report } = convert9RouterBackup(detected.payload, tenantId);
      const result = await this.apply(converted, tenantId, selection);
      return { ...result, report, format: "nine_router" };
    }

    const result = await this.apply(detected.payload, tenantId, selection);
    return { ...result, format: "native" };
  }

  async restoreFirstBoot(payload: unknown, tenantId: string): Promise<ImportResult> {
    const detected = detectFormat(normalizeBackupInput(payload));
    if (detected.kind !== "native") {
      throw new ConsoleDomainError(
        "invalid_request",
        400,
        detected.kind === "unknown" ? detected.reason : "first-boot restore accepts a Cartethyia backup only",
      );
    }
    const result = await this.apply(detected.payload, tenantId);
    return { ...result, format: "native" };
  }

  inspect(payload: unknown): BackupInspection {
    const detected = detectFormat(normalizeBackupInput(payload));
    if (detected.kind === "unknown") {
      throw new ConsoleDomainError("invalid_request", 400, detected.reason);
    }
    const candidate = detected.kind === "native" ? detected.payload : null;
    if (candidate === null) {
      return {
        format: "nine_router",
        version: 0,
        exportedAt: "",
        rows: [],
        total: 0,
        warnings: [],
      };
    }
    const validation = validateRestorePayload(candidate, "");
    const warnings = validation.ok ? validation.value.warnings : [];
    const knownTables = new Set(
      [...tablesForSection("config"), ...tablesForSection("telemetry"), TENANT_TABLE].map(tableName),
    );

    const rows: BackupInspectionRow[] = [];
    let total = 0;
    const sections = isPlainObject(candidate.sections) ? candidate.sections : {};
    for (const [section, value] of Object.entries(sections)) {
      if (!isPlainObject(value)) continue;
      for (const [table, list] of Object.entries(value)) {
        if (!Array.isArray(list)) continue;
        rows.push({ section, table, count: list.length, supported: knownTables.has(table) });
        total += list.length;
      }
    }
    rows.sort((left, right) => right.count - left.count || left.table.localeCompare(right.table));

    return {
      format: "native",
      version: typeof candidate.version === "number" ? candidate.version : 0,
      exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : "",
      rows,
      total,
      warnings,
    };
  }

  /** Validates and applies a native payload. Shared by both formats. */
  private async apply(
    payload: unknown,
    tenantId: string,
    selection?: BackupRestoreSelection,
  ): Promise<{ restored: Record<string, number>; skipped: Record<string, number>; warnings: readonly RestoreWarning[] }> {
    const validation = validateRestorePayload(payload, tenantId);
    if (!validation.ok) {
      throw new ConsoleDomainError("invalid_request", 400, validation.error);
    }
    try {
      const scoped = restrictToSelection(validation.value, selection);
      const compatible = await omitRowsForUnavailableProviders(this.options.db, scoped, tenantId);
      const applied = await applyRestore(this.options.db, compatible, restoreOrder(), tenantId);
      return { ...applied, warnings: compatible.warnings };
    } catch (error) {
      // The message carries table and column names only — the store never
      // interpolates a cell value — so a failed restore cannot leak credentials
      // into a log or an HTTP response.
      throw new ConsoleDomainError(
        "restore_failed",
        500,
        `restore failed and was rolled back: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /** Permanently deletes selected tenant configuration after re-authentication. */
  async exportNineRouter(
    password: unknown,
    tenantId: string,
  ): Promise<NineRouterExportReport> {
    if (typeof password !== "string" || !(await this.options.verifyPassword(password))) {
      throw new ConsoleDomainError("unauthorized", 401, "password is incorrect");
    }
    return convertToNineRouterExport(this.options.db, tenantId);
  }
  async deleteAll(password: unknown, scopes: readonly DeleteAllScope[], tenantId: string): Promise<DeleteAllResult> {
    if (typeof password !== "string" || !(await this.options.verifyPassword(password))) {
      throw new ConsoleDomainError("unauthorized", 401, "password is incorrect");
    }
    if (scopes.length === 0) {
      throw new ConsoleDomainError("invalid_request", 400, "select at least one delete scope");
    }
    try {
      return await deleteAll(this.options.db, scopes, tenantId);
    } catch (error) {
      throw new ConsoleDomainError(
        "delete_failed",
        500,
        `delete failed and was rolled back: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /** Counts a section without building its payload. */
  async preview(
    sections: readonly BackupSection[] | undefined,
    tenantId: string,
  ): Promise<Record<string, number>> {
    const { counts } = await exportBackup(
      this.options.db,
      sectionsOrDefault(sections).flatMap((section) => tablesForSection(section)),
      tenantId,
    );
    return counts;
  }

  /** Reads the tenant's auto-backup preferences (bot token masked for read). */
  async getAutoBackup(tenantId: string): Promise<{ enabled: boolean; botTokenMasked: string | null; chatId: string | null; intervalHours: number; lastSentAt: string | null; lastError: string | null }> {
    const { consoleSettings } = await import("../../persistence/schema");
    const rows = await this.options.db.select({ preferences: consoleSettings.preferences }).from(consoleSettings).where(eq(consoleSettings.tenantId, tenantId));
    const ab = (rows[0]?.preferences as Record<string, unknown> | undefined)?.autoBackup as Record<string, unknown> | undefined;
    return {
      enabled: ab?.enabled === true,
      botTokenMasked: typeof ab?.botToken === "string" && ab.botToken.length >= 8 ? `${ab.botToken.slice(0, 6)}…${ab.botToken.slice(-4)}` : null,
      chatId: typeof ab?.chatId === "string" ? ab.chatId : null,
      intervalHours: typeof ab?.intervalHours === "number" ? ab.intervalHours : 24,
      lastSentAt: typeof ab?.lastSentAt === "string" ? ab.lastSentAt : null,
      lastError: typeof ab?.lastError === "string" ? ab.lastError : null,
    };
  }

  /** Upserts auto-backup preferences; an empty bot token clears the stored one. */
  async updateAutoBackup(
    password: unknown,
    tenantId: string,
    patch: { enabled?: boolean; botToken?: string; chatId?: string; intervalHours?: number },
  ): Promise<{ enabled: boolean; botTokenMasked: string | null; chatId: string | null; intervalHours: number; lastSentAt: string | null; lastError: string | null }> {
    if (typeof password !== "string" || !(await this.options.verifyPassword(password))) {
      throw new ConsoleDomainError("unauthorized", 401, "password is incorrect");
    }
    const { consoleSettings } = await import("../../persistence/schema");
    const rows = await this.options.db.select({ preferences: consoleSettings.preferences }).from(consoleSettings).where(eq(consoleSettings.tenantId, tenantId));
    const prefs = (rows[0]?.preferences ?? {}) as Record<string, unknown>;
    const prev = (prefs.autoBackup ?? {}) as Record<string, unknown>;
    const nextAutoBackup = {
      ...prev,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.botToken !== undefined ? { botToken: patch.botToken === "" ? undefined : patch.botToken } : {}),
      ...(patch.chatId !== undefined ? { chatId: patch.chatId } : {}),
      ...(patch.intervalHours !== undefined ? { intervalHours: patch.intervalHours } : {}),
    };
    if (nextAutoBackup.botToken === undefined) delete nextAutoBackup.botToken;
    const nextPrefs = { ...prefs, autoBackup: nextAutoBackup };
    await this.options.db
      .insert(consoleSettings)
      .values({ tenantId, preferences: nextPrefs as never, updatedAt: new Date() })
      .onConflictDoUpdate({ target: consoleSettings.tenantId, set: { preferences: nextPrefs as never, updatedAt: new Date() } });
    return this.getAutoBackup(tenantId);
  }

  /** Fires an auto-backup run immediately (bypassing the interval gate). */
  async runAutoBackupNow(password: unknown, tenantId: string, fetcher?: typeof fetch): Promise<{ sent: boolean; error?: string }> {
    if (typeof password !== "string" || !(await this.options.verifyPassword(password))) {
      throw new ConsoleDomainError("unauthorized", 401, "password is incorrect");
    }
    const { runAutoBackupForTenant } = await import("../../workers/auto-backup");
    return runAutoBackupForTenant({ db: this.options.db, tenantId, fetcher, force: true });
  }
}
