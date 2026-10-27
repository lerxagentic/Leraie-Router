/**
 * The buddy-family static catalog row.
 *
 * CodeBuddy (intl + CN) and WorkBuddy describe their static fallback catalogs
 * with the same seven-field tuple and build each row the same way, differing
 * only in the wire endpoint the row targets. Both had their own copy of the
 * tuple type and the builder, so a new column meant editing two identical
 * declarations.
 *
 * Only the row shape and the builder are shared. Identity headers are not:
 * `codebuddyHeaders` and `workbuddyHeaders` send genuinely different bytes
 * (`X-Product`/`X-IDE-Type`/`X-Domain` versus `origin`/`referer` and the
 * account-derived `x-user-id`/`x-machine-id`/`x-session-id`), and those stay
 * with their own provider.
 */
import { GatewayError } from "../../../transport/gateway-error";
import { defineModel } from "../../model-definition";
import type { ModelDefinition } from "../../provider-registry";

/** One static catalog row: id, display name, flags, limits, optional tool override. */
export type BuddyRawEntry = readonly [
  string,
  string,
  boolean,
  boolean,
  number | null,
  number | null,
  /** Explicit tool support. Omitted → derived from the base catalog. */
  boolean?,
];

/** The image-generation ids the international buddy providers serve. */
const BUDDY_IMAGE_MODEL_IDS: readonly { id: string; endpoint: string; ctx: number; out: number }[] = [
  { id: "gemini-2.5-flash-image", endpoint: "/chat/completions", ctx: 1_000_000, out: 64_000 },
  { id: "gemini-3.0-pro-image", endpoint: "/chat/completions", ctx: 1_000_000, out: 64_000 },
  { id: "gemini-3.1-flash-image", endpoint: "/chat/completions", ctx: 1_000_000, out: 64_000 },
  { id: "gpt-image-2", endpoint: "/chat/completions", ctx: 400_000, out: 128_000 },
  { id: "gpt-image-2.5-sunburst", endpoint: "/chat/completions", ctx: 400_000, out: 128_000 },
  { id: "hy-image-3.5", endpoint: "/chat/completions", ctx: 1_000_000, out: 64_000 },
];

/** The video-generation ids the international buddy providers serve. */
const BUDDY_VIDEO_MODEL_IDS: readonly { id: string; endpoint: string; ctx: number; out: number }[] = [
  { id: "seedance-2.5", endpoint: "/videos/generations", ctx: 1_000_000, out: 128_000 },
  { id: "kling-video-v3", endpoint: "/videos/generations", ctx: 1_000_000, out: 128_000 },
];

export const BUDDY_IMAGE_MODEL_ID_SET: ReadonlySet<string> = new Set(
  BUDDY_IMAGE_MODEL_IDS.map((entry) => entry.id),
);

export const BUDDY_VIDEO_MODEL_ID_SET: ReadonlySet<string> = new Set(
  BUDDY_VIDEO_MODEL_IDS.map((entry) => entry.id),
);

const BUDDY_CN_IMAGE_MODEL_IDS: readonly { id: string; ctx: number; out: number }[] = [
  { id: "hunyuan-image-alpha", ctx: 1_000_000, out: 64_000 },
];

export const BUDDY_CN_IMAGE_MODEL_ID_SET: ReadonlySet<string> = new Set(
  BUDDY_CN_IMAGE_MODEL_IDS.map((entry) => entry.id),
);

export const BUDDY_PRO_ONLY_MODEL_IDS: ReadonlySet<string> = new Set([
  "primary-model",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "gpt-5.5",
  "gpt-5.4",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "grok-4.6",
  "grok-4.7",
  "kimi-k3.1-pro-highspeed",
  "claude-opus-4.6",
  "claude-opus-4.7-1m",
]);

export function makeBuddyImageModels(
  providerId: string,
  endpoint: string,
): readonly ModelDefinition[] {
  return BUDDY_IMAGE_MODEL_IDS.map((entry) =>
    defineModel({
      id: entry.id,
      providerId,
      serviceKind: "imageGeneration",
      wireFamily: "chat",
      endpoint,
      ctx: entry.ctx,
      out: entry.out,
      vision: true,
      output: ["image"],
      toolCall: false,
    }),
  );
}

export function makeBuddyVideoModels(
  providerId: string,
  endpoint: string,
): readonly ModelDefinition[] {
  return BUDDY_VIDEO_MODEL_IDS.map((entry) =>
    defineModel({
      id: entry.id,
      providerId,
      serviceKind: "videoGeneration",
      wireFamily: "chat",
      endpoint,
      ctx: entry.ctx,
      out: entry.out,
      vision: true,
      output: ["video"],
      toolCall: false,
    }),
  );
}

export function makeBuddyCnImageModels(
  providerId: string,
  endpoint: string,
): readonly ModelDefinition[] {
  return BUDDY_CN_IMAGE_MODEL_IDS.map((entry) =>
    defineModel({
      id: entry.id,
      providerId,
      serviceKind: "imageGeneration",
      wireFamily: "chat",
      endpoint,
      ctx: entry.ctx,
      out: entry.out,
      vision: true,
      output: ["image"],
      toolCall: false,
    }),
  );
}

