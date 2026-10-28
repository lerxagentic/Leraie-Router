/**
 * Console REST API for Outbound Alert Notifications (9Router Pro parity).
 *
 * GET  /console/api/settings/notifications
 * PUT  /console/api/settings/notifications
 * POST /console/api/settings/notifications/test
 */
import { Elysia, t } from "elysia";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import { consoleSettings } from "../../persistence/schema";
import { eq } from "drizzle-orm";
import type { ConsoleAccessResolver } from "../auth/access";
import { ConsoleDomainError } from "../shared/errors";
import { sendRouterNotification, type NotificationSettings } from "../../observability/notifier";

export interface NotificationRoutesConfig {
  readonly db: CartethyiaDatabase;
  readonly accessResolver: ConsoleAccessResolver;
}

export function createNotificationRoutes(config: NotificationRoutesConfig): Elysia<any, any, any, any, any, any, any, any> {
  const { db, accessResolver } = config;

  async function getNotificationSettings(tenantId: string): Promise<NotificationSettings> {
    const [row] = await db
      .select({ preferences: consoleSettings.preferences })
      .from(consoleSettings)
      .where(eq(consoleSettings.tenantId, tenantId))
      .limit(1);
    const prefs = (row?.preferences as Record<string, unknown>) ?? {};
    const notif = (prefs["notifications"] as NotificationSettings) ?? {};
    return {
      telegram: {
        enabled: notif.telegram?.enabled ?? false,
        botToken: notif.telegram?.botToken ?? "",
        chatId: notif.telegram?.chatId ?? "",
      },
      webhook: {
        enabled: notif.webhook?.enabled ?? false,
        url: notif.webhook?.url ?? "",
        secret: notif.webhook?.secret ?? "",
      },
    };
  }

  async function saveNotificationSettings(tenantId: string, settings: NotificationSettings) {
    const [row] = await db
      .select({ preferences: consoleSettings.preferences })
      .from(consoleSettings)
      .where(eq(consoleSettings.tenantId, tenantId))
      .limit(1);
    const prefs = (row?.preferences as Record<string, unknown>) ?? {};
    const nextPrefs = {
      ...prefs,
      notifications: settings,
    };

    await db
      .insert(consoleSettings)
      .values({
        tenantId,
        preferences: nextPrefs,
      })
      .onConflictDoUpdate({
        target: consoleSettings.tenantId,
        set: {
          preferences: nextPrefs,
          updatedAt: new Date(),
        },
      });
  }

  return new Elysia({ prefix: "/settings/notifications" })
    .get("/", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      const settings = await getNotificationSettings(access.tenantId);
      return {
        telegram: {
          enabled: settings.telegram?.enabled ?? false,
          configured: Boolean(settings.telegram?.botToken && settings.telegram?.chatId),
          chatId: settings.telegram?.chatId ?? "",
        },
        webhook: {
          enabled: settings.webhook?.enabled ?? false,
          configured: Boolean(settings.webhook?.url),
          url: settings.webhook?.url ?? "",
        },
      };
    })
    .put(
      "/",
      {
        body: t.Object({}, { additionalProperties: true }),
      },
      async ({ request, body }) => {
        const access = accessResolver(request);
        if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
        const b = (body as Record<string, unknown>) ?? {};

        const existing = await getNotificationSettings(access.tenantId);
        const tgInput = (b["telegram"] as Record<string, unknown>) ?? {};
        const whInput = (b["webhook"] as Record<string, unknown>) ?? {};

        const nextSettings: NotificationSettings = {
          telegram: {
            enabled: Boolean(tgInput["enabled"] ?? existing.telegram?.enabled),
            botToken: typeof tgInput["botToken"] === "string" && tgInput["botToken"].length > 0
              ? tgInput["botToken"].trim()
              : existing.telegram?.botToken,
            chatId: typeof tgInput["chatId"] === "string" && tgInput["chatId"].length > 0
              ? tgInput["chatId"].trim()
              : existing.telegram?.chatId,
          },
          webhook: {
            enabled: Boolean(whInput["enabled"] ?? existing.webhook?.enabled),
            url: typeof whInput["url"] === "string" && whInput["url"].length > 0
              ? whInput["url"].trim()
              : existing.webhook?.url,
            secret: typeof whInput["secret"] === "string" && whInput["secret"].length > 0
              ? whInput["secret"]
              : existing.webhook?.secret,
          },
        };

        await saveNotificationSettings(access.tenantId, nextSettings);
        return {
          telegram: {
            enabled: nextSettings.telegram?.enabled ?? false,
            configured: Boolean(nextSettings.telegram?.botToken && nextSettings.telegram?.chatId),
            chatId: nextSettings.telegram?.chatId ?? "",
          },
          webhook: {
            enabled: nextSettings.webhook?.enabled ?? false,
            configured: Boolean(nextSettings.webhook?.url),
            url: nextSettings.webhook?.url ?? "",
          },
        };
      },
    )
    .post("/test", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      const settings = await getNotificationSettings(access.tenantId);
      const outcome = await sendRouterNotification(
        "test_alert",
        {
          title: "Test notification from Lerx Router",
          detail: "Outbound alerts are working correctly.",
        },
        settings,
      );
      return outcome;
    });
}
