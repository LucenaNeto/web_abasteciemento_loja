// src/app/api/units/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^d{5}$/, "Código deve ter 5 dígitos. Ex: 24603")
    .optional(),
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

  const adminId = Number((guard.session.user as any)?.id);

  try {
    const after = await withTransaction(async (tx) => {
      const [before] = await tx
        .select({
          id: schema.units.id,
          code: schema.units.code,
          name: schema.units.name,
          isActive: schema.units.isActive,
        })
        .from(schema.units)
        .where(eq(schema.units.id, id))
        .for("update")
        .limit(1);

      if (!before) return null;

      await tx
        .update(schema.units)
        .set({
          ...(payload.code ? { code: payload.code } : {}),
          ...(payload.name ? { name: payload.name.trim() } : {}),
          ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.units.id, id));

      const [row] = await tx
        .select({
          id: schema.units.id,
          code: schema.units.code,
          name: schema.units.name,
          isActive: schema.units.isActive,
        })
        .from(schema.units)
        .where(eq(schema.units.id, id))
        .limit(1);

      await tx.insert(schema.auditLogs).values({
        tableName: "units",
        action: "UPDATE",
        recordId: String(id),
        userId: Number.isFinite(adminId) ? adminId : null,
        payload: JSON.stringify({ before, after: row }),
      });

      return row;
    });

    if (!after) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ data: after });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const isUnique =
      (err as { code?: string })?.code === "23505" ||
      (err as { cause?: { code?: string } })?.cause?.code === "23505" ||
      msg.toLowerCase().includes("unique") ||
      msg.includes("units_code_uq");

    return NextResponse.json(
      { error: isUnique ? "Já existe unidade com este código." : "Falha ao atualizar unidade." },
      { status: isUnique ? 409 : 500 },
    );
  }
}
