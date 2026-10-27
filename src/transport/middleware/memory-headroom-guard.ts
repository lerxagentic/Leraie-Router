import { Elysia } from "elysia";
import type { RuntimeMemorySnapshot } from "../../observability/runtime-metrics";
import type { ProxyRequestStateStore } from "../request/state";

export interface MemoryHeadroomGuardDeps {
  readonly stateStore: ProxyRequestStateStore;
  readonly memorySnapshot?: () => RuntimeMemorySnapshot | undefined;
  readonly minFreeBytes?: number;
}

/** Sheds only API inference traffic before memory pressure can kill the process. */
export function createMemoryHeadroomMiddleware(deps: MemoryHeadroomGuardDeps) {
  return new Elysia()
    .beforeHandle(({ request }) => {
      const path = new URL(request.url).pathname;
      if (!(path === "/v1" || path.startsWith("/v1/"))) return;
      const snapshot = deps.memorySnapshot?.();
      if (!snapshot || snapshot.limitBytes === undefined) return;
      const reserved = deps.minFreeBytes ?? Math.floor(snapshot.limitBytes * 0.2);
      if (snapshot.rssBytes + reserved <= snapshot.limitBytes) return;
      return new Response(
        JSON.stringify({
          error: {
            code: "platform_unavailable",
            message: "The gateway is under memory pressure. Retry shortly.",
            details: { retryAfterMs: 1000, activeRequests: deps.stateStore.activeCount() },
          },
        }),
        { status: 503, headers: { "content-type": "application/json", "retry-after": "1" } },
      );
    })
    .as("plugin");
}
