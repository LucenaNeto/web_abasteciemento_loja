// src/server/db/seed.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "./index";
import { assertSafeDb } from "../../../scripts/guard-db";

async function ensureDefaultUnit() {
  const code = process.env.SEED_DEFAULT_UNIT_CODE ?? "00000";
  const name = process.env.SEED_DEFAULT_UNIT_NAME ?? "Unidade Padrão";

  await db
    .insert(schema.units)
    .values({ code, name, isActive: true })
    .onConflictDoNothing({ target: schema.units.code });

  const [u] = await db
    .select({ id: schema.units.id, code: schema.units.code })
    .from(schema.units)
    .where(eq(schema.units.code, code))
    .limit(1);

  if (!u?.id) throw new Error(`Não consegui obter a unitId da unidade ${code}`);
  return u.id;
}

async function ensureAdmin() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!adminEmail || adminPassword.length < 8) {
    throw new Error(
      "Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (mínimo 8 caracteres). Não há valores padrão.",
    );
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (existing.length) {
    console.log("✅ Admin já existe, não foi recriado.");
    return { id: existing[0].id, email: adminEmail, password: adminPassword };
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const [created] = await db
    .insert(schema.users)
    .values({
      name: "Admin",
      email: adminEmail,
      passwordHash,
      role: "admin",
      isActive: true,
    })
    .returning({ id: schema.users.id });

  console.log(`> Admin criado: ${adminEmail}`);
  return { id: created.id, email: adminEmail, password: adminPassword };
}

async function ensureUserPrimaryUnit(userId: number, unitId: number) {
  // garante vínculo (user_id, unit_id)
  await db
    .insert(schema.userUnits)
    .values({ userId, unitId, isPrimary: true })
    .onConflictDoUpdate({
      target: [schema.userUnits.userId, schema.userUnits.unitId],
      set: { isPrimary: true },
    });

  // garante que só essa é primary
  await db
    .update(schema.userUnits)
    .set({ isPrimary: false })
    .where(and(eq(schema.userUnits.userId, userId), ne(schema.userUnits.unitId, unitId)));
}

async function main() {
  assertSafeDb("db:seed");

  console.log("🔎 Garantindo unidade padrão...");
  const unitId = await ensureDefaultUnit();

  console.log("🔎 Verificando admin seed...");
  const admin = await ensureAdmin();

  console.log("🔗 Garantindo vínculo do admin com a unidade...");
  await ensureUserPrimaryUnit(admin.id, unitId);

  if (process.env.SEED_SAMPLE_PRODUCTS !== "yes") {
    console.log("> Produtos de exemplo ignorados (use SEED_SAMPLE_PRODUCTS=yes para criá-los).");
    console.log("> Seed concluído.");
    return;
  }

  console.log("🌱 Garantindo produtos iniciais...");
  const initialProducts = [
    { sku: "SKU-001", name: "Produto A", unit: "UN" },
    { sku: "SKU-002", name: "Produto B", unit: "UN" },
    { sku: "SKU-003", name: "Produto C", unit: "CX" },
  ];

  for (const p of initialProducts) {
    await db
      .insert(schema.products)
      .values({
        unitId,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        isActive: true,
        stock: 0,
      })
      .onConflictDoNothing({
        target: [schema.products.unitId, schema.products.sku],
      });
  }

  console.log("> Seed concluído.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
