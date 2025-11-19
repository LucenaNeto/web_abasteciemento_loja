// src/server/db/index.ts
try {
  require("server-only");
} catch {}

// 🔹 Carrega variáveis de ambiente (.env.local e .env) tanto para Next quanto para scripts (seed, etc.)
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Garante que sempre rodamos em Node
export const runtime = "nodejs";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL não definido. Confira .env.local / variáveis do Vercel.",
  );
}

// Reuso em dev para evitar vários pools no hot-reload do Next
declare global {
  // eslint-disable-next-line no-var
  var __pg_pool__: Pool | undefined;
  // eslint-disable-next-line no-var
  var __drizzle__: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

const pool =
  global.__pg_pool__ ??
  new Pool({
    connectionString,
    max: 5, // número máximo de conexões no pool
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

// Helper de transação compatível com o que você já usa no projeto
export async function withTransaction<T>(
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  // Drizzle cuida de BEGIN/COMMIT/ROLLBACK
  return db.transaction(async (tx) => {
    return fn(tx as unknown as typeof db);
  });
}

export { schema };
