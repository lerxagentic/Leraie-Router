/**
 * Console REST API for TOTP 2FA Management (9Router Pro parity).
 *
 * GET  /console/api/auth/totp
 * POST /console/api/auth/totp
 */
import { Elysia, t } from "elysia";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import type { ConsoleAccessResolver } from "./access";
import { ConsoleDomainError } from "../shared/errors";
import {
  generateTotpSecret,
  generateBackupCodes,
  hashBackupCode,
  generateOtpauthUrl,
  verifyTotpCode,
  getTenantTotpConfig,
  saveTenantTotpConfig,
} from "./totp";

export interface TotpRoutesConfig {
  readonly db: CartethyiaDatabase;
  readonly accessResolver: ConsoleAccessResolver;
}

export function createTotpRoutes(
  config: TotpRoutesConfig,
): Elysia<any, any, any, any, any, any, any, any> {
  const { db, accessResolver } = config;

  return new Elysia({ prefix: "/auth/totp" })
    .get("/", async ({ request }) => {
      const access = accessResolver(request);
      if (!access || !access.tenantId) {
        throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
      }
      const cfg = await getTenantTotpConfig(db, access.tenantId);
      return {
        enabled: cfg.enabled,
        backupCodesRemaining: cfg.backupHashes.length,
        hasPendingSetup: Boolean(cfg.pendingSecret),
      };
    })
    .post(
      "/",
      {
        body: t.Object({
          action: t.String(),
          code: t.Optional(t.String()),
        }),
      },
      async ({ request, body }) => {
        const access = accessResolver(request);
        if (!access || !access.tenantId) {
          throw new ConsoleDomainError("unauthorized", 401, "Authentication required");
        }
        const tenantId = access.tenantId;
        const { action, code } = body;
        const cfg = await getTenantTotpConfig(db, tenantId);

        if (action === "setup") {
          if (cfg.enabled) {
            throw new ConsoleDomainError("conflict", 400, "Two-factor authentication is already enabled");
          }
          const secret = generateTotpSecret();
          const backupCodes = generateBackupCodes(10);
          const backupHashes = backupCodes.map(hashBackupCode);
          await saveTenantTotpConfig(db, tenantId, {
            ...cfg,
            pendingSecret: secret,
            pendingBackupHashes: backupHashes,
          });
          return {
            secret,
            otpauthUrl: generateOtpauthUrl(secret, "admin", "Lerx Router"),
            backupCodes,
          };
        }

        if (action === "enable") {
          if (!cfg.pendingSecret) {
            throw new ConsoleDomainError("invalid_request", 400, "No pending TOTP setup found. Start setup first.");
          }
          const userCode = String(code || "").trim();
          if (!verifyTotpCode(cfg.pendingSecret, userCode)) {
            throw new ConsoleDomainError("unauthorized", 401, "Invalid authenticator code. Check your device clock.");
          }
          await saveTenantTotpConfig(db, tenantId, {
            enabled: true,
            secret: cfg.pendingSecret,
            backupHashes: cfg.pendingBackupHashes ?? [],
            pendingSecret: undefined,
            pendingBackupHashes: undefined,
            createdAt: new Date().toISOString(),
          });
          return { enabled: true };
        }

        if (action === "disable") {
          const userCode = String(code || "").trim();
          if (!cfg.enabled) {
            throw new ConsoleDomainError("invalid_request", 400, "TOTP is not enabled.");
          }
          let valid = verifyTotpCode(cfg.secret, userCode);
          if (!valid) {
            const h = hashBackupCode(userCode);
            if (cfg.backupHashes.includes(h)) valid = true;
          }
          if (!valid) {
            throw new ConsoleDomainError("unauthorized", 401, "Invalid authenticator or backup code.");
          }
          await saveTenantTotpConfig(db, tenantId, {
            enabled: false,
            secret: "",
            backupHashes: [],
            pendingSecret: undefined,
            pendingBackupHashes: undefined,
          });
          return { enabled: false };
        }

        throw new ConsoleDomainError("invalid_request", 400, "Unknown action");
      },
    );
}
