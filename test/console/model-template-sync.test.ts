import { describe, expect, test } from "bun:test";
import { createModelTemplateOperations } from "../../src/console/domains/model-templates/routes";
import type { ModelTemplateRecord } from "../../src/console/domains/model-templates/contracts";
import type { ApiKeyRecord } from "../../src/persistence/api-key-store";
import type { ModelTemplateStore } from "../../src/persistence/model-template-store";

const access = {
  tenantId: "tenant-1",
  scopes: ["dashboard:read", "dashboard:write"],
  isPlatformAdmin: false,
} as never;

function templateRecord(overrides: Partial<ModelTemplateRecord> = {}): ModelTemplateRecord {
  return {
    id: "tpl-1",
    tenantId: "tenant-1",
    name: "DeepSeek Only",
    modelList: ["workbuddy/deepseek-v4.1-flash"],
    createdAt: new Date("2026-10-26T00:00:00.000Z"),
    ...overrides,
  };
}

function keyRecord(overrides: Record<string, unknown>): ApiKeyRecord {
  const base: Record<string, unknown> = {
    id: "key-1",
    tenantId: "tenant-1",
    keyHash: "hash",
    keyMode: "personal" as const,
    label: "primary",
    enabled: true,
    scopes: [] as never,
    modelAccessMode: "whitelist" as const,
    modelList: ["old/model"],
    modelTemplateId: "tpl-1",
    createdAt: new Date("2026-10-26T00:00:00.000Z"),
    tokensConsumed: 0,
    ...overrides,
  };
  return base as unknown as ApiKeyRecord;
}

function build(keys: readonly ApiKeyRecord[], templates: readonly ModelTemplateRecord[] = [templateRecord()]) {
  const updates: { keyId: string; patch: Record<string, unknown> }[] = [];
  const store: ModelTemplateStore = {
    list: async () => templates,
    get: async (_tenantId, templateId) => templates.find((t) => t.id === templateId),
    create: async (tenantId, input) =>
      templateRecord({ id: "tpl-new", tenantId, name: input.name, modelList: input.modelList }),
    update: async (_tenantId, templateId, input) =>
      templateRecord({ id: templateId, name: input.name, modelList: input.modelList }),
    remove: async () => true,
  };
  const apiKeyStore = {
    list: async () => keys,
    update: async (_tenantId: string, keyId: string, patch: Record<string, unknown>) => {
      updates.push({ keyId, patch });
      return keys.find((key) => key.id === keyId);
    },
  };
  return {
    operations: createModelTemplateOperations({
      store,
      apiKeyStore: apiKeyStore as never,
      accessResolver: () => access,
    }),
    updates,
  };
}

describe("model template sync", () => {
  test("sync rewrites the models of a linked live personal key", async () => {
    const { operations, updates } = build([keyRecord({})]);
    const result = await operations.syncTemplate(access, "tpl-1");
    expect(result.updatedKeys).toEqual([{ id: "key-1", label: "primary" }]);
    expect(result.skippedCount).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch.modelList).toEqual(["workbuddy/deepseek-v4.1-flash"]);
    expect(updates[0]?.patch.modelAccessMode).toBe("whitelist");
  });

  test("keys not linked to the template are never touched", async () => {
    const { operations, updates } = build([
      keyRecord({ id: "key-other", modelTemplateId: "tpl-2" }),
      keyRecord({ id: "key-none", modelTemplateId: null }),
    ]);
    const result = await operations.syncTemplate(access, "tpl-1");
    expect(result.updatedKeys).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test("a revoked or share key is skipped instead of silently revived", async () => {
    const { operations, updates } = build([
      keyRecord({ id: "revoked", revokedAt: new Date("2026-10-01T00:00:00.000Z") }),
      keyRecord({ id: "share-template", keyMode: "share" }),
      keyRecord({ id: "share-child", parentKeyId: "parent" }),
    ]);
    const result = await operations.syncTemplate(access, "tpl-1");
    expect(result.updatedKeys).toHaveLength(0);
    expect(result.skippedCount).toBe(3);
    expect(updates).toHaveLength(0);
  });

  test("an unknown template is a 404 rather than a silent no-op", async () => {
    const { operations } = build([], []);
    await expect(operations.syncTemplate(access, "missing")).rejects.toThrow();
  });
});
