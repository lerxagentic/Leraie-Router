/**
 * The buddy media path, against the shape cb actually answers.
 *
 * Image and video are the two generation surfaces the buddy family serves, and
 * both are easy to get subtly wrong, so these assertions are about the
 * *contract* rather than string output:
 *
 * - **CodeBuddy image generation is native.** The request must use
 *   `/images/generations` and preserve size/count; its nested response envelope
 *   must be normalized to the gateway's image outcome.
 * - **cb refuses over HTTP 200.** Exhausted credits arrive as a 200 JSON
 *   envelope `{error:{data:{code,msg}}}`, not a 4xx. Surfacing `msg` verbatim is
 *   the difference between "top up" and a meaningless "no image".
 * - **video is an async task.** A submit returns `{data:{id,status:queued}}`;
 *   the clip is fetched from a sibling task endpoint, so the adapter has to poll
 *   until it stops being queued.
 *
 * The upstream is a mock: these run without credits, and they lock the request
 * shape and the poll loop, which is the part under our control.
 */
import { describe, expect, test } from "bun:test";
import {
  BuddyMediaAdapter,
  buddyErrorOf,
  extractChatImages,
} from "../../src/providers/integrations/buddy/buddy-media";
import type { ProviderDispatchContext, ProviderDispatchTarget } from "../../src/providers/provider-registry";

const IMAGE_TARGET = {
  provider_id: "cb",
  model_id: "gemini-3.1-flash-image",
  wire_family: "chat",
  endpoint_path: "/images/generations",
  capabilities: {},
} as unknown as ProviderDispatchTarget;

const VIDEO_TARGET = {
  provider_id: "cb",
  model_id: "seedance-2.5",
  wire_family: "chat",
  endpoint_path: "/videos/generations",
  capabilities: {},
} as unknown as ProviderDispatchTarget;

function context(fetcher: typeof fetch): ProviderDispatchContext {
  return {
    credential: { provider_id: "cb", credential_kind: "api_key", secret: new TextEncoder().encode("sk-cb") },
    deadline: Date.now() + 30_000,
    abort_signal: new AbortController().signal,
    outbound_fetch: fetcher as never,
  } as unknown as ProviderDispatchContext;
}

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown> | null;
  readonly headers: Record<string, string>;
}

