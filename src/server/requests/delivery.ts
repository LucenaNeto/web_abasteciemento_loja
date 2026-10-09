// src/server/requests/delivery.ts
//
// Regra única de entrega/baixa de estoque, usada por TODAS as rotas que alteram
// quantidades entregues (PATCH /api/requisicoes/:id e /api/requisicoes/itens/:itemId).
//
// - Deve rodar dentro de uma transação, com a linha da requisição já travada (lockRequest).
// - Cada mudança de quantidade gera UM movimento (out = saída, in = estorno).
// - O estoque é alterado de forma atômica (stock = stock - delta), nunca por valor lido.
// - Estoque insuficiente é AVISO: exige confirmação explícita, não bloqueia de vez.

import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/server/db";
import { schema } from "@/server/db";
import type { ItemStatus, RequestStatus } from "@/server/db/schema";

export type Tx = typeof db;

export class ApiError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type StockWarning = {
  productId: number;
  sku: string;
  name: string;
  available: number;
  requested: number;
};

export type PlanRow = {
  itemId: number;
  productId: number;
  requested: number;
  deliveredPrev: number;
  deliveredFinal: number;
  delta: number; // >0 saída, <0 estorno
  status: ItemStatus;
};

/** Trava a requisição (serializa atendimentos concorrentes da mesma requisição). */
export async function lockRequest(tx: Tx, requestId: number) {
  const [row] = await tx
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .for("update")
    .limit(1);
  return row ?? null;
}

export function itemStatusFor(delivered: number, requested: number): ItemStatus {
  if (delivered <= 0) return "pending";
  if (delivered < requested) return "partial";
  return "delivered";
}

/**
 * Status da requisição a partir dos status dos itens.
 * Requisição cancelada nunca é reaberta aqui.
 */
export function requestStatusFromItems(statuses: ItemStatus[], current: RequestStatus): RequestStatus {
  if (current === "cancelled") return "cancelled";
  if (statuses.length > 0 && statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.every((s) => s === "delivered" || s === "cancelled")) return "completed";
  if (statuses.some((s) => s === "delivered" || s === "partial") || current === "in_progress") {
    return "in_progress";
  }
  return current;
}

/**
 * Marcos de tempo da requisição ao mudar de status (base do dashboard).
 * - started_at: 1ª vez em "em progresso" (nunca é apagado)
 * - completed_at: ao concluir; limpo se um admin reabrir
 * (cancelamento é tratado na rota, pois guarda quem cancelou e o motivo)
 */
export function statusTimestamps(
  prev: { status: RequestStatus; startedAt: Date | null },
  next: RequestStatus,
  now: Date = new Date(),
) {
  const patch: { startedAt?: Date; completedAt?: Date | null } = {};
  if (next === "in_progress" && !prev.startedAt) patch.startedAt = now;
  if (next === "completed" && prev.status !== "completed") patch.completedAt = now;
  if (next !== "completed" && prev.status === "completed") patch.completedAt = null;
  return patch;
}

type ApplyArgs = {
  requestId: number;
  /** itemId -> quantidade entregue ABSOLUTA desejada */
  targets: Map<number, number>;
  /** itens sem alvo explícito: true = completar o que falta; false = manter */
  completeRest: boolean;
  userId: number | null;
  allowInsufficientStock: boolean;
};

