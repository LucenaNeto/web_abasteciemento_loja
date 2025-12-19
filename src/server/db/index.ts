// src/server/db/index.ts
try {
  require("server-only");
} catch {}

// ✅ Carrega .env só localmente (no Vercel não precisa e evita bundling desnecessário)
import * as dotenv from "dotenv";
if (!process.env.VERCEL) {
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Tipos para reuso no global
type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Reuso em dev (hot-reload)
declare global {
  // eslint-disable-next-line no-var
  var __pg_pool__: Pool | undefined;
  // eslint-disable-next-line no-var
  var __drizzle__: DrizzleDb | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL não definido. Confira .env.local (local) / variáveis do Vercel (Preview/Prod).",
  );
}

const pool =
  global.__pg_pool__ ??
  new Pool({
    connectionString,
    max: 5,
    // Se algum provider exigir SSL e sua URL não tiver sslmode,
    // descomente o bloco abaixo:
    // ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global.__pg_pool__ = pool;
}

export const db =
  global.__drizzle__ ??
  drizzle(pool, {
    schema,
    logger: process.env.NODE_ENV === "development",
  });

if (process.env.NODE_ENV !== "production") {
  global.__drizzle__ = db;
}

export async function withTransaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as typeof db));
}

export { schema };
