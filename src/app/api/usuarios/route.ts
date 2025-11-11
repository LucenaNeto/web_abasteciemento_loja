// src/app/api/usuarios/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq, like, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- GET /api/usuarios ----------
// Filtros: ?q=...&role=admin|store|warehouse&active=true|false&page=1&pageSize=20
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const role = (searchParams.get("role") ?? "").trim();
  const active = (searchParams.get("active") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  const filters = [];
  if (q) {
    filters.push(
      or(
        like(schema.users.name, `%${q}%`),
        like(schema.users.email, `%${q}%`),
      ),
    );
  }
  if (role === "admin" || role === "store" || role === "warehouse") {
    filters.push(eq(schema.users.role, role));
  }
  if (active === "true") filters.push(eq(schema.users.isActive, true));
  if (active === "false") filters.push(eq(schema.users.isActive, false));

  const whereClause = filters.length ? and(...(filters as any)) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.users)
    .where(whereClause as any);

  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      isActive: schema.users.isActive,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    })
    .from(schema.users)
    .where(whereClause as any)
    .orderBy(desc(schema.users.id))
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      pageSize,
      total: Number(count ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(count ?? 0) / pageSize)),
    },
  });
}

// ---------- POST /api/usuarios ----------
// Body: { name, email, password, role: "admin"|"store"|"warehouse", isActive?: boolean=true }
const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório").max(255).trim(),
  email: z.string().email("E-mail inválido").max(255).trim(),
  password: z.string().min(6, "Senha mínima de 6 caracteres"),
  role: z.enum(["admin", "store", "warehouse"]),
  isActive: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  let payload: z.infer<typeof createSchema>;
  try {
    const json = await req.json();
    payload = createSchema.parse(json);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  // verificar duplicidade por email
  const [exists] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, payload.email))
    .limit(1);

  if (exists) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  // criar usuário
  const passwordHash = await bcrypt.hash(payload.password, 10);

  try {
    const ins = await db
      .insert(schema.users)
      .values({
        name: payload.name,
        email: payload.email,
        passwordHash,
        role: payload.role,
        isActive: payload.isActive ?? true,
      })
      .returning({ id: schema.users.id });

    const userId = ins[0]?.id;

    // auditoria
    const adminId = Number((guard.session.user as any).id);
    await db.insert(schema.auditLogs).values({
      tableName: "users",
      action: "CREATE",
      recordId: String(userId),
      userId: Number.isFinite(adminId) ? adminId : null,
      payload: JSON.stringify({
        after: {
          id: userId,
          name: payload.name,
          email: payload.email,
          role: payload.role,
          isActive: payload.isActive ?? true,
        },
      }),
    });

    // retorna sem hash
    const [created] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId!))
      .limit(1);

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const isUnique =
      msg.includes("UNIQUE constraint failed") || msg.toLowerCase().includes("unique");
    return NextResponse.json(
      { error: isUnique ? "E-mail já cadastrado" : "Falha ao criar usuário" },
      { status: isUnique ? 409 : 500 },
    );
  }
}
