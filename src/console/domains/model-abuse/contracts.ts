import { Elysia, t } from "elysia";
import { PERMANENT_BAN_TTL_MS, type ModelAbuseBan, type ModelStrikeService } from "../../../security/model-abuse";
import type { AccessDecision } from "../../../security/access-control";
import { ConsoleDomainError, errorResponse, requireGlobalAdmin } from "../../shared/errors";

/**
 * The ban durations the console offers, in whole minutes. `null` is the
 * "Permanent" choice.
 */
export const BAN_DURATION_CHOICES = [
  { minutes: 60, label: "1 hour" },
  { minutes: 6 * 60, label: "6 hours" },
  { minutes: 12 * 60, label: "12 hours" },
  { minutes: 24 * 60, label: "1 day" },
  { minutes: 7 * 24 * 60, label: "7 days" },
  { minutes: null, label: "Permanent" },
] as const;

/** The duration a bare "ban this user" click uses: the shortest one on offer. */
export const DEFAULT_BAN_MINUTES = 60;

/** Whole minutes the console accepts, or `null` for permanent. */
export type BanDurationMinutes = (typeof BAN_DURATION_CHOICES)[number]["minutes"];

export interface ModelAbuseRoutesConfig {
  readonly strikes: Pick<ModelStrikeService, "listBans" | "unban" | "ban">;
  readonly accessResolver: (request: Request) => AccessDecision | undefined;
}

const unbanBody = t.Object({
  identity: t.String({ minLength: 1 }),
});

const banBody = t.Object({
  ip: t.String({ minLength: 1, maxLength: 45 }),
  apiKeyId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  minutes: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])),
  addressOnly: t.Optional(t.Boolean()),
});

const ALLOWED_MINUTES = new Set<number | null>(
  BAN_DURATION_CHOICES.map((choice) => choice.minutes),
);

function banTtlMs(minutes: number | null | undefined): number {
  const chosen = minutes === undefined ? DEFAULT_BAN_MINUTES : minutes;
  if (!ALLOWED_MINUTES.has(chosen)) {
    throw new ConsoleDomainError(
      "invalid_request",
      400,
      "Unsupported ban duration. Choose one of the offered durations.",
    );
  }
  return chosen === null ? PERMANENT_BAN_TTL_MS : chosen * 60_000;
}

export function createModelAbuseRoutes(config: ModelAbuseRoutesConfig): Elysia {
  return new Elysia()
    .get("/model-bans", async ({ request, set }) => {
      try {
        requireGlobalAdmin(config.accessResolver(request));
        const bans: readonly ModelAbuseBan[] = await config.strikes.listBans();
        return { bans };
      } catch (e) {
        return errorResponse(e, set, "Model ban read failed");
      }
    })
    .post("/model-bans", { body: banBody }, async ({ request, body, set }) => {
      try {
        requireGlobalAdmin(config.accessResolver(request));
        const ban = await config.strikes.ban({
          ip: body.ip,
          ...(body.apiKeyId === undefined ? {} : { apiKeyId: body.apiKeyId }),
          ttlMs: banTtlMs(body.minutes),
          ...(body.addressOnly === undefined ? {} : { addressOnly: body.addressOnly }),
        });
        return { ban };
      } catch (e) {
        return errorResponse(e, set, "Model ban failed");
      }
    })
    .delete("/model-bans", { body: unbanBody }, async ({ request, body, set }) => {
      try {
        requireGlobalAdmin(config.accessResolver(request));
        const removed = await config.strikes.unban(body.identity);
        if (!removed) throw new ConsoleDomainError("ban_not_found", 404, "No such ban");
        return { success: true };
      } catch (e) {
        return errorResponse(e, set, "Model unban failed");
      }
    }) as unknown as Elysia;
}
