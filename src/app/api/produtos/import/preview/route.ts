// src/app/api/produtos/import/preview/route.ts
import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { z } from "zod";
import { ensureRoleApi } from "@/server/auth/rbac";
import { db, schema } from "@/server/db";
import { and, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart/form-data
//  - file: CSV/XLSX
//  - delimiter: "," | ";" (somente CSV, opcional)
//  - unitId: (via URL ?unitId=1 OU via formData unitId) ✅ obrigatório p/ preview correto
export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: `Content-Type inválido (${ct}). Envie Body→Form (multipart/form-data).` },
      { status: 415 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Falha ao interpretar multipart. Remova Content-Type manual e use Body→Form." },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);

  // ✅ unitId vindo da URL (?unitId=1) ou do formData (unitId)
  const unitIdRaw = String(searchParams.get("unitId") ?? form.get("unitId") ?? "");
  const unitId = Number(unitIdRaw);

  if (!Number.isFinite(unitId) || unitId <= 0) {
    return NextResponse.json(
      { error: "Informe unitId válido. Ex: /api/produtos/import/preview?unitId=1" },
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

  const filePart = getAnyFilePart(form);
  if (!filePart) {
    const keys = Array.from(form.keys());
    return NextResponse.json(
      { error: `Nenhum arquivo encontrado. Chaves recebidas: ${keys.join(", ")}` },
      { status: 400 },
    );
  }

  const ab = await (filePart as any).arrayBuffer();
  const buf = Buffer.from(ab);

  const fileName = String((filePart as any).name ?? "").toLowerCase();
  const mime = String((filePart as any).type ?? "").toLowerCase();
  const isExcel =
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    mime.includes("sheet") ||
    mime.includes("excel");

  let records: any[] = [];
  let delimiterUsed: string | undefined = ",";

  if (isExcel) {
    records = parseXlsx(buf);
    delimiterUsed = undefined;
  } else {
    const text = buf.toString("utf8");
    const reqDelim = form.get("delimiter")?.toString();
    delimiterUsed = reqDelim ?? detectDelimiter(text);
    records = parseCsv(text, delimiterUsed);
  }

  // normalização + validação
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
      const isActive = toBool(r.isActive ?? r.ativo ?? r.status);

      const parsed = rowSchema.parse({ sku, name, unit: unitTxt, isActive });

      const key = parsed.sku.toUpperCase();
      if (seen.has(key)) {
        errors.push({ line, error: "SKU duplicado no arquivo." });
        return;
      }
      seen.add(key);

      cleaned.push({ row: parsed, line });
    } catch (e: any) {
      const msg =
        e?.issues?.map((i: any) => i.message).join("; ") || String(e?.message ?? e);
      errors.push({ line, error: `Linha inválida: ${msg}` });
    }
  });

  if (cleaned.length === 0) {
    return NextResponse.json(
      {
        unitId,
        error: "Nenhuma linha válida.",
        details: errors,
        type: isExcel ? "excel" : "csv",
        delimiter: delimiterUsed,
      },
      { status: 400 },
    );
  }

  // ✅ checa existência no banco POR UNIDADE (unitId + sku)
  const skus = cleaned.map((c) => c.row.sku);
  const existing = await db
    .select({ sku: schema.products.sku })
    .from(schema.products)
    .where(and(eq(schema.products.unitId, unitId), inArray(schema.products.sku, skus)));

  const existingSet = new Set(existing.map((p) => p.sku.toUpperCase()));

  const total = cleaned.length;
  const uniqueSkus = seen.size;
  const alreadyExists = cleaned.filter((c) => existingSet.has(c.row.sku.toUpperCase())).length;

  const sample = cleaned.slice(0, 20).map((c) => ({ line: c.line, ...c.row }));

  return NextResponse.json({
    unitId,
    type: isExcel ? "excel" : "csv",
    delimiter: delimiterUsed,
    stats: {
      totalRows: total,
      uniqueSkus,
      existInDb: alreadyExists,
      newSkus: uniqueSkus - alreadyExists,
      errorsCount: errors.length,
    },
    sample,
    errors,
  });
}

/* ---------------- helpers ---------------- */

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
