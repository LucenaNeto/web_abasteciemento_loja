import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";
import type { RequestStatus } from "@/server/db/schema";
import {
  ApiError,
  applyDeliveries,
  itemStatuses,
  lockRequest,
  requestStatusFromItems,
  userHasUnit,
} from "@/server/requests/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseItemId(itemParam: string | string[]) {
  const raw = Array.isArray(itemParam) ? itemParam[0] : itemParam ?? "";
  const id = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// -------- GET /api/requisicoes/itens/:itemId --------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { itemId: itemParam } = await params;
  const id = parseItemId(itemParam);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const [row] = await db
    .select({
      id: schema.requestItems.id,
      requestId: schema.requestItems.requestId,
      unitId: schema.requests.unitId,
      productId: schema.requestItems.productId,
      requestedQty: schema.requestItems.requestedQty,
      deliveredQty: schema.requestItems.deliveredQty,
      status: schema.requestItems.status,
      productSku: schema.products.sku,
      productName: schema.products.name,
      productUnit: schema.products.unit,
    })
    .from(schema.requestItems)
    .innerJoin(schema.requests, eq(schema.requests.id, schema.requestItems.requestId))
    .leftJoin(schema.products, eq(schema.products.id, schema.requestItems.productId))
    .where(eq(schema.requestItems.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

  // acesso por unidade (admin vê tudo)
  const sessionUser = guard.session.user as any;
  if (String(sessionUser?.role ?? "") !== "admin") {
    const meId = Number(sessionUser?.id);
    if (!Number.isFinite(meId)) {
      return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
    }
    if (!(await userHasUnit(db, meId, row.unitId))) {
      return NextResponse.json({ error: "Sem acesso a esta unidade." }, { status: 403 });
    }
  }

  const { unitId: _unitId, ...data } = row;
  void _unitId;
  return NextResponse.json({ data });
}

// -------- PATCH /api/requisicoes/itens/:itemId --------
// Body: { deliveredQty?: number >= 0, status?: "cancelled", confirmInsufficientStock?: boolean }
// A quantidade entregue passa pela MESMA regra de baixa de estoque da rota da requisição.
const patchSchema = z.object({
  deliveredQty: z.number().int().min(0).optional(),
  status: z.literal("cancelled").optional(),
  confirmInsufficientStock: z.boolean().optional().default(false),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { itemId: itemParam } = await params;
  const id = parseItemId(itemParam);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const userIdNum = Number(sessionUser?.id);
  const userId = Number.isFinite(userIdNum) ? userIdNum : null;

  try {
    const result = await withTransaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(schema.requestItems)
        .where(eq(schema.requestItems.id, id))
        .limit(1);
      if (!item) throw new ApiError(404, "Item não encontrado");

      // trava a requisição do item (mesma ordem de lock da rota da requisição)
      const currentReq = await lockRequest(tx, item.requestId);
      if (!currentReq) throw new ApiError(404, "Requisição não encontrada");

      if (role !== "admin") {
        if (!userId) throw new ApiError(401, "Sessão inválida.");
        if (!(await userHasUnit(tx, userId, currentReq.unitId)))
          throw new ApiError(403, "Sem acesso a esta unidade.");
      }

      if (currentReq.status === "completed" || currentReq.status === "cancelled") {
        throw new ApiError(400, "Requisição já finalizada; não é possível alterar itens.");
      }

      // relê o item já com a requisição travada
      const [cur] = await tx
        .select()
        .from(schema.requestItems)
        .where(eq(schema.requestItems.id, id))
        .limit(1);
      if (!cur) throw new ApiError(404, "Item não encontrado");

      let warnings: Awaited<ReturnType<typeof applyDeliveries>>["warnings"] = [];

      if (payload.status === "cancelled") {
        if (cur.deliveredQty > 0)
          throw new ApiError(400, "Item com quantidade entregue não pode ser cancelado.");
        await tx
          .update(schema.requestItems)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(schema.requestItems.id, id));
      } else {
        const wanted = payload.deliveredQty ?? cur.deliveredQty;
        ({ warnings } = await applyDeliveries(tx, {
          requestId: cur.requestId,
          targets: new Map([[id, wanted]]),
          completeRest: false,
          userId,
          allowInsufficientStock: payload.confirmInsufficientStock,
        }));
      }

      await tx.insert(schema.auditLogs).values({
        tableName: "request_items",
        action: "UPDATE",
        recordId: String(id),
        userId,
        payload: JSON.stringify({
          requestId: cur.requestId,
          before: { deliveredQty: cur.deliveredQty, status: cur.status },
          request: payload.status === "cancelled" ? { cancelItem: true } : { deliveredQty: payload.deliveredQty },
          stockWarningsConfirmed: warnings.length ? warnings : undefined,
        }),
      });

      // recalcula o status da requisição a partir dos itens
      const statuses = await itemStatuses(tx, cur.requestId);
      const computed = requestStatusFromItems(statuses, currentReq.status as RequestStatus);
      if (computed !== currentReq.status) {
        await tx
          .update(schema.requests)
          .set({ status: computed, updatedAt: new Date() })
          .where(eq(schema.requests.id, cur.requestId));

        await tx.insert(schema.auditLogs).values({
          tableName: "requests",
          action: "STATUS_CHANGE",
          recordId: String(cur.requestId),
          userId,
          payload: JSON.stringify({ from: currentReq.status, to: computed, reason: "item_update" }),
        });
      }

      const [after] = await tx
        .select()
        .from(schema.requestItems)
        .where(eq(schema.requestItems.id, id))
        .limit(1);

      return { after, warnings };
    });

    return NextResponse.json({ data: result.after, warnings: result.warnings });
  } catch (e: any) {
    if (e instanceof ApiError) {
      return NextResponse.json(
        { error: e.message, code: e.code, ...(e.extra ?? {}) },
        { status: e.status },
      );
    }
    console.error("PATCH /api/requisicoes/itens error:", e);
    return NextResponse.json({ error: "Erro interno ao atualizar o item." }, { status: 500 });
  }
}
