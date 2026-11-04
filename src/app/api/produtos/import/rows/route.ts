// src/app/api/produtos/import/rows/route.ts
//
// Importação por COLUNAS: o navegador lê a planilha inteira, o usuário escolhe as colunas (A, B, H...) e
// só os campos necessários chegam aqui, em lotes (cada lote é gravado de forma atômica).
// Reenviar um lote é seguro: upsert é idempotente e insert ignora SKUs já existentes.
//
// POST JSON: { unitId, mode: "insert"|"upsert", dryRun?: boolean, importId?: string,
//              part?: {index, total}, rows: [{ line, sku, name, unit? }] }   (até 10.000 linhas)
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { applyProducts, type CleanProduct } from "@/server/import/write-products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 10_000;

const bodySchema = z.object({
  unitId: z.number().int().positive(),
  mode: z.enum(["insert", "upsert"]),
  dryRun: z.boolean().optional().default(false),
  importId: z.string().max(64).optional(),
  part: z.object({ index: z.number().int().min(1), total: z.number().int().min(1) }).optional(),
  rows: z
    .array(
      z.object({
        line: z.number().int().min(0),
        sku: z.string(),
        name: z.string(),
        unit: z.string().optional(),
      }),
    )
    .max(MAX_ROWS, `Envie no máximo ${MAX_ROWS} linhas por vez.`),
});

const rowSchema = z.object({
  sku: z.string().trim().min(1, "SKU vazio.").max(64, "SKU muito longo (máx. 64)."),
  name: z.string().trim().min(1, "Nome vazio.").max(255, "Nome muito longo (máx. 255)."),
  unit: z.string().trim().min(1).max(10, "Quantidade/unidade muito longa (máx. 10)."),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const issues = (err as { issues?: unknown })?.issues;
    return NextResponse.json({ error: "Dados inválidos", details: issues ?? String(err) }, { status: 400 });
  }

  const [unit] = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.id, body.unitId))
    .limit(1);
  if (!unit) return NextResponse.json({ error: `Unidade ${body.unitId} não existe.` }, { status: 400 });

  // revalida no servidor (não confia no navegador) e remove SKUs repetidos dentro do lote
  const clean: CleanProduct[] = [];
  const errors: { line: number; error: string }[] = [];
  const seen = new Set<string>();
  for (const r of body.rows) {
    const parsed = rowSchema.safeParse({ sku: r.sku, name: r.name, unit: (r.unit ?? "").trim() || "0" });
    if (!parsed.success) {
      errors.push({ line: r.line, error: parsed.error.issues.map((i) => i.message).join(" ") });
      continue;
    }
    const key = parsed.data.sku.toUpperCase();
    if (seen.has(key)) {
      errors.push({ line: r.line, error: `SKU ${parsed.data.sku} repetido no lote.` });
      continue;
    }
    seen.add(key);
    clean.push({
      sku: parsed.data.sku,
      name: parsed.data.name,
      unit: parsed.data.unit.toUpperCase(),
      isActive: true,
    });
  }

  const adminId = Number((guard.session.user as { id?: string }).id);

  try {
    const result = await applyProducts({
      unitId: body.unitId,
      mode: body.mode,
      rows: clean,
      adminId: Number.isFinite(adminId) ? adminId : null,
      dryRun: body.dryRun,
      invalidRows: errors.length,
      audit: { via: "colunas", importId: body.importId, part: body.part },
    });
    return NextResponse.json({
      unitId: body.unitId,
      mode: body.mode,
      dryRun: body.dryRun,
      received: body.rows.length,
      valid: clean.length,
      ...result,
      errors,
    });
  } catch (e) {
    console.error("POST /api/produtos/import/rows error:", e);
    return NextResponse.json({ error: "Falha ao importar no banco." }, { status: 500 });
  }
}
