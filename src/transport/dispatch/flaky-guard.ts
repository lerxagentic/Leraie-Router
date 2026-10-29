/**
 * Anti-Flaky Guard (9Router Pro parity).
 *
 * Inspects finished upstream HTTP responses for empty bodies or degenerate
 * repetition loops ("OK.OK.OK.OK..."). Fail-open by design: anything
 * unrecognized or malformed is treated as acceptable rather than throwing.
 * Tool calls and reasoning-only answers are never flagged.
 */

export interface FlakyVerdict {
  readonly flaky: boolean;
  readonly reason?: "empty" | "degenerate" | undefined;
}

const DEGENERATE_MIN_LENGTH = 24;
const DEGENERATE_COVERAGE = 0.8;
const DEGENERATE_MIN_REPEATS = 4;
const WORD_RUN_MIN = 8;

export interface ExtractedSignals {
  readonly text: string;
  readonly hasTools: boolean;
  readonly hasReasoning: boolean;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (typeof part === "string") out += part;
      else if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        out += (part as Record<string, unknown>).text as string;
      }
    }
    return out;
  }
  return "";
}

/**
 * Extracts { text, hasTools, hasReasoning } from standard LLM response payloads:
 * OpenAI Chat, Claude Messages, OpenAI Responses, Gemini.
 */
export function extractResponseSignals(json: unknown): ExtractedSignals {
  const none: ExtractedSignals = { text: "", hasTools: false, hasReasoning: false };
  if (!json || typeof json !== "object" || Array.isArray(json)) return none;
  const obj = json as Record<string, unknown>;

  // OpenAI Chat / Completions
  const choices = Array.isArray(obj.choices) ? (obj.choices as Array<Record<string, unknown>>) : null;
  const choice = choices && choices.length > 0 ? choices[0] : null;
  if (choice && (choice.message || choice.delta)) {
    const msg = (choice.message || choice.delta || {}) as Record<string, unknown>;
    const text = textFromContent(msg.content);
    const hasTools = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    const hasReasoning =
      typeof msg.reasoning_content === "string" && msg.reasoning_content.trim().length > 0;
    return { text, hasTools, hasReasoning };
  }

  // Claude Messages
  if (obj.type === "message" && Array.isArray(obj.content)) {
    let text = "";
    let hasTools = false;
    let hasReasoning = false;
    for (const block of obj.content as Array<Record<string, unknown>>) {
      if (!block) continue;
      if (block.type === "text" && typeof block.text === "string") text += block.text;
      else if (block.type === "tool_use") hasTools = true;
      else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim().length > 0) {
        hasReasoning = true;
      }
    }
    return { text, hasTools, hasReasoning };
  }

  // OpenAI Responses wire
  if (Array.isArray(obj.output)) {
    let text = "";
    let hasTools = false;
    let hasReasoning = false;
    for (const item of obj.output as Array<Record<string, unknown>>) {
      if (!item) continue;
      if (item.type === "function_call" || item.type === "custom_tool_call") hasTools = true;
      else if (item.type === "reasoning") hasReasoning = true;
      else if (Array.isArray(item.content)) text += textFromContent(item.content);
    }
    return { text, hasTools, hasReasoning };
  }

  // Gemini parts
  const candidates = Array.isArray(obj.candidates) ? (obj.candidates as Array<Record<string, unknown>>) : null;
  const candidate = candidates && candidates.length > 0 ? candidates[0] : null;
  const content = candidate?.content as Record<string, unknown> | undefined;
  if (content && Array.isArray(content.parts)) {
    let text = "";
    let hasTools = false;
    for (const part of content.parts as Array<Record<string, unknown>>) {
      if (!part) continue;
      if (typeof part.text === "string" && part.thought !== true) text += part.text;
      if (part.functionCall || part.function_call) hasTools = true;
      if (part.inlineData || part.inline_data) text += " ";
    }
    return { text, hasTools, hasReasoning: false };
  }

  return none;
}

/**
 * Checks if a string repeats a short substring until it dominates the answer.
 */
export function isDegenerateText(text: unknown): boolean {
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length < DEGENERATE_MIN_LENGTH) return false;

  for (let u = 1; u <= 16; u++) {
    const unit = t.slice(0, u);
    if (!unit.trim()) continue;
    let covered = 0;
    while (covered + u <= t.length && t.startsWith(unit, covered)) covered += u;
    const rest = t.slice(covered);
    const tailOk = rest.length > 0 && rest.length < u && unit.startsWith(rest);
    if (
      (covered === t.length || tailOk) &&
      covered >= t.length * DEGENERATE_COVERAGE &&
      covered / u >= DEGENERATE_MIN_REPEATS
    ) {
      return true;
    }
  }

  const words = t.split(/\s+/);
  if (words.length >= 12) {
    let run = 1;
    let maxRun = 1;
    for (let i = 1; i < words.length; i++) {
      run = words[i] === words[i - 1] ? run + 1 : 1;
      if (run > maxRun) maxRun = run;
    }
    if (maxRun >= WORD_RUN_MIN && maxRun / words.length >= 0.5) return true;
  }

  return false;
}

/**
 * Classifies a finished parsed JSON response.
 */
export function detectFlakyResponse(json: unknown): FlakyVerdict {
  try {
    if (!json || typeof json !== "object" || Array.isArray(json)) return { flaky: false };
    const { text, hasTools, hasReasoning } = extractResponseSignals(json);
    if (hasTools || hasReasoning) return { flaky: false };
    if (!text || !text.trim()) return { flaky: true, reason: "empty" };
    if (isDegenerateText(text)) return { flaky: true, reason: "degenerate" };
    return { flaky: false };
  } catch {
    return { flaky: false };
  }
}
