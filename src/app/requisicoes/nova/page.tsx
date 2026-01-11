"use client";

import UnitSelect from "@/components/UnitSelect";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Role = "admin" | "store" | "warehouse";
type Criticality = "cashier" | "service" | "restock";

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  unit: string | null;
  isActive: boolean | 0 | 1;
};

type ListResp = {
  data: ProductRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type CartItem = {
  productId: number;
  sku: string;
  name: string;
  unit: string | null;
  qty: number;
};

export default function NovaRequisicaoPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const canCreate = role === "store" || role === "admin";
  const router = useRouter();

  // ✅ unidade atual
  const [unitId, setUnitId] = useState<number | null>(null);

  // busca
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // carrinho
  const [cart, setCart] = useState<Record<number, CartItem>>({});
  const cartArr = useMemo(() => Object.values(cart), [cart]);
  const totalItens = useMemo(() => cartArr.reduce((s, it) => s + (it.qty || 0), 0), [cartArr]);

  // obs/criticidade
  const [note, setNote] = useState("");
  const [criticality, setCriticality] = useState<Criticality>("restock");

  const [saving, setSaving] = useState(false);

  const mustPickUnit = role === "admin" && !unitId;

  async function search() {
    setLoading(true);
    setErr(null);
    try {
      const usp = new URLSearchParams();
      if (q.trim()) usp.set("q", q.trim());
      usp.set("active", "true");
      usp.set("page", String(page));
      usp.set("pageSize", "10");

      // ✅ força unidade (pra buscar produtos da unidade atual)
      if (unitId) usp.set("unitId", String(unitId));

      const r = await fetch(`/api/produtos?${usp.toString()}`, { cache: "no-store" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      const data = (j as ListResp);
      setRows(data.data);
      setTotalPages(data.pagination.totalPages);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!canCreate) return;

    // admin precisa escolher unidade antes
    if (mustPickUnit) return;

    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canCreate, page, unitId, mustPickUnit]);

  function addToCart(p: ProductRow) {
    setCart((m) => {
      const cur = m[p.id];
      const nextQty = Math.max(1, (cur?.qty ?? 0) + 1);
      return {
        ...m,
        [p.id]: { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty: nextQty },
      };
    });
  }

  function setQty(pid: number, qtyStr: string) {
    const n = Number.parseInt(qtyStr, 10);
    setCart((m) => {
      const cur = m[pid];
      if (!cur) return m;
      const qn = Number.isFinite(n) && n > 0 ? n : 0;
      const copy = { ...m };
      if (qn <= 0) delete copy[pid];
      else copy[pid] = { ...cur, qty: qn };
      return copy;
    });
  }

  function remove(pid: number) {
    setCart((m) => {
      const copy = { ...m };
      delete copy[pid];
      return copy;
    });
  }

  async function submitReq(e: FormEvent) {
    e.preventDefault();

    if (mustPickUnit) {
      alert("Selecione uma unidade antes de criar a requisição.");
      return;
    }

    if (cartArr.length === 0) {
      alert("Adicione ao menos 1 item.");
      return;
    }

    const items = cartArr.map((it) => ({ productId: it.productId, requestedQty: it.qty }));

    setSaving(true);
    try {
      const r = await fetch("/api/requisicoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitId: unitId ?? undefined, // ✅ agora envia
          items,
          note: note.trim() || undefined,
          criticality,
        }),
      });

      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      const id = j?.data?.id ?? j?.id ?? null;
      alert("Requisição criada com sucesso!");
      router.push(id ? `/requisicoes/${id}` : "/requisicoes");
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") return <div className="p-6">Carregando...</div>;

  if (!canCreate) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Loja</strong> ou <strong>Admin</strong> podem criar requisições.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between text-sm">
          <Link href="/requisicoes" className="underline">← Voltar</Link>
          <span className="text-xs text-gray-500">Nova Requisição</span>
        </div>

        {/* ✅ Unidade */}
        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
          <label className="block text-sm font-medium text-gray-700">Unidade</label>
          <div className="mt-1 max-w-md">
            <UnitSelect
              role={role}
              value={unitId}
              onChange={(v) => {
                setUnitId(v);
                setPage(1);
                setCart({});
              }}
            />
          </div>

          {mustPickUnit && (
            <p className="mt-2 text-sm text-red-600">Selecione uma unidade para continuar.</p>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* BUSCA */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-gray-900">Buscar produtos</h2>

            <div className="mt-3 flex gap-2">
              <input
                className="w-full rounded-xl border px-3 py-2"
                placeholder="SKU ou nome"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (setPage(1), search())}
                disabled={mustPickUnit}
              />
              <button
                onClick={() => (setPage(1), search())}
                className="rounded-xl border px-4 py-2 hover:bg-gray-50"
                disabled={mustPickUnit}
              >
                Buscar
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">Un.</th>
                    <th className="px-3 py-2">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {mustPickUnit ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-gray-500" colSpan={4}>
                        Selecione uma unidade.
                      </td>
                    </tr>
                  ) : loading ? (
                    <tr>
                      <td className="px-3 py-4 text-center" colSpan={4}>Carregando...</td>
                    </tr>
                  ) : err ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-red-600" colSpan={4}>{err}</td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-gray-500" colSpan={4}>Nenhum produto.</td>
                    </tr>
                  ) : (
                    rows.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2">{p.sku}</td>
                        <td className="px-3 py-2">{p.name}</td>
                        <td className="px-3 py-2">{p.unit ?? "UN"}</td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => addToCart(p)}
                            className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          >
                            Adicionar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
              <span>Página {page} de {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading || mustPickUnit}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading || mustPickUnit}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            </div>
          </section>

          {/* CARRINHO */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-gray-900">Carrinho ({totalItens} itens)</h2>

            <div className="mt-3 overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">Qtde</th>
                    <th className="px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {cartArr.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-gray-500" colSpan={4}>Carrinho vazio.</td>
                    </tr>
                  ) : (
                    cartArr.map((it) => (
                      <tr key={it.productId} className="border-t">
                        <td className="px-3 py-2">{it.sku}</td>
                        <td className="px-3 py-2">{it.name}</td>
                        <td className="px-3 py-2">
                          <input
                            className="w-24 rounded-lg border px-2 py-1.5"
                            inputMode="numeric"
                            value={String(it.qty)}
                            onChange={(e) => setQty(it.productId, e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => remove(it.productId)}
                            className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <form onSubmit={submitReq} className="mt-4 space-y-3">
              <div>
                <span className="block text-sm font-medium text-gray-700">Criticidade</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCriticality("cashier")}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs font-medium " +
                      (criticality === "cashier"
                        ? "border-red-500 bg-red-50 text-red-800"
                        : "border-red-200 bg-white text-red-700")
                    }
                  >
                    Revendedor no caixa (alta)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCriticality("service")}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs font-medium " +
                      (criticality === "service"
                        ? "border-yellow-500 bg-yellow-50 text-yellow-800"
                        : "border-yellow-200 bg-white text-yellow-700")
                    }
                  >
                    Revendedor em atendimento
                  </button>
                  <button
                    type="button"
                    onClick={() => setCriticality("restock")}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs font-medium " +
                      (criticality === "restock"
                        ? "border-green-500 bg-green-50 text-green-800"
                        : "border-green-200 bg-white text-green-700")
                    }
                  >
                    Abastecimento
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Observação (opcional)</label>
                <textarea
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving || cartArr.length === 0 || mustPickUnit}
                  className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? "Enviando..." : "Criar Requisição"}
                </button>
                <span className="text-xs text-gray-500">Itens: {cartArr.length}</span>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

async function safeJson(r: Response) {
  try {
    const ctype = (r.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("application/json")) return null;
    const txt = await r.text();
    if (!txt) return null;
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
