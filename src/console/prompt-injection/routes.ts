/**
 * Console REST API routes for Prompt Injection & Model Variants (9Router Pro parity).
 *
 * GET    /console/api/prompt-injection
 * PUT    /console/api/prompt-injection
 * DELETE /console/api/prompt-injection
 */
import { Elysia, t } from "elysia";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import { consoleSettings } from "../../persistence/schema";
import { eq } from "drizzle-orm";
import type { ConsoleAccessResolver } from "../auth/access";
import { ConsoleDomainError } from "../shared/errors";
import type {
  PromptInjectionConfig,
  PromptInjectionStoreData,
} from "../../transport/request/prompt-injection";

export interface PromptInjectionRoutesConfig {
  readonly db: CartethyiaDatabase;
  readonly accessResolver: ConsoleAccessResolver;
}

export function createPromptInjectionRoutes(config: PromptInjectionRoutesConfig): Elysia<any, any, any, any, any, any, any, any> {
  const { db, accessResolver } = config;

  async function getPreferences(tenantId: string) {
    const [row] = await db
      .select({ preferences: consoleSettings.preferences })
      .from(consoleSettings)
      .where(eq(consoleSettings.tenantId, tenantId))
      .limit(1);
    return row?.preferences ?? {};
  }

  async function saveInjections(
    tenantId: string,
    mutator: (current: PromptInjectionStoreData) => PromptInjectionStoreData,
  ): Promise<PromptInjectionStoreData> {
    const prefs = await getPreferences(tenantId);
    const currentInjections: PromptInjectionStoreData = prefs.promptInjections ?? {
      global: null,
      byKey: {},
      byModel: {},
      byKeyModel: {},
      byVariant: {},
    };

    const nextInjections = mutator(currentInjections);
    const nextPrefs = {
      ...prefs,
      promptInjections: nextInjections,
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

    return nextInjections;
  }

  return new Elysia({ prefix: "/prompt-injection" })
    .get("/", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      const prefs = await getPreferences(access.tenantId);
      const injections: PromptInjectionStoreData = prefs.promptInjections ?? {
        global: null,
        byKey: {},
        byModel: {},
        byKeyModel: {},
        byVariant: {},
      };

      return {
        global: injections.global ?? null,
        userPrompts: injections.byKey ?? {},
        prompts: injections.byModel ?? {},
        keyModelPrompts: injections.byKeyModel ?? {},
        variants: injections.byVariant ?? {},
        templates: [],
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

        // 1. Global
        if ("global" in b) {
          const globalEntry = b["global"] as PromptInjectionConfig | null;
          const updated = await saveInjections(access.tenantId, (curr) => ({
            ...curr,
            global: globalEntry,
          }));
          return { global: updated.global };
        }

        // 2. Variant
        if (b["variant"] && typeof b["variant"] === "object") {
          const v = b["variant"] as PromptInjectionConfig & { name?: string; model?: string };
          const name = v.name?.trim();
          if (!name || name.includes("/")) {
            throw new ConsoleDomainError(
              "invalid_variant",
              400,
              "Variant needs a custom name without '/' (e.g. 'coding-bot')",
            );
          }
          if (!v.model || !v.model.includes("/")) {
            throw new ConsoleDomainError(
              "invalid_variant",
              400,
              "Variant needs a backing provider/model (e.g. 'workbuddy/deepseek-v4.1-flash')",
            );
          }
          const updated = await saveInjections(access.tenantId, (curr) => {
            const nextVariants = { ...(curr.byVariant ?? {}) };
            nextVariants[name] = v;
            return { ...curr, byVariant: nextVariants };
          });
          return { variant: updated.byVariant?.[name] };
        }

        // 3. By Key
        if (typeof b["keyId"] === "string" && b["keyId"].length > 0) {
          const keyId = b["keyId"];
          const entry: PromptInjectionConfig = {
            name: typeof b["name"] === "string" ? b["name"] : undefined,
            mode: b["mode"] === "chat" ? "chat" : "single",
            text: typeof b["content"] === "string" ? b["content"] : (b["text"] as string | undefined),
            position: b["position"] === "prepend" ? "prepend" : "append",
            turns: Array.isArray(b["turns"]) ? b["turns"] : undefined,
            enabled: b["enabled"] !== false,
          };
          const updated = await saveInjections(access.tenantId, (curr) => {
            const nextKeys = { ...(curr.byKey ?? {}) };
            nextKeys[keyId] = entry;
            return { ...curr, byKey: nextKeys };
          });
          return { keyId, entry: updated.byKey?.[keyId] };
        }

        throw new ConsoleDomainError("invalid_request", 400, "Provide global, keyId, or variant");
      },
    )
    .delete("/", async ({ request, query }: { request: Request; query: Record<string, string | undefined> }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");

      const { variant, keyId } = query;

      if (variant) {
        await saveInjections(access.tenantId, (curr) => {
          const next = { ...(curr.byVariant ?? {}) };
          delete next[variant];
          return { ...curr, byVariant: next };
        });
        return { deleted: true, variant };
      }

      if (keyId) {
        await saveInjections(access.tenantId, (curr) => {
          const next = { ...(curr.byKey ?? {}) };
          delete next[keyId];
          return { ...curr, byKey: next };
        });
        return { deleted: true, keyId };
      }

      throw new ConsoleDomainError("invalid_request", 400, "Provide variant or keyId");
    });
}
