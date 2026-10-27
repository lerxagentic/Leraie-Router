import { describe, expect, test } from "bun:test";
import { apiKeyMatchesSearch, filterApiKeys } from "../../src/lib/api-key-search";

describe("API-key list search", () => {
  const production = {
    id: "production",
    label: "Production gateway",
    keyPrefix: "rk_prod_",
    modelList: ["openai/gpt-5", "anthropic/claude-sonnet"],
  };
  const keys = [
    production,
    { id: "staging", label: "Staging", keyPrefix: "rk_stage_", modelList: ["google/gemini-3"] },
  ];

  test("matches label, displayed key prefix, and allowed models without case sensitivity", () => {
    expect(apiKeyMatchesSearch(production, "PROD")).toBe(true);
    expect(apiKeyMatchesSearch(production, "RK_PROD")).toBe(true);
    expect(apiKeyMatchesSearch(production, "CLAUDE-SONNET")).toBe(true);
  });

  test("requires every whitespace-separated search term to match some searchable field", () => {
    expect(filterApiKeys(keys, "production gpt-5").map((key) => key.id)).toEqual(["production"]);
    expect(filterApiKeys(keys, "production gemini")).toEqual([]);
  });

  test("treats blank search as an unfiltered copy and tolerates missing optional fields", () => {
    expect(filterApiKeys(keys, " \t ")).toEqual(keys);
    expect(apiKeyMatchesSearch({ label: "Unprefixed" }, "unprefixed")).toBe(true);
  });
});
