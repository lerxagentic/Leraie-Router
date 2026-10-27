import type { CanonicalRequest } from "../../transport/canonical-model";
import type { ProviderDispatchTarget } from "../provider-registry";
import type { ApiKeyProviderSpec } from "./configured-provider";

const HERMES_PROVIDER_ID = "hermes" as const;

/** Portal attribution tags required by the Nous Research inference API. */
const HERMES_PORTAL_TAGS = ["product=hermes-agent", "client=hermes-client-v0.13.0"] as const;

function injectHermesTags(
  payload: Record<string, unknown>,
  _request: CanonicalRequest,
  _candidate: ProviderDispatchTarget,
): void {
  payload["tags"] = [...HERMES_PORTAL_TAGS];
}



import { defineModel } from "../model-definition";
import type { ModelDefinition } from "../provider-registry";

import { isRecord } from "../../protocol/primitives";
import {
  boundedUpstreamArray,
  boundedUpstreamNumber,
  sanitizeUpstreamLabel,
} from "../provider-metadata";

export const HERMES_MODELS: readonly ModelDefinition[] = [
  defineModel({ id: "poolside/laguna-s-2.1:free", ctx: 262144, out: 131072, reasoning: true, free: true }),
  defineModel({ id: "poolside/laguna-xs-2.1:free", ctx: 262144, out: 32768, reasoning: true, free: true }),
  defineModel({ id: "stepfun/step-3.7-flash:free", ctx: 262144, out: 256000, vision: true, reasoning: true, free: true }),
  defineModel({ id: "upstage/solar-mini4:free", ctx: 524288, out: 131072, reasoning: true, free: true }),
  defineModel({ id: "reflection/beam-1.0-501b-a23b:free", ctx: 262144, out: 131072, reasoning: true, free: true }),
  defineModel({ id: "meituan/longcat-2.5-preview:free", ctx: 1048576, out: 131072, vision: true, reasoning: true, free: true }),
  defineModel({ id: "ornith/ornith-1.5-122b:free", ctx: 262144, out: 262144, vision: true, reasoning: true, free: true }),
];


/**
 * Nous Research (Hermes) — chat-only, with provider-specific portal `tags`
 * injected through the spec's `prePayload` hook. The registry builds the
 * adapter via `createApiKeyAdapter`.
 */
export const HERMES_SPEC: ApiKeyProviderSpec = {
  provider_id: HERMES_PROVIDER_ID,
  endpoint_paths_by_wire_family: {},
  prePayload: injectHermesTags,
};

/**
 * Hermes' `/v1/models` is OpenRouter-shaped and needs no credential.
 */
export async function discoverHermesFreeModels(options: {
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
}): Promise<readonly ModelDefinition[] | null> {
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/models`;
  const signal = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: "application/json" }, signal });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const rec = isRecord(payload) ? payload : undefined;
  const rows = rec === undefined ? undefined : boundedUpstreamArray(rec["data"]);
  if (rows === undefined) return null;

  const byId = new Map<string, ModelDefinition>();
  for (const entry of rows) {
    if (!isRecord(entry)) continue;
    const id = sanitizeUpstreamLabel(entry["id"]);
    if (id === undefined) continue;
    if (!isFreePriced(entry)) continue;

    const context = boundedUpstreamNumber(entry["context_length"], { min: 1, max: 1_000_000_000 }) ?? undefined;
    const topProvider = isRecord(entry["top_provider"]) ? entry["top_provider"] : undefined;
    const output =
      boundedUpstreamNumber(topProvider?.["max_completion_tokens"], { min: 1, max: 1_000_000_000 }) ?? undefined;
    const architecture = isRecord(entry["architecture"]) ? entry["architecture"] : undefined;
    const inputs = boundedUpstreamArray(architecture?.["input_modalities"]) ?? [];
    const hasImage = inputs.includes("image");

    byId.set(
      id,
      defineModel({
        id,
        wireFamily: "chat",
        endpoint: "/v1/chat/completions",
        ...(context !== undefined ? { ctx: context } : {}),
        ...(output !== undefined ? { out: output } : {}),
        vision: hasImage,
        reasoning: true,
        toolCall: true,
        free: true,
      }),
    );
  }
  return [...byId.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

function isFreePriced(entry: Record<string, unknown>): boolean {
  const pricing = entry["pricing"];
  if (!isRecord(pricing)) return false;
  const prompt = Number(pricing["prompt"]);
  const completion = Number(pricing["completion"]);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return false;
  return prompt === 0 && completion === 0;
}
