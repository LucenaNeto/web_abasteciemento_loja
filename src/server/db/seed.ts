// src/server/db/seed.ts
import { db, schema } from "./index";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

  // Admin (cria se não existir)
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await db.insert(schema.users).values({
      name: "Admin",
      email: adminEmail,
      passwordHash,
      role: "admin",
      isActive: true,
    });
    console.log(`> Admin criado: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log("> Admin já existe, não foi recriado.");
  }

  // Produtos iniciais (ignora se já existir por SKU)
  const initialProducts = [
    { sku: "SKU-001", name: "Produto A", unit: "UN" },
    { sku: "SKU-002", name: "Produto B", unit: "UN" },
    { sku: "SKU-003", name: "Produto C", unit: "CX" },
  ];

  for (const p of initialProducts) {
    await db
      .insert(schema.products)
      .values(p)
      .onConflictDoNothing({ target: schema.products.sku });
  }

  console.log("> Seed concluído.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
