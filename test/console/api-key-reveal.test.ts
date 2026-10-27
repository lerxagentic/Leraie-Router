import { describe, expect, test } from "bun:test";
import { createApiKeyOperations } from "../../src/console/domains/api-keys/routes";
import { encryptCredential } from "../../src/security/crypto";
import type { ApiKeyRecord } from "../../src/persistence/api-key-store";

const access = {
  tenantId: "tenant-1",
  scopes: ["dashboard:read", "dashboard:write"],
  isPlatformAdmin: false,
} as never;

const PLAINTEXT = "rk_reveal_test_secret_value";

function record(overrides: Record<string, unknown>): ApiKeyRecord {
  return {
    id: "key-1",
    tenantId: "tenant-1",
    keyHash: "hash",
    keyMode: "personal",
    label: "primary",
    enabled: true,
    scopes: [],
    keyPrefix: "rk_",
    createdAt: new Date("2026-10-26T00:00:00.000Z"),
    tokensConsumed: 0,
    ...overrides,
  } as unknown as ApiKeyRecord;
}

function build(rec: ApiKeyRecord | undefined) {
  return createApiKeyOperations({
    store: {
      list: async () => (rec ? [rec] : []),
      get: async () => rec,
      listChildren: async () => [],
      create: async () => undefined,
      reorder: async () => undefined,
      update: async () => rec,
      revoke: async () => true,
    } as never,
    accessResolver: () => access,
    admissionService: { purgeKey: async () => undefined } as never,
  });
}

describe("API-key reveal", () => {
  test("a personal key with a stored ciphertext reveals its plaintext", async () => {
    const operations = build(record({ keyEncrypted: encryptCredential(PLAINTEXT) }));
    await expect(operations.revealKey(access, "key-1")).resolves.toEqual({ secret: PLAINTEXT });
  });

  test("a share template has no credential of its own, so reveal refuses", async () => {
    const operations = build(record({ keyMode: "share", keyHash: null, keyEncrypted: undefined }));
    await expect(operations.revealKey(access, "key-1")).rejects.toThrow();
  });

  test("a personal key without a stored ciphertext refuses instead of inventing one", async () => {
    const operations = build(record({ keyEncrypted: undefined }));
    await expect(operations.revealKey(access, "key-1")).rejects.toThrow();
  });

  test("an unknown or revoked key is a 404", async () => {
    const missing = build(undefined);
    await expect(missing.revealKey(access, "nope")).rejects.toThrow();
    const revoked = build(record({ revokedAt: new Date("2026-10-01T00:00:00.000Z") }));
    await expect(revoked.revealKey(access, "key-1")).rejects.toThrow();
  });
});
