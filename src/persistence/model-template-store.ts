// Drizzle-backed persistence for tenant-owned model templates.
import { and, eq } from "drizzle-orm";
import type { CartethyiaDatabase } from "./postgres";
import { modelTemplates } from "./schema";
import type { ModelTemplateRecord } from "../console/domains/model-templates/contracts";

/** Persistence boundary for the model-template domain. */
export interface ModelTemplateStore {
  list(tenantId: string): Promise<readonly ModelTemplateRecord[]>;
  get(tenantId: string, templateId: string): Promise<ModelTemplateRecord | undefined>;
  create(
    tenantId: string,
    input: { readonly name: string; readonly modelList: readonly string[] },
  ): Promise<ModelTemplateRecord>;
  update(
    tenantId: string,
    templateId: string,
    input: { readonly name: string; readonly modelList: readonly string[] },
  ): Promise<ModelTemplateRecord | undefined>;
  /** Removes the template; linked keys keep their copied list (`SET NULL`). */
  remove(tenantId: string, templateId: string): Promise<boolean>;
}

function mapRow(row: typeof modelTemplates.$inferSelect): ModelTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    modelList: [...(row.modelList ?? [])],
    createdAt: row.createdAt,
  };
}

export class DrizzleModelTemplateStore implements ModelTemplateStore {
  constructor(private readonly db: CartethyiaDatabase) {}

  async list(tenantId: string): Promise<readonly ModelTemplateRecord[]> {
    const rows = await this.db
      .select()
      .from(modelTemplates)
      .where(eq(modelTemplates.tenantId, tenantId))
      .orderBy(modelTemplates.name);
    return rows.map(mapRow);
  }

  async get(tenantId: string, templateId: string): Promise<ModelTemplateRecord | undefined> {
    const rows = await this.db
      .select()
      .from(modelTemplates)
      .where(and(eq(modelTemplates.tenantId, tenantId), eq(modelTemplates.id, templateId)))
      .limit(1);
    const row = rows[0];
    return row ? mapRow(row) : undefined;
  }

  async create(
    tenantId: string,
    input: { readonly name: string; readonly modelList: readonly string[] },
  ): Promise<ModelTemplateRecord> {
    const rows = await this.db
      .insert(modelTemplates)
      .values({ tenantId, name: input.name, modelList: [...input.modelList] })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("failed to create model template");
    return mapRow(row);
  }

  async update(
    tenantId: string,
    templateId: string,
    input: { readonly name: string; readonly modelList: readonly string[] },
  ): Promise<ModelTemplateRecord | undefined> {
    const rows = await this.db
      .update(modelTemplates)
      .set({ name: input.name, modelList: [...input.modelList] })
      .where(and(eq(modelTemplates.tenantId, tenantId), eq(modelTemplates.id, templateId)))
      .returning();
    const row = rows[0];
    return row ? mapRow(row) : undefined;
  }

  async remove(tenantId: string, templateId: string): Promise<boolean> {
    const rows = await this.db
      .delete(modelTemplates)
      .where(and(eq(modelTemplates.tenantId, tenantId), eq(modelTemplates.id, templateId)))
      .returning({ id: modelTemplates.id });
    return rows.length > 0;
  }
}
