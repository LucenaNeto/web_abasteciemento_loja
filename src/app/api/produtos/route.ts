// src/app/api/produtos/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Helpers */
async function getDefaultUnitId() {
  const [u] = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.code, "00000"))
    .limit(1);

  return u?.id ?? null;
}

async function getPrimaryUnitId(userId: number) {
  const [row] = await db
    .select({ unitId: schema.userUnits.unitId })
    .from(schema.userUnits)
    .where(and(eq(schema.userUnits.userId, userId), eq(schema.userUnits.isPrimary, true)))
    .limit(1);

  return row?.unitId ?? null;
}

async function userHasUnit(userId: number, unitId: number) {
  const [row] = await db
    .select({ ok: sql<number>`1` })
    .from(schema.userUnits)
    .where(and(eq(schema.userUnits.userId, userId), eq(schema.userUnits.unitId, unitId)))
    .limit(1);

  return !!row;
}

/**
 * GET /api/produtos
 * Query:
 *  - unitId (opcional para admin; obrigatório/auto-resolvido para store/warehouse)
 *  - q (opcional: busca em sku ou name)
 *  - page, pageSize
 */
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const unitIdParam = searchParams.get("unitId");
  const unitIdFromQuery = unitIdParam ? Number(unitIdParam) : NaN;

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const meId = Number(sessionUser?.id);

  let unitId: number | null = Number.isFinite(unitIdFromQuery) ? unitIdFromQuery : null;

  // ✅ store/warehouse: força unitId (resolvendo primária)
  if (role !== "admin") {
    if (!Number.isFinite(meId)) {
      return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
    }

    if (!unitId) unitId = await getPrimaryUnitId(meId);
    if (!unitId) unitId = await getDefaultUnitId();

    if (!unitId) {
      return NextResponse.json({ error: "Unidade não definida para o usuário." }, { status: 400 });
    }

    const allowed = await userHasUnit(meId, unitId);
    if (!allowed) {
      return NextResponse.json({ error: "Sem acesso a esta unidade." }, { status: 403 });
    }
  } else {
    // admin: se veio unitId, valida; se não veio, pode listar geral
    if (unitIdParam && (!Number.isFinite(unitId as number) || (unitId as number) <= 0)) {
      return NextResponse.json({ error: "unitId inválido." }, { status: 400 });
    }
  }

  const filters: any[] = [];

  if (unitId) {
    filters.push(eq(schema.products.unitId, unitId));
  }

  if (q) {
    filters.push(or(ilike(schema.products.sku, `%${q}%`), ilike(schema.products.name, `%${q}%`)));
  }

  const whereClause = filters.length ? and(...filters) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.products)
    .where(whereClause as any);

  const rows = await db
    .select()
    .from(schema.products)
    .where(whereClause as any)
    .orderBy(desc(schema.products.id))
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      pageSize,
      total: Number(count ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(count ?? 0) / pageSize)),
    },
  });
}

/**
 * POST /api/produtos
 * Body:
 *  {
 *    unitId: number,
 *    sku: string,
 *    name: string,
 *    unit?: string,
 *    isActive?: boolean,
 *    stock?: number
 *  }
 */
const createSchema = z.object({
  unitId: z.number().int().positive(),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  unit: z.string().min(1).max(10).optional().default("UN"),
  isActive: z.boolean().optional().default(true),
  stock: z.number().int().min(0).optional().default(0),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  let payload: z.infer<typeof createSchema>;
  try {
    payload = createSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  // valida unidade existe
  const [u] = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.id, payload.unitId))
    .limit(1);

  if (!u) {
    return NextResponse.json({ error: `Unidade ${payload.unitId} não existe.` }, { status: 400 });
  }

  // evita duplicar (unitId + sku)
  const [exists] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.unitId, payload.unitId), eq(schema.products.sku, payload.sku)))
    .limit(1);

  if (exists) {
    return NextResponse.json({ error: "SKU já existe nesta unidade." }, { status: 409 });
  }

  const [created] = await db
    .insert(schema.products)
    .values({
      unitId: payload.unitId,
      sku: payload.sku,
      name: payload.name,
      unit: payload.unit ?? "UN",
      isActive: payload.isActive ?? true,
      stock: payload.stock ?? 0,
    })
    .returning();

  return NextResponse.json({ data: created }, { status: 201 });
}
