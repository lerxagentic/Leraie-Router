import { describe, expect, it } from "bun:test";
import {
  buildNotificationText,
  signWebhookPayload,
  sendRouterNotification,
  type NotificationSettings,
} from "../../src/observability/notifier";

describe("notifier", () => {
  it("builds formatted notification text correctly", () => {
    const text = buildNotificationText("account_cooldown", {
      title: "WorkBuddy Rate Limit Hit",
      model: "deepseek-v4.1-flash",
      providerId: "workbuddy",
      error: "429 Too Many Requests",
    });
    expect(text).toContain("[Lerx Router] account_cooldown");
    expect(text).toContain("WorkBuddy Rate Limit Hit");
    expect(text).toContain("Model: deepseek-v4.1-flash");
    expect(text).toContain("Provider: workbuddy");
    expect(text).toContain("Error: 429 Too Many Requests");
  });

  it("signs webhook payload with sha256 HMAC", () => {
    const secret = "supersecret";
    const body = JSON.stringify({ hello: "world" });
    const sig = signWebhookPayload(secret, body);
    expect(sig).toBeString();
    expect(sig.length).toBe(64); // 32 bytes hex
  });

  it("skips channels when disabled", async () => {
    const config: NotificationSettings = {
      telegram: { enabled: false },
      webhook: { enabled: false },
    };
    const res = await sendRouterNotification("test", { title: "Test" }, config);
    expect(res).toEqual({ telegram: "skipped", webhook: "skipped" });
  });
});
