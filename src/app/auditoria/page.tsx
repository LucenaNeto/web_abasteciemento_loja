// src/app/auditoria/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type LogRow = {
  id: number;
  tableName: string;
  action: string;
  recordId: string;
  userId: number | null;
  payload: string | null;
  createdAt: string;
};

type ListResp = {
  data: LogRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export default function AuditoriaPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as "admin" | "store" | "warehouse" | undefined;
  const isAdmin = role === "admin";

  // filtros
  const [tableName, setTableName] = useState("");
  const [recordId, setRecordId] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [q, setQ] = useState("");

  // paginação
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // dados
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // modal payload
  const [openPayload, setOpenPayload] = useState<LogRow | null>(null);

  const query = useMemo(() => {
    const usp = new URLSearchParams();
    if (tableName.trim()) usp.set("table", tableName.trim());
    if (recordId.trim()) usp.set("recordId", recordId.trim());
    if (action.trim()) usp.set("action", action.trim());
    if (userId.trim()) usp.set("userId", userId.trim());
    if (q.trim()) usp.set("q", q.trim());
    usp.set("page", String(page));
    usp.set("pageSize", String(pageSize));
    return usp.toString();
  }, [tableName, recordId, action, userId, q, page, pageSize]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/auditoria?${query}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(await safeText(resp));
      const json: ListResp = await resp.json();
      setRows(json.data);
      setTotal(json.pagination.total);
      setTotalPages(json.pagination.totalPages);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated" && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isAdmin, query]);

  function resetAndReload() {
    setPage(1);
  }

  if (status === "loading") {
    return <div className="p-6">Carregando...</div>;
  }
  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Admin</strong> pode acessar Auditoria.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <header>
          <h1 className="text-2xl font-semibold text-gray-900">Auditoria</h1>
          <p className="text-sm text-gray-500">Rastreabilidade de ações (CRUD, mudanças de status, etc.).</p>
        </header>

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700">Tabela</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder='ex.: "requests", "products"'
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Record ID</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder="ex.: 15"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ação</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder='ex.: "CREATE", "UPDATE", "STATUS_CHANGE"'
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">User ID</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="ex.: 1"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Buscar no payload</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder='termo livre (ex.: "STATUS_CHANGE")'
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resetAndReload()}
              />
            </div>
            <div className="sm:col-span-6">
              <button onClick={resetAndReload} className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800">
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
                  <th className="px-4 py-3">Tabela</th>
                  <th className="px-4 py-3">Ação</th>
                  <th className="px-4 py-3">Record</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Payload</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-center" colSpan={7}>
                      Carregando...
                    </td>
                  </tr>
                ) : err ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-red-600" colSpan={7}>
                      {err}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                      Nenhum log encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-4 py-3">#{r.id}</td>
                      <td className="px-4 py-3">{r.tableName}</td>
                      <td className="px-4 py-3">{r.action}</td>
                      <td className="px-4 py-3">{r.recordId}</td>
                      <td className="px-4 py-3">{r.userId ?? "-"}</td>
                      <td className="px-4 py-3">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setOpenPayload(r)}
                          className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                        >
                          Ver
                        </button>
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

      {/* Modal Payload */}
      {openPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Log #{openPayload.id} — {openPayload.tableName}/{openPayload.action}
              </h3>
              <button onClick={() => setOpenPayload(null)} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            <div className="mt-4 overflow-auto rounded-xl border bg-gray-50">
              <pre className="whitespace-pre-wrap p-4 text-xs text-gray-800">
                {prettyJson(openPayload.payload)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function prettyJson(s: string | null) {
  if (!s) return "(sem payload)";
  try {
    const obj = JSON.parse(s);
    return JSON.stringify(obj, null, 2);
  } catch {
    return s;
  }
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
