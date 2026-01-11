// src/app/requisicoes/page.tsx
"use client";

import UnitSelect from "@/components/UnitSelect";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Req = {
  id: number;
  createdByUserId: number;
  assignedToUserId: number | null;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResp = {
  data: Req[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export default function RequisicoesPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as "admin" | "store" | "warehouse" | undefined;

  // ✅ unidade (dropdown)
  const [unitId, setUnitId] = useState<number | null>(null);

  // filtros
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "in_progress" | "completed" | "cancelled"
  >("all");
  const [createdBy, setCreatedBy] = useState<"all" | "me">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // dados
  const [rows, setRows] = useState<Req[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canCreate = role === "admin" || role === "store";
  const canOperate = role === "admin" || role === "warehouse";

  const query = useMemo(() => {
    const usp = new URLSearchParams();

    // ✅ se tiver unitId selecionado, filtra
    // (admin pode deixar null para ver geral, se quiser)
    if (unitId) usp.set("unitId", String(unitId));

    if (q.trim()) usp.set("q", q.trim());
    if (statusFilter !== "all") usp.set("status", statusFilter);
    if (createdBy === "me") usp.set("createdBy", "me");
    usp.set("page", String(page));
    usp.set("pageSize", String(pageSize));
    return usp.toString();
  }, [unitId, q, statusFilter, createdBy, page, pageSize]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/requisicoes?${query}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(await safeText(resp));
      const json: ListResp = await resp.json();
      setRows(json.data);
      setTotal(json.pagination.total);
      setTotalPages(json.pagination.totalPages);
    } catch (e: any) {
      setErr(e?.message || "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return;

    // ✅ para store/warehouse, só carrega quando já tiver unitId escolhido
    // (evita chamar API sem unitId e ficar "geral" indevido)
    if ((role === "warehouse" || role === "store") && !unitId) return;

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, role, unitId, query]);

  function resetAndReload() {
    setPage(1);
  }

  // ações rápidas
  async function assumir(id: number) {
    if (!canOperate) return;
    const resp = await fetch(`/api/requisicoes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "in_progress", assignToMe: true }),
    });
    if (!resp.ok) {
      const j = await safeJson(resp);
      alert(j?.error || `Falha (HTTP ${resp.status})`);
      return;
    }
    await load();
  }

  async function concluir(id: number) {
    if (!canOperate) return;
    const resp = await fetch(`/api/requisicoes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (!resp.ok) {
      const j = await safeJson(resp);
      alert(j?.error || `Falha (HTTP ${resp.status})`);
      return;
    }
    await load();
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Requisições</h1>
            <p className="text-sm text-gray-500">
              Fluxo: criar → atender → finalizar.{" "}
              <Link href="/produtos" className="underline">
                Ver produtos
              </Link>
            </p>
          </div>

          {canCreate && (
            <Link
              href="/requisicoes/nova"
              className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
            >
              Nova Requisição
            </Link>
          )}
        </header>

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
            {/* ✅ Unidade */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Unidade</label>
              <div className="mt-1">
                <UnitSelect
                  role={role}
                  value={unitId}
                  onChange={(v) => {
                    setUnitId(v);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Buscar</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="ID (exato) ou texto na observação"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resetAndReload()}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <select
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as any);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="pending">Pendente</option>
                <option value="in_progress">Em progresso</option>
                <option value="completed">Concluída</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </div>

            <div>
              <button
                onClick={resetAndReload}
                className="w-full rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
              >
                Aplicar filtros
              </button>
            </div>
          </div>

          {/* Criadas por */}
          <div className="mt-3 grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Criadas por</label>
              <select
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                value={createdBy}
                onChange={(e) => {
                  setCreatedBy(e.target.value as any);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="me">Somente minhas</option>
              </select>
            </div>
          </div>
        </section>

        {/* Tabela */}
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Observação</th>
                  <th className="px-4 py-3">Criada em</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-center" colSpan={5}>
                      Carregando...
                    </td>
                  </tr>
                ) : err ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-red-600" colSpan={5}>
                      {err}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={5}>
                      Nenhuma requisição encontrada.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/requisicoes/${r.id}`} className="underline">
                          #{r.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={r.status} />
                      </td>
                      <td className="px-4 py-3">{r.note || "-"}</td>
                      <td className="px-4 py-3">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {canOperate && r.status === "pending" && (
                            <button
                              onClick={() => assumir(r.id)}
                              className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                            >
                              Assumir
                            </button>
                          )}
                          {canOperate && r.status === "in_progress" && (
                            <button
                              onClick={() => concluir(r.id)}
                              className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                            >
                              Concluir
                            </button>
                          )}
                          <Link
                            href={`/requisicoes/${r.id}`}
                            className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          >
                            Detalhes
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between p-4 text-sm text-gray-600">
            <span>
              Total: <strong>{total}</strong> • Página <strong>{page}</strong> de{" "}
              <strong>{totalPages}</strong>
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Badge({ status }: { status: Req["status"] }) {
  const map: Record<Req["status"], string> = {
    pending: "bg-yellow-100 text-yellow-800",
    in_progress: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status]}`}>
      {status === "pending"
        ? "Pendente"
        : status === "in_progress"
        ? "Em progresso"
        : status === "completed"
        ? "Concluída"
        : "Cancelada"}
    </span>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

async function safeJson(r: Response) {
  if (r.status === 204 || r.status === 205 || r.status === 304) return null as any;
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("application/json")) return null as any;
  const txt = await r.text();
  if (!txt) return null as any;
  try {
    return JSON.parse(txt);
  } catch {
    return null as any;
  }
}