export async function applyDeliveries(tx: Tx, args: ApplyArgs) {
  const { requestId, targets, completeRest, userId, allowInsufficientStock } = args;

  const rows = await tx
    .select({
      itemId: schema.requestItems.id,
      productId: schema.requestItems.productId,
      requested: schema.requestItems.requestedQty,
      deliveredPrev: schema.requestItems.deliveredQty,
      statusPrev: schema.requestItems.status,
      sku: schema.products.sku,
      name: schema.products.name,
      stock: schema.products.stock,
    })
    .from(schema.requestItems)
    .innerJoin(schema.products, eq(schema.requestItems.productId, schema.products.id))
    .where(eq(schema.requestItems.requestId, requestId));

  if (rows.length === 0) throw new ApiError(400, "Requisição sem itens");

  for (const itemId of targets.keys()) {
    if (!rows.some((r) => r.itemId === itemId)) {
      throw new ApiError(400, `Item ${itemId} não pertence a esta requisição.`);
    }
  }

  // 1) plano: itens cancelados não mudam
  const plan: PlanRow[] = rows.map((r) => {
    if (r.statusPrev === "cancelled") {
      return {
        itemId: r.itemId,
        productId: r.productId,
        requested: r.requested,
        deliveredPrev: r.deliveredPrev,
        deliveredFinal: r.deliveredPrev,
        delta: 0,
        status: "cancelled",
      };
    }
    const wanted = targets.get(r.itemId);
    const raw = wanted != null ? wanted : completeRest ? r.requested : r.deliveredPrev;
    const deliveredFinal = Math.max(0, Math.min(r.requested, raw));
    return {
      itemId: r.itemId,
      productId: r.productId,
      requested: r.requested,
      deliveredPrev: r.deliveredPrev,
      deliveredFinal,
      delta: deliveredFinal - r.deliveredPrev,
      status: itemStatusFor(deliveredFinal, r.requested),
    };
  });

  // 2) aviso de estoque (somado por produto; só saídas)
  const outByProduct = new Map<number, number>();
  for (const p of plan) {
    if (p.delta > 0) outByProduct.set(p.productId, (outByProduct.get(p.productId) ?? 0) + p.delta);
  }
  const warnings: StockWarning[] = [];
  for (const [productId, out] of outByProduct) {
    const info = rows.find((r) => r.productId === productId)!;
    if (info.stock < out) {
      warnings.push({ productId, sku: info.sku, name: info.name, available: info.stock, requested: out });
    }
  }
  if (warnings.length > 0 && !allowInsufficientStock) {
    throw new ApiError(
      409,
      "Estoque no sistema é menor que a quantidade a entregar. Confirme para entregar mesmo assim.",
      "INSUFFICIENT_STOCK",
      { warnings },
    );
  }

  // 3) aplica itens + movimentos
  for (const p of plan) {
    const changed = p.delta !== 0 || p.status !== rows.find((r) => r.itemId === p.itemId)!.statusPrev;
    if (!changed) continue;

    await tx
      .update(schema.requestItems)
      .set({ deliveredQty: p.deliveredFinal, status: p.status, updatedAt: new Date() })
      .where(eq(schema.requestItems.id, p.itemId));

    if (p.delta !== 0) {
      await tx.insert(schema.inventoryMovements).values({
        productId: p.productId,
        qty: Math.abs(p.delta),
        type: p.delta > 0 ? "out" : "in",
        refType: "request",
        refId: requestId,
        requestItemId: p.itemId,
        note:
          p.delta > 0
            ? `Saída por requisição #${requestId} (item ${p.itemId})`
            : `Estorno de entrega na requisição #${requestId} (item ${p.itemId})`,
        createdByUserId: userId,
      });
    }
  }

  // 4) estoque: atômico, em ordem de id (evita deadlock entre requisições concorrentes)
  const netByProduct = new Map<number, number>();
  for (const p of plan) {
    if (p.delta !== 0) netByProduct.set(p.productId, (netByProduct.get(p.productId) ?? 0) + p.delta);
  }
  for (const [productId, net] of [...netByProduct].sort((a, b) => a[0] - b[0])) {
    if (net === 0) continue;
    await tx
      .update(schema.products)
      .set({ stock: sql`${schema.products.stock} - ${net}`, updatedAt: new Date() })
      .where(eq(schema.products.id, productId));
  }

  return { plan, warnings };
}

/** Confere se o usuário (não-admin) tem vínculo com a unidade. */
export async function userHasUnit(tx: Tx, userId: number, unitId: number) {
  const [row] = await tx
    .select({ ok: sql<number>`1` })
    .from(schema.userUnits)
    .where(and(eq(schema.userUnits.userId, userId), eq(schema.userUnits.unitId, unitId)))
    .limit(1);
  return !!row;
}

export async function itemStatuses(tx: Tx, requestId: number) {
  const rows = await tx
    .select({ status: schema.requestItems.status })
    .from(schema.requestItems)
    .where(eq(schema.requestItems.requestId, requestId));
  return rows.map((r) => r.status as ItemStatus);
}

