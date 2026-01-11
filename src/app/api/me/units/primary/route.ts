import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  unitId: z.number().int().positive(),
});

async function resolveUserIdFromSession(sessionUser: any) {
  const sessionId = sessionUser?.id;
  const sessionEmail = sessionUser?.email as string | undefined;

  if (sessionId != null) {
    const n = Number(sessionId);
    if (Number.isFinite(n)) return n;
  }

  if (sessionEmail) {
    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, sessionEmail))
      .limit(1);

    if (u) {
      const n = Number(u.id);
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

/**
 * PATCH /api/me/units/primary
 * Body: { unitId }
 */
export async function PATCH(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const sessionUser = guard.session.user as any;
  const userId = await resolveUserIdFromSession(sessionUser);
  if (!userId) return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });

  // valida se unidade existe e está ativa
  const [u] = await db
    .select({ id: schema.units.id, isActive: schema.units.isActive })
    .from(schema.units)
    .where(eq(schema.units.id, payload.unitId))
    .limit(1);

  if (!u) return NextResponse.json({ error: "Unidade não existe." }, { status: 400 });
  if (!u.isActive) return NextResponse.json({ error: "Unidade está inativa." }, { status: 400 });

  // valida se usuário tem vínculo com a unidade
  const [link] = await db
    .select({ userId: schema.userUnits.userId })
    .from(schema.userUnits)
    .where(and(eq(schema.userUnits.userId, userId), eq(schema.userUnits.unitId, payload.unitId)))
    .limit(1);

  if (!link) {
    return NextResponse.json({ error: "Sem acesso a esta unidade." }, { status: 403 });
  }

  await withTransaction(async (tx) => {
    // zera primária atual
    await tx.update(schema.userUnits).set({ isPrimary: false }).where(eq(schema.userUnits.userId, userId));

    // seta a nova primária
    await tx
      .update(schema.userUnits)
      .set({ isPrimary: true })
      .where(and(eq(schema.userUnits.userId, userId), eq(schema.userUnits.unitId, payload.unitId)));
  });

  return NextResponse.json({ ok: true, primaryUnitId: payload.unitId });
}
