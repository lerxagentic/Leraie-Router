import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { OpenAICompatibleAdapterConfig } from "../../compatible-adapter";
import { withBearerAuthentication } from "../../compatible-adapter";
import type { CanonicalRequest } from "../../../transport/canonical-model";
import type {
  ProviderDispatchContext,
  ProviderDispatchTarget,
  ProviderId,
} from "../../provider-registry";
import { resolveInboundSessionId } from "../../operations/session-resolution";
import {
  buildWorkBuddyUserAgent,
  getWorkBuddyClientVersion,
  getWorkBuddyCliVersion,
} from "../../operations/client-versions";
import { buddyConversationHeaders } from "./buddy-conversation-headers";
import { buddyCliHeaders, buddyCliTraceHeaders } from "./buddy-cli-headers";
import { buddyEnterprise, buddyUserId, resolveBuddyDeviceBinding, resolveBuddyIdentity } from "./buddy-identity";
import {
  getTuringDeviceTokenService,
  resolveTuringSdkRoot,
  type TuringSdkConfig,
  WORKBUDDY_TURING_CONFIG,
} from "./turing-device-token";

/**
 * WorkBuddy serves chat from a versioned path on a base URL that carries no
 * version segment (billing uses the unversioned `/billing/…` path), so both the
 * adapter config and the static catalog rows must state it. The generic
 * `/chat/completions` default would join into
 * `https://www.workbuddy.ai/chat/completions`, which that upstream answers with
 * a 405 HTML error page.
 */
export const WORKBUDDY_CHAT_PATH = "/v2/chat/completions" as const;

export {
  buildWorkBuddyUserAgent,
  getWorkBuddyClientVersion,
  getWorkBuddyCliVersion,
};

/** WorkBuddy international gateway domain (Origin/Referer/X-Domain). */
export const WORKBUDDY_DOMAIN = "www.workbuddy.ai";

/**
 * Stable per-account device identifiers.
 *
 * WorkBuddy's desktop client presents one fixed virtual device per account.
 * Deriving `X-Machine-ID` / `X-Session-ID` from the account id (sha256, 36 hex)
 * keeps them constant across restarts while staying distinct per account, so
 * multiple pooled accounts are not correlated by a missing or drifting device
 * fingerprint. Mirrors the reference gateway's `wb2a:<purpose>:<uid>` scheme.
 */
function deriveAccountStableId(accountId: string, purpose: string): string {
  const sum = createHash("sha256").update(`wb2a:${purpose}:${accountId}`).digest("hex");
  return sum.slice(0, 36);
}

/**
 * Desktop risk token, sent only when the account actually has one.
 */
const DEVICE_TOKEN_FILE_MAX_BYTES = 1024;
const DEVICE_TOKEN_FILE_TTL_MS = 5 * 60_000;
let deviceTokenFileCache: { readonly value: string | undefined; readonly readAt: number } | undefined;

export function readBuddyDeviceToken(context?: ProviderDispatchContext): string | undefined {
  const state = context?.credential.auth_state;
  const value = state?.["deviceToken"] ?? state?.["device_token"];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return readDeviceTokenFile();
}

function readDeviceTokenFile(): string | undefined {
  const now = Date.now();
  if (deviceTokenFileCache !== undefined && now - deviceTokenFileCache.readAt < DEVICE_TOKEN_FILE_TTL_MS) {
    return deviceTokenFileCache.value;
  }
  const path = process.env["CARTETHYIA_DEVICE_TOKEN_FILE"] ?? "/app/data/device_token";
  let value: string | undefined;
  try {
    const raw = readFileSync(path);
    if (raw.byteLength > 0 && raw.byteLength <= DEVICE_TOKEN_FILE_MAX_BYTES) {
      const text = raw.toString("utf8").trim();
      if (text.length > 0) value = text;
    }
  } catch {
    value = undefined;
  }
  deviceTokenFileCache = { value, readAt: now };
  return value;
}

/**
 * Per-request WorkBuddy chat headers — the exact desktop-client contract.
 */
