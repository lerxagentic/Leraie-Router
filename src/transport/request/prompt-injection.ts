/**
 * Prompt Injection & Model Variants Engine for Lerx Router.
 * Ported and enhanced from 9Router Pro (Gienetic).
 *
 * Scopes:
 * - global: applied to all requests
 * - byKey: applied to specific API key
 * - byModel: applied to specific provider/model
 * - byKeyModel: applied when both key and model match
 * - byVariant: applied when an alias variant is called
 *
 * Modes:
 * - single: prepends or appends system instructions
 * - chat: inserts multi-turn conversational script (fake history) before the real chat
 */
import type { CanonicalMessage, CanonicalRequest, ContentPart } from "../canonical-model";

export interface InjectedChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface PromptInjectionConfig {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly mode?: "single" | "chat" | undefined;
  readonly text?: string | undefined;
  readonly content?: string | undefined; // synonym for text
  readonly position?: "prepend" | "append" | undefined;
  readonly turns?: readonly InjectedChatTurn[] | undefined;
  readonly enabled?: boolean | undefined;
}

export interface PromptInjectionStoreData {
  global?: PromptInjectionConfig | null;
  byKey?: Record<string, PromptInjectionConfig>;
  byModel?: Record<string, PromptInjectionConfig>;
  byKeyModel?: Record<string, Record<string, PromptInjectionConfig>>;
  byVariant?: Record<string, PromptInjectionConfig & { model?: string }>;
}

export interface PromptResolutionContext {
  readonly apiKeyId?: string | null;
  readonly requestedModel?: string | null;
  readonly resolvedModel?: string | null;
}

/** Resolves active prompt injections matching the given request context. */
export function selectPromptInjections(
  data: PromptInjectionStoreData | undefined,
  context: PromptResolutionContext,
): PromptInjectionConfig[] {
  if (!data) return [];
  const results: PromptInjectionConfig[] = [];

  // 1. Global
  if (data.global && data.global.enabled !== false) {
    results.push(data.global);
  }

  // 2. By API Key
  if (context.apiKeyId && data.byKey?.[context.apiKeyId]) {
    const keyInject = data.byKey[context.apiKeyId];
    if (keyInject && keyInject.enabled !== false) {
      results.push(keyInject);
    }
  }

  // 3. Variant or Model
  let variantFound = false;
  if (context.requestedModel && data.byVariant?.[context.requestedModel]) {
    const variant = data.byVariant[context.requestedModel];
    if (variant && variant.enabled !== false) {
      results.push(variant);
      variantFound = true;
    }
  }

  if (!variantFound) {
    const modelTarget = context.resolvedModel ?? context.requestedModel;
    if (modelTarget && data.byModel?.[modelTarget]) {
      const modelInject = data.byModel[modelTarget];
      if (modelInject && modelInject.enabled !== false) {
        results.push(modelInject);
      }
    }
  }

  // 4. By Key + Model
  if (context.apiKeyId && data.byKeyModel?.[context.apiKeyId]) {
    const keyModelMap = data.byKeyModel[context.apiKeyId];
    const target = context.resolvedModel ?? context.requestedModel;
    if (keyModelMap && target && keyModelMap[target]) {
      const kmInject = keyModelMap[target];
      if (kmInject && kmInject.enabled !== false) {
        results.push(kmInject);
      }
    }
  }

  return results.filter((inj) => {
    if (inj.mode === "chat") {
      return Array.isArray(inj.turns) && inj.turns.length > 0;
    }
    const txt = (inj.text ?? inj.content)?.trim();
    return typeof txt === "string" && txt.length > 0;
  });
}

/** Injects prompt instructions and chat turns into a CanonicalRequest. */
export function applyPromptInjections(
  request: CanonicalRequest,
  injections: readonly PromptInjectionConfig[],
): CanonicalRequest {
  if (!injections.length) return request;

  let current = request;

  // Separate single system prompt injections vs chat script turns
  const singles = injections.filter((i) => i.mode !== "chat");
  const chats = injections.filter((i) => i.mode === "chat");

  // 1. Apply single system prompts
  if (singles.length > 0) {
    const prepends = singles
      .filter((s) => s.position === "prepend")
      .map((s) => (s.text ?? s.content)?.trim())
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    const appends = singles
      .filter((s) => s.position !== "prepend")
      .map((s) => (s.text ?? s.content)?.trim())
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    if (prepends.length > 0 || appends.length > 0) {
      const existingSystemParts = current.system ?? [];
      const existingText = existingSystemParts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text)
        .join("\n\n")
        .trim();

      let baseText = existingText;
      const activePrepends: string[] = [];
      for (const p of prepends) {
        if (baseText.startsWith(p)) {
          // already present at start
          continue;
        }
        activePrepends.push(p);
      }

      const activeAppends: string[] = [];
      for (const a of appends) {
        if (baseText.endsWith(a)) {
          // already present at end
          continue;
        }
        activeAppends.push(a);
      }

      const combinedPieces: string[] = [];
      if (activePrepends.length > 0) combinedPieces.push(activePrepends.join("\n\n"));
      if (baseText.length > 0) combinedPieces.push(baseText);
      if (activeAppends.length > 0) combinedPieces.push(activeAppends.join("\n\n"));

      const finalSystemText = combinedPieces.join("\n\n");
      const alreadyMatches =
        existingSystemParts.length === 1 &&
        existingSystemParts[0]?.kind === "text" &&
        existingSystemParts[0].text === finalSystemText;

      if (!alreadyMatches) {
        const newSystem: readonly ContentPart[] = [{ kind: "text", text: finalSystemText }];
        current = {
          ...current,
          system: newSystem,
          persona_injected: true,
        };
      }
    }
  }

  // 2. Apply chat scripts (fake turns)
  if (chats.length > 0) {
    const allTurns = chats.flatMap((c) => c.turns ?? []);
    if (allTurns.length > 0) {
      const messages = [...current.messages];

      // Convert turns to canonical messages
      const fakeMessages: CanonicalMessage[] = allTurns.map((turn) => ({
        role: turn.role,
        content: [{ kind: "text", text: turn.content }],
      }));

      // Merge trailing user turn if the first real user message is also a user turn
      if (messages.length > 0 && messages[0]?.role === "user" && fakeMessages[fakeMessages.length - 1]?.role === "user") {
        const lastFake = fakeMessages[fakeMessages.length - 1]!;
        const firstReal = messages[0]!;
        const lastFakeText = (lastFake.content[0] as { text: string }).text;
        const firstRealText = firstReal.content
          .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
          .map((p) => p.text)
          .join("\n\n");

        const mergedText = `${lastFakeText}\n\n${firstRealText}`;
        messages[0] = {
          ...firstReal,
          content: [{ kind: "text", text: mergedText }],
        };
        fakeMessages.pop();
      }

      current = {
        ...current,
        messages: [...fakeMessages, ...messages],
      };
    }
  }

  return current;
}
