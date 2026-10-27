// Console model-template domain: request/response shapes and pure helpers.
//
// A template is a named model whitelist a tenant reuses when provisioning API
// keys. It is a provisioning aid only: nothing on the gateway request path
// reads it, so a stale template can never change how a live key routes.
import { ConsoleDomainError } from "../../shared/errors";

/** Stored template row, as the persistence layer hands it back. */
export interface ModelTemplateRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly modelList: readonly string[];
  readonly createdAt: Date;
}

/** Browser-facing projection; the tenant id stays server-side. */
export interface ModelTemplateResponse {
  readonly id: string;
  readonly name: string;
  readonly modelList: readonly string[];
  readonly createdAt: string;
}

/** Result of pushing one template's models onto its linked keys. */
export interface ModelTemplateSyncResponse {
  readonly templateId: string;
  readonly updatedKeys: readonly { readonly id: string; readonly label: string }[];
  readonly skippedCount: number;
}

/** Longest name a template may carry, in characters. */
export const MODEL_TEMPLATE_NAME_MAX = 80;
/** Largest model list a template may hold. */
export const MODEL_TEMPLATE_MODELS_MAX = 500;

function invalid(message: string): never {
  throw new ConsoleDomainError("invalid_model_template", 400, message);
}

/**
 * Validates and normalizes a create/update request.
 *
 * Names are trimmed and required; the model list is trimmed, de-duplicated,
 * and order-preserving so a template's list reads exactly as the operator
 * built it. Duplicates would otherwise be copied verbatim onto every key.
 */
export function parseModelTemplateRequest(body: unknown): {
  readonly name: string;
  readonly modelList: readonly string[];
} {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    invalid("A model template requires a JSON object body");
  }
  const record = body as { name?: unknown; modelList?: unknown };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0) invalid("A model template requires a name");
  if (name.length > MODEL_TEMPLATE_NAME_MAX) {
    invalid(`A model template name is limited to ${MODEL_TEMPLATE_NAME_MAX} characters`);
  }
  if (!Array.isArray(record.modelList)) invalid("A model template requires a modelList array");
  const models: string[] = [];
  const seen = new Set<string>();
  for (const entry of record.modelList) {
    if (typeof entry !== "string") invalid("Every modelList entry must be a string");
    const model = entry.trim();
    if (model.length === 0 || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  if (models.length === 0) invalid("A model template requires at least one model");
  if (models.length > MODEL_TEMPLATE_MODELS_MAX) {
    invalid(`A model template is limited to ${MODEL_TEMPLATE_MODELS_MAX} models`);
  }
  return { name, modelList: models };
}

/** Projects a stored row onto the browser contract. */
export function toModelTemplateResponse(record: ModelTemplateRecord): ModelTemplateResponse {
  return {
    id: record.id,
    name: record.name,
    modelList: [...record.modelList],
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Whether a key linked to a template may be rewritten by an explicit sync.
 *
 * Only live top-level personal keys are rewritten: a revoked key must not
 * silently come back with a different model list, a share template never
 * authenticates on its own, and a share child follows its parent's list.
 */
export function isTemplateSyncableKey(key: {
  readonly keyMode: string;
  readonly revokedAt?: Date;
  readonly parentKeyId?: string;
}): boolean {
  return key.keyMode === "personal" && key.revokedAt === undefined && key.parentKeyId === undefined;
}
