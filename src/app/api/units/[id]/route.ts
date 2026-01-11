// src/app/api/units/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam ?? "";
  const id = Number.parseInt(String(raw).trim(), 10);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: e?.issues ?? String(e) },
      { status: 400 },
    );
  }

  // nada pra atualizar?
  if (!payload.code && !payload.name && payload.isActive === undefined) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const [exists] = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(eq(schema.units.id, id))
    .limit(1);

  if (!exists) {
    return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
  }

  try {
    await db
      .update(schema.units)
      .set({
        ...(payload.code ? { code: payload.code.trim() } : {}),
        ...(payload.name ? { name: payload.name.trim() } : {}),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        updatedAt: new Date(),
      } as any)
      .where(eq(schema.units.id, id));

    const [after] = await db
      .select({
        id: schema.units.id,
        code: schema.units.code,
        name: schema.units.name,
        isActive: schema.units.isActive,
      })
      .from(schema.units)
      .where(eq(schema.units.id, id))
      .limit(1);

    return NextResponse.json({ data: after });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const isUnique =
      msg.includes("UNIQUE") || msg.toLowerCase().includes("unique") || msg.includes("units_code_uq");

    return NextResponse.json(
      { error: isUnique ? "Já existe unidade com este código." : "Falha ao atualizar unidade." },
      { status: isUnique ? 409 : 500 },
    );
  }
}
