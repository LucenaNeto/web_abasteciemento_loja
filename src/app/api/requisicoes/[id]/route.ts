import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";
import type { RequestStatus } from "@/server/db/schema";
import {
  ApiError,
  applyDeliveries,
  lockRequest,
  requestStatusFromItems,
  statusTimestamps,
  userHasUnit,
  type StockWarning,
} from "@/server/requests/delivery";

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

  // ✅ Validação de acesso à unidade (GET)
  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const meId = Number(sessionUser?.id);

  if (role !== "admin") {
    if (!Number.isFinite(meId)) {
      return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
    }
    if (!reqRow.unitId) {
      return NextResponse.json({ error: "Requisição sem unidade." }, { status: 400 });
    }
    const allowed = await userHasUnit(db, meId, reqRow.unitId);
    if (!allowed) {
      return NextResponse.json({ error: "Sem acesso a esta unidade." }, { status: 403 });
    }
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

  let cancelledBy: { id: number; name: string } | null = null;
  if (reqRow.cancelledByUserId) {
    const [c] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, reqRow.cancelledByUserId))
      .limit(1);
    cancelledBy = c ?? null;
  }

  return NextResponse.json({
    data: {
      ...reqRow,
      createdBy,
      assignedTo,
      cancelledBy,
      items,
    },
  });
}

// ---------- PATCH /api/requisicoes/:id ----------
// Body permite: status opcional, assignToMe, items (para definir entregas) e note.
// Estoque insuficiente devolve 409 (code INSUFFICIENT_STOCK); reenviar com
// confirmInsufficientStock: true para entregar mesmo assim.
const patchSchema = z.object({
  status: z.enum(["in_progress", "completed", "cancelled"]).optional(),
  assignToMe: z.boolean().optional().default(false),
  note: z.string().optional(),
  cancelReason: z.string().trim().max(300).optional(),
  confirmInsufficientStock: z.boolean().optional().default(false),
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
  // admin/warehouse atendem e movimentam estoque; store só pode CANCELAR a própria requisição pendente
  const guard = await ensureRoleApi(["admin", "warehouse", "store"]);
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

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const userId = Number(sessionUser?.id) || null;

  if (role === "store") {
    const onlyCancel =
      payload.status === "cancelled" &&
      !(payload.items?.length) &&
      !payload.assignToMe &&
      payload.note === undefined;
    if (!onlyCancel) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await withTransaction(async (tx) => {
      // 1) Trava a requisição: dois atendimentos simultâneos não se atropelam
      const reqRow = await lockRequest(tx, requestId);
      if (!reqRow) throw new ApiError(404, "Requisição não encontrada");
      if (reqRow.status === "cancelled")
        throw new ApiError(400, "Requisição cancelada não pode ser alterada");

      // Loja só cancela a PRÓPRIA requisição e enquanto ninguém começou a atender
      if (role === "store") {
        if (reqRow.createdByUserId !== userId)
          throw new ApiError(403, "Só quem criou a requisição pode cancelá-la.");
        if (reqRow.status !== "pending")
          throw new ApiError(
            400,
            "Só é possível cancelar requisições pendentes. Fale com o almoxarifado.",
            "NOT_PENDING",
          );
      }

      // Concluída é final: só um admin pode reabrir (status in_progress). Repetir
      // "concluir" é inofensivo (idempotente) e não mexe em nada.
      if (reqRow.status === "completed") {
        const hasItems = (payload.items?.length ?? 0) > 0;
        if (payload.status === "completed" && !hasItems) {
          return { after: reqRow, warnings: [] as StockWarning[] };
        }
        const isAdminReopen = role === "admin" && payload.status === "in_progress" && !hasItems;
        if (!isAdminReopen) {
          throw new ApiError(
            400,
            "Requisição concluída não pode ser alterada. Um administrador pode reabri-la.",
            "REQUEST_COMPLETED",
          );
        }
      }

      // 2) Acesso à unidade
      if (role !== "admin") {
        if (!reqRow.unitId) throw new ApiError(400, "Requisição sem unidade.");
        if (!userId) throw new ApiError(401, "Sessão inválida.");
        if (!(await userHasUnit(tx, userId, reqRow.unitId)))
          throw new ApiError(403, "Sem acesso a esta unidade.");
      }

      // 3) Alvos de entrega (por id do item ou por productId)
      const itemRows = await tx
        .select({ id: schema.requestItems.id, productId: schema.requestItems.productId })
        .from(schema.requestItems)
        .where(eq(schema.requestItems.requestId, requestId));

      const targets = new Map<number, number>();
      for (const it of payload.items ?? []) {
        const itemId = it.id ?? itemRows.find((r) => r.productId === it.productId)?.id;
        if (itemId != null) targets.set(itemId, it.deliveredQty);
      }

      // 4) Entrega + movimentos + estoque (regra única)
      const wantCompleted = payload.status === "completed";
      const { plan, warnings } = await applyDeliveries(tx, {
        requestId,
        targets,
        completeRest: wantCompleted,
        userId,
        allowInsufficientStock: payload.confirmInsufficientStock,
      });

      if (wantCompleted) {
        const open = plan.filter((p) => p.status !== "cancelled" && p.deliveredFinal < p.requested);
        if (open.length > 0)
          throw new ApiError(400, "Há itens com entrega parcial. Ajuste as quantidades para concluir.");
      }

      // Cancelar com itens já entregues deixaria o estoque inconsistente:
      // primeiro estorne as entregas (quantidade volta a 0).
      if (payload.status === "cancelled") {
        const delivered = plan.filter((p) => p.status !== "cancelled" && p.deliveredFinal > 0);
        if (delivered.length > 0)
          throw new ApiError(
            400,
            "Há itens já entregues. Zere as quantidades entregues (estorno) antes de cancelar.",
            "HAS_DELIVERED_ITEMS",
          );
      }

      // 5) Status final da requisição
      const nextStatus: RequestStatus =
        payload.status ??
        requestStatusFromItems(
          plan.map((p) => p.status),
          reqRow.status as RequestStatus,
        );

      const patchReq: Partial<typeof schema.requests.$inferInsert> = {
        status: nextStatus,
        updatedAt: new Date(),
      };
      Object.assign(
        patchReq,
        statusTimestamps(
          { status: reqRow.status as RequestStatus, startedAt: reqRow.startedAt },
          nextStatus,
        ),
      );
      if (nextStatus === "cancelled") {
        patchReq.cancelledAt = new Date();
        patchReq.cancelledByUserId = userId;
        patchReq.cancelReason = payload.cancelReason || null;
      }
      if (payload.assignToMe && userId) patchReq.assignedToUserId = userId;
      if (payload.note !== undefined) patchReq.note = payload.note;

      await tx.update(schema.requests).set(patchReq).where(eq(schema.requests.id, requestId));

      // 6) Auditoria
      await tx.insert(schema.auditLogs).values({
        tableName: "requests",
        action: "STATUS_CHANGE",
        recordId: String(requestId),
        userId,
        payload: JSON.stringify({
          from: reqRow.status,
          to: nextStatus,
          note: payload.note ?? undefined,
          cancelReason: nextStatus === "cancelled" ? payload.cancelReason || undefined : undefined,
          stockWarningsConfirmed: warnings.length ? warnings : undefined,
          items: plan.map((p) => ({
            itemId: p.itemId,
            deliveredFinal: p.deliveredFinal,
            delta: p.delta,
          })),
        }),
      });

      const [after] = await tx
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.id, requestId))
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
    console.error("PATCH /api/requisicoes/:id error:", e);
    return NextResponse.json({ error: "Erro interno ao atualizar a requisição." }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
