-- Adds `buddy_task_ledger`: one row per (day, account, growth task) once that
-- day's claim was attempted.
--
-- The buddy growth endpoints (streak makeup, redeem, lottery, travel, adopt,
-- trial) are all "claim once per day" surfaces, and a sweep that re-POSTs them
-- on every pass spends the day's budget twice and floods the log. The composite
-- PK is the guard: an insert that conflicts is exactly the "already settled
-- today" answer.

CREATE TABLE IF NOT EXISTS "buddy_task_ledger" (
  "day_key" text NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "provider_accounts"("id") ON DELETE cascade,
  "task" text NOT NULL,
  "claimed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "buddy_task_ledger_day_key_account_id_task_pk" PRIMARY KEY("day_key","account_id","task")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_task_ledger_account_idx" ON "buddy_task_ledger" USING btree ("account_id");
