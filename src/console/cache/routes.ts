/**
 * Console REST API for Response Cache Management (9Router Pro parity).
 *
 * GET  /console/api/settings/cache
 * POST /console/api/settings/cache/clear
 */
import { Elysia } from "elysia";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import type { ConsoleAccessResolver } from "../auth/access";
import { ConsoleDomainError } from "../shared/errors";
import { globalResponseCache } from "../../transport/cache/response-cache";

export interface CacheRoutesConfig {
  readonly db: CartethyiaDatabase;
  readonly accessResolver: ConsoleAccessResolver;
}

export function createCacheRoutes(config: CacheRoutesConfig): Elysia<any, any, any, any, any, any, any, any> {
  const { accessResolver } = config;

  return new Elysia({ prefix: "/settings/cache" })
    .get("/", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      return {
        enabled: true,
        stats: globalResponseCache.getStats(),
      };
    })
    .post("/clear", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      globalResponseCache.clear();
      return {
        cleared: true,
        stats: globalResponseCache.getStats(),
      };
    });
}
