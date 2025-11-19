// src/app/api/usuarios/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------- GET /api/usuarios/:id --------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string | string[] }> },
) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const raw = Array.isArray(idParam) ? idParam[0] : idParam ?? "";
  const id = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const [user] = await db
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
    .where(eq(schema.users.id, id))
    .limit(1);

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  return NextResponse.json({ data: user });
}

// -------- PATCH /api/usuarios/:id --------
// Campos permitidos: name?, role?, isActive?, newPassword?
const patchSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  role: z.enum(["admin", "store", "warehouse"]).optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(6).optional(),
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
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  if (
    payload.name == null &&
    payload.role == null &&
    payload.isActive == null &&
    payload.newPassword == null
  ) {
    return NextResponse.json(
      { error: "Informe pelo menos um campo para atualizar." },
      { status: 400 },
    );
  }

  // Carrega atual (para validações e auditoria)
  const [current] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!current) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Monta patch
  const patch: Partial<typeof schema.users.$inferInsert> = {};
  if (payload.name != null) patch.name = payload.name;
  if (payload.role != null) patch.role = payload.role;
  if (payload.isActive != null) patch.isActive = payload.isActive;

  // Senha (se vier)
  let passwordChanged = false;
  if (payload.newPassword) {
    patch.passwordHash = await bcrypt.hash(payload.newPassword, 10);
    passwordChanged = true;
  }

  // Atualiza
  await db
    .update(schema.users)
    .set({ ...patch, updatedAt: new Date()})
    .where(eq(schema.users.id, id));

  // Auditoria (UPDATE)
  const adminId = Number((guard.session.user as any).id);
  await db.insert(schema.auditLogs).values({
    tableName: "users",
    action: "UPDATE",
    recordId: String(id),
    userId: Number.isFinite(adminId) ? adminId : null,
    payload: JSON.stringify({
      before: {
        name: current.name,
        role: current.role,
        isActive: current.isActive,
      },
      after: {
        name: payload.name ?? current.name,
        role: payload.role ?? current.role,
        isActive: payload.isActive ?? current.isActive,
      },
    }),
  });

  // Auditoria (PASSWORD_RESET) se necessário
  if (passwordChanged) {
    await db.insert(schema.auditLogs).values({
      tableName: "users",
      action: "PASSWORD_RESET",
      recordId: String(id),
      userId: Number.isFinite(adminId) ? adminId : null,
      payload: JSON.stringify({ reason: "admin_update" }),
    });
  }

  // Retorna o usuário atualizado (sem hash)
  const [updated] = await db
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
    .where(eq(schema.users.id, id))
    .limit(1);

  return NextResponse.json({ data: updated });
}
