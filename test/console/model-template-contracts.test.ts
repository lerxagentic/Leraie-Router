import { describe, expect, test } from "bun:test";
import {
  isTemplateSyncableKey,
  parseModelTemplateRequest,
  toModelTemplateResponse,
} from "../../src/console/domains/model-templates/contracts";

describe("model template contracts", () => {
  test("a create request normalizes name and de-duplicates the model list", () => {
    const parsed = parseModelTemplateRequest({
      name: "  Coding Premium ",
      modelList: ["workbuddy/gpt-5.6-terra", "workbuddy/gpt-5.6-terra", " workbuddy/kimi-k3 "],
    });
    expect(parsed.name).toBe("Coding Premium");
    expect(parsed.modelList).toEqual(["workbuddy/gpt-5.6-terra", "workbuddy/kimi-k3"]);
  });

  test("an empty name or model list is rejected", () => {
    expect(() => parseModelTemplateRequest({ name: "   ", modelList: ["a"] })).toThrow();
    expect(() => parseModelTemplateRequest({ name: "ok", modelList: [] })).toThrow();
    expect(() => parseModelTemplateRequest({ name: "ok" })).toThrow();
  });

  test("the response carries the template identity and its models", () => {
    const response = toModelTemplateResponse({
      id: "tpl-1",
      tenantId: "tenant-1",
      name: "Budget",
      modelList: ["workbuddy/glm-5.3"],
      createdAt: new Date("2026-10-26T00:00:00.000Z"),
    });
    expect(response).toEqual({
      id: "tpl-1",
      name: "Budget",
      modelList: ["workbuddy/glm-5.3"],
      createdAt: "2026-10-26T00:00:00.000Z",
    });
  });

  test("only live top-level personal keys are rewritten by a sync", () => {
    expect(isTemplateSyncableKey({ keyMode: "personal" })).toBe(true);
    expect(isTemplateSyncableKey({ keyMode: "personal", revokedAt: new Date() })).toBe(false);
    expect(isTemplateSyncableKey({ keyMode: "personal", parentKeyId: "parent" })).toBe(false);
    expect(isTemplateSyncableKey({ keyMode: "share" })).toBe(false);
  });
});
