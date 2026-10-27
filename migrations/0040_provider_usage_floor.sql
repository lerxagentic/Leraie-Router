-- Per-provider usage floor.
--
-- An account whose remaining allowance is at or below this floor is skipped at
-- routing time and the request fails over to the next account. `usage_floor`
-- null means no floor (the previous behaviour). The unit picks which reading the
-- floor compares: `credit` is the summed absolute remaining credit, `percent`
-- is the aggregate credit percentage gated by the lowest independent window.
--
-- `percent` is the default because a provider that only reports utilization has
-- no absolute credit to compare against, and a floor that silently never fires
-- is worse than one that reads the unit the provider actually exposes.
ALTER TABLE "provider_routing_settings" ADD COLUMN IF NOT EXISTS "usage_floor" integer;
--> statement-breakpoint
ALTER TABLE "provider_routing_settings" ADD COLUMN IF NOT EXISTS "usage_floor_unit" text NOT NULL DEFAULT 'percent';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_routing_settings" ADD CONSTRAINT "provider_routing_settings_usage_floor_check"
    CHECK ("usage_floor" IS NULL OR ("usage_floor" >= 0 AND "usage_floor" <= 1000000));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "provider_routing_settings" ADD CONSTRAINT "provider_routing_settings_usage_floor_unit_check"
    CHECK ("usage_floor_unit" IN ('credit', 'percent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
