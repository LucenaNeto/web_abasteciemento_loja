CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_units" (
	"user_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_units_user_id_unit_id_pk" PRIMARY KEY("user_id","unit_id")
);
--> statement-breakpoint

-- IMPORTANTE: não queremos mais SKU único global
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_unique";
--> statement-breakpoint

-- adiciona unit_id (nullable por enquanto; NOT NULL vem depois do backfill)
ALTER TABLE "products" ADD COLUMN "unit_id" integer;
--> statement-breakpoint

-- se você também adicionou unit_id em requests, precisa estar aqui:
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "unit_id" integer;
--> statement-breakpoint

ALTER TABLE "user_units" ADD CONSTRAINT "user_units_user_id_users_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "user_units" ADD CONSTRAINT "user_units_unit_id_units_id_fk"
FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "units_code_uq" ON "units" USING btree ("code");
--> statement-breakpoint

ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_units_id_fk"
FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ NÃO crie o índice unique (unit_id, sku) agora.
-- Primeiro precisamos preencher unit_id nos dados existentes.
-- (Deixamos para o final)

DO $$
DECLARE
  v_unit_id integer;
BEGIN
  -- 1) cria (se não existir) uma unidade padrão
  INSERT INTO "units" ("code", "name", "is_active")
  VALUES ('00000', 'Unidade Padrão', true)
  ON CONFLICT ("code") DO NOTHING;

  SELECT "id" INTO v_unit_id
    FROM "units"
   WHERE "code" = '00000';

  -- 2) backfill products.unit_id
  UPDATE "products"
     SET "unit_id" = v_unit_id
   WHERE "unit_id" IS NULL;

  -- 3) backfill requests.unit_id
  UPDATE "requests"
     SET "unit_id" = v_unit_id
   WHERE "unit_id" IS NULL;

  -- 4) cria vínculo user_units p/ todos os usuários
  INSERT INTO "user_units" ("user_id", "unit_id", "is_primary")
  SELECT u."id",
         v_unit_id,
         NOT EXISTS (
           SELECT 1 FROM "user_units" uu
            WHERE uu."user_id" = u."id" AND uu."is_primary" = true
         )
    FROM "users" u
  ON CONFLICT ("user_id", "unit_id") DO NOTHING;
END $$;
--> statement-breakpoint

-- agora sim: garante NOT NULL (depois do backfill)
ALTER TABLE "products" ALTER COLUMN "unit_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "unit_id" SET NOT NULL;
--> statement-breakpoint

-- se ainda existir índice/constraint antigo de SKU, tenta remover sem quebrar
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "products_sku_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "products_sku_unique";
--> statement-breakpoint

-- garante unique por unidade
CREATE UNIQUE INDEX IF NOT EXISTS "products_unit_sku_uq"
  ON "products" ("unit_id", "sku");
