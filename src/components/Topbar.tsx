// src/components/Topbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {label}
    </Link>
  );
}

export default function Topbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  if (pathname?.startsWith("/login")) {
    return null;
  }
  const user = session?.user as any;
  const role = (user?.role ?? "") as "admin" | "store" | "warehouse" | "";
  const roleLabel =
    role === "admin" ? "Administrador" : role === "store" ? "Loja" : role === "warehouse" ? "Almoxarifado" : "";

  const isAdmin = role === "admin";
  const canCreateReq = role === "admin" || role === "store";
  const canHandleReq = role === "admin" || role === "warehouse";

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Esquerda: logo e navegação */}
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-gray-900">
            Reposição
          </Link>
          <nav className="hidden gap-1 sm:flex">
            <NavLink href="/" label="Início" active={pathname === "/"} />

            {/* Produtos + Importar (Admin) */}
            <NavLink
              href="/produtos"
              label="Produtos"
              active={pathname.startsWith("/produtos") && !pathname.startsWith("/produtos/import")}
            />
            {isAdmin && (
              <NavLink
                href="/produtos/import"
                label="Importar"
                active={pathname.startsWith("/produtos/import")}
              />
            )}

            {/* Requisições + Nova (Store/Admin) + Pendentes (Warehouse/Admin) */}
            <NavLink
              href="/requisicoes"
              label="Requisições"
              active={
                pathname === "/requisicoes" ||
                (pathname.startsWith("/requisicoes/") &&
                  !pathname.startsWith("/requisicoes/nova") &&
                  !pathname.startsWith("/requisicoes/pendentes"))
              }
            />
            {canCreateReq && (
              <NavLink
                href="/requisicoes/nova"
                label="Nova"
                active={pathname.startsWith("/requisicoes/nova")}
              />
            )}
            {canHandleReq && (
              <NavLink
                href="/requisicoes/pendentes"
                label="Pendentes"
                active={pathname.startsWith("/requisicoes/pendentes")}
              />
            )}

            {/* Usuários/Auditoria (Admin) */}
            {isAdmin && (
              <NavLink
                href="/usuarios"
                label="Usuários"
                active={pathname.startsWith("/usuarios")}
              />
            )}
            {isAdmin && (
              <NavLink
                href="/auditoria"
                label="Auditoria"
                active={pathname.startsWith("/auditoria")}
              />
            )}
          </nav>
        </div>

        {/* Direita: usuário e sair */}
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium text-gray-900">{user?.name ?? "Usuário"}</div>
            {roleLabel && <div className="text-xs text-gray-500">{roleLabel}</div>}
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
            title="Sair"
          >
            Sair
          </button>
        </div>
      </div>

      {/* Navegação mobile */}
      <div className="border-t border-gray-200 px-3 py-2 sm:hidden">
        <nav className="flex flex-wrap gap-2">
          <NavLink href="/" label="Início" active={pathname === "/"} />
          <NavLink
            href="/produtos"
            label="Produtos"
            active={pathname.startsWith("/produtos") && !pathname.startsWith("/produtos/import")}
          />
          {isAdmin && (
            <NavLink
              href="/produtos/import"
              label="Importar"
              active={pathname.startsWith("/produtos/import")}
            />
          )}
          <NavLink
            href="/requisicoes"
            label="Requisições"
            active={
              pathname === "/requisicoes" ||
              (pathname.startsWith("/requisicoes/") &&
                !pathname.startsWith("/requisicoes/nova") &&
                !pathname.startsWith("/requisicoes/pendentes"))
            }
          />
          {canCreateReq && (
            <NavLink
              href="/requisicoes/nova"
              label="Nova"
              active={pathname.startsWith("/requisicoes/nova")}
            />
          )}
          {canHandleReq && (
            <NavLink
              href="/requisicoes/pendentes"
              label="Pendentes"
              active={pathname.startsWith("/requisicoes/pendentes")}
            />
          )}
          {isAdmin && (
            <NavLink
              href="/usuarios"
              label="Usuários"
              active={pathname.startsWith("/usuarios")}
            />
          )}
          {isAdmin && (
            <NavLink
              href="/auditoria"
              label="Auditoria"
              active={pathname.startsWith("/auditoria")}
            />
          )}
        </nav>
      </div>
    </header>
  );
}
