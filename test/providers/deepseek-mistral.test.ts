import { describe, expect, test } from "bun:test";
import { DEEPSEEK_MODELS } from "../../src/providers/integrations/deepseek";
import { MISTRAL_MODELS } from "../../src/providers/integrations/mistral";
import { createDeepseekAnthropicAdapter } from "../../src/providers/integrations/anthropic";
import { PROVIDER_CAPABILITIES } from "../../src/providers/default-registry";

describe("DeepSeek and Mistral static catalog & adapter", () => {
  test("DEEPSEEK_MODELS defines expected models with correct wire and capabilities", () => {
    expect(DEEPSEEK_MODELS.length).toBeGreaterThanOrEqual(3);
    const modelIds = DEEPSEEK_MODELS.map((m) => m.modelId);
    expect(modelIds).toContain("deepseek-v4-pro");
    expect(modelIds).toContain("deepseek-v4.1-flash");
    expect(modelIds).toContain("deepseek-flash");

    for (const m of DEEPSEEK_MODELS) {
      expect(m.wireFamily).toBe("messages");
      expect(m.endpointPath).toBe("/v1/messages");
      expect(m.toolCall).toBe(true);
    }
  });

  test("MISTRAL_MODELS defines expected frontier models", () => {
    expect(MISTRAL_MODELS.length).toBeGreaterThanOrEqual(2);
    const modelIds = MISTRAL_MODELS.map((m) => m.modelId);
    expect(modelIds).toContain("mistral-large-latest");
    expect(modelIds).toContain("mistral-medium-latest");

    for (const m of MISTRAL_MODELS) {
      expect(m.wireFamily).toBe("chat");
      expect(m.toolCall).toBe(true);
      expect(m.modalities.input).toContain("image");
    }
  });

  test("createDeepseekAnthropicAdapter builds an Anthropic-compatible adapter routed to deepseek /anthropic", () => {
    const adapter = createDeepseekAnthropicAdapter();
    expect(adapter.provider_id).toBe("anthropic");
    expect(typeof adapter.dispatch).toBe("function");
  });

  test("PROVIDER_CAPABILITIES resolves static models for deepseek and mistral", async () => {
    const deepseekModels = await PROVIDER_CAPABILITIES.deepseek.loadModels?.();
    expect(deepseekModels).toBeDefined();
    expect(deepseekModels?.length).toBeGreaterThanOrEqual(3);

    const mistralModels = await PROVIDER_CAPABILITIES.mistral.loadModels?.();
    expect(mistralModels).toBeDefined();
    expect(mistralModels?.length).toBeGreaterThanOrEqual(2);
  });
});
