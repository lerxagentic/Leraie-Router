/**
 * Buddy-family media generation: image and video.
 *
 * CodeBuddy (intl) and WorkBuddy serve media through the same facade, so shared
 * request shaping lives here. Their image endpoint can differ by provider;
 * identity headers come from {@link codebuddyHeaders} keyed on the variant.
 *
 * Two image paths are supported: CodeBuddy can use its native
 * `/images/generations` API, while WorkBuddy keeps its chat-completion image
 * path. The configured provider path selects the wire format.
 *
 * - **Video** (`seedance-2.5`) is implemented as an async task: submission
 *   expects a task ID, then the adapter polls a sibling task URL until a clip
 *   appears or the task fails/times out.
 */
import { OpenAICompatibleAdapter, authHeaders, type OpenAICompatibleAdapterConfig } from "../../compatible-adapter";
import { GatewayError } from "../../../transport/gateway-error";
import { isRecord, joinUrl } from "../../../protocol/primitives";
import { decodeSseEvents } from "../../../transport/streaming";
import { postUpstreamJson } from "../../../protocol/transport/openai";
import { imageCreatedSeconds, imagePrompt } from "../../../protocol/image-generation";
import { abortGatewayError, createUpstreamDeadlineLifecycle } from "../../operations/upstream-deadline";
import { mapUpstreamHttpError } from "../../../transport/failure-policy";
import type { ImageGenerationOutcome, ProviderDispatchContext, ProviderDispatchTarget, ValidatedOutboundFetch } from "../../provider-registry";
import type { CanonicalRequest } from "../../../transport/canonical-model";
import { codebuddyHeaders, type CodeBuddyVariant } from "./codebuddy-shared";
import { applyBuddySystemPrompt, buddyPrePayloadCommon } from "./buddy-chat-shared";

/** Media adapter identity: the variant's headers, its leading system turn, and base URL. */
export interface BuddyMediaConfig {
  readonly variant: CodeBuddyVariant;
  readonly systemPrompt: string;
  readonly baseUrl: string;
  readonly imageGenerationPath?: string;
  readonly buildHeaders?: (
    context: ProviderDispatchContext,
    request?: CanonicalRequest,
  ) => Promise<Record<string, string>>;
}

async function mediaIdentityHeaders(
  config: BuddyMediaConfig,
  context: ProviderDispatchContext,
): Promise<Record<string, string>> {
  const request = context.request_headers
    ? ({ model: "", messages: [] } as unknown as CanonicalRequest)
    : undefined;
  return config.buildHeaders
    ? config.buildHeaders(context, request)
    : codebuddyHeaders(config.variant, context, request);
}

function outbound(context: ProviderDispatchContext): ValidatedOutboundFetch {
  return context.outbound_fetch ?? (globalThis.fetch as unknown as ValidatedOutboundFetch);
}

function bearer(context: ProviderDispatchContext): Record<string, string> {
  return authHeaders("authorization_bearer", context.credential.secret, context.credential.credential_kind);
}

function modelOf(body: Record<string, unknown>, candidate: ProviderDispatchTarget): string {
  return candidate.model_id.length > 0 ? candidate.model_id : typeof body.model === "string" ? body.model : "";
}

/**
 * Extracts generated images from the accumulated chat text.
 */
export function extractChatImages(text: string): Record<string, unknown>[] {
  const images: Record<string, unknown>[] = [];
  for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
    const url = match[1];
    if (url !== undefined) images.push({ url });
  }
  for (const match of text.matchAll(/data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
    const subtype = match[1];
    const b64 = match[2];
    if (subtype !== undefined && b64 !== undefined) {
      images.push({ b64_json: b64, mime_type: `image/${subtype}` });
    }
  }
  return images;
}

/**
 * Generates an image through the buddy chat wire or native image endpoint.
 */
