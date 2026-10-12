CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"request_id" integer,
	"request_item_id" integer,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "request_items" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "cancelled_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_item_id_request_items_id_fk" FOREIGN KEY ("request_item_id") REFERENCES "public"."request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_user_read" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_requests_unit_created" ON "requests" USING btree ("unit_id","created_at");
--> statement-breakpoint
-- ===== Preenchimento do histórico (a partir da auditoria) =====
-- started_at: 1ª vez que a requisição foi para "em progresso"
UPDATE "requests" r
   SET "started_at" = s.first_at
  FROM (
    SELECT a."record_id"::int AS rid, min(a."created_at") AS first_at
      FROM "audit_logs" a
     WHERE a."table_name" = 'requests'
       AND a."action" = 'STATUS_CHANGE'
       AND a."record_id" ~ '^[0-9]+$'
       AND (CASE WHEN a."payload" ~ '^\s*\{' THEN a."payload"::jsonb ->> 'to' END) = 'in_progress'
     GROUP BY 1
  ) s
 WHERE r."id" = s.rid
   AND r."started_at" IS NULL;--> statement-breakpoint

-- completed_at: última vez que foi concluída (só para as que estão concluídas hoje)
UPDATE "requests" r
   SET "completed_at" = s.last_at
  FROM (
    SELECT a."record_id"::int AS rid, max(a."created_at") AS last_at
      FROM "audit_logs" a
     WHERE a."table_name" = 'requests'
       AND a."action" = 'STATUS_CHANGE'
       AND a."record_id" ~ '^[0-9]+$'
       AND (CASE WHEN a."payload" ~ '^\s*\{' THEN a."payload"::jsonb ->> 'to' END) = 'completed'
     GROUP BY 1
  ) s
 WHERE r."id" = s.rid
   AND r."status" = 'completed'
   AND r."completed_at" IS NULL;--> statement-breakpoint

-- sem registro na auditoria: usa a última alteração da própria requisição
UPDATE "requests"
   SET "completed_at" = "updated_at"
 WHERE "status" = 'completed'
   AND "completed_at" IS NULL;--> statement-breakpoint

-- canceladas (se houver): mesma ideia
UPDATE "requests"
   SET "cancelled_at" = "updated_at"
 WHERE "status" = 'cancelled'
   AND "cancelled_at" IS NULL;
