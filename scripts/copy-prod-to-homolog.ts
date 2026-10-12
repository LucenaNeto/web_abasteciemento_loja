// scripts/copy-prod-to-homolog.ts
//
// Copia os dados de PRODUÇÃO para a HOMOLOGAÇÃO, anonimizando usuários.
//
//   origem  = DATABASE_URL de .env.local.prod   (somente LEITURA: transação READ ONLY)
//   destino = DATABASE_URL de .env.local        (precisa ser APP_ENV=homolog)
//
// Uso:
//   npm run db:copy-prod                       -> dry-run (só lê e mostra o que faria)
//   npm run db:copy-prod -- --apply            -> apaga os dados da homologação e copia
//
// Variáveis para --apply (defina só na sua sessão, nunca em arquivo):
//   ANON_PASSWORD   senha única de teste para todos os usuários anonimizados
//
// Nada é escrito na origem. Qualquer dúvida sobre origem == destino aborta antes de tocar em dados.

import * as fs from "node:fs";
import * as dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { Pool, types, type PoolClient } from "pg";
import { assertSafeDb } from "./guard-db";

const APPLY = process.argv.includes("--apply");

// Ordem respeita as chaves estrangeiras (pais antes dos filhos)
const TABLES = [
  "units",
  "users",
  "user_units",
  "products",
  "requests",
  "request_items",
  "inventory_movements",
  "audit_logs",
] as const;

const HAS_ID_SEQ = TABLES.filter((t) => t !== "user_units");

