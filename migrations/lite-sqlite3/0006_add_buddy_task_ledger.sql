-- Adds `buddy_task_ledger` (Lite / SQLite)
CREATE TABLE IF NOT EXISTS "buddy_task_ledger" (
  "day_key" text NOT NULL,
  "account_id" text NOT NULL,
  "task" text NOT NULL,
  "claimed_at" text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  CONSTRAINT "buddy_task_ledger_account_id_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "provider_accounts"("id") ON DELETE cascade,
  CONSTRAINT "buddy_task_ledger_day_key_account_id_task_pk" PRIMARY KEY("day_key","account_id","task")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_task_ledger_account_idx" ON "buddy_task_ledger" ("account_id");