export async function buddyGenerateImage(
  config: BuddyMediaConfig,
  body: Record<string, unknown>,
  candidate: ProviderDispatchTarget,
  context: ProviderDispatchContext,
): Promise<ImageGenerationOutcome> {
  const model = modelOf(body, candidate);
  if (model.length === 0) throw new GatewayError("invalid_request", 400, "model is required");
  const prompt = imagePrompt(body);
  if (config.imageGenerationPath !== undefined) {
    const requestBody: Record<string, unknown> = { model, prompt };
    if (typeof body.size === "string" && body.size.trim().length > 0) requestBody["size"] = body.size.trim();
    if (typeof body.n === "number" && Number.isInteger(body.n) && body.n >= 1) requestBody["n"] = body.n;
    const { res, release } = await postUpstreamJson(
      joinUrl(config.baseUrl, config.imageGenerationPath),
      {
        "content-type": "application/json",
        accept: "application/json",
        ...bearer(context),
        ...(await mediaIdentityHeaders(config, context)),
      },
      requestBody,
      context,
      outbound(context),
    );
    let responseBody: unknown;
    try {
      if (!res.ok) throw await mapUpstreamHttpError(res, "codebuddy");
      responseBody = await res.json();
    } finally {
      release();
    }
    if (!isRecord(responseBody)) {
      throw new GatewayError("platform_unavailable", 502, "CodeBuddy image generation returned an invalid response", {}, "upstream");
    }
    const providerError = buddyErrorOf(responseBody);
    if (providerError !== undefined) {
      throw new GatewayError("platform_unavailable", 502, providerError, {}, "upstream");
    }
    if (responseBody.code !== undefined && responseBody.code !== 0 && responseBody.code !== "0") {
      const message =
        typeof responseBody.msg === "string" && responseBody.msg.trim().length > 0
          ? responseBody.msg.trim()
          : `CodeBuddy image generation failed with code ${String(responseBody.code)}`;
      throw new GatewayError("platform_unavailable", 502, message, {}, "upstream");
    }
    if (!isRecord(responseBody.data)) {
      throw new GatewayError("platform_unavailable", 502, "CodeBuddy image generation returned no image data", {}, "upstream");
    }
    const result = responseBody.data;
    if (!Array.isArray(result.data) || result.data.some((image) => !isRecord(image))) {
      throw new GatewayError("platform_unavailable", 502, "CodeBuddy image generation returned malformed image data", {}, "upstream");
    }
    if (result.data.length === 0) {
      throw new GatewayError("platform_unavailable", 502, "CodeBuddy image generation returned no images", {}, "upstream");
    }
    return {
      ...(typeof result.created === "number" ? { created: result.created } : {}),
      data: result.data,
      ...(isRecord(result.usage) ? { usage: result.usage } : {}),
    };
  }
  const payload: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: "user", content: prompt }],
  };
  buddyPrePayloadCommon(payload, undefined);
  const messages = payload["messages"];
  if (Array.isArray(messages)) {
    applyBuddySystemPrompt(messages as Array<Record<string, unknown>>, config.systemPrompt);
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...bearer(context),
    ...(await mediaIdentityHeaders(config, context)),
  };
  const lifecycle = createUpstreamDeadlineLifecycle(context);
  let response: Response;
  try {
    response = await outbound(context)(joinUrl(config.baseUrl, candidate.endpoint_path), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: lifecycle.signal,
    });
  } catch (error: unknown) {
    const abortError = abortGatewayError(lifecycle, error, context.abort_signal);
    if (abortError) throw abortError;
    throw new GatewayError(
      "platform_unavailable",
      502,
      `CodeBuddy image generation unreachable: ${error instanceof Error ? error.message : String(error)}`,
      {},
      "upstream",
    );
  } finally {
    lifecycle.release();
  }
  if (!response.ok) {
    throw await mapUpstreamHttpError(response, "codebuddy");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const parsed: unknown = await response.json().catch(() => null);
    const message = buddyErrorOf(parsed) ?? "CodeBuddy image generation returned a non-stream body";
    throw new GatewayError("platform_unavailable", 502, message, {}, "upstream");
  }
  let content = "";
  for await (const event of decodeSseEvents(response.body, { signal: context.abort_signal })) {
    const data = event.data.trim();
    if (data.length === 0 || data === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (isRecord(parsed.error)) {
      const message = isRecord(parsed.error) && typeof parsed.error.message === "string" ? parsed.error.message : "CodeBuddy image generation failed";
      throw new GatewayError("platform_unavailable", 502, message, {}, "upstream");
    }
    const choices = parsed.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) continue;
    const delta = (choices[0] as Record<string, unknown>).delta;
    if (isRecord(delta) && typeof delta.content === "string") content += delta.content;
  }
  const images = extractChatImages(content);
  if (images.length === 0) {
    throw new GatewayError(
      "platform_unavailable",
      502,
      "CodeBuddy image generation returned no image in the chat stream",
      {},
      "upstream",
    );
  }
  return { created: imageCreatedSeconds(), data: images };
}

const VIDEO_PENDING = new Set(["queued", "pending", "running", "in_progress", "processing", "generating"]);
const VIDEO_POLL_TIMEOUT_MS = 180_000;
const VIDEO_POLL_INTERVAL_MS = 3_000;

function taskIdOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : payload;
  const id = data.id ?? data.task_id ?? data.taskId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function videoUrlOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : payload;
  const content = isRecord(data.content) ? data.content : undefined;
  const candidates = [content?.video_url, data.video_url, data.url, content?.url];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function videoStatusOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : payload;
  const status = data.status;
  return typeof status === "string" ? status.toLowerCase() : undefined;
}

