// src/app/api/requisicoes/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

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
    .where(
      and(
        eq(schema.userUnits.userId, userId),
        eq(schema.userUnits.isPrimary, true),
      ),
    )
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

/**
 * GET /api/requisicoes
 * Query:
 *  - status, q, createdBy, page, pageSize
 *  - unitId (opcional)
 */
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);

  const statusParam = searchParams.get("status") ?? "";
  const q = (searchParams.get("q") ?? "").trim();
  const createdBy = (searchParams.get("createdBy") ?? "").trim();

  const unitIdParam = searchParams.get("unitId");
  const unitIdFromQuery = unitIdParam ? Number(unitIdParam) : NaN;

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const meId = Number(sessionUser?.id);

  let unitId: number | null = Number.isFinite(unitIdFromQuery) ? unitIdFromQuery : null;

  // Se não for admin, resolve unidade (primária -> default) e valida acesso
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
  }

  const filters: any[] = [];

  if (unitId) filters.push(eq(schema.requests.unitId, unitId));
  if (statusParam) filters.push(eq(schema.requests.status, statusParam as any));

  if (q) {
    const idNum = Number(q);
    if (Number.isFinite(idNum)) filters.push(eq(schema.requests.id, idNum));
    else filters.push(like(schema.requests.note, `%${q}%`));
  }

  if (createdBy) {
    if (createdBy === "me") {
      if (Number.isFinite(meId)) filters.push(eq(schema.requests.createdByUserId, meId));
    } else {
      const idNum = Number(createdBy);
      if (Number.isFinite(idNum)) filters.push(eq(schema.requests.createdByUserId, idNum));
    }
  }

  const whereClause = filters.length ? and(...filters) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.requests)
    .where(whereClause as any);

  const rows = await db
    .select()
    .from(schema.requests)
    .where(whereClause as any)
    .orderBy(desc(schema.requests.id))
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
 * POST /api/requisicoes
 */
const createSchema = z.object({
  // ✅ aceita null também (mais robusto caso o front mande null por acidente)
  unitId: z.number().int().positive().nullable().optional(),
  note: z.string().max(500).optional().default(""),
  criticality: z.enum(["cashier", "service", "restock"]).default("restock"),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        requestedQty: z.number().int().min(1),
      }),
    )
    .min(1, "Informe pelo menos 1 item."),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin", "store"]);
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

  const ids = payload.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json(
      { error: "Itens duplicados: remova produtos repetidos." },
      { status: 400 },
    );
  }

  // userId seguro
  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const sessionId = sessionUser?.id;
  const sessionEmail = sessionUser?.email as string | undefined;

  let userId: number | null = null;
  if (sessionId != null) {
    const n = Number(sessionId);
    if (Number.isFinite(n)) userId = n;
  }

  if (!userId && sessionEmail) {
    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, sessionEmail))
      .limit(1);

    if (u) {
      const n = Number(u.id);
      if (Number.isFinite(n)) userId = n;
    }
  }

  if (!userId) {
    console.error("POST /api/requisicoes -> userId não encontrado", { sessionId, sessionEmail });
    return NextResponse.json({ error: "Usuário da sessão não encontrado no banco." }, { status: 401 });
  }

  // ✅ resolve unitId
  // - admin: EXIGE unitId no body (evita cair na 00000 sem querer)
  // - store: body -> primary -> default
  let unitId: number | null = payload.unitId ?? null;

  if (role === "admin") {
    if (!unitId) {
      return NextResponse.json(
        { error: "Informe unitId para criar a requisição." },
        { status: 400 },
      );
    }
  } else {
    if (!unitId) unitId = await getPrimaryUnitId(userId);
    if (!unitId) unitId = await getDefaultUnitId();
  }

  if (!unitId) {
    return NextResponse.json({ error: "Unidade não definida." }, { status: 400 });
  }

  // valida unidade existe e ativa
  const unitCheck = await assertUnitExistsAndActive(unitId);
  if (!unitCheck.ok) {
    return NextResponse.json({ error: unitCheck.error }, { status: 400 });
  }

  // store precisa ter vínculo com a unidade
  if (role !== "admin") {
    const allowed = await userHasUnit(userId, unitId);
    if (!allowed) return NextResponse.json({ error: "Sem acesso a esta unidade." }, { status: 403 });
  }

  // ✅ valida produtos da mesma unidade
  const prods = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.unitId, unitId), inArray(schema.products.id, ids as number[])));

  if (prods.length !== ids.length) {
    return NextResponse.json(
      { error: "Algum produto não existe nesta unidade (ou não existe)." },
      { status: 400 },
    );
  }

  if (prods.some((p) => !p.isActive)) {
    return NextResponse.json({ error: "Há produto(s) inativo(s) no pedido." }, { status: 400 });
  }

  const created = await withTransaction(async (tx) => {
    const res = await tx
      .insert(schema.requests)
      .values({
        unitId,
        createdByUserId: userId,
        assignedToUserId: null,
        status: "pending",
        criticality: payload.criticality,
        note: payload.note || null,
      })
      .returning({ id: schema.requests.id });

    const requestId = res[0]!.id;

    await tx.insert(schema.requestItems).values(
      payload.items.map((it) => ({
        requestId,
        productId: it.productId,
        requestedQty: it.requestedQty,
        deliveredQty: 0,
        status: "pending" as const,
      })),
    );

    await tx.insert(schema.auditLogs).values({
      tableName: "requests",
      action: "CREATE",
      recordId: String(requestId),
      userId,
      payload: JSON.stringify({
        after: {
          requestId,
          unitId,
          note: payload.note,
          criticality: payload.criticality,
          items: payload.items,
        },
      }),
    });

    const [reqRow] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);

    return reqRow;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
