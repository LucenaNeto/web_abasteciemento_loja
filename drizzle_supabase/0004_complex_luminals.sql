ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "unit_id" integer;--> statement-breakpoint

DO $$
DECLARE
  v_unit_id integer;
BEGIN
  INSERT INTO "units" ("code", "name", "is_active")
  VALUES ('00000', 'Unidade Padrão', true)
  ON CONFLICT ("code") DO NOTHING;

  SELECT "id" INTO v_unit_id
    FROM "units"
   WHERE "code" = '00000';

  UPDATE "requests"
     SET "unit_id" = v_unit_id
   WHERE "unit_id" IS NULL;
END $$;--> statement-breakpoint

ALTER TABLE "requests" ALTER COLUMN "unit_id" SET NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'requests_unit_id_units_id_fk'
       AND conrelid = 'public.requests'::regclass
  ) THEN
    ALTER TABLE "requests"
      ADD CONSTRAINT "requests_unit_id_units_id_fk"
      FOREIGN KEY ("unit_id")
      REFERENCES "public"."units"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_requests_unit"
  ON "requests" USING btree ("unit_id");
