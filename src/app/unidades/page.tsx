// src/app/unidades/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type Role = "admin" | "store" | "warehouse";
type Unit = { id: number; code: string; name: string; isActive: boolean };

export default function UnidadesPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const isAdmin = role === "admin";

  const [active, setActive] = useState<"all" | "true" | "false">("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // modal novo
  const [openNew, setOpenNew] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [savingNew, setSavingNew] = useState(false);
  const [newErr, setNewErr] = useState<string | null>(null);

  const query = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("active", active);
    return usp.toString();
  }, [active]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (u) =>
        u.code.toLowerCase().includes(term) ||
        u.name.toLowerCase().includes(term),
    );
  }, [rows, q]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/units?${query}`, { cache: "no-store" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);
      setRows((j?.data ?? []) as Unit[]);
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

  async function createUnit() {
    setNewErr(null);

    const code = newCode.trim();
    const name = newName.trim();

    if (!code || !name) {
      setNewErr("Preencha código e nome.");
      return;
    }

    setSavingNew(true);
    try {
      const r = await fetch("/api/units", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name, isActive: newActive }),
      });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      setOpenNew(false);
      setNewCode("");
      setNewName("");
      setNewActive(true);
      await load();
    } catch (e: any) {
      setNewErr(String(e?.message ?? e));
    } finally {
      setSavingNew(false);
    }
  }

  async function toggleActive(u: Unit) {
    try {
      const r = await fetch(`/api/units/${u.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      setRows((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, isActive: !u.isActive } : x)),
      );
    } catch (e: any) {
      alert(`Falha ao atualizar: ${String(e?.message ?? e)}`);
    }
  }

  if (status === "loading") return <div className="p-6">Carregando...</div>;

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Admin</strong> pode acessar Unidades.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Unidades</h1>
            <p className="text-sm text-gray-500">
              Crie novas unidades e ative/desative.
            </p>
          </div>

          <button
            onClick={() => setOpenNew(true)}
            className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
          >
            Nova Unidade
          </button>
        </header>

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <div className="sm:col-span-3">
              <label className="block text-sm font-medium text-gray-700">Buscar</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder="código ou nome"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ativo</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={active}
                onChange={(e) => setActive(e.target.value as any)}
              >
                <option value="all">Todas</option>
                <option value="true">Somente ativas</option>
                <option value="false">Somente inativas</option>
              </select>
            </div>
            <div>
              <button
                onClick={load}
                className="w-full rounded-xl border px-4 py-2 hover:bg-gray-50"
                disabled={loading}
              >
                {loading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          </div>

          {err && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          )}
        </section>

        {/* Tabela */}
        <section className="mt-4 rounded-2xl border bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Ativo</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-center" colSpan={4}>Carregando...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-gray-500" colSpan={4}>
                      Nenhuma unidade.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="px-4 py-3 font-medium">{u.code}</td>
                      <td className="px-4 py-3">{u.name}</td>
                      <td className="px-4 py-3">{u.isActive ? "Sim" : "Não"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleActive(u)}
                          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          title={u.isActive ? "Desativar" : "Ativar"}
                        >
                          {u.isActive ? "Desativar" : "Ativar"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Modal Nova Unidade */}
      {openNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Nova Unidade</h3>
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
              <div>
                <label className="block text-sm font-medium text-gray-700">Código</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="ex: 24603"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Nome</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="ex: VD GARANHUNS"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2 flex items-center gap-2">
                <input
                  id="unit-active"
                  type="checkbox"
                  checked={newActive}
                  onChange={(e) => setNewActive(e.target.checked)}
                />
                <label htmlFor="unit-active" className="text-sm text-gray-700">
                  Ativa
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setOpenNew(false)}
                className="rounded-xl border px-4 py-2"
                disabled={savingNew}
              >
                Cancelar
              </button>
              <button
                onClick={createUnit}
                disabled={savingNew}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {savingNew ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

async function safeJson(r: Response) {
  if (r.status === 204 || r.status === 205 || r.status === 304) return null as any;
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  const text = await r.text().catch(() => "");
  if (!text) return null as any;
  if (!ctype.includes("application/json")) return { error: text } as any;
  try { return JSON.parse(text); } catch { return { error: text } as any; }
}
