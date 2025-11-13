// src/app/api/produtos/import/route.ts
import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { inArray, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart/form-data
//   file: CSV ou Excel (.xlsx/.xls)
//   mode: "insert" | "upsert" (default: insert)
//   delimiter: "," | ";"  (apenas p/ CSV; opcional)
export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

const form = await req.formData();
const mode = String(form.get("mode") ?? "insert").toLowerCase();

// tenta pegar o arquivo por várias chaves comuns e/ou vasculha todas as entries
function getAnyFilePart(fd: FormData) {
  const keys = ["file", "files", "upload", "arquivo", "data"];
  for (const k of keys) {
    const v = fd.get(k) as any;
    if (v && typeof v.arrayBuffer === "function") return v;
  }
  for (const [, v] of fd.entries()) {
    const anyv = v as any;
    if (anyv && typeof anyv.arrayBuffer === "function") return anyv;
  }
  return null;
}

const filePart: any = getAnyFilePart(form);
if (!filePart) {
  // ajuda a diagnosticar quando o cliente manda algo esquisito
  const keys = Array.from(form.keys());
  return NextResponse.json(
    { error: `Nenhum arquivo encontrado no multipart. Chaves recebidas: ${keys.join(", ")}` },
    { status: 400 },
  );
}


  if (mode !== "insert" && mode !== "upsert") {
    return NextResponse.json({ error: `mode deve ser 'insert' ou 'upsert'` }, { status: 400 });
  }

  const ab = await (filePart as any).arrayBuffer();
  const buf = Buffer.from(ab);

  // Detecta tipo pelo nome ou content-type
  const fileName = String((filePart as any).name ?? "").toLowerCase();
  const ctype = String((filePart as any).type ?? "").toLowerCase();
  const isExcel =
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    ctype.includes("sheet") ||
    ctype.includes("excel");

  let records: any[] = [];
  let delimiterUsed = ",";

  if (isExcel) {
    records = parseXlsx(buf); // primeira planilha
  } else {
    const csvText = buf.toString("utf8");
    const delimiterParam = form.get("delimiter")?.toString();
    delimiterUsed = delimiterParam ?? detectDelimiter(csvText);
    records = parseCsv(csvText, delimiterUsed);
  }

  // Validação/normalização
  const rowSchema = z.object({
    sku: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    unit: z.string().min(1).max(10).optional().default("UN"),
    isActive: z.boolean().optional().default(true),
  });
  type CleanRow = z.infer<typeof rowSchema>;

  const cleaned: Array<{ row: CleanRow; line: number }> = [];
  const errors: Array<{ line: number; error: string }> = [];
  const seen = new Set<string>();

  records.forEach((r, idx) => {
    const line = (r.__line ?? (idx + 2)) as number; // heurística p/ linha real
    try {
      const sku = String(r.sku ?? r.SKU ?? "").trim();
      const name =
        String(r.name ?? "").trim() ||
        String(r.nome ?? "").trim() ||
        String(r.descricao ?? r["descrição"] ?? "").trim();
      const unit = String(r.unit ?? r.unidade ?? r.uni ?? r.und ?? "").trim() || "UN";
      const isActiveRaw = r.isActive ?? r.ativo ?? r.status;
      const isActive = toBool(isActiveRaw);

      const parsed = rowSchema.parse({ sku, name, unit, isActive });

      const key = parsed.sku.toUpperCase();
      if (seen.has(key)) {
        errors.push({ line, error: "SKU duplicado no arquivo." });
        return;
      }
      seen.add(key);

      cleaned.push({ row: parsed, line });
    } catch (e: any) {
      const msg = e?.issues?.map((i: any) => i.message).join("; ") || String(e?.message ?? e);
      errors.push({ line, error: `Linha inválida: ${msg}` });
    }
  });

  if (cleaned.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha válida.", details: errors }, { status: 400 });
  }

  // Consulta existentes
  const skus = cleaned.map((c) => c.row.sku);
  const existing = await db.select().from(schema.products).where(inArray(schema.products.sku, skus));
  const bySku = new Map(existing.map((p) => [p.sku.toUpperCase(), p]));
  const adminId = Number((guard.session.user as any).id);

  const summary = { inserted: 0, updated: 0, skipped: 0, errors };

  await withTransaction(async (tx) => {
    for (const { row, line } of cleaned) {
      const key = row.sku.toUpperCase();
      const current = bySku.get(key);

      if (!current) {
        try {
          const ins = await tx
            .insert(schema.products)
            .values({
              sku: row.sku,
              name: row.name,
              unit: row.unit ?? "UN",
              isActive: row.isActive ?? true,
            })
            .returning({ id: schema.products.id });

          const id = ins[0]?.id;
          await tx.insert(schema.auditLogs).values({
            tableName: "products",
            action: "CREATE",
            recordId: String(id),
            userId: Number.isFinite(adminId) ? adminId : null,
            payload: JSON.stringify({ after: { id, ...row }, source: "import" }),
          });
          summary.inserted += 1;
        } catch (e: any) {
          summary.errors.push({ line, error: `Falha ao inserir: ${String(e?.message ?? e)}` });
        }
        continue;
      }

      if (mode === "insert") {
        summary.skipped += 1;
        continue;
      }

      const patch: Partial<typeof schema.products.$inferInsert> = {};
      let changed = false;

      if (row.name && row.name !== current.name) {
        patch.name = row.name;
        changed = true;
      }
      if (row.unit && row.unit !== current.unit) {
        patch.unit = row.unit;
        changed = true;
      }
      if (typeof row.isActive === "boolean" && row.isActive !== current.isActive) {
        patch.isActive = row.isActive;
        changed = true;
      }

      if (!changed) {
        summary.skipped += 1;
        continue;
      }

      try {
        await tx
          .update(schema.products)
          .set({ ...patch, updatedAt: new Date().toISOString() })
          .where(eq(schema.products.id, current.id));

        await tx.insert(schema.auditLogs).values({
          tableName: "products",
          action: "UPDATE",
          recordId: String(current.id),
          userId: Number.isFinite(adminId) ? adminId : null,
          payload: JSON.stringify({
            before: { name: current.name, unit: current.unit, isActive: current.isActive },
            after: {
              name: patch.name ?? current.name,
              unit: patch.unit ?? current.unit,
              isActive: patch.isActive ?? current.isActive,
            },
            source: "import",
          }),
        });

        summary.updated += 1;
      } catch (e: any) {
        summary.errors.push({ line, error: `Falha ao atualizar: ${String(e?.message ?? e)}` });
      }
    }
  });

  return NextResponse.json({
    mode,
    type: isExcel ? "excel" : "csv",
    delimiter: isExcel ? undefined : delimiterUsed,
    summary,
  });
}

