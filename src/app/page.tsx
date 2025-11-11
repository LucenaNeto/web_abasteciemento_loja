// src/app/page.tsx
import Link from "next/link";
import { requireUser } from "@/server/auth/rbac";

export const dynamic = "force-dynamic"; // evita cache com sessão

export default async function Home() {
  const session = await requireUser();
  const user = session.user as any;
  const role = user?.role as "admin" | "store" | "warehouse";

  const roleLabel =
    role === "admin" ? "Administrador"
    : role === "store" ? "Loja"
    : role === "warehouse" ? "Almoxarifado"
    : "Usuário";

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Sistema de Reposição
            </h1>
            <p className="text-sm text-gray-500">
              Olá, <span className="font-medium">{user?.name}</span> — Papel: <span className="font-medium">{roleLabel}</span>
            </p>
          </div>
          <nav className="text-sm text-gray-600">
            <Link href="/api/auth/signout" className="underline">
              Sair
            </Link>
          </nav>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/produtos"
            className="rounded-2xl bg-white p-5 shadow hover:shadow-md transition"
          >
            <h2 className="text-lg font-medium text-gray-900">Produtos</h2>
            <p className="mt-1 text-sm text-gray-500">
              Cadastro e consulta de SKUs.
            </p>
          </Link>

          <Link
            href="/requisicoes"
            className="rounded-2xl bg-white p-5 shadow hover:shadow-md transition"
          >
            <h2 className="text-lg font-medium text-gray-900">Requisições</h2>
            <p className="mt-1 text-sm text-gray-500">
              Criar, atender e acompanhar status.
            </p>
          </Link>

          <Link
            href="/auditoria"
            className="rounded-2xl bg-white p-5 shadow hover:shadow-md transition"
          >
            <h2 className="text-lg font-medium text-gray-900">Auditoria</h2>
            <p className="mt-1 text-sm text-gray-500">
              Rastreabilidade das ações.
            </p>
          </Link>
        </section>

        <section className="mt-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-base font-semibold text-gray-900">
              Fila de Requisições Pendentes
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Em breve: listaremos aqui as requisições com status <em>pending</em> / <em>in_progress</em>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
