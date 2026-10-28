import { describe, expect, test } from "bun:test";
import { FactoryOAuthClient } from "../../src/providers/integrations/factory/factory-oauth";

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.`;
}

describe("Factory OAuth account state", () => {
  test("device login records residency from Factory whoami", async () => {
    const access = jwt({ external_org_id: "org-1", exp: 4_102_444_800 });
    const urls: string[] = [];
    const client = new FactoryOAuthClient(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("workos.com")) {
        return new Response(JSON.stringify({ access_token: access, refresh_token: "refresh-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(new Headers(init?.headers).get("x-factory-org-id")).toBe("org-1");
      return new Response(JSON.stringify({ orgId: "org-1", region: "eu" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await client.pollDeviceAuth("device-code");
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("login did not complete");
    expect(result.result.auth_state?.["region"]).toBe("eu");
    expect(urls).toContain("https://api.factory.ai/api/cli/whoami");
  });

  test("refresh keeps a rotated refresh token", async () => {
    const access = jwt({ external_org_id: "org-1", exp: 4_102_444_800 });
    const client = new FactoryOAuthClient(async (input) => {
      const url = String(input);
      if (url.includes("workos.com")) {
        return new Response(JSON.stringify({ access_token: access, refresh_token: "refresh-2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ orgId: "org-1", region: "global" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await client.refresh("refresh-1");
    expect(result.refresh).toBe("refresh-2");
  });

  test("refresh preserves stored region and inference_region when whoami fails", async () => {
    const access = jwt({ external_org_id: "org-1", exp: 4_102_444_800 });
    const client = new FactoryOAuthClient(async (input) => {
      const url = String(input);
      if (url.includes("workos.com")) {
        return new Response(JSON.stringify({ access_token: access, refresh_token: "refresh-3" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Service Unavailable", { status: 503 });
    });
    const result = await client.refresh("refresh-2", undefined, {
      account_id: "acc-1",
      auth_state: { region: "eu", inference_region: "global" },
    });
    expect(result.auth_state?.["region"]).toBe("eu");
    expect(result.auth_state?.["inference_region"]).toBe("global");
  });
});
