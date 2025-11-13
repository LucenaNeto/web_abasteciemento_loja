// src/app/requisicoes/pendentes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation"; // App Router ✅

type Role = "admin" | "store" | "warehouse";

type ReqRow = {
  id: number;
  status: "pending" | "in_progress" | "completed" | string;
  createdAt: string;
  createdByName?: string | null;
  itemsCount?: number | null;
};

type ListResp = {
  data: ReqRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export default function PendentesAlmoxPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const canHandle = role === "warehouse" || role === "admin";
  const router = useRouter();

  // filtros
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // dados
  const [rows, setRows] = useState<ReqRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // loading por linha ao atender
  const [attendingId, setAttendingId] = useState<number | null>(null);

  const query = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("status", "pending");
    if (q.trim()) usp.set("q", q.trim());
    usp.set("page", String(page));
    usp.set("pageSize", String(pageSize));
    return usp.toString();
  }, [q, page, pageSize]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/requisicoes?${query}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await safeText(r));
      const j: ListResp = await r.json();
      setRows(j.data);
      setTotalPages(j.pagination.totalPages);
      setTotal(j.pagination.total);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated" && canHandle) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canHandle, query]);

  async function atender(id: number) {
    if (!canHandle) return;
    setAttendingId(id);
    try {
      // endpoint preferencial
      let resp = await fetch(`/api/requisicoes/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });

      // fallback se não existir rota dedicada
      if (resp.status === 404) {
        resp = await fetch(`/api/requisicoes/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "in_progress" }),
        });
      }

      // trata 204/sem corpo JSON
      const j = await maybeJson(resp);
      if (!resp.ok) throw new Error(j?.error || `Falha (HTTP ${resp.status})`);

      router.push(`/requisicoes/${id}/atender`);
    } catch (e: any) {
      alert(`Falha ao marcar como "em progresso": ${String(e?.message ?? e)}`);
    } finally {
      setAttendingId(null);
    }
  }

  if (status === "loading") return <div className="p-6">Carregando...</div>;
  if (!canHandle) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Almoxarifado</strong> ou <strong>Admin</strong> visualizam esta fila.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-sm">
          <Link href="/requisicoes" className="underline">← Voltar para Requisições</Link>
        </div>

        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Fila — Pendentes</h1>
            <p className="text-sm text-gray-600">Atenda as requisições marcando como <em>em progresso</em> e depois conclua no detalhe.</p>
          </div>
          <div className="text-sm text-gray-600">Total: <strong>{total}</strong></div>
        </header>

        {/* Filtro */}
        <section className="mt-4 rounded-2xl border bg-white p-4">
          <div className="flex gap-2">
            <input
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Buscar por ID, criador, observação..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())}
            />
            <button onClick={() => (setPage(1), load())} className="rounded-xl border px-4 py-2 hover:bg-gray-50">
              Aplicar
            </button>
          </div>
        </section>

        {/* Tabela */}
        <section className="mt-4 rounded-2xl border bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Criado em</th>
                  <th className="px-4 py-3">Aberta por</th>
                  <th className="px-4 py-3">Itens</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center">Carregando...</td></tr>
                ) : err ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-red-600">{err}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Nenhuma requisição pendente.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-3">#{r.id}</td>
                      <td className="px-4 py-3">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3">{r.createdByName ?? "-"}</td>
                      <td className="px-4 py-3">{r.itemsCount ?? "-"}</td>
                      <td className="px-4 py-3 flex gap-2">
                        <button
                          onClick={() => atender(r.id)}
                          disabled={attendingId === r.id}
                          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                          title='Mudar status para "em progresso"'
                        >
                          {attendingId === r.id ? "Atendendo..." : "Atender"}
                        </button>
                        <Link
                          href={`/requisicoes/${r.id}`}
                          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          title="Abrir detalhes (concluir e informar quantidades)"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between p-4 text-sm text-gray-600">
            <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
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
  if (r.status === 204 || r.status === 205 || r.status === 304) return null;
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("application/json")) return null;
  const text = await r.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function maybeJson(r: Response) {
  // Alias para operações que podem retornar 204 (sem corpo)
  return safeJson(r);
}