export async function workbuddyHeaders(
  context?: ProviderDispatchContext,
  request?: CanonicalRequest,
  domain = WORKBUDDY_DOMAIN,
  clientVersion = getWorkBuddyClientVersion(),
  cliIdentity?: boolean,
): Promise<Record<string, string>> {
  const identity = resolveBuddyIdentity(context, cliIdentity);
  const conversation = buddyConversationHeaders({
    ...(resolveInboundSessionId(context, request) === undefined
      ? {}
      : { conversationId: resolveInboundSessionId(context, request) }),
    messageIdStyle: identity === "desktop" ? "uuid" : "hex",
  });
  const accountId = context?.credential.account_id;
  if (identity === "cli") {
    return {
      accept: "application/json",
      "user-agent": `CLI/${getWorkBuddyCliVersion()} CodeBuddy/${getWorkBuddyCliVersion()}`,
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
      "x-domain": domain,
      "x-agent-purpose": "conversation",
      "x-ide-name": "CLI",
      "x-ide-type": "CLI",
      "x-ide-version": getWorkBuddyCliVersion(),
      "x-product": "SaaS",
      "x-no-enterprise-id": "1",
      ...conversation,
      ...buddyCliTraceHeaders(conversation),
      ...buddyCliHeaders({
        userId: buddyUserId(context),
        enterpriseId: buddyEnterprise(context),
      }),
    };
  }
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "user-agent": buildWorkBuddyUserAgent(clientVersion, getWorkBuddyCliVersion()),
    origin: `https://${domain}`,
    referer: `https://${domain}/`,
    "accept-language": "en-US",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
    "x-domain": domain,
    "x-agent-purpose": "conversation",
    "x-ide-name": "WorkBuddy",
    "x-ide-type": "WorkBuddy",
    "x-ide-version": clientVersion,
    "x-product": "SaaS",
    "x-no-enterprise-id": "1",
  };
  Object.assign(headers, conversation);
  if (accountId) {
    headers["x-user-id"] = accountId;
    headers["x-machine-id"] = deriveAccountStableId(accountId, "machine");
    headers["x-session-id"] = deriveAccountStableId(accountId, "session");
  }
  const binding = resolveBuddyDeviceBinding(context);
  if (binding !== undefined) {
    headers["x-device-id-list"] = JSON.stringify({ qimei36: binding });
  }
  Object.assign(headers, await buddyDeviceTokenHeaders({
    realm: domain.endsWith(".cn") ? "cn" : "intl",
    context,
    cliIdentity,
  }));
  return headers;
}

export async function buddyDeviceTokenHeaders(args: {
  realm: "intl" | "cn";
  context: ProviderDispatchContext | undefined;
  cliIdentity: boolean | undefined;
  turingConfig?: TuringSdkConfig;
}): Promise<Record<string, string>> {
  const { context, cliIdentity, turingConfig } = args;
  void args.realm;
  if (resolveBuddyIdentity(context, cliIdentity) === "cli") return {};
  if (resolveTuringSdkRoot() !== null) {
    const sdkHeaders = await getTuringDeviceTokenService(turingConfig ?? WORKBUDDY_TURING_CONFIG).headersForRequest(false);
    if (sdkHeaders["x-device-token"] !== undefined) return sdkHeaders;
  }
  const token = readBuddyDeviceToken(context);
  if (token !== undefined) return { "x-device-token": token };
  return { "x-device-token-error": "sdk_not_initialized" };
}

/**
 * Shared OpenAI-compatible chat-adapter config for WorkBuddy: bearer auth
 * (api_key and oauth both use `Authorization: Bearer`), `/v2/chat/completions`
 * endpoint, per-request desktop-client headers, and the payload hook.
 */
export function workbuddyAdapterConfig(args: {
  providerId: ProviderId;
  baseUrl: string;
  prePayload: (
    payload: Record<string, unknown>,
    request: CanonicalRequest,
    candidate: ProviderDispatchTarget,
  ) => void;
  fetchImpl?: typeof fetch;
}): OpenAICompatibleAdapterConfig {
  return withBearerAuthentication({
    provider_id: args.providerId,
    base_url: args.baseUrl,
    endpoint_paths_by_wire_family: { chat: WORKBUDDY_CHAT_PATH },
    buildExtraHeaders: (context, request) => workbuddyHeaders(context, request),
    prePayload: args.prePayload,
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
  });
}

