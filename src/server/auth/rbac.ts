// src/server/auth/rbac.ts
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "./options";
import type { UserRole } from "@/server/db/schema";

// Sessão server-side (App Router)
export async function getSession() {
  return getServerSession(authOptions);
}

// Exige usuário autenticado (para páginas/server components)
export async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

// Exige um dos papéis informados (para páginas/server components)
// - Se não autenticado → redirect /login
// - Se autenticado porém sem permissão → notFound() (404 para não vazar info)
export async function requireRole(allowed: ReadonlyArray<UserRole>) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  const role = (session.user as any).role as UserRole;
  if (!allowed.includes(role)) {
    notFound(); // podemos trocar por redirect("/403") quando criarmos a página
  }
  return { session, role };
}

// Validação para rotas de API (Route Handlers)
// Uso típico dentro do handler:
//   const guard = await ensureRoleApi(["admin"]);
//   if (!guard.ok) return guard.res;
//   ... (guard.session, guard.role)
export async function ensureRoleApi(allowed: ReadonlyArray<UserRole>) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false as const,
      res: new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  const role = (session.user as any).role as UserRole;
  if (!allowed.includes(role)) {
    return {
      ok: false as const,
      res: new NextResponse(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { ok: true as const, session, role };
}
