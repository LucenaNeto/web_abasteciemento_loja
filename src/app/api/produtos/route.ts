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

async function assertUnitExistsAndActive(unitId: number) {
  const [u] = await db
    .select({ id: schema.units.id, isActive: schema.units.isActive })
    .from(schema.units)
    .where(eq(schema.units.id, unitId))
    .limit(1);

  if (!u) return { ok: false as const, error: "Unidade não encontrada." };
  if (!u.isActive) return { ok: false as const, error: "Unidade inativa." };
  return { ok: true as const };
}

function parseBoolParam(v: string | null) {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return null;
}

/**
 * GET /api/produtos
 * Query:
 *  - unitId (OBRIGATÓRIO para admin; auto-resolvido para store/warehouse)
 *  - q (opcional: busca em sku ou name)
 *  - active (opcional: true/false)  ✅ agora funciona
 *  - page, pageSize
 */
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") ?? "").trim();
  const active = parseBoolParam(searchParams.get("active"));

  const unitIdParam = searchParams.get("unitId");
  const unitIdFromQuery = unitIdParam ? Number(unitIdParam) : NaN;

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const meId = Number(sessionUser?.id);

  let unitId: number | null = Number.isFinite(unitIdFromQuery) ? unitIdFromQuery : null;

  // ✅ regra nova: admin precisa informar unitId (bloqueia consulta geral)
  if (role === "admin") {
    if (!unitId) {
      return NextResponse.json(
        { error: "Informe unitId para listar produtos." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return NextResponse.json({ error: "unitId inválido." }, { status: 400 });
    }
  } else {
    // ✅ store/warehouse: resolve unitId e valida vínculo
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
  }

  // valida unidade existe e está ativa (para qualquer role)
  const unitCheck = await assertUnitExistsAndActive(unitId);
  if (!unitCheck.ok) {
    return NextResponse.json({ error: unitCheck.error }, { status: 400 });
  }

  const filters: any[] = [];
  filters.push(eq(schema.products.unitId, unitId));

  if (active !== null) {
    filters.push(eq(schema.products.isActive, active));
  }

  if (q) {
    filters.push(
      or(
        ilike(schema.products.sku, `%${q}%`),
        ilike(schema.products.name, `%${q}%`),
      ),
    );
  }

  const whereClause = and(...filters);

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
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  unit: z.string().trim().min(1).max(10).optional().default("UN"),
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

  // valida unidade existe e ativa
  const unitCheck = await assertUnitExistsAndActive(payload.unitId);
  if (!unitCheck.ok) {
    return NextResponse.json({ error: unitCheck.error }, { status: 400 });
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
