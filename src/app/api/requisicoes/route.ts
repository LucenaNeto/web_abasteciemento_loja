// src/app/api/requisicoes/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/requisicoes
 * Query:
 *  - status: "pending" | "in_progress" | "completed" | "cancelled"
 *  - q: busca por id (numérico exato) OU em note (like)
 *  - createdBy: "me" | id numérico (opcional)
 *  - page, pageSize
 */
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status") ?? "";
  const q = (searchParams.get("q") ?? "").trim();
  const createdBy = (searchParams.get("createdBy") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") ?? "20")),
  );
  const offset = (page - 1) * pageSize;

  const filters: any[] = [];
  if (statusParam) filters.push(eq(schema.requests.status, statusParam as any));

  if (q) {
    const idNum = Number(q);
    if (Number.isFinite(idNum)) {
      filters.push(eq(schema.requests.id, idNum));
    } else {
      filters.push(like(schema.requests.note, `%${q}%`));
    }
  }

  if (createdBy) {
    if (createdBy === "me") {
      const meId = Number((guard.session.user as any).id);
      if (Number.isFinite(meId)) {
        filters.push(eq(schema.requests.createdByUserId, meId));
      }
    } else {
      const idNum = Number(createdBy);
      if (Number.isFinite(idNum)) {
        filters.push(eq(schema.requests.createdByUserId, idNum));
      }
    }
  }

  const whereClause = filters.length ? and(...filters) : undefined;

  // Total
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.requests)
    .where(whereClause as any);

  // Lista
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
      totalPages: Math.max(
        1,
        Math.ceil(Number(count ?? 0) / pageSize),
      ),
    },
  });
}

/**
 * POST /api/requisicoes
 * Body:
 *  {
 *    note?: string,
 *    criticality?: "cashier" | "service" | "restock",
 *    items: Array<{ productId: number, requestedQty: number }>
 *  }
 */
const createSchema = z.object({
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

  // Checa duplicidade de productId no payload
  const ids = payload.items.map((i) => i.productId);
  const hasDup = new Set(ids).size !== ids.length;
  if (hasDup) {
    return NextResponse.json(
      { error: "Itens duplicados: remova produtos repetidos." },
      { status: 400 },
    );
  }

  // Valida existência e ativo
  const prods = await db
    .select()
    .from(schema.products)
    .where(inArray(schema.products.id, ids as number[]));

  if (prods.length !== ids.length) {
    return NextResponse.json(
      { error: "Algum produto não existe." },
      { status: 400 },
    );
  }
  const inativos = prods.filter((p) => !p.isActive);
  if (inativos.length > 0) {
    return NextResponse.json(
      { error: "Há produto(s) inativo(s) no pedido." },
      { status: 400 },
    );
  }

  // 🔹 Resolver userId de forma segura (sem NaN)
  const sessionUser = guard.session.user as any;
  const sessionId = sessionUser?.id;
  const sessionEmail = sessionUser?.email as string | undefined;

  let userId: number | null = null;

  // 1) tenta usar o id que veio na sessão
  if (sessionId != null) {
    const n = Number(sessionId);
    if (Number.isFinite(n)) {
      userId = n;
    }
  }

  // 2) se não deu, tenta achar o usuário pelo e-mail
  if (!userId && sessionEmail) {
    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, sessionEmail))
      .limit(1);

    if (u) {
      const n = Number(u.id);
      if (Number.isFinite(n)) {
        userId = n;
      }
    }
  }

  if (!userId) {
    console.error("POST /api/requisicoes -> userId não encontrado", {
      sessionId,
      sessionEmail,
    });
    return NextResponse.json(
      { error: "Usuário da sessão não encontrado no banco." },
      { status: 401 },
    );
  }

  // Cria requisição + itens dentro de uma transação
  const created = await withTransaction(async (tx) => {
    // cria request
    const res = await tx
      .insert(schema.requests)
      .values({
        createdByUserId: userId,
        assignedToUserId: null,
        status: "pending",
        criticality: payload.criticality, // 🔴🟡🟢 salva criticidade
        note: payload.note || null,
      })
      .returning({ id: schema.requests.id });

    const requestId = res[0]?.id as number;

    // cria itens
    const itemsToInsert: typeof schema.requestItems.$inferInsert[] =
      payload.items.map((it) => ({
        requestId,
        productId: it.productId,
        requestedQty: it.requestedQty,
        deliveredQty: 0,
        status: "pending" as const,
      }));

    await tx.insert(schema.requestItems).values(itemsToInsert);

    // auditoria
    await tx.insert(schema.auditLogs).values({
      tableName: "requests",
      action: "CREATE",
      recordId: String(requestId),
      userId,
      payload: JSON.stringify({
        after: {
          requestId,
          note: payload.note,
          criticality: payload.criticality,
          items: payload.items,
        },
      }),
    });

    // retorna a request criada
    const [reqRow] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);

    return reqRow;
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
