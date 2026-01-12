// src/app/api/usuarios/[id]/units/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseUserIdFromParam(id: string) {
  const raw = decodeURIComponent(String(id ?? "")).trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * GET /api/usuarios/:id/units
 * Retorna as unidades associadas ao usuário + qual é primária
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const userId = parseUserIdFromParam(id);

  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "userId inválido." }, { status: 400 });
  }

  // garante usuário existe
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!u) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  // lista unidades vinculadas
  const rows = await db
    .select({
      unitId: schema.userUnits.unitId,
      isPrimary: schema.userUnits.isPrimary,
      code: schema.units.code,
      name: schema.units.name,
      isActive: schema.units.isActive,
    })
    .from(schema.userUnits)
    .innerJoin(schema.units, eq(schema.units.id, schema.userUnits.unitId))
    .where(eq(schema.userUnits.userId, userId));

  return NextResponse.json({
    data: {
      userId,
      units: rows,
      primaryUnitId: rows.find((r) => r.isPrimary)?.unitId ?? null,
    },
  });
}

/**
 * PUT/PATCH /api/usuarios/:id/units
 * Body aceito (qualquer um destes):
 *  - { unitIds: number[], primaryUnitId: number|null }
 *  - { units: number[], primaryUnitId: number|null }
 *  - { allowedUnitIds: number[], primaryUnitId: number|null }
 */
const bodySchema = z.object({
  unitIds: z.array(z.number().int().positive()).optional(),
  units: z.array(z.number().int().positive()).optional(),
  allowedUnitIds: z.array(z.number().int().positive()).optional(),
  primaryUnitId: z.number().int().positive().nullable().optional(),
});

async function saveUnits(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const userId = parseUserIdFromParam(id);

  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: "userId inválido." }, { status: 400 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Body inválido", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const unitIds = payload.unitIds ?? payload.units ?? payload.allowedUnitIds ?? [];

  // remove duplicados
  const unique = Array.from(new Set(unitIds));

  // valida primary
  let primaryUnitId = payload.primaryUnitId ?? null;
  if (primaryUnitId && !unique.includes(primaryUnitId)) {
    return NextResponse.json(
      { error: "Unidade primária deve estar entre as unidades selecionadas." },
      { status: 400 },
    );
  }

  // se tem unidades e não veio primária, define a primeira como primária
  if (unique.length > 0 && !primaryUnitId) primaryUnitId = unique[0];

  // garante usuário existe
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!u) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  // valida unidades existem
  if (unique.length > 0) {
    const found = await db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(inArray(schema.units.id, unique));

    if (found.length !== unique.length) {
      return NextResponse.json({ error: "Alguma unidade informada não existe." }, { status: 400 });
    }
  }

  await withTransaction(async (tx) => {
    // apaga todas as relações atuais
    await tx.delete(schema.userUnits).where(eq(schema.userUnits.userId, userId));

    // recria relações
    if (unique.length > 0) {
      await tx.insert(schema.userUnits).values(
        unique.map((unitId) => ({
          userId,
          unitId,
          isPrimary: primaryUnitId === unitId,
        })),
      );
    }
  });

  return NextResponse.json({
    data: { userId, unitIds: unique, primaryUnitId },
  });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return saveUnits(req, ctx);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return saveUnits(req, ctx);
}
