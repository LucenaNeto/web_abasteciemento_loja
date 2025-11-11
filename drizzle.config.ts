// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // caminho do arquivo SQLite para o CLI do Drizzle
    url: "./data/db.sqlite",
  },
  strict: true,
  verbose: true,
});