function refOf(url: URL) {
  const fromUser = url.username.split(".")[1];
  if (fromUser) return fromUser;
  const m = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  return m?.[1] ?? null;
}

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function main() {
  // --- destino: .env.local ---
  dotenv.config({ path: ".env.local", quiet: true });
  assertSafeDb("copy-prod-to-homolog");
  if ((process.env.APP_ENV ?? "").toLowerCase() !== "homolog") {
    die("APP_ENV precisa ser 'homolog' no .env.local para copiar dados.");
  }
  const destUrlRaw = process.env.DATABASE_URL;
  if (!destUrlRaw) die("DATABASE_URL (destino) não definido no .env.local.");

  // --- origem: .env.local.prod (lido à parte, não vai para process.env) ---
  if (!fs.existsSync(".env.local.prod")) die("Arquivo .env.local.prod não encontrado.");
  const prodEnv = dotenv.parse(fs.readFileSync(".env.local.prod"));
  const srcUrlRaw = prodEnv.DATABASE_URL;
  if (!srcUrlRaw) die("DATABASE_URL de produção não encontrado em .env.local.prod.");

  // --- travas: origem != destino ---
  const src = new URL(srcUrlRaw);
  const dest = new URL(destUrlRaw);
  if (srcUrlRaw === destUrlRaw) die("Origem e destino são a MESMA URL. Abortando.");
  const srcRef = refOf(src);
  const destRef = refOf(dest);
  if (srcRef && destRef && srcRef === destRef) die("Origem e destino são o MESMO projeto Supabase. Abortando.");
  if (src.hostname === dest.hostname && src.pathname === dest.pathname) {
    die("Origem e destino têm o mesmo host/banco. Abortando.");
  }
  if (prodEnv.APP_ENV && prodEnv.APP_ENV.toLowerCase() !== "production") {
    die("O .env.local.prod não está marcado como APP_ENV=production. Confira os arquivos.");
  }

  console.log(`Origem  (leitura): ${src.hostname} [${srcRef ?? "?"}]`);
  console.log(`Destino (escrita): ${dest.hostname} [${destRef ?? "?"}]`);
  console.log(`Modo: ${APPLY ? "APPLY (vai apagar e recriar os dados da HOMOLOGAÇÃO)" : "dry-run (não escreve nada)"}\n`);

  // origem devolve timestamps como texto cru (evita mudança de fuso no caminho)
  const srcTypes = {
    getTypeParser: (oid: number, format?: "text" | "binary") =>
      oid === 1114 || oid === 1184 ? (v: string) => v : types.getTypeParser(oid, format as "text"),
  };
  const srcPool = new Pool({ connectionString: srcUrlRaw, max: 1, types: srcTypes as never });
  const destPool = new Pool({ connectionString: destUrlRaw, max: 1 });

  const s = await srcPool.connect();
  const d = await destPool.connect();
  try {
    await s.query("BEGIN TRANSACTION READ ONLY");

    // --- schema: colunas origem x destino ---
    const colsOf = async (c: PoolClient, t: string) =>
      (
        await c.query(
          `select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
          [t],
        )
      ).rows.map((r) => r.column_name as string);

    const columns: Record<string, string[]> = {};
    let drift = false;
    for (const t of TABLES) {
      const sc = await colsOf(s, t);
      const dc = await colsOf(d, t);
      if (sc.length === 0) die(`Tabela ${t} não existe na origem.`);
      if (dc.length === 0) die(`Tabela ${t} não existe no destino. Rode db:migrate na homologação.`);
      const onlySrc = sc.filter((c) => !dc.includes(c));
      const onlyDest = dc.filter((c) => !sc.includes(c));
      if (onlySrc.length || onlyDest.length) {
        drift = true;
        console.log(`⚠ schema diferente em ${t}: só na origem [${onlySrc}] · só no destino [${onlyDest}]`);
      }
      columns[t] = sc.filter((c) => dc.includes(c));
    }
    if (drift) console.log("  (copiando apenas as colunas em comum)\n");

    // --- contagens ---
    console.log("tabela               origem  destino(atual)");
    for (const t of TABLES) {
      const a = (await s.query(`select count(*)::int n from "${t}"`)).rows[0].n;
      const b = (await d.query(`select count(*)::int n from "${t}"`)).rows[0].n;
      console.log(`${t.padEnd(20)} ${String(a).padStart(6)}  ${String(b).padStart(6)}`);
    }

    if (!APPLY) {
      console.log("\nDry-run concluído. Nada foi escrito. Use --apply para copiar.");
      return;
    }

    const anonPassword = process.env.ANON_PASSWORD;
    if (!anonPassword || anonPassword.length < 8) {
      die("Defina ANON_PASSWORD (mín. 8 caracteres) na sua sessão para usar --apply.");
    }
    const anonHash = await bcrypt.hash(anonPassword, 10);

    // --- guarda o(s) perfil(is) de teste que já existem na homologação ---
    const keepUsers = (await d.query(`select * from users`)).rows;
    const keepLinks = (
      await d.query(
        `select uu.user_id, u.code, uu.is_primary from user_units uu join units u on u.id = uu.unit_id`,
      )
    ).rows;
    console.log(`\nPerfis de teste existentes na homologação (serão recriados): ${keepUsers.length}`);

    // --- copia (destino em uma transação só: ou copia tudo ou nada) ---
    await d.query("BEGIN");
    await d.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);

    for (const t of TABLES) {
      const cols = columns[t];
      const { rows } = await s.query(`select ${cols.map((c) => `"${c}"`).join(", ")} from "${t}"`);

      for (const r of rows) {
        if (t === "users") {
          r.name = `Usuário ${r.id} (${r.role})`;
          r.email = `usuario${r.id}@homolog.local`;
          r.password_hash = anonHash;
        }
        if (t === "audit_logs" && r.table_name === "users") {
          r.payload = JSON.stringify({ anonimizado: true });
        }
      }

      const size = 500;
      for (let i = 0; i < rows.length; i += size) {
        const batch = rows.slice(i, i + size);
        const params: unknown[] = [];
        const tuples = batch.map((r) => {
          const ph = cols.map((c) => {
            params.push(r[c]);
            return `$${params.length}`;
          });
          return `(${ph.join(", ")})`;
        });
        await d.query(
          `insert into "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) values ${tuples.join(", ")}`,
          params,
        );
      }
      console.log(`  ✓ ${t}: ${rows.length}`);
    }

    // sequências de ID continuam depois do maior id copiado
    for (const t of HAS_ID_SEQ) {
      await d.query(
        `select setval(pg_get_serial_sequence('"${t}"', 'id'), coalesce(max(id), 1), max(id) is not null) from "${t}"`,
      );
    }

    // --- recria perfis de teste (mesmo e-mail/senha/papel), vinculados pelo CÓDIGO da unidade ---
    const unitByCode = new Map<string, number>(
      (await d.query(`select id, code from units`)).rows.map((r) => [r.code as string, r.id as number]),
    );
    for (const u of keepUsers) {
      const ins = await d.query(
        `insert into users (name, email, password_hash, role, is_active) values ($1,$2,$3,$4,$5)
         on conflict (email) do update set role = excluded.role returning id`,
        [u.name, u.email, u.password_hash, u.role, u.is_active],
      );
      const newId = ins.rows[0].id as number;
      const links = keepLinks.filter((l) => l.user_id === u.id && unitByCode.has(l.code));
      const toLink = links.length
        ? links.map((l) => ({ unitId: unitByCode.get(l.code)!, primary: l.is_primary as boolean }))
        : [{ unitId: [...unitByCode.values()][0], primary: true }];
      for (const l of toLink) {
        await d.query(
          `insert into user_units (user_id, unit_id, is_primary) values ($1,$2,$3) on conflict do nothing`,
          [newId, l.unitId, l.primary],
        );
      }
      console.log(`  ✓ perfil de teste recriado: ${u.email} (${u.role})`);
    }

    await d.query("COMMIT");
    console.log("\n✔ Cópia concluída na homologação.");
  } catch (e) {
    try {
      await d.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    try {
      await s.query("ROLLBACK");
    } catch {}
    s.release();
    d.release();
    await srcPool.end();
    await destPool.end();
  }
}

main().catch((e) => {
  console.error("\n✖ Falhou:", e?.message ?? e);
  process.exit(1);
});
