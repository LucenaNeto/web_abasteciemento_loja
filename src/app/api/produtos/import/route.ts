// src/app/api/produtos/import/route.ts
import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, eq, inArray, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos

type Mode = "insert" | "upsert";

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const form = await req.formData();

  const mode = String(form.get("mode") ?? "insert").toLowerCase() as Mode;
  if (mode !== "insert" && mode !== "upsert") {
    return NextResponse.json(
      { error: `mode deve ser 'insert' ou 'upsert'` },
      { status: 400 },
    );
  }

  // ✅ unitId vindo da URL (?unitId=1) ou do formData (unitId)
  const unitIdRaw = String(searchParams.get("unitId") ?? form.get("unitId") ?? "");
  const unitId = Number(unitIdRaw);

  if (!Number.isFinite(unitId) || unitId <= 0) {
    return NextResponse.json(
      { error: "Informe unitId válido na URL ou no formData. Ex: /api/produtos/import?unitId=1" },
      { status: 400 },
    );
  }

  // ✅ garante que a unidade existe
  const [unit] = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.id, unitId))
    .limit(1);

  if (!unit) {
    return NextResponse.json({ error: `Unidade ${unitId} não existe.` }, { status: 400 });
  }

  // pega arquivo (várias chaves comuns)
  const filePart: any = getAnyFilePart(form);
  if (!filePart) {
    const keys = Array.from(form.keys());
    return NextResponse.json(
      { error: `Nenhum arquivo encontrado no multipart. Chaves recebidas: ${keys.join(", ")}` },
      { status: 400 },
    );
  }

  const ab = await filePart.arrayBuffer();
  const buf = Buffer.from(ab);

  const fileName = String(filePart.name ?? "").toLowerCase();
  const ctype = String(filePart.type ?? "").toLowerCase();
  const isExcel =
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    ctype.includes("sheet") ||
    ctype.includes("excel");

  let records: any[] = [];
  let delimiterUsed = ",";

  if (isExcel) {
    records = parseXlsx(buf);
  } else {
    const csvText = buf.toString("utf8");
    const delimiterParam = form.get("delimiter")?.toString();
    delimiterUsed = delimiterParam ?? detectDelimiter(csvText);
    records = parseCsv(csvText, delimiterUsed);
  }

  // valida/normaliza linhas
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
    const line = (r.__line ?? idx + 2) as number;
    try {
      const sku = String(r.sku ?? r.SKU ?? "").trim();
      const name =
        String(r.name ?? "").trim() ||
        String(r.nome ?? "").trim() ||
        String(r.descricao ?? r["descrição"] ?? "").trim();
      const unitTxt = String(r.unit ?? r.unidade ?? r.uni ?? r.und ?? "").trim() || "UN";
      const isActiveRaw = r.isActive ?? r.ativo ?? r.status;
      const isActive = toBool(isActiveRaw);

      const parsed = rowSchema.parse({ sku, name, unit: unitTxt, isActive });

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

  // --- EXISTENTES por (unitId + sku) ---
  const skuList = cleaned.map((c) => c.row.sku);
  const existingSkusUpper = new Set<string>();

  // chunk para evitar query gigante
  for (const chunk of chunkArray(skuList, 1000)) {
    const rows = await db
      .select({ sku: schema.products.sku })
      .from(schema.products)
      .where(and(eq(schema.products.unitId, unitId), inArray(schema.products.sku, chunk)));

    for (const r of rows) existingSkusUpper.add(String(r.sku).toUpperCase());
  }

  const insertedPlanned =
    mode === "insert"
      ? cleaned.filter((c) => !existingSkusUpper.has(c.row.sku.toUpperCase())).length
      : cleaned.filter((c) => !existingSkusUpper.has(c.row.sku.toUpperCase())).length;

  const updatedPlanned =
    mode === "upsert"
      ? cleaned.filter((c) => existingSkusUpper.has(c.row.sku.toUpperCase())).length
      : 0;

  const skippedPlanned = mode === "insert" ? cleaned.length - insertedPlanned : 0;

  const adminId = Number((guard.session.user as any).id);
  const summary = {
    unitId,
    mode,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors,
  };

  // --- escreve no banco ---
  try {
    await withTransaction(async (tx) => {
      const values = cleaned.map(({ row }) => ({
        unitId,
        sku: row.sku,
        name: row.name,
        unit: row.unit ?? "UN",
        isActive: row.isActive ?? true,
        stock: 0,
      }));

      if (mode === "insert") {
        // insere só os que não existem
        const toInsert = values.filter((v) => !existingSkusUpper.has(v.sku.toUpperCase()));

        for (const batch of chunkArray(toInsert, 500)) {
          if (batch.length === 0) continue;
          await tx.insert(schema.products).values(batch);
        }

        summary.inserted = insertedPlanned;
        summary.skipped = skippedPlanned;
      } else {
        // upsert em lote (unitId + sku)
        for (const batch of chunkArray(values, 500)) {
          if (batch.length === 0) continue;

          await tx
            .insert(schema.products)
            .values(batch)
            .onConflictDoUpdate({
              target: [schema.products.unitId, schema.products.sku],
              set: {
                name: sql`excluded.name`,
                unit: sql`excluded.unit`,
                isActive: sql`excluded.is_active`,
                updatedAt: new Date(),
              },
            });
        }

        summary.inserted = insertedPlanned;
        summary.updated = updatedPlanned;
      }

      // ✅ 1 log resumido (bem mais leve)
      await tx.insert(schema.auditLogs).values({
        tableName: "products",
        action: "IMPORT",
        recordId: `unit:${unitId}`,
        userId: Number.isFinite(adminId) ? adminId : null,
        payload: JSON.stringify({
          source: "import",
          unitId,
          mode,
          totals: {
            totalValidRows: cleaned.length,
            inserted: summary.inserted,
            updated: summary.updated,
            skipped: summary.skipped,
            invalidRows: errors.length,
          },
        }),
      });
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Falha ao importar no banco.", details: String(e?.message ?? e) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    unitId,
    mode,
    type: isExcel ? "excel" : "csv",
    delimiter: isExcel ? undefined : delimiterUsed,
    summary,
  });
}

/* ----------------- Helpers ----------------- */

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

function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

function parseCsv(text: string, delimiter: string) {
  return parse(text, {
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
}

function parseXlsx(buf: Buffer) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
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

function toBool(v: any) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return true;
  if (["1", "true", "t", "yes", "y", "sim", "ativo", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "nao", "não", "inativo", "off"].includes(s)) return false;
  return s as any;
}
