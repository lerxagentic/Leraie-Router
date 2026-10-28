import { describe, expect, test } from "bun:test";
import { PROVIDER_CAPABILITIES } from "../../src/providers/default-registry";
import {
  createAlibabaCodingPlanAdapter,
} from "../../src/providers/integrations/alibabacp/alibabacp";
import { alibabacpBaseUrl } from "../../src/providers/integrations/alibabacp/alibabacp-oauth";
import { cloudflareBaseUrl } from "../../src/providers/integrations/cloudflareai/cloudflareai";
import {
  encodeAlibabaCodingPlanCredential,
} from "../../src/security/credential-codec";
import type { CanonicalRequest } from "../../src/transport/canonical-model";
import type { ProviderDispatchContext, ProviderDispatchTarget } from "../../src/providers/provider-registry";

const REQUEST = {
  model: "qwen3.6-plus",
  messages: [{ role: "user", content: [{ kind: "text", text: "hi" }] }],
  generation_controls: {},
  stream: false,
  source_surface: "chat",
} as CanonicalRequest;

const TARGET = {
  provider_id: "alibabacp",
  model_id: "qwen3.6-plus",
  wire_family: "chat",
  endpoint_path: "/chat/completions",
  capabilities: {},
} as ProviderDispatchTarget;

describe("Factory, Cloudflare AI, and Alibaba provider registry", () => {
  test("all cloud adapters expose adapter, OAuth, and static model capabilities", async () => {
    for (const id of ["factory", "cloudflareai", "alibabacp"] as const) {
      const capability = PROVIDER_CAPABILITIES[id];
      expect(capability).toBeDefined();
      expect((await capability.loadAdapter()).provider_id).toBe(id);
      expect((await capability.loadModels?.())?.length).toBeGreaterThan(0);
      expect((await capability.loadAuthentication?.())?.client).toBeDefined();
    }
  });

  test("Cloudflare path segments are URL encoded", () => {
    expect(cloudflareBaseUrl("account/a", "gateway b")).toBe(
      "https://gateway.ai.cloudflare.com/v1/account%2Fa/gateway%20b/anthropic",
    );
  });

  test("Alibaba region mapping is explicit", () => {
    expect(alibabacpBaseUrl("international")).toContain("ap-southeast-1");
    expect(alibabacpBaseUrl("china")).toContain("cn-beijing");
    expect(alibabacpBaseUrl("unknown")).toBeUndefined();
  });

  test("Alibaba dispatch uses credential region host and inner token", async () => {
    let seenUrl = "";
    let seenAuthorization = "";
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      seenUrl = String(url);
      const headers = new Headers(init?.headers);
      seenAuthorization = headers.get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 1,
          model: "qwen3.6-plus",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const adapter = createAlibabaCodingPlanAdapter(fetcher);
    const secret = new TextEncoder().encode(
      encodeAlibabaCodingPlanCredential({ token: "inner-token", region: "china" }),
    );
    const context = {
      credential: { credential_kind: "oauth", secret },
      deadline: Date.now() + 60_000,
      abort_signal: new AbortController().signal,
    } as unknown as ProviderDispatchContext;
    for await (const _event of adapter.dispatch(REQUEST, TARGET, context)) void _event;
    expect(seenUrl).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(seenAuthorization).toBe("Bearer inner-token");
  });
});
