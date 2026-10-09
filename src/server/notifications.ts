// src/server/notifications.ts
// Avisos dentro do sistema (sino). Sempre criados na MESMA transação da ação que os origina.

import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import type { Tx } from "@/server/requests/delivery";
import type { NotificationType } from "@/server/db/schema";

type NewNotification = {
  userId: number;
  type: NotificationType;
  requestId?: number | null;
  requestItemId?: number | null;
  message: string;
};

export async function notify(tx: Tx, items: NewNotification[]) {
  if (items.length === 0) return;
  await tx.insert(schema.notifications).values(
    items.map((n) => ({
      userId: n.userId,
      type: n.type,
      requestId: n.requestId ?? null,
      requestItemId: n.requestItemId ?? null,
      message: n.message,
    })),
  );
}

/** Almoxarifes ATIVOS vinculados à unidade (quem precisa saber de uma nova requisição). */
export async function warehouseUserIdsOfUnit(tx: Tx, unitId: number) {
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.userUnits)
    .innerJoin(schema.users, eq(schema.users.id, schema.userUnits.userId))
    .where(
      and(
        eq(schema.userUnits.unitId, unitId),
        eq(schema.users.role, "warehouse"),
        eq(schema.users.isActive, true),
      ),
    );
  return rows.map((r) => r.id);
}

