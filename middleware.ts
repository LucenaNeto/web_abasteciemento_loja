// middleware.ts (ou src/middleware.ts)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Ajuste se necessário, mas o padrão abaixo cobre páginas (exclui _next, api, etc.)
export const config = {
  matcher: ["/((?!_next|api|favicon.ico|assets|public).*)"],
};

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Permite livre: 403 e arquivos estáticos
  if (pathname === "/403") return NextResponse.next();

  // Lê o token da sessão (requer NEXTAUTH_SECRET no .env)
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isLogged = !!token;

  // Usuário já autenticado acessando /login => manda pra home
  if (pathname.startsWith("/login")) {
    if (isLogged) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  // Bloqueia qualquer página sem login
  if (!isLogged) {
    const url = new URL("/login", req.url);
    // opcional: preserva destino
    url.searchParams.set("redirectTo", pathname + search);
    return NextResponse.redirect(url);
  }

  // Extrai role do token (ajuste conforme seu callback do NextAuth)
  const role =
    (token as any)?.role ||
    (token as any)?.user?.role ||
    "";

  // ---------- Regras de acesso por rota ----------

  // Admin-only
  const adminOnly = ["/produtos/import", "/usuarios", "/auditoria"];
  if (adminOnly.some((p) => pathname.startsWith(p))) {
    if (role !== "admin") return deny(req);
  }

  // Store/Admin podem criar
  if (pathname.startsWith("/requisicoes/nova")) {
    if (role !== "admin" && role !== "store") return deny(req);
  }

  // Warehouse/Admin: fila de pendentes e tela de atender
  const isPendentes = pathname.startsWith("/requisicoes/pendentes");
  const isAtender = pathname.endsWith("/atender") && pathname.startsWith("/requisicoes/");
  if (isPendentes || isAtender) {
    if (role !== "admin" && role !== "warehouse") return deny(req);
  }

  // Demais páginas: apenas autenticado
  return NextResponse.next();
}

function deny(req: NextRequest) {
  // Reescreve para /403 (UI bonita). Para API deixe a verificação nos handlers.
  const url = new URL("/403", req.url);
  // Dica: marcar cabeçalho ajuda a debugar em proxies
  const res = NextResponse.rewrite(url);
  res.headers.set("x-deny-reason", "rbac");
  return res;
}
