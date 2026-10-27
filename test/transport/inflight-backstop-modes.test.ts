import { expect, test } from "bun:test";
import { createGatewayApp } from "../../src/app";

test("route-only mode registers the in-flight ghost backstop when a scheduler is supplied", () => {
  const names: string[] = [];
  createGatewayApp({
    mode: "route-only",
    dashboardDist: "/nonexistent",
    scheduledTasks: { register(task: { name: string }) { names.push(task.name); } } as never,
  });
  expect(names).toContain("inflight-backstop");
});
