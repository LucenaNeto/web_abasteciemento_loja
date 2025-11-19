// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Carrega variáveis de ambiente (tanto .env.local quanto .env, se existirem)
dotenv.config({ path: ".env.local" });
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️ DATABASE_URL não encontrada em .env.local / .env. " +
      "Drizzle não vai conseguir conectar no Supabase."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",

  // pasta nova para migrações do Supabase (não usa mais as antigas do SQLite)
  out: "./drizzle_supabase",

  dbCredentials: {
    // URL completa do Supabase (postgres://usuario:senha@host:5432/db)
    url: process.env.DATABASE_URL!,
  },

  strict: true,
  verbose: true,
});
