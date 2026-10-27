// Console model-template domain: HTTP routes and operations.
//
// Templates are a provisioning aid: applying one copies its model list onto an
// API key, and an explicit sync pushes a template's current list onto the keys
// already linked to it. Nothing on the gateway request path reads a template,
// so a template edit never changes live routing on its own.
import { Elysia } from "elysia";
import type { AccessDecision } from "../../../security/access-control";
import type { ConsoleAccessResolver } from "../../auth/access";
import type { AuditSink } from "../audit/contracts";
import { ConsoleDomainError, errorResponse, requireTenantScope } from "../../shared/errors";
import { invalidateApiKeyCache } from "../../../security/api-key-auth";
import type { ModelTemplateStore } from "../../../persistence/model-template-store";
import type { ApiKeyStore } from "../../../persistence/api-key-store";
import {
  isTemplateSyncableKey,
  parseModelTemplateRequest,
  toModelTemplateResponse,
  type ModelTemplateResponse,
  type ModelTemplateSyncResponse,
} from "./contracts";

export interface ModelTemplateConfig {
  readonly store: ModelTemplateStore;
  readonly apiKeyStore: Pick<ApiKeyStore, "list" | "update">;
  readonly accessResolver: ConsoleAccessResolver;
  readonly auditSink?: AuditSink;
}

/**
 * A unique-name collision reaches this layer as a driver error; both dialects
 * report it differently, so the check reads the code and the message.
 */
function isTemplateNameTaken(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const code = "code" in current ? String(current.code) : "";
    if (code === "23505" || code.startsWith("SQLITE_CONSTRAINT")) return true;
    if (current instanceof Error && /unique constraint|duplicate key/i.test(current.message)) {
      return true;
    }
    if (!("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

export function createModelTemplateOperations(config: ModelTemplateConfig) {
  return {
    async listTemplates(access: AccessDecision | undefined): Promise<ModelTemplateResponse[]> {
      const authorized = requireTenantScope(access, "dashboard:read");
      const records = await config.store.list(authorized.tenantId);
      return records.map(toModelTemplateResponse);
    },

    async createTemplate(
      access: AccessDecision | undefined,
      body: unknown,
    ): Promise<ModelTemplateResponse> {
      const authorized = requireTenantScope(access, "dashboard:write");
      const request = parseModelTemplateRequest(body);
      let record;
      try {
        record = await config.store.create(authorized.tenantId, request);
      } catch (error) {
        if (isTemplateNameTaken(error)) {
          throw new ConsoleDomainError(
            "template_name_taken",
            409,
            "A model template with this name already exists",
          );
        }
        throw error;
      }
      await config.auditSink?.record({
        access: authorized,
        action: "model_template.created",
        target: record.id,
        detail: { name: record.name, modelCount: record.modelList.length },
      });
      return toModelTemplateResponse(record);
    },

    async updateTemplate(
      access: AccessDecision | undefined,
      templateId: string,
      body: unknown,
    ): Promise<ModelTemplateResponse> {
      const authorized = requireTenantScope(access, "dashboard:write");
      const request = parseModelTemplateRequest(body);
      let record;
      try {
        record = await config.store.update(authorized.tenantId, templateId, request);
      } catch (error) {
        if (isTemplateNameTaken(error)) {
          throw new ConsoleDomainError(
            "template_name_taken",
            409,
            "A model template with this name already exists",
          );
        }
        throw error;
      }
      if (!record) {
        throw new ConsoleDomainError("template_not_found", 404, "No such model template");
      }
      await config.auditSink?.record({
        access: authorized,
        action: "model_template.updated",
        target: record.id,
        detail: { name: record.name, modelCount: record.modelList.length },
      });
      return toModelTemplateResponse(record);
    },

    /**
     * Deletes a template. Linked keys keep the model list they copied, because
     * the foreign key detaches (`ON DELETE SET NULL`) rather than cascading.
     */
    async deleteTemplate(
      access: AccessDecision | undefined,
      templateId: string,
    ): Promise<{ success: true }> {
      const authorized = requireTenantScope(access, "dashboard:write");
      const removed = await config.store.remove(authorized.tenantId, templateId);
      if (!removed) {
        throw new ConsoleDomainError("template_not_found", 404, "No such model template");
      }
      await config.auditSink?.record({
        access: authorized,
        action: "model_template.deleted",
        target: templateId,
        detail: {},
      });
      return { success: true };
    },

    /**
     * Pushes the template's current model list onto every key linked to it.
     *
     * The counterpart to create-time copying: the operator edits the template,
     * then explicitly applies it to keys already issued. Only live top-level
     * personal keys are rewritten — a revoked key must not silently come back
     * different, a share template never authenticates on its own, and a share
     * child follows its parent.
     */
    async syncTemplate(
      access: AccessDecision | undefined,
      templateId: string,
    ): Promise<ModelTemplateSyncResponse> {
      const authorized = requireTenantScope(access, "dashboard:write");
      const template = await config.store.get(authorized.tenantId, templateId);
      if (!template) {
        throw new ConsoleDomainError("template_not_found", 404, "No such model template");
      }
      const keys = await config.apiKeyStore.list(authorized.tenantId);
      const updatedKeys: { id: string; label: string }[] = [];
      let skippedCount = 0;
      for (const key of keys) {
        if (key.modelTemplateId !== templateId) continue;
        if (!isTemplateSyncableKey(key)) {
          skippedCount += 1;
          continue;
        }
        const updated = await config.apiKeyStore.update(authorized.tenantId, key.id, {
          modelAccessMode: "whitelist",
          modelList: [...template.modelList],
        });
        if (!updated) {
          skippedCount += 1;
          continue;
        }
        // The model list is part of the cached auth snapshot: drop it so the
        // new list governs the key's very next request.
        invalidateApiKeyCache(key.id);
        updatedKeys.push({ id: key.id, label: key.label });
      }
      await config.auditSink?.record({
        access: authorized,
        action: "model_template.synced",
        target: template.id,
        detail: {
          name: template.name,
          updated: updatedKeys.length,
          skipped: skippedCount,
        },
      });
      return { templateId: template.id, updatedKeys, skippedCount };
    },
  };
}

export function createModelTemplateRoutes(config: ModelTemplateConfig): Elysia {
  const operations = createModelTemplateOperations(config);
  return new Elysia({ prefix: "/model-templates" })
    .get("/", async ({ request, set }) => {
      try {
        return await operations.listTemplates(config.accessResolver(request));
      } catch (error) {
        return errorResponse(error, set, "Model template operation failed");
      }
    })
    .post("/", async ({ request, body, set }) => {
      try {
        set.status = 201;
        return await operations.createTemplate(config.accessResolver(request), body);
      } catch (error) {
        return errorResponse(error, set, "Model template operation failed");
      }
    })
    .patch("/:templateId", async ({ request, params, body, set }) => {
      try {
        return await operations.updateTemplate(
          config.accessResolver(request),
          params.templateId,
          body,
        );
      } catch (error) {
        return errorResponse(error, set, "Model template operation failed");
      }
    })
    .delete("/:templateId", async ({ request, params, set }) => {
      try {
        return await operations.deleteTemplate(config.accessResolver(request), params.templateId);
      } catch (error) {
        return errorResponse(error, set, "Model template operation failed");
      }
    })
    .post("/:templateId/sync", async ({ request, params, set }) => {
      try {
        return await operations.syncTemplate(config.accessResolver(request), params.templateId);
      } catch (error) {
        return errorResponse(error, set, "Model template operation failed");
      }
    }) as unknown as Elysia;
}