function capture(responder: (call: Captured, index: number) => Response): { fetcher: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const call: Captured = {
      url: String(url),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers,
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function adapter(): BuddyMediaAdapter {
  const cfg = {
    provider_id: "cb" as const,
    base_url: "https://www.codebuddy.ai/v2",
    authentication_header_shape: "authorization_bearer" as const,
  };
  return new BuddyMediaAdapter(cfg as never, {
    variant: "IDE",
    systemPrompt: "SYSTEM",
    baseUrl: "https://www.codebuddy.ai/v2",
    imageGenerationPath: "/images/generations",
  });
}

describe("buddyGenerateImage — CodeBuddy native image endpoint", () => {
  test("sends size and count and normalizes the nested success envelope", async () => {
    const { fetcher, calls } = capture(() => new Response(
      JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          created: 1_700_000_000,
          data: [{ url: "https://cdn.example.com/generated-1.png" }],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const result = await adapter().generateImage(
      { prompt: "draw a rabbit", size: "1024x1024", n: 1 },
      IMAGE_TARGET,
      context(fetcher),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://www.codebuddy.ai/v2/images/generations");
    expect(calls[0]?.body).toEqual({
      model: "gemini-3.1-flash-image",
      prompt: "draw a rabbit",
      size: "1024x1024",
      n: 1,
    });
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer sk-cb");
    expect(result.created).toBe(1_700_000_000);
    expect(result.data).toEqual([{ url: "https://cdn.example.com/generated-1.png" }]);
  });

  test("unwraps a code-level refusal even when HTTP status is 200", async () => {
    const { fetcher } = capture(() => new Response(
      JSON.stringify({
        code: 11140,
        msg: "insufficient credits: please recharge your account",
        data: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    expect(
      adapter().generateImage({ prompt: "draw a rabbit" }, IMAGE_TARGET, context(fetcher)),
    ).rejects.toThrow("insufficient credits: please recharge your account");
  });

  test("surfaces cb's nested error.data message", async () => {
    const { fetcher } = capture(() => new Response(
      JSON.stringify({
        error: { data: { code: 11141, msg: "prompt violates safety policy" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    expect(
      adapter().generateImage({ prompt: "unsafe" }, IMAGE_TARGET, context(fetcher)),
    ).rejects.toThrow("prompt violates safety policy");
  });
});

describe("extractChatImages — WorkBuddy chat stream extractor", () => {
  test("finds markdown image URLs", () => {
    const text = "Here is your picture:\n\n![a cat](https://images.example.com/cat.png)\nEnjoy!";
    expect(extractChatImages(text)).toEqual([{ url: "https://images.example.com/cat.png" }]);
  });

  test("finds inline base64 data URIs", () => {
    const text = "Result: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA";
    expect(extractChatImages(text)).toEqual([{
      b64_json: "iVBORw0KGgoAAAANSUhEUgAA",
      mime_type: "image/png",
    }]);
  });

  test("returns empty for text with no image", () => {
    expect(extractChatImages("Sorry, I cannot draw that.")).toEqual([]);
  });
});

describe("buddyGenerateVideo — task submission and poll loop", () => {
  test("submits, polls until ready, and returns the clip", async () => {
    let pollCount = 0;
    const { fetcher, calls } = capture((call) => {
      if (call.url.endsWith("/videos/generations")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { id: "task-42", status: "queued" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (call.url.endsWith("/task-42")) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({ data: { status: "running" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              status: "succeeded",
              video_url: "https://cdn.example.com/clip-42.mp4",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const result = await adapter().generateVideo(
      { prompt: "a tree in the wind" },
      VIDEO_TARGET,
      context(fetcher),
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe("https://www.codebuddy.ai/v2/videos/generations");
    expect(calls[0]?.body).toEqual({
      model: "seedance-2.5",
      prompt: "a tree in the wind",
    });
    expect(calls[1]?.url).toBe("https://www.codebuddy.ai/v2/videos/generations/task-42");
    expect(calls[2]?.url).toBe("https://www.codebuddy.ai/v2/videos/generations/task-42");
    expect(result).toEqual({
      data: [{ url: "https://cdn.example.com/clip-42.mp4" }],
      task_id: "task-42",
    });
  });

  test("returns synchronous clip without polling when the submit already carries it", async () => {
    const { fetcher, calls } = capture(() => new Response(
      JSON.stringify({
        data: { url: "https://cdn.example.com/instant.mp4" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const result = await adapter().generateVideo(
      { prompt: "instant" },
      VIDEO_TARGET,
      context(fetcher),
    );

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ data: [{ url: "https://cdn.example.com/instant.mp4" }] });
  });

  test("fails when the task ends in a failed state", async () => {
    const { fetcher } = capture((call) => {
      if (call.url.endsWith("/videos/generations")) {
        return new Response(
          JSON.stringify({ data: { id: "task-fail" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ data: { status: "failed" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    expect(
      adapter().generateVideo({ prompt: "fail" }, VIDEO_TARGET, context(fetcher)),
    ).rejects.toThrow('CodeBuddy video task ended in state "failed" with no clip');
  });
});

describe("buddyErrorOf", () => {
  test("extracts error.data.msg", () => {
    expect(buddyErrorOf({ error: { data: { msg: "no quota" } } })).toBe("no quota");
  });

  test("falls back to error.code when no msg is given", () => {
    expect(buddyErrorOf({ error: { data: { code: 11140 } } })).toBe("CodeBuddy error 11140");
  });

  test("returns undefined for a payload without error", () => {
    expect(buddyErrorOf({ code: 0, data: {} })).toBeUndefined();
    expect(buddyErrorOf(null)).toBeUndefined();
  });
});
