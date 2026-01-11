import { NextResponse } from "next/server";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const userId = Number(sessionUser?.id);

  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
  }

  // Admin: pode enxergar todas as unidades
  if (role === "admin") {
    const rows = await db
      .select({
        id: schema.units.id,
        code: schema.units.code,
        name: schema.units.name,
        isActive: schema.units.isActive,
      })
      .from(schema.units)
      .orderBy(schema.units.name);

    return NextResponse.json({ data: rows });
  }

  // Store/Warehouse: só as unidades vinculadas
  const rows = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      name: schema.units.name,
      isActive: schema.units.isActive,
      isPrimary: schema.userUnits.isPrimary,
    })
    .from(schema.userUnits)
    .innerJoin(schema.units, eq(schema.userUnits.unitId, schema.units.id))
    .where(and(eq(schema.userUnits.userId, userId), eq(schema.units.isActive, true)))
    .orderBy(desc(schema.userUnits.isPrimary), schema.units.name);

  const primaryUnitId = rows.find((r) => r.isPrimary)?.id ?? null;

  return NextResponse.json({ data: rows, primaryUnitId });
}
