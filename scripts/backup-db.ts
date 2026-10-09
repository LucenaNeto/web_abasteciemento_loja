// scripts/backup-db.ts
//
// Cópia de segurança LÓGICA (somente leitura) de um banco, em arquivos NDJSON (uma linha JSON por registro).
// Complementa — não substitui — o backup do Supabase e o pg_dump.
//
//   npm run db:backup                           -> lê DATABASE_URL de .env.local.prod (produção)
//   npm run db:backup -- --env=.env.local       -> lê de outro arquivo
//
// Saída: backups/AAAA-MM-DDTHH-MM-SS/<tabela>.ndjson + manifest.json (contagens, versão, SHA-256).
// A pasta backups/ está no .gitignore: contém dados reais (e-mails e hashes de senha). Guarde com cuidado.
//
// O banco é lido em transação READ ONLY; nada é escrito nele.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as dotenv from "dotenv";
import { Pool, types } from "pg";

const TABLES: { name: string; key?: string }[] = [
  { name: "units", key: "id" },
  { name: "users", key: "id" },
  { name: "user_units" }, // chave composta: lida de uma vez
  { name: "products", key: "id" },
  { name: "requests", key: "id" },
  { name: "request_items", key: "id" },
  { name: "inventory_movements", key: "id" },
  { name: "audit_logs", key: "id" },
  { name: "notifications", key: "id" }, // só existe depois da migração 0006
];

const PAGE = 5000;

function arg(name: string, fallback: string) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
}

async function main() {
  const envFile = arg("env", ".env.local.prod");
  if (!fs.existsSync(envFile)) throw new Error(`Arquivo ${envFile} não encontrado.`);
  const url = dotenv.parse(fs.readFileSync(envFile)).DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL não definido em ${envFile}.`);
  const host = new URL(url).hostname;

  // timestamps como texto cru: o backup guarda exatamente o que está no banco
  const raw = {
    getTypeParser: (oid: number, format?: "text" | "binary") =>
      oid === 1114 || oid === 1184 ? (v: string) => v : types.getTypeParser(oid, format as "text"),
  };
  const pool = new Pool({ connectionString: url, max: 1, types: raw as never });
  const c = await pool.connect();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join("backups", stamp);
  fs.mkdirSync(dir, { recursive: true });

  try {
    await c.query("BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ"); // foto consistente
    const version = (await c.query("select current_setting('server_version') v")).rows[0].v as string;
    const migrations = Number(
      (await c.query("select count(*)::int n from drizzle.__drizzle_migrations")).rows[0].n,
    );
    console.log(`Origem: ${host} · PostgreSQL ${version} · ${migrations} migrações aplicadas`);

    const manifest: Record<string, unknown> = {
      createdAt: new Date().toISOString(),
      sourceHost: host,
      serverVersion: version,
      migrationsApplied: migrations,
      tables: {} as Record<string, { rows: number; sha256: string; file: string }>,
    };

    for (const t of TABLES) {
      const exists = (
        await c.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [t.name])
      ).rowCount;
      if (!exists) {
        console.log(`  - ${t.name}: não existe (ignorado)`);
        continue;
      }

      const file = path.join(dir, `${t.name}.ndjson`);
      const out = fs.createWriteStream(file);
      const hash = crypto.createHash("sha256");
      let rows = 0;
      const write = (obj: unknown) => {
        const line = JSON.stringify(obj) + "\n";
        hash.update(line);
        out.write(line);
        rows++;
      };

      if (t.key) {
        let last = 0;
        for (;;) {
          const r = await c.query(`select * from "${t.name}" where "${t.key}" > $1 order by "${t.key}" limit ${PAGE}`, [last]);
          for (const row of r.rows) write(row);
          if (r.rows.length < PAGE) break;
          last = Number(r.rows[r.rows.length - 1][t.key]);
        }
      } else {
        const r = await c.query(`select * from "${t.name}"`);
        for (const row of r.rows) write(row);
      }
      await new Promise<void>((res) => out.end(res));

      // confere contra a contagem do próprio banco (mesma foto)
      const expected = Number((await c.query(`select count(*)::int n from "${t.name}"`)).rows[0].n);
      if (expected !== rows) throw new Error(`${t.name}: gravou ${rows} linhas, o banco tem ${expected}.`);

      (manifest.tables as Record<string, unknown>)[t.name] = {
        rows,
        sha256: hash.digest("hex"),
        file: path.basename(file),
      };
      console.log(`  ✓ ${t.name}: ${rows}`);
    }

    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`\n✔ Backup concluído em ${dir}`);
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("\n✖ Falhou:", e?.message ?? e);
  process.exit(1);
});
