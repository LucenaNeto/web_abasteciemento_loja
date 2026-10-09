// src/app/api/notificacoes/route.ts
// Avisos do usuário logado (sino). Cada usuário só enxerga e marca os PRÓPRIOS avisos.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notificacoes
 * Retorna os 30 avisos mais recentes + total de não lidos (e o id do mais novo,
 * usado no cliente para detectar avisos novos e tocar o alerta sonoro).
 */
export async function GET() {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const userId = Number((guard.session.user as any)?.id);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
  }

  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: schema.notifications.id,
        type: schema.notifications.type,
        requestId: schema.notifications.requestId,
        requestItemId: schema.notifications.requestItemId,
        message: schema.notifications.message,
        createdAt: schema.notifications.createdAt,
        readAt: schema.notifications.readAt,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.id))
      .limit(30),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt))),
  ]);

  return NextResponse.json({
    data: rows,
    unreadCount: unread?.n ?? 0,
    latestId: rows[0]?.id ?? 0,
  });
}

const readSchema = z.object({
  ids: z.array(z.number().int().positive()).max(100).optional(),
  all: z.boolean().optional(),
});

/** PATCH /api/notificacoes  { ids: [1,2] }  ou  { all: true }  -> marca como lidos */
export async function PATCH(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const userId = Number((guard.session.user as any)?.id);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
  }

  let payload: z.infer<typeof readSchema>;
  try {
    payload = readSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json({ error: "Dados inválidos", details: err?.issues ?? String(err) }, { status: 400 });
  }
  if (!payload.all && !(payload.ids?.length)) {
    return NextResponse.json({ error: "Informe ids ou all." }, { status: 400 });
  }

  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
        payload.all ? undefined : inArray(schema.notifications.id, payload.ids ?? []),
      ),
    );

  return NextResponse.json({ ok: true });
}