/**
 * Builds one buddy catalog row.
 */
export function makeBuddyModel(
  entry: BuddyRawEntry,
  providerId: string,
  endpoint?: string,
  realm: "intl" | "cn" = "intl",
): ModelDefinition {
  if (!entry[0]) throw new GatewayError("invalid_request", 400, "invalid model");
  const proOnly = realm === "intl" && BUDDY_PRO_ONLY_MODEL_IDS.has(entry[0].toLowerCase());
  return defineModel({
    id: entry[0],
    providerId,
    ...(endpoint === undefined ? {} : { endpoint }),
    reasoning: entry[2],
    vision: entry[3],
    ctx: entry[4],
    out: entry[5],
    ...(entry[6] === undefined ? {} : { toolCall: entry[6] }),
    ...(proOnly ? { proOnly: true } : {}),
  });
}

/**
 * The shared model roster for the two international buddy sites.
 */
export const BUDDY_SHARED_RAW: readonly BuddyRawEntry[] = [
  ["auto", "Auto", true, true, 168_000, 64_000],
  ["primary-model", "Primary", true, true, 272_000, 72_000],
  ["claude-opus-4.6", "Claude Opus 4.6", true, true, 200_000, 64_000],
  ["claude-opus-4.7-1m", "Claude Opus 4.7 1M", true, true, 1_000_000, 64_000],
  ["claude-sonnet-4.6", "Claude Sonnet 4.6", true, true, 200_000, 32_000],
  ["deepseek-v4.1-flash", "DeepSeek V4.1 Flash", true, false, 1_000_000, 384_000],
  ["deepseek-v4.1-flash-sg", "DeepSeek V4.1 Flash SG", true, false, 1_000_000, 128_000],
  ["deepseek-v4.1-pro", "DeepSeek V4.1 Pro", true, false, 1_000_000, 384_000],
  ["gemini-2.5-flash-image", "Gemini 2.5 Flash Image", true, true, 1_000_000, 64_000],
  ["gemini-3.0-pro-image", "Gemini 3.0 Pro Image", true, true, 1_000_000, 64_000],
  ["gemini-3.1-flash-image", "Gemini 3.1 Flash Image", true, true, 1_000_000, 64_000],
  ["gemini-3.1-pro", "Gemini 3.1 Pro", true, true, 1_048_576, 65_536],
  ["gemini-3.5-flash", "Gemini 3.5 Flash", true, true, 1_048_576, 65_536],
  ["glm-5.3", "GLM-5.3", true, false, 1_000_000, 131_072],
  ["glm-5.3-flash", "GLM-5.3 Flash", true, false, 1_000_000, 131_072],
  ["glm-5v-turbo", "GLM-5V Turbo", true, true, 200_000, 131_072],
  ["gpt-5.3-codex", "GPT-5.3 Codex", true, true, 400_000, 128_000],
  ["gpt-5.4", "GPT-5.4", true, true, 1_050_000, 128_000],
  ["gpt-5.5", "GPT-5.5", true, true, 1_050_000, 128_000],
  ["gpt-5.6-luna", "GPT-5.6 Luna", true, true, 1_050_000, 128_000],
  ["gpt-5.6-sol", "GPT-5.6 Sol", true, true, 1_050_000, 128_000],
  ["gpt-5.6-terra", "GPT-5.6 Terra", true, true, 1_050_000, 128_000],
  ["gpt-6-astra", "GPT-6 Astra", true, true, 1_050_000, 128_000],
  ["gpt-6.1-sol", "GPT-6.1 Sol", true, true, 1_050_000, 128_000],
  ["gpt-image-2", "GPT-Image-2", true, true, 400_000, 128_000],
  ["grok-4.6", "Grok 4.6", true, true, 500_000, 500_000],
  ["grok-4.7", "Grok 4.7", true, true, 500_000, 500_000],
  ["hy3", "Hy3", true, false, 1_000_000, 64_000, true],
  ["hy4-preview", "Hy4 Preview", true, false, 1_000_000, 64_000, true],
  ["hy4-preview-f", "Hy4 Preview F", true, false, 1_000_000, 64_000, true],
  ["kimi-k2.5", "Kimi K2.5", true, false, 164_000, 262_144],
  ["kimi-k2.6", "Kimi K2.6", true, false, 256_000, 262_144],
  ["kimi-k2.7", "Kimi K2.7", true, false, 256_000, 65_536],
  ["kimi-k2.8-preview", "Kimi K2.8 Preview", true, false, 256_000, 65_536],
  ["kimi-k3", "Kimi K3", true, false, 1_048_576, 131_072],
  ["kimi-k3.1", "Kimi K3.1", true, false, 1_000_000, 131_072],
  ["minimax-m3", "MiniMax-M3", true, false, 512_000, 512_000],
];
