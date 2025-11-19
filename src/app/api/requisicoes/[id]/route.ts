// src/app/api/requisicoes/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq, inArray, sql } from "drizzle-orm";
import type { RequestStatus } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- GET /api/requisicoes/:id ----------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam ?? "";
  const idStr = decodeURIComponent(String(raw)).trim();
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const [reqRow] = await db.select().from(schema.requests).where(eq(schema.requests.id, id)).limit(1);
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
// Body permite: status opcional, assignToMe, items (para definir entregas) e note
const patchSchema = z.object({
  status: z.enum(["in_progress", "completed", "cancelled"]).optional(),
  assignToMe: z.boolean().optional().default(false),
  note: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.number().int().positive().optional(), // id do request_item
        productId: z.number().int().positive().optional(), // alternativa
        deliveredQty: z.number().int().min(0).default(0),
      }),
    )
    .optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string | string[] }> },
) {
  // Permissão: somente admin/warehouse movimentam estoque
  const guard = await ensureRoleApi(["admin", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam ?? "";
  const idStr = decodeURIComponent(String(raw)).trim();
  const requestId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(requestId)) {
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

  const userId = Number((guard.session.user as any).id) || null;

  try {
    const updated = await withTransaction(async (tx) => {
      // 1) Carrega a requisição
      const [reqRow] = await tx.select().from(schema.requests).where(eq(schema.requests.id, requestId)).limit(1);
      if (!reqRow) throw new ApiError(404, "Requisição não encontrada");
      if (reqRow.status === "cancelled")
        throw new ApiError(400, "Requisição cancelada não pode ser alterada");

      // 2) Carrega itens + produto (para estoque)
      const itemsRows = await tx
        .select({
          itemId: schema.requestItems.id,
          productId: schema.requestItems.productId,
          requestedQty: schema.requestItems.requestedQty,
          deliveredQtyPrev: schema.requestItems.deliveredQty,
          itemStatusPrev: schema.requestItems.status,
          sku: schema.products.sku,
          name: schema.products.name,
          unit: schema.products.unit,
          stock: schema.products.stock,
        })
        .from(schema.requestItems)
        .innerJoin(schema.products, eq(schema.requestItems.productId, schema.products.id))
        .where(eq(schema.requestItems.requestId, requestId));

      if (itemsRows.length === 0) throw new ApiError(400, "Requisição sem itens");

      // 3) Normaliza itens do body em mapa <requestItemId, deliveredFinal>
      const incoming = new Map<number, number>();
      if (Array.isArray(payload.items)) {
        for (const it of payload.items) {
          if (it?.id != null) {
            const q = Math.max(0, Number(it.deliveredQty ?? 0) | 0);
            incoming.set(it.id, q);
          }
        }
        // Se veio por productId, converte agora
        for (const it of payload.items) {
          if (it?.productId && it?.id == null) {
            const row = itemsRows.find((r) => r.productId === it.productId);
            if (row) incoming.set(row.itemId, Math.max(0, Number(it.deliveredQty ?? 0) | 0));
          }
        }
      }

      // 4) Planeja: delivered final, delta de saída e validações
      const wantCompleted = payload.status === "completed";
      const plan = itemsRows.map((r) => {
        const provided = incoming.get(r.itemId);
        const deliveredTarget =
          provided != null
            ? Math.min(r.requestedQty, provided)
            : wantCompleted
            ? r.requestedQty
            : r.deliveredQtyPrev;

        const moveDelta = Math.max(0, deliveredTarget - r.deliveredQtyPrev); // só o que falta sair
        return {
          itemId: r.itemId,
          productId: r.productId,
          requested: r.requestedQty,
          deliveredPrev: r.deliveredQtyPrev,
          deliveredFinal: deliveredTarget,
          moveDelta,
        };
      });

      if (wantCompleted) {
        const allFull = plan.every((p) => p.deliveredFinal >= p.requested);
        if (!allFull)
          throw new ApiError(400, "Há itens com entrega parcial. Ajuste as quantidades para concluir.");
      }

      // 5) Valida estoque suficiente (somado por produto)
      const sumByProd = new Map<number, number>();
      for (const p of plan) sumByProd.set(p.productId, (sumByProd.get(p.productId) ?? 0) + p.moveDelta);

      if (sumByProd.size > 0) {
        const prodIds = Array.from(sumByProd.keys());
        const prods = await tx
          .select({
            id: schema.products.id,
            stock: schema.products.stock,
            sku: schema.products.sku,
            name: schema.products.name,
          })
          .from(schema.products)
          .where(inArray(schema.products.id, prodIds));

        const stocks = new Map(prods.map((p) => [p.id, p.stock]));
        for (const [pid, outQty] of sumByProd.entries()) {
          if (outQty <= 0) continue;
          const available = stocks.get(pid) ?? 0;
          if (available < outQty) {
            const p = prods.find((x) => x.id === pid);
            throw new ApiError(
              400,
              `Estoque insuficiente para ${p?.sku ?? pid}: pedido saída ${outQty}, disponível ${available}.`,
            );
          }
        }
      }

      // 6) Aplica: atualiza itens, cria movimentos (idempotente) e abate estoque
      for (const p of plan) {
        // status do item
        const newItemStatus =
          p.deliveredFinal <= 0 ? "pending" : p.deliveredFinal < p.requested ? "partial" : "delivered";

        await tx
          .update(schema.requestItems)
          .set({
            deliveredQty: p.deliveredFinal,
            status: newItemStatus as any,
            updatedAt: new Date(),
          })
          .where(eq(schema.requestItems.id, p.itemId));

        // movimento + estoque
        if (p.moveDelta > 0) {
          try {
            await tx.insert(schema.inventoryMovements).values({
              productId: p.productId,
              qty: p.moveDelta,
              type: "out",
              refType: "request",
              refId: requestId,
              requestItemId: p.itemId,
              note: `Saída por requisição #${requestId} (item ${p.itemId})`,
              createdByUserId: userId,
            });
          } catch {
            // unique (refType, requestItemId) — se já existir, ignora
          }

          await tx
            .update(schema.products)
            .set({
              stock: sql`${schema.products.stock} - ${p.moveDelta}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.products.id, p.productId));
        }
      }

      // 7) Define status final da requisição
      let nextStatus =
        (payload.status as RequestStatus | undefined) ?? (reqRow.status as RequestStatus);
      if (payload.status === "completed") {
        nextStatus = "completed";
      } else if (payload.status === "in_progress") {
        nextStatus = "in_progress";
      } else if (!payload.status) {
        const allDelivered = plan.every((p) => p.deliveredFinal >= p.requested);
        const anyDelivered = plan.some((p) => p.deliveredFinal > 0);
        nextStatus = allDelivered ? "completed" : anyDelivered ? "in_progress" : "pending";
      }

      // 8) Atualiza requisição (status/nota/assignee)
      const patchReq: Partial<typeof schema.requests.$inferInsert> = {
        status: nextStatus,
        updatedAt: new Date(),
      };
      if (payload.assignToMe && userId) patchReq.assignedToUserId = userId;
      if (payload.note !== undefined) patchReq.note = payload.note;

      await tx.update(schema.requests).set(patchReq).where(eq(schema.requests.id, requestId));

      // 9) Auditoria simples
      await tx.insert(schema.auditLogs).values({
        tableName: "requests",
        action: "STATUS_CHANGE",
        recordId: String(requestId),
        userId,
        payload: JSON.stringify({
          to: nextStatus,
          note: payload.note ?? undefined,
          items: plan.map((p) => ({
            itemId: p.itemId,
            deliveredFinal: p.deliveredFinal,
            moveDelta: p.moveDelta,
          })),
        }),
      });

      // 10) Retorna a requisição atualizada
      const [after] = await tx
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.id, requestId))
        .limit(1);

      return after;
    });

    return NextResponse.json({ data: updated });
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : 500;
    const msg = e instanceof ApiError ? e.message : String(e?.message ?? e);
    return NextResponse.json({ error: msg }, { status });
  }
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
