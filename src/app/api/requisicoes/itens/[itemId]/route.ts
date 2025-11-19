// src/app/api/requisicoes/itens/[itemId]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";
import type { ItemStatus, RequestStatus } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------- GET /api/requisicoes/itens/:itemId --------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { itemId: itemParam } = await params;
  const raw = Array.isArray(itemParam) ? itemParam[0] : itemParam ?? "";
  const id = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: schema.requestItems.id,
      requestId: schema.requestItems.requestId,
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
    .where(eq(schema.requestItems.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

  return NextResponse.json({ data: row });
}

// -------- PATCH /api/requisicoes/itens/:itemId --------
// Body: { deliveredQty?: number >= 0, status?: "pending" | "partial" | "delivered" | "cancelled" }
const patchSchema = z.object({
  deliveredQty: z.number().int().min(0).optional(),
  status: z.enum(["pending", "partial", "delivered", "cancelled"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { itemId: itemParam } = await params;
  const raw = Array.isArray(itemParam) ? itemParam[0] : itemParam ?? "";
  const id = Number.parseInt(String(raw).trim(), 10);
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

  // --- INÍCIO DO BLOCO ADICIONADO ---
  // A chamada da transação agora está envolvida em um try/catch
  let updated;
  try {
    updated = await withTransaction(async (tx) => {
      // Busca item + request atual
      const [currentItem] = await tx
        .select()
        .from(schema.requestItems)
        .where(eq(schema.requestItems.id, id))
        .limit(1);

      if (!currentItem) throw new ApiError(404, "Item não encontrado");

      const [currentReq] = await tx
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.id, currentItem.requestId))
        .limit(1);

      if (!currentReq) throw new ApiError(404, "Requisição não encontrada");

      if (currentReq.status === "completed" || currentReq.status === "cancelled") {
        throw new ApiError(400, "Requisição já finalizada; não é possível alterar itens.");
      }

      // Calcula novos valores do item
      let deliveredQty = payload.deliveredQty ?? currentItem.deliveredQty;
      if (!Number.isFinite(deliveredQty) || deliveredQty < 0) {
        throw new ApiError(400, "Quantidade entregue inválida.");
      }
      // limita ao solicitado
      if (deliveredQty > currentItem.requestedQty) deliveredQty = currentItem.requestedQty;

      let newStatus: ItemStatus | undefined = payload.status as ItemStatus | undefined;
      if (!newStatus) {
        if (deliveredQty <= 0) newStatus = "pending";
        else if (deliveredQty >= currentItem.requestedQty) newStatus = "delivered";
        else newStatus = "partial";
      }

      // Atualiza item
      await tx
        .update(schema.requestItems)
        .set({
          deliveredQty,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.requestItems.id, id));

      // Auditoria (item)
      await tx.insert(schema.auditLogs).values({
        tableName: "request_items",
        action: "UPDATE",
        recordId: String(id),
        userId: Number.isFinite(userId) ? userId : null,
        payload: JSON.stringify({
          requestId: currentItem.requestId,
          before: {
            deliveredQty: currentItem.deliveredQty,
            status: currentItem.status,
          },
          after: {
            deliveredQty,
            status: newStatus,
          },
        }),
      });

      // Recalcula status da requisição
      const items = await tx
        .select({ status: schema.requestItems.status })
        .from(schema.requestItems)
        .where(eq(schema.requestItems.requestId, currentItem.requestId));

      const allCancelled = items.every((i) => i.status === "cancelled");
      const allFinal = items.every((i) => i.status === "delivered" || i.status === "cancelled");

      // computed com tipo explícito
      const computed: RequestStatus = allCancelled
        ? "cancelled"
        : allFinal
        ? "completed"
        : "in_progress";

      // narrow no status atual para o union correto
      const curStatus = currentReq.status as RequestStatus;

      if (curStatus !== computed && curStatus !== "cancelled") {
        await tx
          .update(schema.requests)
          .set({ status: computed, updatedAt: new Date() })
          .where(eq(schema.requests.id, currentItem.requestId));

        await tx.insert(schema.auditLogs).values({
          tableName: "requests",
          action: "STATUS_CHANGE",
          recordId: String(currentItem.requestId),
          userId: Number.isFinite(userId) ? userId : null,
          payload: JSON.stringify({ from: curStatus, to: computed, reason: "item_update" }),
        });
      }

      // Retorna o item atualizado
      const [after] = await tx
        .select()
        .from(schema.requestItems)
        .where(eq(schema.requestItems.id, id))
        .limit(1);

      return after;
    });
  } catch (e: any) {
    // Se for um erro "nosso", responde com o status certo
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Loga outros erros e retorna 500 com JSON
    console.error("PATCH /api/requisicoes/itens error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  return NextResponse.json({ data: updated });
  // --- FIM DO BLOCO ADICIONADO ---
}

// Utilitário de erro HTTP
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}