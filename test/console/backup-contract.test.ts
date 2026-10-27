import { describe, expect, test } from "bun:test";
import {
  CONFIG_TABLES,
  droppedColumns,
  ownershipOf,
  payloadNameOf,
  sealedAliases,
  sealedColumns,
  tableName,
  tablesForSection,
} from "../../src/console/backup/contracts";
import {
  DELETE_ALL_SCOPES,
  compressBackup,
  decompressBackup,
  isGzipBytes,
  type DeleteAllScope,
} from "../../src/console/backup/store";
import { BackupService } from "../../src/console/backup/service";
import { validateRestorePayload } from "../../src/console/backup/validate";
import { apiKeys, networkPools, providerAccounts } from "../../src/persistence/schema";

describe("backup contract coverage", () => {
  test("includes tenant-owned studio sessions in configuration", () => {
    expect(tablesForSection("config").map(tableName)).toContain("studio_sessions");
  });

  test("every config table has an ownership rule", () => {
    for (const table of CONFIG_TABLES) expect(() => ownershipOf(table)).not.toThrow();
  });

  test("delete scopes are represented as a narrow runtime union", () => {
    const scopes: readonly DeleteAllScope[] = DELETE_ALL_SCOPES;
    expect(scopes).toEqual(["providers", "proxies", "configuration"]);
  });
});

describe("legacy dropped columns on restore", () => {
  test("provider_accounts.max_inflight is accepted and skipped", () => {
    const table = tablesForSection("config").find((t) => tableName(t) === "provider_accounts");
    expect(table).toBeDefined();
    expect(droppedColumns(table!)).toContain("max_inflight");

    const payload = {
      app: "cartethyia",
      version: 1,
      exportedAt: "2026-10-01T00:00:00.000Z",
      sections: {
        config: {
          provider_accounts: [
            { id: "00000000-0000-0000-0000-000000000001", label: "x", credential_kind: "static", max_inflight: 10 },
          ],
        },
      },
    };
    const result = validateRestorePayload(payload, "tenant-1");
    expect(result.ok).toBe(true);
  });

  test("a still-unknown column is rejected with the same message", () => {
    const payload = {
      app: "cartethyia",
      version: 1,
      exportedAt: "2026-10-01T00:00:00.000Z",
      sections: {
        config: {
          provider_accounts: [
            { id: "00000000-0000-0000-0000-000000000001", label: "x", credential_kind: "static", not_a_column: 1 },
          ],
        },
      },
    };
    const result = validateRestorePayload(payload, "tenant-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("is not a column");
  });

  test("migrates legacy model allow/deny policy into the current single policy", () => {
    const payload = {
      app: "cartethyia",
      version: 1,
      exportedAt: "2026-10-01T00:00:00.000Z",
      sections: {
        config: {
          api_keys: [
            {
              id: "00000000-0000-0000-0000-000000000002",
              label: "legacy",
              model_allowlist: ["alpha"],
              model_denylist: [],
            },
          ],
        },
      },
    };
    const result = validateRestorePayload(payload, "tenant-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rows = result.value.tables.get(
        tablesForSection("config").find((table) => tableName(table) === "api_keys")!,
      )?.rows;
      expect(rows?.[0]).toMatchObject({
        model_access_mode: "whitelist",
        model_list: ["alpha"],
      });
      expect(rows?.[0]).not.toHaveProperty("model_allowlist");
      expect(rows?.[0]).not.toHaveProperty("model_denylist");
    }
  });
});

