// src/app/produtos/page.tsx
"use client";

import UnitSelect from "@/components/UnitSelect";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Role = "admin" | "store" | "warehouse";

type ProductRow = {
  id: number;
  unitId?: number;
  sku: string;
  name: string;
  unit: string | null;
  isActive: boolean | 0 | 1;
  stock?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type ListResp = {
  data: ProductRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export default function ProdutosPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;

  const isAdmin = role === "admin";

  // ✅ unidade (dropdown)
  const [unitId, setUnitId] = useState<number | null>(null);

  // filtros
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "true" | "false">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // dados
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // store/warehouse precisam de unitId (admin pode deixar null = todas)
  const mustPickUnit = (role === "store" || role === "warehouse") && !unitId;

  const query = useMemo(() => {
    const usp = new URLSearchParams();

    // ✅ unitId (admin pode omitir para listar geral)
    if (unitId) usp.set("unitId", String(unitId));

    if (q.trim()) usp.set("q", q.trim());
    if (activeFilter !== "all") usp.set("active", activeFilter);

    usp.set("page", String(page));
    usp.set("pageSize", String(pageSize));

    return usp.toString();
  }, [unitId, q, activeFilter, page, pageSize]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/produtos?${query}`, { cache: "no-store" });

      if (!resp.ok) {
        const j = await safeJson(resp);
        const msg =
          j?.error ||
          j?.message ||
          (typeof j === "string" ? j : null) ||
          (await safeText(resp)) ||
          `Falha (HTTP ${resp.status})`;
        throw new Error(String(msg));
      }

      const json: ListResp = await resp.json();
      setRows(json.data || []);
      setTotal(json.pagination?.total ?? 0);
      setTotalPages(json.pagination?.totalPages ?? 1);
    } catch (e: any) {
      setErr(e?.message || "Falha ao carregar");
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    if (mustPickUnit) return; // store/warehouse só carrega quando tiver unitId
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, role, unitId, query, mustPickUnit]);

  function resetAndReload() {
    setPage(1);
  }

  const columnsCount = 6; // ID, SKU, Nome, Unid, Ativo, Ações

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Produtos</h1>
            <p className="text-sm text-gray-500">
              Cadastre e pesquise SKUs.
              {isAdmin ? " Você tem permissão para criar/editar." : ""}
            </p>
          </div>

          {isAdmin && (
            <Link
              href={`/produtos/novo${unitId ? `?unitId=${unitId}` : ""}`}
              className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
            >
              Novo Produto
            </Link>
          )}
        </header>

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
            {/* Unidade */}
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

            {/* Buscar */}
            <div className="sm:col-span-3">
              <label className="block text-sm font-medium text-gray-700">Buscar</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="SKU ou nome"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resetAndReload()}
              />
            </div>

            {/* Ativo */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Ativo</label>
              <select
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                value={activeFilter}
                onChange={(e) => {
                  setActiveFilter(e.target.value as any);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </div>

            {/* Aplicar */}
            <div>
              <button
                onClick={resetAndReload}
                className="w-full rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
              >
                Aplicar filtros
              </button>
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
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Unid.</th>
                  <th className="px-4 py-3">Ativo</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>

              <tbody>
                {mustPickUnit ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={columnsCount}>
                      Selecione uma unidade para listar os produtos.
                    </td>
                  </tr>
                ) : loading ? (
                  <tr>
                    <td className="px-4 py-6 text-center" colSpan={columnsCount}>
                      Carregando...
                    </td>
                  </tr>
                ) : err ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-red-600" colSpan={columnsCount}>
                      {err}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={columnsCount}>
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 font-medium">{p.id}</td>
                      <td className="px-4 py-3">{p.sku}</td>
                      <td className="px-4 py-3">{p.name}</td>
                      <td className="px-4 py-3">{p.unit ?? "UN"}</td>
                      <td className="px-4 py-3">{isActiveText(p.isActive)}</td>

                      {role === "admin" && (
                        <td className="px-4 py-3">
                          <Link
                            href={`/produtos/${p.id}/editar${unitId ? `?unitId=${unitId}` : ""}`}
                            className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          >
                            Editar
                          </Link>
                        </td>
                      )}
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

function isActiveText(v: boolean | 0 | 1) {
  return v === true || v === 1 ? "Sim" : "Não";
}

async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

async function safeJson(r: Response) {
  try {
    const ctype = (r.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("application/json")) return null as any;
    return await r.json();
  } catch {
    return null as any;
  }
}
