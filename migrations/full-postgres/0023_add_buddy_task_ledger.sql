-- Adds `buddy_task_ledger`: one row per (day, account, growth task) once that
-- day's claim was attempted.

CREATE TABLE IF NOT EXISTS "buddy_task_ledger" (
  "day_key" text NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "provider_accounts"("id") ON DELETE cascade,
  "task" text NOT NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "buddy_task_ledger_day_key_account_id_task_pk" PRIMARY KEY("day_key","account_id","task")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_task_ledger_account_idx" ON "buddy_task_ledger" USING btree ("account_id");
