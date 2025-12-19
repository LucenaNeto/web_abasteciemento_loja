// src/app/api/produtos/import/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";

// ✅ IMPORTA AS TABELAS DIRETAMENTE (evita o erro "schema.units não existe" no build)
import { products, units } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Esperado (de planilha/CSV/JSON):
 * sku (obrigatório)
 * name (obrigatório)
 * unit (opcional) -> default "UN"
 * isActive (opcional) -> default true
 * stock (opcional) -> default 0
 */
type ImportRow = {
  sku: string;
  name: string;
  unit?: string | null;
  isActive?: boolean | null;
  stock?: number | null;
};

const jsonBodySchema = z.object({
  // ✅ opcional: pode mandar unitId no JSON também
  unitId: z.number().int().positive().optional(),
  rows: z.array(
    z.object({
      sku: z.string().min(1),
      name: z.string().min(1),
      unit: z.string().optional(),
      isActive: z.boolean().optional(),
      stock: z.number().int().optional(),
    }),
  ),
});

function normalizeSku(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeName(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeUnit(v: unknown) {
  const s = String(v ?? "").trim();
  return s || "UN";
}

function normalizeBool(v: unknown, def = true) {
  if (v === null || v === undefined || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y"].includes(s)) return true;
  if (["0", "false", "nao", "não", "no", "n"].includes(s)) return false;
  return def;
}

function normalizeInt(v: unknown, def = 0) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

async function getDefaultUnitId() {
  const [u] = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.code, "00000"))
    .limit(1);

  return u?.id ?? null;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseCsvToRows(csvText: string): ImportRow[] {
  // CSV simples (separador , ou ;)
  const lines = csvText
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());

  const idxSku = headers.indexOf("sku");
  const idxName = headers.indexOf("name");
  const idxUnit = headers.indexOf("unit");
  const idxIsActive = headers.indexOf("isactive");
  const idxStock = headers.indexOf("stock");

  const rows: ImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim());

    const sku = normalizeSku(cols[idxSku] ?? "");
    const name = normalizeName(cols[idxName] ?? "");

    if (!sku || !name) continue;

    rows.push({
      sku,
      name,
      unit: normalizeUnit(cols[idxUnit]),
      isActive: idxIsActive >= 0 ? normalizeBool(cols[idxIsActive], true) : true,
      stock: idxStock >= 0 ? normalizeInt(cols[idxStock], 0) : 0,
    });
  }

  return rows;
}

async function parseXlsxToRows(file: File): Promise<ImportRow[]> {
  // dependência: xlsx
  const XLSX = await import("xlsx");

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];

  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

  // tenta mapear colunas por nome
  const rows: ImportRow[] = [];

  for (const r of json) {
    // aceita variações: SKU/sku, Nome/name, Unidade/unit, Ativo/isActive, Estoque/stock
    const sku = normalizeSku(r.sku ?? r.SKU ?? r.Sku);
    const name = normalizeName(r.name ?? r.Nome ?? r.NOME ?? r.Name);

    if (!sku || !name) continue;

    const unit = normalizeUnit(r.unit ?? r.Unidade ?? r.UNIDADE);
    const isActive = normalizeBool(r.isActive ?? r.Ativo ?? r.ATIVO, true);
    const stock = normalizeInt(r.stock ?? r.Estoque ?? r.ESTOQUE, 0);

    rows.push({ sku, name, unit, isActive, stock });
  }

  return rows;
}

/**
 * POST /api/produtos/import?unitId=123
 * - FormData: { file: File }  (xlsx/csv)
 * - OU JSON: { unitId?: number, rows: ImportRow[] }
 */
export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const url = new URL(req.url);
  const unitIdParam = url.searchParams.get("unitId");
  const unitIdFromQuery = unitIdParam ? Number(unitIdParam) : NaN;

  const contentType = req.headers.get("content-type") ?? "";

  let incomingUnitId: number | null = Number.isFinite(unitIdFromQuery) ? unitIdFromQuery : null;
  let rows: ImportRow[] = [];

  // 1) JSON (compatível com import antigo, se existir)
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const parsed = jsonBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "JSON inválido", details: parsed.error.issues },
        { status: 400 },
      );
    }

    incomingUnitId = incomingUnitId ?? parsed.data.unitId ?? null;
    rows = parsed.data.rows;
  } else {
    // 2) FormData com arquivo
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Envie um arquivo via multipart/form-data (campo 'file') ou JSON." },
        { status: 400 },
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Arquivo não encontrado. Envie no campo 'file'." },
        { status: 400 },
      );
    }

    const fname = (file.name || "").toLowerCase();

    if (fname.endsWith(".csv")) {
      const text = await file.text();
      rows = parseCsvToRows(text);
    } else if (fname.endsWith(".xlsx") || fname.endsWith(".xls")) {
      rows = await parseXlsxToRows(file);
    } else {
      return NextResponse.json(
        { error: "Formato não suportado. Use .csv ou .xlsx" },
        { status: 400 },
      );
    }
  }

  // resolve unitId (query -> body -> default 00000)
  let unitId = incomingUnitId;
  if (!unitId) unitId = await getDefaultUnitId();

  if (!unitId) {
    return NextResponse.json(
      { error: "unitId é obrigatório (e a unidade 00000 não existe no banco)." },
      { status: 400 },
    );
  }

  // sanitiza/valida linhas
  const cleaned: ImportRow[] = rows
    .map((r) => ({
      sku: normalizeSku(r.sku),
      name: normalizeName(r.name),
      unit: normalizeUnit(r.unit),
      isActive: normalizeBool(r.isActive, true),
      stock: normalizeInt(r.stock, 0),
    }))
    .filter((r) => r.sku && r.name);

  if (cleaned.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha válida encontrada (precisa de sku e name)." },
      { status: 400 },
    );
  }

  // opcional: remove duplicados por sku na mesma carga (último vence)
  const map = new Map<string, ImportRow>();
  for (const r of cleaned) map.set(r.sku, r);
  const uniqueRows = Array.from(map.values());

  // ✅ Upsert em lote (menos roundtrips)
  // Ajuste CHUNK_SIZE se precisar
  const CHUNK_SIZE = 500;

  const payloadToInsert = uniqueRows.map((r) => ({
    unitId, // ✅ obrigatório agora
    sku: r.sku,
    name: r.name,
    unit: r.unit ?? "UN",
    isActive: r.isActive ?? true,
    stock: r.stock ?? 0,
  }));

  await withTransaction(async (tx) => {
    for (const part of chunk(payloadToInsert, CHUNK_SIZE)) {
      await tx
        .insert(products)
        .values(part)
        .onConflictDoUpdate({
          // ✅ conflito composto
          target: [products.unitId, products.sku],
          // ✅ usa EXCLUDED (funciona bem em lote)
          set: {
            name: sql`excluded.name`,
            unit: sql`excluded.unit`,
            isActive: sql`excluded.is_active`,
            stock: sql`excluded.stock`,
            updatedAt: sql`now()`,
          },
        });
    }
  });

  return NextResponse.json(
    {
      ok: true,
      unitId,
      received: rows.length,
      valid: cleaned.length,
      unique: uniqueRows.length,
      message: "Import concluído (upsert por unidade + sku).",
    },
    { status: 200 },
  );
}
