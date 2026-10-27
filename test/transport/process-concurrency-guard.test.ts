import { describe, expect, test } from "bun:test";
import {
  createProcessConcurrencyController,
  createProcessConcurrencyMiddleware,
} from "../../src/transport/middleware/process-concurrency-guard";

describe("process concurrency guard", () => {
  test("refuses past the process cap and releases idempotently", () => {
    const controller = createProcessConcurrencyController(2);
    const first = controller.tryAcquire();
    const second = controller.tryAcquire();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(controller.tryAcquire()).toBeUndefined();
    first?.(); first?.();
    expect(controller.activeCount()).toBe(1);
    expect(controller.tryAcquire()).toBeDefined();
  });

  test("returns a retryable 503 and does not count health or console", async () => {
    const controller = createProcessConcurrencyController(1);
    const app = createProcessConcurrencyMiddleware(controller)
      .post("/v1/chat/completions", () => "ok")
      .get("/health", () => "healthy")
      .get("/console", () => "console");
    const held = controller.tryAcquire();
    const refused = await app.handle(new Request("http://x/v1/chat/completions", { method: "POST" }));
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("3");
    expect(await app.handle(new Request("http://x/health"))).toMatchObject({ status: 200 });
    expect(await app.handle(new Request("http://x/console"))).toMatchObject({ status: 200 });
    expect(controller.activeCount()).toBe(1);
    held?.();
  });
});
