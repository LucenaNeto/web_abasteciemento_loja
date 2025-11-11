// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Rotas públicas (sem necessidade de login)
  const publicPaths = [
    "/login",
    "/api/auth", // endpoints do NextAuth
    "/favicon.ico",
  ];

  // Recursos estáticos
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|css|js|map)$/)
  ) {
    return NextResponse.next();
  }

  // Permite públicos (login e auth)
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Obtém token da sessão (funciona no middleware)
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Não autenticado
  if (!token) {
    // Se for API (exceto /api/auth), responde 401 em vez de redirecionar
    if (pathname.startsWith("/api")) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // Redireciona para /login com callbackUrl
    const loginUrl = new URL("/login", req.url);
    const callbackUrl = pathname + (search ?? "");
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  // Autenticado → segue o fluxo
  return NextResponse.next();
}

// Aplica o middleware a tudo, exceto recursos estáticos (filtrados acima)
export const config = {
  matcher: ["/:path*"],
};
