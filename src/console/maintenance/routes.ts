/**
 * Console REST API for Database Maintenance (9Router Pro parity).
 *
 * GET  /console/api/settings/maintenance
 * POST /console/api/settings/maintenance
 * POST /console/api/settings/maintenance/run
 */
import { Elysia, t } from "elysia";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import type { ConsoleAccessResolver } from "../auth/access";
import { ConsoleDomainError } from "../shared/errors";
import {
  runDatabaseMaintenance,
  getMaintenanceConfig,
} from "./service";

export interface MaintenanceRoutesConfig {
  readonly db: CartethyiaDatabase;
  readonly accessResolver: ConsoleAccessResolver;
}

export function createMaintenanceRoutes(
  config: MaintenanceRoutesConfig,
): Elysia<any, any, any, any, any, any, any, any> {
  const { db, accessResolver } = config;

  return new Elysia({ prefix: "/settings/maintenance" })
    .get("/", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) {
        throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      }
      const cfg = await getMaintenanceConfig(db, access.tenantId);
      return { config: cfg };
    })
    .post(
      "/",
      {
        body: t.Object({
          retentionDays: t.Optional(t.Number()),
        }),
      },
      async ({ request, body }) => {
        const access = accessResolver(request);
        if (!access || !access.tenantId) {
          throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
        }
        const b = (body as { retentionDays?: number }) ?? {};
        const result = await runDatabaseMaintenance(db, access.tenantId, {
          ...(b.retentionDays !== undefined ? { retentionDays: b.retentionDays } : {}),
        });
        return { result };
      },
    );
}
