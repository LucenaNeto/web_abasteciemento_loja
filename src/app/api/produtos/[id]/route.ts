import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, eq, ne } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(idRaw: string) {
  const id = Number(idRaw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const id = parseId(ctx.params.id);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const [row] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

  return NextResponse.json({ data: row });
}

const patchSchema = z.object({
  sku: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(255).optional(),
  unit: z.string().min(1).max(10).nullable().optional(),
  isActive: z.boolean().optional(),
  stock: z.number().int().min(0).nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const id = parseId(ctx.params.id);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const [current] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);

  if (!current) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

  // se trocar SKU, garante unicidade dentro da unidade
  if (payload.sku && payload.sku !== current.sku) {
    const [exists] = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.unitId, (current as any).unitId),
          eq(schema.products.sku, payload.sku),
          ne(schema.products.id, id),
        ),
      )
      .limit(1);

    if (exists) {
      return NextResponse.json({ error: "SKU já existe nesta unidade." }, { status: 409 });
    }
  }

  const [updated] = await db
    .update(schema.products)
    .set({
      sku: payload.sku ?? current.sku,
      name: payload.name ?? current.name,
      unit: payload.unit !== undefined ? payload.unit : (current as any).unit,
      isActive: payload.isActive !== undefined ? payload.isActive : (current as any).isActive,
      stock: payload.stock !== undefined ? payload.stock : (current as any).stock,
    })
    .where(eq(schema.products.id, id))
    .returning();

  return NextResponse.json({ data: updated });
}
