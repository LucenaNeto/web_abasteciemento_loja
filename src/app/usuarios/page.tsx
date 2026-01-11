"use client";

import { useEffect, useMemo, useState } from "react";
// Em produção, descomente a linha abaixo e remova o mock de useSession
import { useSession } from "next-auth/react";



type Role = "admin" | "store" | "warehouse";

type Row = {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean | 0 | 1;
  createdAt: string;
  updatedAt: string;
};

type UnitRow = {
  id: number;
  code: string;
  name: string;
  isActive: boolean | 0 | 1;
};

type UserUnitsResp = {
  data: { userId: number; unitIds: number[]; primaryUnitId: number | null };
};

type ListResp = {
  data: Row[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export default function UsuariosPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const isAdmin = role === "admin";

  // ---- unidades (para atribuição no modal) ----
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsErr, setUnitsErr] = useState<string | null>(null);

  async function loadUnits() {
    setUnitsLoading(true);
    setUnitsErr(null);
    try {
      const r = await fetch("/api/units?active=true", { cache: "no-store" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);
      setUnits((j?.data ?? []) as UnitRow[]);
    } catch (e: any) {
      setUnitsErr(String(e?.message ?? e));
    } finally {
      setUnitsLoading(false);
    }
  }

  useEffect(() => {
    if (status === "authenticated" && isAdmin) loadUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isAdmin]);

  // filtros
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [active, setActive] = useState<"all" | "true" | "false">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // dados
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // modal novo
  const [openNew, setOpenNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("store");
  const [newActive, setNewActive] = useState(true);

  // unidades do novo
  const [newUnitIds, setNewUnitIds] = useState<number[]>([]);
  const [newPrimaryUnitId, setNewPrimaryUnitId] = useState<number | null>(null);

  const [savingNew, setSavingNew] = useState(false);
  const [newErr, setNewErr] = useState<string | null>(null);

  // modal editar
  const [openEdit, setOpenEdit] = useState<Row | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("store");
  const [editActive, setEditActive] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState("");

  // unidades do editar
  const [editUnitIds, setEditUnitIds] = useState<number[]>([]);
  const [editPrimaryUnitId, setEditPrimaryUnitId] = useState<number | null>(null);
  const [loadingEditUnits, setLoadingEditUnits] = useState(false);

  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const query = useMemo(() => {
    const usp = new URLSearchParams();
    if (q.trim()) usp.set("q", q.trim());
    if (roleFilter !== "all") usp.set("role", roleFilter);
    if (active !== "all") usp.set("active", active);
    usp.set("page", String(page));
    usp.set("pageSize", String(pageSize));
    return usp.toString();
  }, [q, roleFilter, active, page, pageSize]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/usuarios?${query}`, { cache: "no-store" });
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

  // ---- helpers unidade (novo) ----
  function toggleNewUnit(uid: number) {
    setNewUnitIds((prev) => {
      const has = prev.includes(uid);
      const next = has ? prev.filter((x) => x !== uid) : [...prev, uid];
      // ajusta primária
      if (!has) {
        if (!newPrimaryUnitId) setNewPrimaryUnitId(uid);
      } else {
        if (newPrimaryUnitId === uid) setNewPrimaryUnitId(next[0] ?? null);
      }
      return next;
    });
  }

  // ---- helpers unidade (editar) ----
  function toggleEditUnit(uid: number) {
    setEditUnitIds((prev) => {
      const has = prev.includes(uid);
      const next = has ? prev.filter((x) => x !== uid) : [...prev, uid];
      if (!has) {
        if (!editPrimaryUnitId) setEditPrimaryUnitId(uid);
      } else {
        if (editPrimaryUnitId === uid) setEditPrimaryUnitId(next[0] ?? null);
      }
      return next;
    });
  }

  async function saveUserUnits(userId: number, unitIds: number[], primaryUnitId: number | null) {
    const r = await fetch(`/api/usuarios/${userId}/units`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitIds, primaryUnitId }),
    });
    const j = await safeJson(r);
    if (!r.ok) throw new Error(j?.error || `Falha ao salvar unidades (HTTP ${r.status})`);
  }

  async function loadUserUnits(userId: number) {
    setLoadingEditUnits(true);
    try {
      const r = await fetch(`/api/usuarios/${userId}/units`, { cache: "no-store" });
      const j = (await safeJson(r)) as UserUnitsResp | null;
      if (!r.ok) throw new Error((j as any)?.error || `Falha (HTTP ${r.status})`);

      const unitIds = j?.data?.unitIds ?? [];
      const primaryUnitId = j?.data?.primaryUnitId ?? null;

      setEditUnitIds(unitIds);
      setEditPrimaryUnitId(primaryUnitId && unitIds.includes(primaryUnitId) ? primaryUnitId : unitIds[0] ?? null);
    } catch (e: any) {
      // se falhar, não trava o modal, só mostra no erro do modal
      setEditErr(String(e?.message ?? e));
      setEditUnitIds([]);
      setEditPrimaryUnitId(null);
    } finally {
      setLoadingEditUnits(false);
    }
  }

  // ✅ CRIAR USUÁRIO ATUALIZADO
  async function createUser() {
    if (!isAdmin) return;

    setNewErr(null);

    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      setNewErr("Preencha nome, e-mail e senha.");
      return;
    }

    // ✅ GARANTE que é array de números
    const unitIds = (newUnitIds ?? [])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (unitIds.length === 0) {
      setNewErr("Selecione ao menos 1 unidade para o usuário.");
      return;
    }

    const primaryUnitId =
      newPrimaryUnitId && unitIds.includes(Number(newPrimaryUnitId))
        ? Number(newPrimaryUnitId)
        : unitIds[0];

    setSavingNew(true);

    console.log("DEBUG createUser:", {
    newUnitIds,
    unitIdsCalculado: unitIds,
    newPrimaryUnitId,
    primaryUnitId,
  });

    try {
      const resp = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
          isActive: newActive,

          // ✅ ISSO aqui é o que normalmente está faltando:
          unitIds,
          primaryUnitId,
        }),
      });

      const j = await safeJson(resp);
      if (!resp.ok) throw new Error(j?.error || `Falha (HTTP ${resp.status})`);

      setOpenNew(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("store");
      setNewActive(true);

      // ✅ reset unidades do modal
      setNewUnitIds([]);
      setNewPrimaryUnitId(null);

      resetAndReload();
      await load();
    } catch (e: any) {
      setNewErr(String(e?.message ?? e));
    } finally {
      setSavingNew(false);
    }
  }

  // abrir modal editar
  function openEditModal(r: Row) {
    setOpenEdit(r);
    setEditName(r.name);
    setEditRole(r.role);
    setEditActive(truthy(r.isActive));
    setEditNewPassword("");
    setEditErr(null);

    // carrega unidades do usuário
    loadUserUnits(r.id);
  }

  // salvar edição
  async function saveEdit() {
    if (!isAdmin || !openEdit) return;
    setEditErr(null);

    if (editUnitIds.length === 0) {
      setEditErr("Selecione ao menos 1 unidade para este usuário.");
      return;
    }

    setSavingEdit(true);

    try {
      const body: any = {
        name: editName.trim() || undefined,
        role: editRole,
        isActive: editActive,
      };
      if (editNewPassword.trim()) body.newPassword = editNewPassword.trim();

      const resp = await fetch(`/api/usuarios/${openEdit.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await safeJson(resp);
      if (!resp.ok) throw new Error(j?.error || `Falha (HTTP ${resp.status})`);

      // salva unidades também
      await saveUserUnits(
        openEdit.id,
        editUnitIds,
        editPrimaryUnitId && editUnitIds.includes(editPrimaryUnitId) ? editPrimaryUnitId : editUnitIds[0] ?? null,
      );

      setOpenEdit(null);
      resetAndReload();
      await load();
    } catch (e: any) {
      setEditErr(String(e?.message ?? e));
    } finally {
      setSavingEdit(false);
    }
  }

  if (status === "loading") {
    return <div className="p-6">Carregando...</div>;
  }
  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Admin</strong> pode acessar Usuários.
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
            <h1 className="text-2xl font-semibold text-gray-900">Usuários</h1>
            <p className="text-sm text-gray-500">Gerencie acesso: nome, papel, status, senha e unidades.</p>
          </div>
          <button
            onClick={() => {
              setOpenNew(true);
              setNewErr(null);
              // reset unidades do novo
              setNewUnitIds([]);
              setNewPrimaryUnitId(null);
              if (units.length === 0) loadUnits();
            }}
            className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
          >
            Novo Usuário
          </button>
        </header>

        {unitsErr && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Falha ao carregar unidades: {unitsErr}
          </div>
        )}

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Buscar</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder="nome ou e-mail"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && resetAndReload()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Papel</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value as any);
                  setPage(1);
                }}
              >
                <option value="all">Todos</option>
                <option value="admin">Administrador</option>
                <option value="store">Loja</option>
                <option value="warehouse">Almoxarifado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ativo</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2"
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
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Papel</th>
                  <th className="px-4 py-3">Ativo</th>
                  <th className="px-4 py-3">Criado em</th>
                  <th className="px-4 py-3">Ações</th>
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
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-4 py-3">#{r.id}</td>
                      <td className="px-4 py-3">{r.name}</td>
                      <td className="px-4 py-3">{r.email}</td>
                      <td className="px-4 py-3">{labelRole(r.role)}</td>
                      <td className="px-4 py-3">{truthy(r.isActive) ? "Sim" : "Não"}</td>
                      <td className="px-4 py-3">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEditModal(r)}
                          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                        >
                          Editar
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

      {/* Modal Novo Usuário */}
      {openNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Novo Usuário</h3>
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
                <label className="block text-sm font-medium text-gray-700">Nome</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">E-mail</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Senha</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Papel</label>
                <select className="mt-1 w-full rounded-xl border px-3 py-2" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  <option value="store">Loja</option>
                  <option value="warehouse">Almoxarifado</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex items-center gap-2">
                <input id="new-active" type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
                <label htmlFor="new-active" className="text-sm text-gray-700">Ativo</label>
              </div>
            </div>

            {/* Unidades */}
            <div className="mt-5 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-900">Unidades permitidas</div>
                  <div className="text-xs text-gray-500">
                    Marque as unidades que esse colaborador pode visualizar. Escolha também a primária.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                    onClick={() => {
                      const ids = units.map((u) => u.id);
                      setNewUnitIds(ids);
                      setNewPrimaryUnitId(ids[0] ?? null);
                    }}
                  >
                    Selecionar todas
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                    onClick={() => {
                      setNewUnitIds([]);
                      setNewPrimaryUnitId(null);
                    }}
                  >
                    Limpar
                  </button>
                </div>
              </div>

              <div className="mt-3 max-h-48 overflow-auto rounded-lg border">
                {units.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500">Sem unidades carregadas.</div>
                ) : (
                  <ul className="divide-y">
                    {units.map((u) => {
                      const checked = newUnitIds.includes(u.id);
                      const isPrimary = newPrimaryUnitId === u.id;
                      return (
                        <li key={u.id} className="flex items-center justify-between gap-3 p-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={checked} onChange={() => toggleNewUnit(u.id)} />
                            <span className="text-sm text-gray-800">
                              <strong>{u.code}</strong> — {u.name}
                            </span>
                          </label>

                          <label className={`flex items-center gap-2 text-sm ${checked ? 'text-gray-700 cursor-pointer' : 'text-gray-300'}`}>
                            <input
                              type="radio"
                              name="new-primary"
                              checked={isPrimary}
                              disabled={!checked}
                              onChange={() => setNewPrimaryUnitId(u.id)}
                            />
                            Primária
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {newUnitIds.length === 0 && (
                <div className="mt-2 text-xs text-amber-700">
                  Dica: se o usuário for Loja/Almoxarifado e não tiver unidade, ele pode ficar sem acesso.
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setOpenNew(false)} className="rounded-xl border px-4 py-2" disabled={savingNew}>
                Cancelar
              </button>
              <button
                onClick={createUser}
                disabled={savingNew}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {savingNew ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Usuário */}
      {openEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Editar Usuário #{openEdit.id}</h3>
              <button onClick={() => setOpenEdit(null)} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            {editErr && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {editErr}
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Nome</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Papel</label>
                <select className="mt-1 w-full rounded-xl border px-3 py-2" value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
                  <option value="store">Loja</option>
                  <option value="warehouse">Almoxarifado</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input id="edit-active" type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                <label htmlFor="edit-active" className="text-sm text-gray-700">Ativo</label>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Nova senha (opcional)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  type="password"
                  value={editNewPassword}
                  onChange={(e) => setEditNewPassword(e.target.value)}
                  placeholder="deixe em branco para não alterar"
                />
              </div>
            </div>

            {/* Unidades */}
            <div className="mt-5 rounded-xl border p-4">
              <div className="text-sm font-medium text-gray-900">Unidades permitidas</div>
              <div className="text-xs text-gray-500">Defina quais unidades ele pode ver e a unidade primária.</div>

              <div className="mt-3 max-h-48 overflow-auto rounded-lg border">
                {loadingEditUnits ? (
                  <div className="p-3 text-sm text-gray-500">Carregando unidades do usuário...</div>
                ) : units.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500">Sem unidades carregadas.</div>
                ) : (
                  <ul className="divide-y">
                    {units.map((u) => {
                      const checked = editUnitIds.includes(u.id);
                      const isPrimary = editPrimaryUnitId === u.id;
                      return (
                        <li key={u.id} className="flex items-center justify-between gap-3 p-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={checked} onChange={() => toggleEditUnit(u.id)} />
                            <span className="text-sm text-gray-800">
                              <strong>{u.code}</strong> — {u.name}
                            </span>
                          </label>

                          <label className={`flex items-center gap-2 text-sm ${checked ? 'text-gray-700 cursor-pointer' : 'text-gray-300'}`}>
                            <input
                              type="radio"
                              name="edit-primary"
                              checked={isPrimary}
                              disabled={!checked}
                              onChange={() => setEditPrimaryUnitId(u.id)}
                            />
                            Primária
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setOpenEdit(null)} className="rounded-xl border px-4 py-2" disabled={savingEdit}>
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {savingEdit ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function labelRole(r: Role) {
  return r === "admin" ? "Administrador" : r === "store" ? "Loja" : "Almoxarifado";
}
function truthy(v: any) {
  return v === true || v === 1 || v === "1";
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
  try {
    return await r.json();
  } catch {
    return null as any;
  }
}