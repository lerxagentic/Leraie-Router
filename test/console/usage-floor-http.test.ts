/**
 * End-to-end check of the usage-floor HTTP surface against the *real* production
 * database, exercised through the same Elysia routes the dashboard calls.
 *
 * A live browser session cannot be forged (the session token is stored hashed),
 * so this mounts the real routes with a real `DrizzleProviderDetailStore` and an
 * access resolver that returns a platform-admin decision. Everything except the
 * cookie check is the production code path: body schema, bounds, validation,
 * upsert, and the response the dashboard reads.
 *
 * Run with DATABASE_URL pointing at production, e.g.:
 *   bun test test/console/usage-floor-http.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createProviderDetailRoutes } from "../../src/console/providers/detail/routes";
import { DrizzleProviderDetailStore } from "../../src/console/providers/detail/store";
import { getDb, type CartethyiaDatabase } from "../../src/persistence/postgres";
import { createAccessDecision, consoleSessionScopes } from "../../src/security/access-control";

const databaseUrl = process.env.DATABASE_URL;
const provider = "workbuddy";

function adminAccess() {
  return createAccessDecision({
    id: "usage-floor-http-test",
    tenantId: "314db87d-b7ed-412b-98c2-f54589c0c714",
    scopes: consoleSessionScopes(true),
    admissionIdentity: "usage-floor-http-test",
  });
}

describe.skipIf(databaseUrl === undefined)("usage floor over the real HTTP routes", () => {
  let db: CartethyiaDatabase | undefined;

  afterAll(async () => {
    // Leave no floor behind: production routing must not inherit a test setting.
    if (db !== undefined) {
      const store = new DrizzleProviderDetailStore(db);
      // Reset the unit too: the credit-unit test would otherwise leave the row
      // reporting a unit no floor is using, which the panel then renders.
      await store.updateRouting(provider, "314db87d-b7ed-412b-98c2-f54589c0c714", {
        usageFloor: null,
        usageFloorUnit: "percent",
      });
    }
  });

  test("round-trips a percent floor through PATCH then GET", async () => {
    db = getDb();
    const store = new DrizzleProviderDetailStore(db);
    const app = createProviderDetailRoutes({
      store,
      accessResolver: () => adminAccess(),
    } as never);

    const patchResponse = await app.handle(
      new Request(`http://localhost/providers/${provider}/routing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usageFloor: 25, usageFloorUnit: "percent" }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as Record<string, unknown>;
    expect(patched.usageFloor).toBe(25);
    expect(patched.usageFloorUnit).toBe("percent");

    const getResponse = await app.handle(
      new Request(`http://localhost/providers/${provider}/routing`),
    );
    expect(getResponse.status).toBe(200);
    const read = (await getResponse.json()) as Record<string, unknown>;
    expect(read.usageFloor).toBe(25);
    expect(read.usageFloorUnit).toBe("percent");
    // The pre-existing credit limit must survive a floor write untouched.
    expect(typeof read.creditLimit).toBe("number");
  });

  test("accepts the credit unit", async () => {
    db = getDb();
    const app = createProviderDetailRoutes({
      store: new DrizzleProviderDetailStore(db),
      accessResolver: () => adminAccess(),
    } as never);

    const response = await app.handle(
      new Request(`http://localhost/providers/${provider}/routing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usageFloor: 250, usageFloorUnit: "credit" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.usageFloor).toBe(250);
    expect(body.usageFloorUnit).toBe("credit");
  });

  test("clearing the floor stores null rather than zero", async () => {
    db = getDb();
    const app = createProviderDetailRoutes({
      store: new DrizzleProviderDetailStore(db),
      accessResolver: () => adminAccess(),
    } as never);

    const response = await app.handle(
      new Request(`http://localhost/providers/${provider}/routing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usageFloor: null }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // A stored 0 would mean "exclude every account"; null means "no floor".
    expect(body.usageFloor).toBeNull();
  });

  test("rejects an out-of-range floor and an unknown unit", async () => {
    db = getDb();
    const app = createProviderDetailRoutes({
      store: new DrizzleProviderDetailStore(db),
      accessResolver: () => adminAccess(),
    } as never);

    const tooBig = await app.handle(
      new Request(`http://localhost/providers/${provider}/routing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usageFloor: 1_000_001 }),
      }),
    );
    expect(tooBig.status).toBeGreaterThanOrEqual(400);
    expect(tooBig.status).toBeLessThan(500);

    const badUnit = await app.handle(
      new Request(`http://localhost/providers/${provider}/routing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usageFloor: 10, usageFloorUnit: "percentage" }),
      }),
    );
    expect(badUnit.status).toBeGreaterThanOrEqual(400);
    expect(badUnit.status).toBeLessThan(500);
  });
});
