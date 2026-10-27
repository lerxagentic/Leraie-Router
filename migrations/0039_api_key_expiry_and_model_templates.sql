-- Expiring API credentials and tenant-owned named model whitelist presets.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "model_template_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "model_list" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "model_templates_tenant_name_unique" UNIQUE ("tenant_id", "name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_templates_tenant_id_idx" ON "model_templates" ("tenant_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_model_template_id_fk"
    FOREIGN KEY ("model_template_id") REFERENCES "model_templates"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
