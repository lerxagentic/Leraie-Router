import { Elysia } from "elysia";
import { fastPathname } from "../request/pathname";

export interface ProcessConcurrencyController {
  tryAcquire(): (() => void) | undefined;
  activeCount(): number;
  limit(): number;
}

export function createProcessConcurrencyController(limit = 64): ProcessConcurrencyController {
  const effective = Math.min(64, Math.max(1, Math.trunc(limit)));
  let active = 0;
  return {
    tryAcquire() {
      if (active >= effective) return undefined;
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      };
    },
    activeCount: () => active,
    limit: () => effective,
  };
}

export const defaultProcessConcurrencyController = createProcessConcurrencyController(
  Number(process.env.CARTETHYIA_PROCESS_CONCURRENCY_LIMIT ?? 64),
);

export function createProcessConcurrencyMiddleware(
  controller: ProcessConcurrencyController = defaultProcessConcurrencyController,
) {
  const tokens = new WeakMap<Request, () => void>();
  return new Elysia()
    .beforeHandle(({ request }) => {
      if (!fastPathname(request.url).startsWith("/v1/")) return;
      const release = controller.tryAcquire();
      if (!release) {
        return new Response(
          JSON.stringify({ error: { code: "platform_unavailable", message: "The gateway is at its concurrency limit. Retry shortly." } }),
          { status: 503, headers: { "content-type": "application/json", "retry-after": "3" } },
        );
      }
      tokens.set(request, release);
    })
    .afterResponse(({ request }) => {
      const release = tokens.get(request);
      if (!release) return;
      tokens.delete(request);
      release();
    })
    .as("plugin");
}
