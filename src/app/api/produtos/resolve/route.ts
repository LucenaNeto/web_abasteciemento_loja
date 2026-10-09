// src/app/api/produtos/resolve/route.ts
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/produtos/resolve?code=SKU-ou-ID&unitId=N
 *
 * Exige login. Sempre resolve DENTRO de uma unidade:
 * - admin: precisa informar unitId
 * - store/warehouse: unitId opcional (usa a unidade primária); só unidades vinculadas ao usuário
 *
 * Regras do "code":
 * - Só dígitos E sem zero à esquerda -> ID numérico do produto
 * - Caso contrário -> SKU (case-insensitive, match exato)
 *
 * Retorna: { data: { id, sku, name, unit } } ou 404
 */
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("code") || "").trim();

  if (!raw) {
    return NextResponse.json({ error: "Parâmetro 'code' é obrigatório." }, { status: 400 });
  }

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const meId = Number(sessionUser?.id);

  const unitParam = searchParams.get("unitId");
  let unitId: number | null = unitParam ? Number(unitParam) : null;
  if (unitParam && (!Number.isInteger(unitId) || (unitId as number) <= 0)) {
    return NextResponse.json({ error: "unitId inválido." }, { status: 400 });
  }

  if (role === "admin") {
    if (!unitId) {
      return NextResponse.json({ error: "Informe unitId." }, { status: 400 });
    }
  } else {
    if (!Number.isFinite(meId)) {
      return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
    }
    if (!unitId) {
      const [primary] = await db
        .select({ unitId: schema.userUnits.unitId })
        .from(schema.userUnits)
        .where(and(eq(schema.userUnits.userId, meId), eq(schema.userUnits.isPrimary, true)))
        .limit(1);
      unitId = primary?.unitId ?? null;
    }
    if (!unitId) {
      return NextResponse.json({ error: "Unidade não definida para o usuário." }, { status: 400 });
    }
    const [link] = await db
      .select({ ok: sql<number>`1` })
      .from(schema.userUnits)
      .where(and(eq(schema.userUnits.userId, meId), eq(schema.userUnits.unitId, unitId)))
      .limit(1);
    if (!link) {
      return NextResponse.json({ error: "Sem acesso a esta unidade." }, { status: 403 });
    }
  }

  const onlyDigits = /^\d+$/.test(raw);
  const leadingZero = onlyDigits && raw.length > 1 && raw.startsWith("0");
  const byId = onlyDigits && !leadingZero;

  try {
    const [row] = await db
      .select({
        id: schema.products.id,
        sku: schema.products.sku,
        name: schema.products.name,
        unit: schema.products.unit,
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.unitId, unitId),
          byId
            ? eq(schema.products.id, Number.parseInt(raw, 10))
            : sql`lower(${schema.products.sku}) = ${raw.toLowerCase()}`,
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ data: row });
  } catch (e) {
    console.error("GET /api/produtos/resolve error:", e);
    return NextResponse.json({ error: "Falha ao resolver produto." }, { status: 500 });
  }
}
