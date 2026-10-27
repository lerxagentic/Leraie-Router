import type { ConsoleAccessResolver } from "../auth/access";
import type { AuditRecorder } from "../auth/service";
import { markClineApiKeyCredential } from "../../providers/integrations/cline/cline-quota";
import { type QuotaRefreshDeps, type QuotaRefreshTarget } from "./refresh";

/**
 * Dependencies shared by the tenant-scoped and global-admin account/quota route
 * groups. Both groups are composed onto one Elysia instance by
 * `createAccountQuotaRoutes`.
 */
export interface AccountQuotaRoutesDeps extends QuotaRefreshDeps {
  readonly accessResolver: ConsoleAccessResolver;
  readonly snapshotInvalidator?: { invalidate(): Promise<number> };
  /** Records privileged account mutations (e.g. hard deletion) to `admin_audit_log`. */
  readonly auditRecorder?: AuditRecorder | undefined;
}

export const ACCOUNT_STATUSES = ["active", "cooldown", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Converts a route account row into a refresh target without losing OAuth state. */
export function quotaTargetForAccount(
  account: {
    readonly id: string;
    readonly providerId: string;
    readonly tenantId: string | null;
    readonly credentialKind: Exclude<QuotaRefreshTarget["credentialKind"], undefined>;
    readonly authState: QuotaRefreshTarget["authState"] | null;
  },
): QuotaRefreshTarget {
  return {
    accountId: account.id,
    providerId: account.providerId,
    tenantId: account.tenantId,
    credentialKind: account.credentialKind,
    ...(account.authState === null ? {} : { authState: account.authState }),
  };
}

/**
 * Builds the refresh dependency bundle from the route deps, binding the
 * provider-specific credential normalisation (`cline` API keys) once so every
 * caller refreshes through the same wiring.
 */
export function createQuotaRefreshDeps(deps: AccountQuotaRoutesDeps): QuotaRefreshDeps {
  return {
    db: deps.db,
    redis: deps.redis,
    providerRegistry: deps.providerRegistry,
    resolveCredential: deps.resolveCredential,
    ...(deps.snapshotInvalidator ? { snapshotInvalidator: deps.snapshotInvalidator } : {}),
    ...(deps.quotaFetcherFor ? { quotaFetcherFor: deps.quotaFetcherFor } : {}),
    markApiKeyCredential: (providerId, credential) =>
      providerId === "cline" ? markClineApiKeyCredential(credential) : credential,
  };
}
