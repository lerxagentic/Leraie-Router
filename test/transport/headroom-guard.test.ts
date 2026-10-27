import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createMemoryHeadroomMiddleware } from "../../src/transport/middleware/memory-headroom-guard";
import { ProxyRequestStateStore } from "../../src/transport/request/state";

const snapshot = () => ({ rssBytes: 64, limitBytes: 512, sampledAtMs: Date.now() });
function app(minFreeBytes: number) {
  const stateStore = new ProxyRequestStateStore(undefined);
  return new Elysia()
    .use(createMemoryHeadroomMiddleware({ stateStore, memorySnapshot: snapshot, minFreeBytes }))
    .post("/v1/messages", () => "gateway")
    .get("/health", () => "ok")
    .get("/console", () => "console");
}
describe("memory headroom guard", () => {
  test("sheds v1 requests when reserved headroom is exhausted", async () => {
    const response = await app(500).handle(new Request("http://x/v1/messages", { method: "POST" }));
    expect(response.status).toBe(503);
  });
  test("leaves health and console traffic exempt", async () => {
    const instance = app(500);
    expect((await instance.handle(new Request("http://x/health"))).status).toBe(200);
    expect((await instance.handle(new Request("http://x/console"))).status).toBe(200);
  });
  test("allows v1 traffic with sufficient headroom", async () => {
    expect((await app(0).handle(new Request("http://x/v1/messages", { method: "POST" }))).status).toBe(200);
  });
});
