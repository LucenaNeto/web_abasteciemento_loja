// src/app/page.tsx — Início: resumo do que importa para cada perfil
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

type Role = "admin" | "store" | "warehouse";
type Counts = { pending: number; inProgress: number; mineOpen: number };

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", store: "Loja", warehouse: "Almoxarifado" };

async function total(qs: string) {
  const r = await fetch(`/api/requisicoes?${qs}&pageSize=1`, { cache: "no-store" });
  if (!r.ok) return 0;
  const j = await r.json();
  return Number(j?.pagination?.total ?? 0);
}

export default function Home() {
  const { data: session, status } = useSession();
  const user = session?.user as { name?: string | null; role?: Role } | undefined;
  const role = user?.role;
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !role) return;
    let alive = true;
    (async () => {
      const [pending, inProgress, mineOpen] = await Promise.all([
        total("status=pending"),
        total("status=in_progress"),
        role === "store" ? total("status=pending&createdBy=me") : Promise.resolve(0),
      ]);
      if (alive) setCounts({ pending, inProgress, mineOpen });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [status, role]);

  const shortcuts: { href: string; title: string; desc: string; icon: IconName; roles?: Role[] }[] = [
    { href: "/requisicoes/nova", title: "Nova requisição", desc: "Pedir reposição de produtos.", icon: "plus", roles: ["admin", "store"] },
    { href: "/requisicoes/pendentes", title: "Fila de pendentes", desc: "Atender o que está aguardando.", icon: "inbox", roles: ["admin", "warehouse"] },
    { href: "/requisicoes", title: "Requisições", desc: "Acompanhar status e histórico.", icon: "list" },
    { href: "/produtos", title: "Produtos", desc: "Consultar e cadastrar SKUs.", icon: "box" },
    { href: "/relatorios", title: "Dashboard", desc: "Indicadores por unidade e usuário.", icon: "chart", roles: ["admin"] },
    { href: "/auditoria", title: "Auditoria", desc: "Rastreabilidade das ações.", icon: "shield", roles: ["admin"] },
  ];

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader
        title={`Olá${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        subtitle={role ? `Perfil: ${ROLE_LABEL[role]}` : "Carregando…"}
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {role !== "store" && (
          <Stat
            href="/requisicoes?status=pending"
            label="Pendentes agora"
            value={counts?.pending}
            tone={counts && counts.pending > 0 ? "warning" : undefined}
          />
        )}
        {role !== "store" && <Stat href="/requisicoes?status=in_progress" label="Em progresso" value={counts?.inProgress} />}
        {role === "store" && <Stat href="/requisicoes?status=pending&createdBy=me" label="Minhas pendentes" value={counts?.mineOpen} />}
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shortcuts
          .filter((s) => !s.roles || (role && s.roles.includes(role)))
          .map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-800 group-hover:bg-brand-100">
                <Icon name={s.icon} className="h-5 w-5" />
              </span>
              <h2 className="mt-3 text-base font-semibold text-gray-900">{s.title}</h2>
              <p className="mt-0.5 text-sm text-gray-600">{s.desc}</p>
            </Link>
          ))}
      </section>
    </main>
  );
}

function Stat({
  href,
  label,
  value,
  tone,
}: {
  href: string;
  label: string;
  value: number | undefined;
  tone?: "warning";
}) {
  return (
    <Link href={href}>
      <Card className="p-4 transition hover:shadow-md">
        <div className="text-xs text-gray-600">{label}</div>
        <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "warning" ? "text-amber-700" : "text-brand-950"}`}>
          {value == null ? "…" : value.toLocaleString("pt-BR")}
        </div>
      </Card>
    </Link>
  );
}
