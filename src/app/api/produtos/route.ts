import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, or, like, eq, sql, desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --------- GET /api/produtos ---------
// Query params: ?q=<texto>&page=1&pageSize=20&active=true|false
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin", "store", "warehouse"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const activeParam = searchParams.get("active");

  const filters = [];
  if (q) {
    filters.push(
      or(like(schema.products.sku, `%${q}%`), like(schema.products.name, `%${q}%`)),
    );
  }
  if (activeParam === "true") filters.push(eq(schema.products.isActive, true));
  if (activeParam === "false") filters.push(eq(schema.products.isActive, false));

  const whereClause = filters.length ? and(...filters) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.products)
    .where(whereClause as any);

  const total = Number(count ?? 0);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select()
    .from(schema.products)
    .where(whereClause as any)
    .orderBy(desc(schema.products.id))
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}

// --------- POST /api/produtos ---------
// Body: { sku: string, name: string, unit?: string = "UN", isActive?: boolean = true }
const productCreateSchema = z.object({
  sku: z.string().min(1, "SKU obrigatório").max(64).trim(),
  name: z.string().min(1, "Nome obrigatório").max(255).trim(),
  unit: z.string().min(1).max(10).trim().optional().default("UN"),
  isActive: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]); // somente Admin cria produtos
  if (!guard.ok) return guard.res;

  let payload: z.infer<typeof productCreateSchema>;
  try {
    const json = await req.json();
    payload = productCreateSchema.parse(json);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  // verifica duplicidade por SKU
  const [existing] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.sku, payload.sku))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: "SKU já cadastrado" },
      { status: 409 },
    );
  }

  try {
    await db.insert(schema.products).values({
      sku: payload.sku,
      name: payload.name,
      unit: payload.unit ?? "UN",
      isActive: payload.isActive ?? true,
    });

    // recupera registro inserido
    const [prod] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.sku, payload.sku))
      .limit(1);

    // auditoria
    if (prod) {
      const userId = Number((guard.session.user as any).id);
      await db.insert(schema.auditLogs).values({
        tableName: "products",
        action: "CREATE",
        recordId: String(prod.id),
        userId: Number.isFinite(userId) ? userId : null,
        payload: JSON.stringify({ after: prod }),
      });
    }

    return NextResponse.json({ data: prod }, { status: 201 });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const isUnique =
      msg.includes("UNIQUE constraint failed") || msg.toLowerCase().includes("unique");
    return NextResponse.json(
      { error: isUnique ? "SKU já cadastrado" : "Falha ao criar produto" },
      { status: isUnique ? 409 : 500 },
    );
  }
}
