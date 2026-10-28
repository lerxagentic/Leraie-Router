import { describe, expect, test } from "bun:test";
import { ModelsDevCatalog } from "../../src/providers/discovery/models-dev-catalog";
import { defineModel } from "../../src/providers/model-definition";
import { validateCompatibilityProfile } from "../../src/console/providers/catalog/contracts";

describe("cloud adapter catalog contracts", () => {
  test("Alibaba provider ids resolve their models.dev provider-specific rows", () => {
    const catalog = new ModelsDevCatalog();
    expect(catalog.resolve("alibabacp", "qwen3.6-plus")).toBeDefined();
    expect(catalog.resolve("dashscope", "qwen3.6-plus")).toBeDefined();
    expect(catalog.costFor("alibabacp", "qwen3.6-plus")).toMatchObject({ input: 0, output: 0 });
  });

  test("an endpoint-less Gemini model never falls back to Anthropic Messages", () => {
    const model = defineModel({
      id: "gemini-test",
      providerId: "factory",
      wireFamily: "gemini",
    });
    expect(model.endpointPath).toBe("/v1beta/models");
  });

  test("generic compatibility profiles reject the bespoke Gemini wire", () => {
    expect(() => validateCompatibilityProfile({
      model_wire_families: [{ pattern: "gemini-*", wire_family: "gemini" }],
    })).toThrow("wire_family");
  });
});
