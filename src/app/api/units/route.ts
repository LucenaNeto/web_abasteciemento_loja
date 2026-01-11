// src/app/api/units/route.ts
import { z } from "zod";
import { NextResponse } from "next/server";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, asc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/units?active=all|true|false
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const active = (searchParams.get("active") ?? "true").trim(); // default: true

  const sessionUser = guard.session.user as any;
  const role = String(sessionUser?.role ?? "");
  const meId = Number(sessionUser?.id);

  const activeWhere =
    active === "true"
      ? eq(schema.units.isActive, true)
      : active === "false"
      ? eq(schema.units.isActive, false)
      : undefined;

  // store/warehouse: só as unidades vinculadas ao usuário (e só ativas)
  if (role !== "admin") {
    if (!Number.isFinite(meId)) {
      return NextResponse.json({ error: "Sessão inválida (sem id)." }, { status: 401 });
    }

    const rows = await db
      .select({
        id: schema.units.id,
        code: schema.units.code,
        name: schema.units.name,
        isActive: schema.units.isActive,
        isPrimary: schema.userUnits.isPrimary,
      })
      .from(schema.userUnits)
      .innerJoin(schema.units, eq(schema.units.id, schema.userUnits.unitId))
      .where(
        and(
          eq(schema.userUnits.userId, meId),
          eq(schema.units.isActive, true), // força ativo p/ não-admin
        ) as any,
      )
      .orderBy(asc(schema.units.code));

    return NextResponse.json({ data: rows });
  }

  // admin: lista geral e respeita active=all|true|false
  const rows = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      name: schema.units.name,
      isActive: schema.units.isActive,
    })
    .from(schema.units)
    .where(activeWhere as any)
    .orderBy(asc(schema.units.code));

  return NextResponse.json({ data: rows });
}

// ---------- POST /api/units ----------
// Body: { code: "24603", name: "VD GARANHUNS", isActive?: true }
const createUnitSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Código deve ter 5 dígitos. Ex: 24603"),
  name: z.string().trim().min(2, "Nome obrigatório").max(255),
  isActive: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  let payload: z.infer<typeof createUnitSchema>;
  try {
    payload = createUnitSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const adminId = Number((guard.session.user as any)?.id) || null;

  try {
    const created = await withTransaction(async (tx) => {
      // evita duplicidade (mensagem amigável)
      const [exists] = await tx
        .select({ id: schema.units.id })
        .from(schema.units)
        .where(eq(schema.units.code, payload.code))
        .limit(1);

      if (exists) {
        return { conflict: true as const };
      }

      const ins = await tx
        .insert(schema.units)
        .values({
          code: payload.code,
          name: payload.name,
          isActive: payload.isActive ?? true,
          updatedAt: new Date(),
        })
        .returning({
          id: schema.units.id,
          code: schema.units.code,
          name: schema.units.name,
          isActive: schema.units.isActive,
        });

      const unit = ins[0];

      // auditoria
      await tx.insert(schema.auditLogs).values({
        tableName: "units",
        action: "CREATE",
        recordId: String(unit.id),
        userId: Number.isFinite(adminId as number) ? (adminId as number) : null,
        payload: JSON.stringify({ after: unit }),
      });

      return { conflict: false as const, unit };
    });

    if (created.conflict) {
      return NextResponse.json({ error: "Já existe uma unidade com esse código." }, { status: 409 });
    }

    return NextResponse.json({ data: created.unit }, { status: 201 });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json({ error: "Falha ao criar unidade.", details: msg }, { status: 500 });
  }
}

