import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dbDescribe, withRollback } from "../helpers/database";

const MIGRATION_FILE = "0038_provider_routing_assigned_pool.sql";

function migrationSql(): string {
  return readFileSync(resolve(process.cwd(), "migrations", MIGRATION_FILE), "utf8");
}

async function assignedPoolColumnCount(client: {
  query: (text: string) => Promise<{ rows: unknown[] }>;
}): Promise<number> {
  const result = await client.query(
    `select column_name from information_schema.columns
      where table_name = 'provider_routing_settings' and column_name = 'assigned_pool_id'`,
  );
  return result.rows.length;
}

dbDescribe("migration: provider routing assigned pool", () => {
  test("adds the nullable assigned_pool_id column to an existing routing table", async () => {
    await withRollback(async (client) => {
      await client.query('ALTER TABLE "provider_routing_settings" DROP COLUMN IF EXISTS "assigned_pool_id"');
      expect(await assignedPoolColumnCount(client)).toBe(0);

      await client.query(migrationSql());

      expect(await assignedPoolColumnCount(client)).toBe(1);
    });
  });

  test("is idempotent", async () => {
    await withRollback(async (client) => {
      await client.query('ALTER TABLE "provider_routing_settings" DROP COLUMN IF EXISTS "assigned_pool_id"');
      await client.query(migrationSql());
      await client.query(migrationSql());

      expect(await assignedPoolColumnCount(client)).toBe(1);
    });
  });
});
