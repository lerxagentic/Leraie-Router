/**
 * Outbound Notification Engine for Lerx Router.
 * Ported and adapted from 9Router Pro (Gienetic).
 *
 * Supports Telegram Bot and HMAC-signed Webhook alerts.
 * Completely fail-open: a notification failure never interrupts traffic.
 */
import { createHmac } from "node:crypto";
import { log } from "./logger";

export interface TelegramNotificationConfig {
  readonly enabled: boolean;
  readonly botToken?: string | undefined;
  readonly chatId?: string | undefined;
}

export interface WebhookNotificationConfig {
  readonly enabled: boolean;
  readonly url?: string | undefined;
  readonly secret?: string | undefined;
}

export interface NotificationSettings {
  readonly telegram?: TelegramNotificationConfig;
  readonly webhook?: WebhookNotificationConfig;
}

const NOTIFY_TIMEOUT_MS = 10_000;

export function buildNotificationText(event: string, data: Record<string, unknown> = {}): string {
  const lines = [`[Lerx Router] ${event}`];
  if (data.title) lines.push(String(data.title));
  if (data.detail) lines.push(String(data.detail));
  if (data.model) lines.push(`Model: ${String(data.model)}`);
  if (data.providerId) lines.push(`Provider: ${String(data.providerId)}`);
  if (data.accountId) lines.push(`Account: ${String(data.accountId)}`);
  if (data.error) lines.push(`Error: ${String(data.error).slice(0, 300)}`);
  return lines.join("\n");
}

export function signWebhookPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function sendRouterNotification(
  event: string,
  data: Record<string, unknown> = {},
  config?: NotificationSettings,
): Promise<{ telegram: "sent" | "skipped" | "failed"; webhook: "sent" | "skipped" | "failed" }> {
  const out: { telegram: "sent" | "skipped" | "failed"; webhook: "sent" | "skipped" | "failed" } = {
    telegram: "skipped",
    webhook: "skipped",
  };

  const text = buildNotificationText(event, data);

  // 1. Telegram
  const tg = config?.telegram;
  if (tg?.enabled && tg.botToken && tg.chatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tg.chatId, text }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
      out.telegram = res.ok ? "sent" : "failed";
    } catch (err) {
      out.telegram = "failed";
      log.warn("[notifier] telegram alert failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 2. Webhook
  const wh = config?.webhook;
  if (wh?.enabled && wh.url) {
    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (wh.secret && wh.secret.length > 0) {
        headers["X-Lerx-Signature"] = signWebhookPayload(wh.secret, body);
      }
      const res = await fetch(wh.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
      out.webhook = res.ok ? "sent" : "failed";
    } catch (err) {
      out.webhook = "failed";
      log.warn("[notifier] webhook alert failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return out;
}