export function buddyErrorOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (!isRecord(error)) return undefined;
  const data = isRecord(error.data) ? error.data : error;
  const msg = data.msg ?? data.message ?? error.msg ?? error.message;
  if (typeof msg === "string" && msg.trim().length > 0) return msg.trim();
  const code = data.code ?? error.code;
  return typeof code === "number" || typeof code === "string" ? `CodeBuddy error ${code}` : "CodeBuddy request failed";
}

/**
 * Generates a video through the Buddy native task API.
 */
export async function buddyGenerateVideo(
  config: BuddyMediaConfig,
  body: Record<string, unknown>,
  candidate: ProviderDispatchTarget,
  context: ProviderDispatchContext,
): Promise<Record<string, unknown>> {
  const model = modelOf(body, candidate);
  if (model.length === 0) throw new GatewayError("invalid_request", 400, "model is required");
  const prompt = imagePrompt(body);
  const submitBody: Record<string, unknown> = { model, prompt };
  if (typeof body.n === "number" && Number.isFinite(body.n)) submitBody["n"] = Math.max(1, Math.floor(body.n));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...bearer(context),
    ...(await mediaIdentityHeaders(config, context)),
  };
  const submitPath = candidate.endpoint_path;
  const submitUrl = joinUrl(config.baseUrl, submitPath);
  if (typeof body.size === "string" && body.size.trim().length > 0) submitBody["size"] = body.size.trim();
  const { res, release } = await postUpstreamJson(
    submitUrl,
    headers,
    submitBody,
    context,
    outbound(context),
  );
  let submitted: unknown;
  try {
    if (!res.ok) {
      throw await mapUpstreamHttpError(res, "codebuddy");
    }
    submitted = await res.json();
  } finally {
    release();
  }
  const taskId = taskIdOf(submitted);
  if (taskId === undefined) {
    const url = videoUrlOf(submitted);
    if (url !== undefined) return { data: [{ url }] };
    const message = buddyErrorOf(submitted) ?? "CodeBuddy video submit returned no task id";
    throw new GatewayError("platform_unavailable", 502, message, {}, "upstream");
  }
  const taskPath = `${submitUrl.replace(/\/+$/, "")}/${taskId}`;
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  for (;;) {
    if (context.abort_signal?.aborted) {
      throw new GatewayError("transport_closed", 499, "video generation aborted");
    }
    const lifecycle = createUpstreamDeadlineLifecycle(context);
    let statusRes: Response;
    try {
      statusRes = await outbound(context)(taskPath, {
        method: "GET",
        headers: { accept: "application/json", ...bearer(context), ...(await mediaIdentityHeaders(config, context)) },
        signal: lifecycle.signal,
      });
    } catch (error: unknown) {
      const abortError = abortGatewayError(lifecycle, error, context.abort_signal);
      if (abortError) throw abortError;
      throw new GatewayError("platform_unavailable", 502, `CodeBuddy video status unreachable: ${error instanceof Error ? error.message : String(error)}`, {}, "upstream");
    } finally {
      lifecycle.release();
    }
    if (!statusRes.ok) {
      throw await mapUpstreamHttpError(statusRes, "codebuddy");
    }
    const payload: unknown = await statusRes.json();
    const url = videoUrlOf(payload);
    if (url !== undefined) return { data: [{ url }], task_id: taskId };
    const status = videoStatusOf(payload);
    if (status !== undefined && !VIDEO_PENDING.has(status)) {
      throw new GatewayError("platform_unavailable", 502, `CodeBuddy video task ended in state "${status}" with no clip`, {}, "upstream");
    }
    if (Date.now() > deadline) {
      throw new GatewayError("platform_unavailable", 504, `CodeBuddy video task ${taskId} did not finish within ${VIDEO_POLL_TIMEOUT_MS}ms`, {}, "upstream");
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
  }
}

/**
 * Chat-compatible adapter that also serves the buddy media surfaces.
 */
export class BuddyMediaAdapter extends OpenAICompatibleAdapter {
  readonly #media: BuddyMediaConfig;

  constructor(config: OpenAICompatibleAdapterConfig, media: BuddyMediaConfig) {
    super(config);
    this.#media = media;
  }

  async generateImage(
    body: Record<string, unknown>,
    candidate: ProviderDispatchTarget,
    context: ProviderDispatchContext,
  ): Promise<ImageGenerationOutcome> {
    return buddyGenerateImage(this.#media, body, candidate, context);
  }

  async generateVideo(
    body: Record<string, unknown>,
    candidate: ProviderDispatchTarget,
    context: ProviderDispatchContext,
  ): Promise<Record<string, unknown>> {
    return buddyGenerateVideo(this.#media, body, candidate, context);
  }
}
