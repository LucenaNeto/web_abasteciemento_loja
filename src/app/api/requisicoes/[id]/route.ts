import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";
import type { RequestStatus } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- GET /api/requisicoes/:id ----------
export async function GET(_req: Request, { params }: { params: Promise<{ id: string | string[] }> }) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam ?? "";
  const idStr = decodeURIComponent(String(raw)).trim();
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const [reqRow] = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ error: "Requisição não encontrada" }, { status: 404 });
  }

  // itens + produtos
  const items = await db
    .select({
      id: schema.requestItems.id,
      productId: schema.requestItems.productId,
      requestedQty: schema.requestItems.requestedQty,
      deliveredQty: schema.requestItems.deliveredQty,
      status: schema.requestItems.status,
      productSku: schema.products.sku,
      productName: schema.products.name,
      productUnit: schema.products.unit,
    })
    .from(schema.requestItems)
    .leftJoin(schema.products, eq(schema.products.id, schema.requestItems.productId))
    .where(eq(schema.requestItems.requestId, id));

  // (opcional) nomes de usuário
  const [createdBy] = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, reqRow.createdByUserId))
    .limit(1);

  let assignedTo: { id: number; name: string } | null = null;
  if (reqRow.assignedToUserId) {
    const [ass] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, reqRow.assignedToUserId))
      .limit(1);
    assignedTo = ass ?? null;
  }

  return NextResponse.json({
    data: {
      ...reqRow,
      createdBy,
      assignedTo,
      items,
    },
  });
}

// ---------- PATCH /api/requisicoes/:id ----------
// Body: { status: "in_progress" | "completed" | "cancelled", assignToMe?: boolean }
const patchSchema = z.object({
  status: z.enum(["in_progress", "completed", "cancelled"]),
  assignToMe: z.boolean().optional().default(false),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string | string[] }> }) {
  const guard = await ensureRoleApi(["admin", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam ?? "";
  const idStr = decodeURIComponent(String(raw)).trim();
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  
  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const userId = Number((guard.session.user as any).id);

  const updated = await withTransaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, id))
      .limit(1);

    if (!current) {
      throw new ApiError(404, "Requisição não encontrada");
    }

    // Regras simples de transição
    const from = current.status as RequestStatus;
    const to = payload.status as RequestStatus;

    if (from === "completed" || from === "cancelled") {
      throw new ApiError(400, "Requisição já finalizada; não é possível alterar status.");
    }
    if (from === "pending" && !(to === "in_progress" || to === "cancelled")) {
      throw new ApiError(400, "Transição inválida a partir de 'pending'.");
    }
    if (from === "in_progress" && !(to === "completed" || to === "cancelled")) {
      throw new ApiError(400, "Transição inválida a partir de 'in_progress'.");
    }

    // prepara update
    const patch: Partial<typeof schema.requests.$inferInsert> = {
      status: to,
    };
    if (payload.assignToMe) {
      patch.assignedToUserId = Number.isFinite(userId) ? userId : null;
    }

    await tx
      .update(schema.requests)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(schema.requests.id, id));

    // auditoria
    await tx.insert(schema.auditLogs).values({
      tableName: "requests",
      action: "STATUS_CHANGE",
      recordId: String(id),
      userId: Number.isFinite(userId) ? userId : null,
      payload: JSON.stringify({ from, to, assignToMe: payload.assignToMe ?? false }),
    });

    const [after] = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, id))
      .limit(1);

    return after;
  });

  return NextResponse.json({ data: updated });
}

// Utilitário simples p/ lançar HTTP errors dentro da tx
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Converte ApiError para resposta adequada
export async function POST() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
