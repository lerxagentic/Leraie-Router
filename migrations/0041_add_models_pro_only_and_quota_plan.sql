-- Adds pro_only to models and quota_plan to provider_accounts for the pro-only plan gate.
ALTER TABLE "models" ADD COLUMN IF NOT EXISTS "pro_only" boolean;
ALTER TABLE "provider_accounts" ADD COLUMN IF NOT EXISTS "quota_plan" text;
