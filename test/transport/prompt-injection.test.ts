import { describe, expect, it } from "bun:test";
import type { CanonicalRequest, ContentPart } from "../../src/transport/canonical-model";
import {
  applyPromptInjections,
  selectPromptInjections,
  type PromptInjectionConfig,
  type PromptInjectionStoreData,
} from "../../src/transport/request/prompt-injection";

describe("selectPromptInjections", () => {
  it("stacks global -> byKey -> byModel in order", () => {
    const store: PromptInjectionStoreData = {
      global: { name: "G", text: "Global Instruction", position: "prepend", enabled: true },
      byKey: {
        key123: { name: "K", text: "Key Instruction", position: "append", enabled: true },
      },
      byModel: {
        "anthropic/claude-3-7-sonnet": { name: "M", text: "Model Instruction", position: "append", enabled: true },
      },
    };
    const selected = selectPromptInjections(store, {
      apiKeyId: "key123",
      requestedModel: "claude-3-7-sonnet",
      resolvedModel: "anthropic/claude-3-7-sonnet",
    });
    expect(selected.map((s: PromptInjectionConfig) => s.name)).toEqual(["G", "K", "M"]);
  });

  it("prioritizes byVariant over byModel", () => {
    const store: PromptInjectionStoreData = {
      global: { name: "G", text: "Global", enabled: true },
      byVariant: {
        "coding-expert": {
          name: "V",
          model: "deepseek/deepseek-chat",
          text: "Variant Instruction",
          enabled: true,
        },
      },
      byModel: {
        "deepseek/deepseek-chat": { name: "M", text: "Model Instruction", enabled: true },
      },
    };
    const selected = selectPromptInjections(store, {
      apiKeyId: "key123",
      requestedModel: "coding-expert",
      resolvedModel: "deepseek/deepseek-chat",
    });
    expect(selected.map((s: PromptInjectionConfig) => s.name)).toEqual(["G", "V"]);
  });

  it("ignores disabled injections", () => {
    const store: PromptInjectionStoreData = {
      global: { name: "G", text: "Global", enabled: false },
      byKey: {
        k1: { name: "K", text: "Key", enabled: true },
      },
    };
    const selected = selectPromptInjections(store, { apiKeyId: "k1" });
    expect(selected.map((s: PromptInjectionConfig) => s.name)).toEqual(["K"]);
  });
});

describe("applyPromptInjections", () => {
  const baseRequest: CanonicalRequest = {
    model: "test-model",
    stream: false,
    source_surface: "chat",
    generation_controls: {},
    system: [{ kind: "text", text: "Base System" }],
    messages: [
      {
        role: "user",
        content: [{ kind: "text", text: "Hello" }],
      },
    ],
  };

  it("prepends and appends system text properly", () => {
    const injections: PromptInjectionConfig[] = [
      { name: "P", text: "Front Instruction", position: "prepend", enabled: true },
      { name: "A", text: "Back Instruction", position: "append", enabled: true },
    ];
    const updated = applyPromptInjections(baseRequest, injections);
    expect(updated.system).toBeDefined();
    const texts = updated.system!.map((p: ContentPart) => (p.kind === "text" ? p.text : ""));
    expect(texts[0]).toBe("Front Instruction\n\nBase System\n\nBack Instruction");
  });

  it("inserts chat script (fake turns) before user messages", () => {
    const injections: PromptInjectionConfig[] = [
      {
        name: "Script",
        mode: "chat",
        turns: [
          { role: "user", content: "Prime Question" },
          { role: "assistant", content: "Prime Answer" },
        ],
        enabled: true,
      },
    ];
    const updated = applyPromptInjections(baseRequest, injections);
    expect(updated.messages.length).toBe(3);
    expect(updated.messages[0]?.role).toBe("user");
    expect((updated.messages[0]?.content[0] as { text: string }).text).toBe("Prime Question");
    expect(updated.messages[1]?.role).toBe("assistant");
    expect((updated.messages[1]?.content[0] as { text: string }).text).toBe("Prime Answer");
    expect(updated.messages[2]?.role).toBe("user");
    expect((updated.messages[2]?.content[0] as { text: string }).text).toBe("Hello");
  });

  it("merges trailing user turn with first real user turn to keep alternating roles", () => {
    const injections: PromptInjectionConfig[] = [
      {
        name: "Script",
        mode: "chat",
        turns: [
          { role: "user", content: "Prime Only User" },
        ],
        enabled: true,
      },
    ];
    const updated = applyPromptInjections(baseRequest, injections);
    expect(updated.messages.length).toBe(1);
    expect(updated.messages[0]?.role).toBe("user");
    expect((updated.messages[0]?.content[0] as { text: string }).text).toBe("Prime Only User\n\nHello");
  });

  it("is idempotent and fail-open", () => {
    const injections: PromptInjectionConfig[] = [
      { name: "P", text: "Front Instruction", position: "prepend", enabled: true },
    ];
    const first = applyPromptInjections(baseRequest, injections);
    const second = applyPromptInjections(first, injections);
    const text1 = (first.system![0] as { text: string }).text;
    const text2 = (second.system![0] as { text: string }).text;
    expect(text1).toBe(text2);
  });
});
