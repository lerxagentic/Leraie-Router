-- Add the provider-level network-pool pin introduced in the routing schema.
-- Existing rows intentionally remain unpinned, preserving their direct or
-- automatic-pool behavior until an operator assigns a pool.
ALTER TABLE "provider_routing_settings"
  ADD COLUMN IF NOT EXISTS "assigned_pool_id" uuid
  REFERENCES "network_pools"("id") ON DELETE SET NULL;
