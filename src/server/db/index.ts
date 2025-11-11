try { require("server-only"); } catch {}
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// Garante que sempre rodaremos em Node (importante para better-sqlite3)
export const runtime = "nodejs";

// Caminho do banco (permite override por env, mas default é ./data/db.sqlite)
const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "db.sqlite");
const DB_PATH = process.env.DATABASE_URL?.replace("file:", "") ?? DEFAULT_DB_PATH;

// Garante que a pasta data/ exista
const dataDir = path.dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Evita múltiplas instâncias no hot-reload do Next em dev
declare global {
  // eslint-disable-next-line no-var
  var __sqlite__: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __drizzle__: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

const sqlite = global.__sqlite__ ?? new Database(DB_PATH, { fileMustExist: false });

if (process.env.NODE_ENV !== "production") {
  global.__sqlite__ = sqlite;
}

export const db =
  global.__drizzle__ ?? drizzle(sqlite, { schema, logger: process.env.NODE_ENV === "development" });

if (process.env.NODE_ENV !== "production") {
  global.__drizzle__ = db;
}

// Utilidade simples para transações (opcional)
export async function withTransaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  // better-sqlite3 é síncrono; usamos um pattern simples para agrupar operações
  const begin = sqlite.prepare("BEGIN");
  const commit = sqlite.prepare("COMMIT");
  const rollback = sqlite.prepare("ROLLBACK");
  try {
    begin.run();
    const res = await fn(db);
    commit.run();
    return res;
  } catch (err) {
    rollback.run();
    throw err;
  }
}

export { schema };
