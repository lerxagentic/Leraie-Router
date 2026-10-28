import { describe, expect, test } from "bun:test";
import { createFactoryDroidAdapter } from "../../src/providers/integrations/factory/factory";
import { encodeFactoryDroidCredential } from "../../src/security/credential-codec";
import type { CanonicalRequest } from "../../src/transport/canonical-model";
import type { ProviderDispatchContext, ProviderDispatchTarget } from "../../src/providers/provider-registry";

const encoder = new TextEncoder();
const REQUEST = {
  model: "glm-5.1",
  messages: [{ role: "user", content: [{ kind: "text", text: "hi" }] }],
  generation_controls: {},
  stream: false,
  source_surface: "chat",
} as CanonicalRequest;

function context(fetcher: typeof fetch, customHeaders?: Record<string, string>): ProviderDispatchContext {
  return {
    outbound_fetch: fetcher,
    deadline: Date.now() + 60_000,
    abort_signal: new AbortController().signal,
    credential: {
      provider_id: "factory",
      credential_kind: "oauth",
      secret: encoder.encode(encodeFactoryDroidCredential({ accessToken: "real-token", orgId: "real-org" })),
      custom_headers: customHeaders,
    },
  } as unknown as ProviderDispatchContext;
}

const CHAT_TARGET = {
  provider_id: "factory",
  model_id: "glm-5.1",
  wire_family: "chat",
  endpoint_path: "/api/llm/o/v1/chat/completions",
  capabilities: {},
} as ProviderDispatchTarget;

const GEMINI_TARGET = {
  provider_id: "factory",
  model_id: "gemini-3.7-flash",
  wire_family: "gemini",
  endpoint_path: "/api/llm/g/v1/generate",
  capabilities: {},
} as ProviderDispatchTarget;

describe("Factory transport hardening", () => {
  test("account custom headers cannot replace Factory identity or routing headers", async () => {
    let headers = new Headers();
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const adapter = createFactoryDroidAdapter(fetcher);
    const ctx = context(fetcher, {
      "X-Factory-Org-Id": "attacker-org",
      "X-Factory-Client": "attacker-client",
      "x-api-provider": "attacker-provider",
      "x-provider-routing-source": "attacker-source",
      "x-safe-custom": "kept",
    });
    const attempt = async () => {
      for await (const _event of adapter.dispatch(REQUEST, CHAT_TARGET, ctx)) void _event;
    };
    await expect(attempt()).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
      details: { header: "X-Factory-Org-Id" },
    });
    expect(headers.get("x-factory-org-id")).toBeNull();
  });

  test("Gemini stream emits usage and a terminal event", async () => {
    const frame = {
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, thoughtsTokenCount: 4 },
    };
    const fetcher = (async () => new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;
    const request = { ...REQUEST, model: "gemini-3.7-flash", stream: true } as CanonicalRequest;
    const events: Array<Record<string, unknown>> = [];
    for await (const event of createFactoryDroidAdapter(fetcher).dispatch(
      request,
      GEMINI_TARGET,
      context(fetcher),
    )) events.push(event as unknown as Record<string, unknown>);
    const terminal = events.find((event) => event["type"] === "terminal");
    expect(terminal).toBeDefined();
    expect(terminal?.["state"]).toBe("complete");
    expect(terminal?.["usage"]).toMatchObject({ input_tokens: 2, output_tokens: 7 });
  });

  test("EU accounts reject Gemini wire with region-unavailable error", async () => {
    const fetcher = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const adapter = createFactoryDroidAdapter(fetcher);
    const ctx = {
      outbound_fetch: fetcher,
      deadline: Date.now() + 60_000,
      abort_signal: new AbortController().signal,
      credential: {
        provider_id: "factory",
        credential_kind: "oauth",
        secret: encoder.encode(encodeFactoryDroidCredential({ accessToken: "real-token", orgId: "real-org" })),
        auth_state: { region: "eu" },
      },
    } as unknown as ProviderDispatchContext;

    const attempt = async () => {
      for await (const _event of adapter.dispatch(REQUEST, GEMINI_TARGET, ctx)) void _event;
    };
    await expect(attempt()).rejects.toMatchObject({
      code: "capability_unsupported",
      status: 400,
      details: { region: "eu" },
    });
  });

  test("Gemini stream captures trailing usage-only frame after finishReason frame", async () => {
    const frame1 = {
      candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }],
    };
    const frame2 = {
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };
    const sseBody = `data: ${JSON.stringify(frame1)}\n\ndata: ${JSON.stringify(frame2)}\n\ndata: [DONE]\n\n`;
    const fetcher = (async () => new Response(sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;
    const request = { ...REQUEST, model: "gemini-3.7-flash", stream: true } as CanonicalRequest;
    const events: Array<Record<string, unknown>> = [];
    for await (const event of createFactoryDroidAdapter(fetcher).dispatch(
      request,
      GEMINI_TARGET,
      context(fetcher),
    )) events.push(event as unknown as Record<string, unknown>);
    const terminal = events.find((event) => event["type"] === "terminal");
    expect(terminal).toBeDefined();
    expect(terminal?.["state"]).toBe("complete");
    expect(terminal?.["stop_reason"]).toBe("stop");
    expect(terminal?.["usage"]).toMatchObject({ input_tokens: 10, output_tokens: 20 });
  });

  test("Gemini SAFETY finishReason maps to failed state and content_filter stop reason", async () => {
    const body = {
      candidates: [{ content: { role: "model", parts: [{ text: "unsafe" }] }, finishReason: "SAFETY" }],
    };
    const fetcher = (async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const events: Array<Record<string, unknown>> = [];
    for await (const event of createFactoryDroidAdapter(fetcher).dispatch(
      REQUEST,
      GEMINI_TARGET,
      context(fetcher),
    )) events.push(event as unknown as Record<string, unknown>);
    const terminal = events.find((event) => event["type"] === "terminal");
    expect(terminal).toBeDefined();
    expect(terminal?.["state"]).toBe("failed");
    expect(terminal?.["stop_reason"]).toBe("content_filter");
    expect(terminal?.["provider_stop_reason"]).toBe("SAFETY");
  });
});
