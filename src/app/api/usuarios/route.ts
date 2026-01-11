import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq, like, or, sql, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- GET /api/usuarios ----------
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
// CORREÇÃO AQUI: Os campos novos devem estar DENTRO do objeto
const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório").max(255).trim(),
  email: z.string().email("E-mail inválido").max(255).trim(),
  password: z.string().min(6, "Senha mínima de 6 caracteres"),
  role: z.enum(["admin", "store", "warehouse"]),
  isActive: z.boolean().optional().default(true),
  // Campos novos devidamente integrados:
  unitIds: z.array(z.number().int().positive()).optional().default([]),
  primaryUnitId: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  let payload: z.infer<typeof createSchema>;
  try {
    const json = await req.json();
    payload = createSchema.parse(json);
    console.log("DEBUG POST /api/usuarios payload:", {
    unitIds: payload.unitIds,
    primaryUnitId: payload.primaryUnitId,
    email: payload.email,
  });

  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  // 1. Validação de Unidades (Antes de criar o usuário!)
  const unitIds = Array.from(new Set(payload.unitIds ?? []));
  if (unitIds.length === 0) {
    return NextResponse.json(
      { error: "Selecione ao menos 1 unidade para o usuário." },
      { status: 400 },
    );
  }

  // Verifica se as unidades existem no banco
  const existingUnits = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(inArray(schema.units.id, unitIds));

  if (existingUnits.length !== unitIds.length) {
    return NextResponse.json(
      { error: "Alguma unidade selecionada não existe." },
      { status: 400 },
    );
  }

  // Define a primária
  const primaryUnitId =
    payload.primaryUnitId && unitIds.includes(payload.primaryUnitId)
      ? payload.primaryUnitId
      : unitIds[0];


  // 2. Verificar duplicidade por email
  const [exists] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, payload.email))
    .limit(1);

  if (exists) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  // 3. Criar hash e Inserir no Banco (Transação implícita ou sequencial)
  const passwordHash = await bcrypt.hash(payload.password, 10);

  try {
    // A) Cria Usuário
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
    if (!userId) throw new Error("Falha ao recuperar ID do novo usuário");

    // B) Vincula Unidades
    await db.insert(schema.userUnits).values(
      unitIds.map((uid) => ({
        userId: userId,
        unitId: uid,
        isPrimary: uid === primaryUnitId,
      })),
    );

    // C) Auditoria
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
          unitIds, // log das unidades
          primaryUnitId
        },
      }),
    });

    // Retorna o usuário criado
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
      .where(eq(schema.users.id, userId))
      .limit(1);

    return NextResponse.json({ data: created }, { status: 201 });

  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // Se falhar na criação das unidades, o ideal seria fazer rollback, 
    // mas sem transação explícita, o erro é pego aqui.
    console.error(err);
    const isUnique =
      msg.includes("UNIQUE constraint failed") || msg.toLowerCase().includes("unique");
    return NextResponse.json(
      { error: isUnique ? "E-mail já cadastrado" : "Falha ao criar usuário" },
      { status: isUnique ? 409 : 500 },
    );
  }
}