// ----------------- Helpers -----------------

function detectDelimiter(s: string) {
  const commas = (s.match(/,/g) || []).length;
  const semis = (s.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}
function normalizeHeader(s: string) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .trim();
}

// mapeia sinônimos pt/en → chaves canônicas
const synonymMap: Record<string, string> = {
  sku: "sku",
  codigo: "sku",
  "codigo/produto": "sku",
  código: "sku",
  name: "name",
  nome: "name",
  descricao: "name",
  descrição: "name",
  unit: "unit",
  unidade: "unit",
  uni: "unit",
  und: "unit",
  isactive: "isActive",
  is_active: "isActive",
  ativo: "isActive",
  status: "isActive",
};

// CSV
function parseCsv(text: string, delimiter: string) {
  const records = parse(text, {
    delimiter,
    bom: true,
    trim: true,
    relax_column_count: true,
    skip_empty_lines: true,
    columns: (headers: string[]) =>
      headers.map((h) => {
        const k = normalizeHeader(h);
        return synonymMap[k] ?? h;
      }),
  }) as any[];
  return records;
}

// Excel (.xlsx/.xls) — pega a primeira planilha
function parseXlsx(buf: Buffer) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // usa o texto exibido na planilha, preservando zeros à esquerda quando houver
  const arr = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false }) as any[];
  return arr.map((row) => {
    const out: any = {};
    for (const key of Object.keys(row)) {
      const k = synonymMap[normalizeHeader(key)] ?? key;
      out[k] = row[key];
    }
    return out;
  });
}

// Converte formatos comuns → boolean
function toBool(v: any) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return true; // vazio = default true
  if (["1", "true", "t", "yes", "y", "sim", "ativo", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "nao", "não", "inativo", "off"].includes(s)) return false;
  return s as any; // deixa o Zod acusar se for inválido
}
