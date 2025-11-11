// src/app/produtos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  isActive: 0 | 1 | boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiListResp = {
  data: Product[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export default function ProdutosPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as "admin" | "store" | "warehouse" | undefined;

  const [q, setQ] = useState("");
  const [active, setActive] = useState<"all" | "true" | "false">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [rows, setRows] = useState<Product[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Modal de criação
  const [openNew, setOpenNew] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("UN");
  const [newSaving, setNewSaving] = useState(false);
  const [newErr, setNewErr] = useState<string | null>(null);

  const isAdmin = role === "admin";

  const queryParams = useMemo(() => {
    const usp = new URLSearchParams();
    if (q.trim()) usp.set("q", q.trim());
    if (active !== "all") usp.set("active", active);
    usp.set("page", String(page));
    usp.set("pageSize", String(pageSize));
    return usp.toString();
  }, [q, active, page, pageSize]);

  async function load() {
    setLoading(true);
    setLoadErr(null);
    try {
      const resp = await fetch(`/api/produtos?${queryParams}`, { cache: "no-store" });
      if (!resp.ok) {
        const t = await safeText(resp);
        throw new Error(t || `Falha ao listar (HTTP ${resp.status})`);
      }
      const json: ApiListResp = await resp.json();
      setRows(json.data);
      setTotalPages(json.pagination.totalPages);
      setTotal(json.pagination.total);
    } catch (e: any) {
      setLoadErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated") {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, queryParams]);

  function resetAndReload() {
    setPage(1);
    // useEffect recarrega devido ao queryParams
  }

  async function createProduct() {
    setNewErr(null);
    if (!newSku.trim() || !newName.trim()) {
      setNewErr("Preencha SKU e Nome.");
      return;
    }
    setNewSaving(true);
    try {
      const resp = await fetch("/api/produtos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: newSku.trim(),
          name: newName.trim(),
          unit: newUnit.trim() || "UN",
        }),
      });
      if (!resp.ok) {
        const tx = await safeJson(resp);
        const msg = tx?.error || `Falha ao criar (HTTP ${resp.status})`;
        throw new Error(msg);
      }
      // sucesso
      setOpenNew(false);
      setNewSku("");
      setNewName("");
      setNewUnit("UN");
      resetAndReload();
      await load();
    } catch (e: any) {
      setNewErr(String(e?.message ?? e));
    } finally {
      setNewSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Produtos</h1>
            <p className="text-sm text-gray-500">
              Cadastre e pesquise SKUs. {isAdmin ? "Você tem permissão para criar." : "Somente Admin pode criar."}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setOpenNew(true)}
              className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
            >
              Novo Produto
            </button>
          )}
        </header>

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">Buscar</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="SKU ou nome"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resetAndReload()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ativo</label>
              <select
                className="mt-1 rounded-xl border border-gray-300 px-3 py-2"
                value={active}
                onChange={(e) => {
                  setActive(e.target.value as any);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="true">Somente ativos</option>
                <option value="false">Somente inativos</option>
              </select>
            </div>
            <div className="sm:w-40">
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
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-center" colSpan={5}>
                      Carregando...
                    </td>
                  </tr>
                ) : loadErr ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-red-600" colSpan={5}>
                      {loadErr}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={5}>
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((p) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-4 py-3">{p.id}</td>
                      <td className="px-4 py-3 font-medium">{p.sku}</td>
                      <td className="px-4 py-3">{p.name}</td>
                      <td className="px-4 py-3">{p.unit}</td>
                      <td className="px-4 py-3">{truthy(p.isActive) ? "Sim" : "Não"}</td>
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

      {/* Modal Novo Produto (somente Admin) */}
      {isAdmin && openNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Novo Produto</h3>
              <button onClick={() => setOpenNew(false)} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            {newErr && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {newErr}
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700">SKU</label>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="Ex.: SKU-010"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700">Unidade</label>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="UN / CX / KG"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Nome</label>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome do produto"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setOpenNew(false)}
                className="rounded-xl border px-4 py-2"
                disabled={newSaving}
              >
                Cancelar
              </button>
              <button
                onClick={createProduct}
                disabled={newSaving}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {newSaving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Helpers
function truthy(v: any) {
  return v === true || v === 1 || v === "1";
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
    return await r.json();
  } catch {
    return null as any;
  }
}
