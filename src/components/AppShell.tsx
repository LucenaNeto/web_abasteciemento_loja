// src/components/AppShell.tsx
// Layout base: menu lateral (desktop) + barra superior com gaveta (celular).
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { signOut, useSession } from "next-auth/react";

type Role = "admin" | "store" | "warehouse";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  roles?: Role[]; // vazio = todos
  /** ativa em subrotas, exceto nestas */
  exclude?: string[];
  exact?: boolean;
};

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Operação",
    items: [
      { href: "/", label: "Início", icon: "home", exact: true },
      {
        href: "/requisicoes",
        label: "Requisições",
        icon: "list",
        exclude: ["/requisicoes/nova", "/requisicoes/pendentes"],
      },
      { href: "/requisicoes/nova", label: "Nova requisição", icon: "plus", roles: ["admin", "store"] },
      { href: "/requisicoes/pendentes", label: "Fila de pendentes", icon: "inbox", roles: ["admin", "warehouse"] },
      { href: "/produtos", label: "Produtos", icon: "box", exclude: ["/produtos/import"] },
    ],
  },
  {
    title: "Administração",
    items: [
      { href: "/relatorios", label: "Relatórios", icon: "chart", roles: ["admin"] },
      { href: "/produtos/import", label: "Importar produtos", icon: "upload", roles: ["admin"] },
      { href: "/usuarios", label: "Usuários", icon: "users", roles: ["admin"] },
      { href: "/unidades", label: "Unidades", icon: "building", roles: ["admin"] },
      { href: "/auditoria", label: "Auditoria", icon: "shield", roles: ["admin"] },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  store: "Loja",
  warehouse: "Almoxarifado",
};

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  if (!(pathname === item.href || pathname.startsWith(item.href + "/"))) return false;
  return !(item.exclude ?? []).some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  // fecha a gaveta ao navegar
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  // sem menu no login
  if (pathname.startsWith("/login") || pathname.endsWith("/imprimir")) return <>{children}</>;

  const user = session?.user as { name?: string | null; role?: Role } | undefined;
  const role = user?.role;

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || (role && i.roles.includes(role))),
  })).filter((g) => g.items.length > 0);

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 text-brand-50">
      <Link href="/" className="flex items-center gap-3 px-5 py-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-grupo.png" alt="Grupo Ana Sobral" className="h-full w-full object-contain" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold">Grupo Ana Sobral</span>
          <span className="block text-[11px] uppercase tracking-wide text-brand-300">Sistema de Reposição</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Menu principal">
        {status === "loading" ? (
          <div className="px-3 py-2 text-sm text-brand-300">Carregando…</div>
        ) : (
          groups.map((g) => (
            <div key={g.title} className="mt-4 first:mt-1">
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-brand-400">
                {g.title}
              </div>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                          active
                            ? "bg-brand-700 font-medium text-white"
                            : "text-brand-100 hover:bg-brand-800 hover:text-white"
                        }`}
                      >
                        <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div className="border-t border-brand-800 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold uppercase">
            {(user?.name ?? "?").trim().charAt(0)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium">{user?.name ?? "Usuário"}</div>
            <div className="text-xs text-brand-300">{role ? ROLE_LABEL[role] : ""}</div>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-brand-700 px-3 py-1.5 text-sm text-brand-100 hover:bg-brand-800"
        >
          <Icon name="logout" className="h-4 w-4" />
          Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64 print:pl-0">
      {/* menu fixo no desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block print:hidden">{sidebar}</aside>

      {/* barra superior no celular */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="rounded-lg border border-gray-200 p-2 text-brand-900 hover:bg-gray-50"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-brand-900">Grupo Ana Sobral</span>
      </header>

      {/* gaveta no celular */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="app-content">{children}</div>
    </div>
  );
}

/* ---------- ícones (SVG inline, sem dependências) ---------- */
type IconName =
  | "home" | "list" | "plus" | "inbox" | "box" | "chart" | "upload"
  | "users" | "building" | "shield" | "logout" | "menu";

const PATHS: Record<IconName, string> = {
  home: "M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1v-9",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  plus: "M12 5v14M5 12h14",
  inbox: "M4 13l2-7h12l2 7M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M4 13h4l1 2h6l1-2h4",
  box: "M21 8 12 3 3 8m18 0v8l-9 5m9-13-9 5m0 8-9-5V8m9 5v8M7.5 5.5l9 5",
  chart: "M4 20V10m6 10V4m6 16v-7m5 7H3",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m17 0v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  building: "M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M3 21h18M8 8h2M8 12h2M8 16h2",
  shield: "M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4",
  logout: "M15 17l5-5-5-5M20 12H9m4 8H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