describe("portable sealed columns and aliases", () => {
  test("sealedColumns correctly identifies encrypted secret columns", () => {
    expect(sealedColumns(providerAccounts)).toContain("credential_ciphertext");
    expect(sealedColumns(apiKeys)).toContain("key_encrypted");
    expect(sealedColumns(networkPools)).toContain("credential_ciphertext");
  });

  test("payloadNameOf returns human-readable plaintext aliases", () => {
    expect(payloadNameOf(providerAccounts, "credential_ciphertext")).toBe("access_token");
    expect(payloadNameOf(apiKeys, "key_encrypted")).toBe("api_key");
    expect(payloadNameOf(networkPools, "credential_ciphertext")).toBe("proxy_credential");
    expect(payloadNameOf(providerAccounts, "label")).toBe("label");
  });

  test("sealedAliases maps human-readable aliases back to schema columns", () => {
    const accountAliases = sealedAliases(providerAccounts);
    expect(accountAliases.get("access_token")).toBe("credential_ciphertext");

    const keyAliases = sealedAliases(apiKeys);
    expect(keyAliases.get("api_key")).toBe("key_encrypted");
  });

  test("validateRestorePayload maps access_token to credential_ciphertext and accepts plaintext string", () => {
    const payload = {
      app: "cartethyia",
      version: 1,
      exportedAt: "2026-10-01T00:00:00.000Z",
      sections: {
        config: {
          provider_accounts: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              provider_id: "anthropic",
              label: "test-account",
              access_token: "sk-ant-api03-secret",
              credential_kind: "api_key",
              status: "active",
            },
          ],
        },
      },
    };
    const result = validateRestorePayload(payload, "tenant-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rows = result.value.tables.get(
        tablesForSection("config").find((table) => tableName(table) === "provider_accounts")!,
      )?.rows;
      expect(rows?.[0]?.credential_ciphertext).toBe("sk-ant-api03-secret");
      expect(rows?.[0]?.access_token).toBeUndefined();
      expect(result.value.warnings).toEqual([]);
    }
  });

  test("validateRestorePayload warns and drops foreign ciphertext that cannot be opened", () => {
    const payload = {
      app: "cartethyia",
      version: 1,
      exportedAt: "2026-10-01T00:00:00.000Z",
      sections: {
        config: {
          provider_accounts: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              provider_id: "anthropic",
              label: "test-account",
              credential_ciphertext: { __bytes: "dGhpcyBpcyBub3QgZGVjcnlwdGFibGU=" },
              credential_kind: "api_key",
              status: "active",
            },
          ],
        },
      },
    };
    const result = validateRestorePayload(payload, "tenant-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rows = result.value.tables.get(
        tablesForSection("config").find((table) => tableName(table) === "provider_accounts")!,
      )?.rows;
      expect(rows?.[0]?.credential_ciphertext).toBeUndefined();
      expect(result.value.warnings.length).toBeGreaterThan(0);
      expect(result.value.warnings[0]?.column).toBe("credential_ciphertext");
    }
  });
});

describe("backup compression and inspection", () => {
  test("compressBackup and decompressBackup roundtrip correctly", () => {
    const data = { hello: "world", count: 42, nested: [1, 2, 3] };
    const compressed = compressBackup(data);
    expect(isGzipBytes(compressed)).toBe(true);
    const decompressed = decompressBackup(compressed);
    expect(JSON.parse(decompressed)).toEqual(data);
  });

  test("decompressBackup returns plain string when not gzipped", () => {
    const raw = JSON.stringify({ plain: "text" });
    const bytes = Buffer.from(raw, "utf8");
    expect(isGzipBytes(bytes)).toBe(false);
    expect(decompressBackup(bytes)).toBe(raw);
  });

  test("BackupService.inspect correctly reports tables and counts without writing", () => {
    const service = new BackupService({ db: {} as never, verifyPassword: async () => true });
    const payload = {
      app: "cartethyia",
      version: 1,
      exportedAt: "2026-10-01T12:00:00.000Z",
      sections: {
        config: {
          models: [{ id: "m1" }, { id: "m2" }],
          unknown_table: [{ foo: "bar" }],
        },
      },
    };
    const inspection = service.inspect(payload);
    expect(inspection.format).toBe("native");
    expect(inspection.version).toBe(1);
    expect(inspection.exportedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(inspection.total).toBe(3);

    const modelsRow = inspection.rows.find((r) => r.table === "models");
    expect(modelsRow).toBeDefined();
    expect(modelsRow?.count).toBe(2);
    expect(modelsRow?.supported).toBe(true);

    const unknownRow = inspection.rows.find((r) => r.table === "unknown_table");
    expect(unknownRow).toBeDefined();
    expect(unknownRow?.count).toBe(1);
    expect(unknownRow?.supported).toBe(false);
  });
});
