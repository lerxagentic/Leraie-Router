import { describe, it, expect, beforeEach } from "bun:test";
import { ResponseCache, globalResponseCache } from "../../src/transport/cache/response-cache";

describe("ResponseCache", () => {
  const sampleBody = {
    model: "openai/gpt-4o",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.7,
  };

  beforeEach(() => {
    globalResponseCache.clear();
  });

  it("builds a stable key regardless of property order", () => {
    const key1 = ResponseCache.buildCacheKey(sampleBody);
    const key2 = ResponseCache.buildCacheKey({
      temperature: 0.7,
      messages: [{ role: "user", content: "hello" }],
      model: "openai/gpt-4o",
    });
    expect(key1).not.toBeNull();
    expect(key1).toBe(key2);
  });

  it("produces different keys when any parameter changes", () => {
    const key1 = ResponseCache.buildCacheKey(sampleBody);
    const key2 = ResponseCache.buildCacheKey({ ...sampleBody, temperature: 0.8 });
    const key3 = ResponseCache.buildCacheKey({
      ...sampleBody,
      messages: [{ role: "user", content: "different" }],
    });
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("refuses streaming, tool calls, and malformed requests", () => {
    expect(ResponseCache.buildCacheKey({ ...sampleBody, stream: true })).toBeNull();
    expect(ResponseCache.buildCacheKey({ ...sampleBody, tools: [{ name: "fn" }] })).toBeNull();
    expect(ResponseCache.buildCacheKey({ ...sampleBody, tool_choice: "auto" })).toBeNull();
    expect(ResponseCache.buildCacheKey({ ...sampleBody, functions: [] })).toBeNull();
    expect(ResponseCache.buildCacheKey(null)).toBeNull();
    expect(ResponseCache.buildCacheKey({ model: "x" })).toBeNull();
  });

  it("stores, retrieves, and expires items correctly", async () => {
    const cache = new ResponseCache();
    const key = ResponseCache.buildCacheKey(sampleBody)!;
    const bytes = new TextEncoder().encode('{"id":"chatcmpl-1","choices":[{"message":{"content":"Hi"}}]}');
    
    // Put with 1 second TTL
    cache.put(key, bytes, "application/json", 1);
    
    // Hit
    const hit = cache.get(key);
    expect(hit).not.toBeNull();
    expect(new TextDecoder().decode(hit!.bytes)).toContain("chatcmpl-1");
    expect(cache.getStats().hits).toBe(1);
    
    // Wait 1.1s for expiration
    await Bun.sleep(1100);
    const expired = cache.get(key);
    expect(expired).toBeNull();
    expect(cache.getStats().misses).toBe(1);
  });
});
