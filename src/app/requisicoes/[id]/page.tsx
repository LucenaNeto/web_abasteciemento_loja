// src/app/requisicoes/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

type ReqStatus = "pending" | "in_progress" | "completed" | "cancelled";
type ItemStatus = "pending" | "partial" | "delivered" | "cancelled";

type Req = {
  id: number;
  createdByUserId: number;
  assignedToUserId: number | null;
  status: ReqStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReqDetail = Req & {
  createdBy?: { id: number; name: string };
  assignedTo?: { id: number; name: string } | null;
  items: Array<{
    id: number;
    productId: number;
    requestedQty: number;
    deliveredQty: number;
    status: ItemStatus;
    productSku: string | null;
    productName: string | null;
    productUnit: string | null;
  }>;
};

export default function ReqDetailPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => Number.parseInt(String(params?.id ?? "").trim(), 10), [params]);
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as "admin" | "store" | "warehouse" | undefined;

  const canOperate = role === "admin" || role === "warehouse";

  const [data, setData] = useState<ReqDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // edição por linha
  const [editQty, setEditQty] = useState<Record<number, string>>({});
  const [savingRow, setSavingRow] = useState<number | null>(null);

  async function load() {
    if (!Number.isFinite(id)) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/requisicoes/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await safeText(r));
      const j = await r.json();
      setData(j.data);
      setEditQty({});
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function assume() {
    if (!canOperate || !data) return;
    const r = await fetch(`/api/requisicoes/${data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "in_progress", assignToMe: true }),
    });
    if (!r.ok) return alert((await safeJson(r))?.error || `Falha (HTTP ${r.status})`);
    await load();
  }

  async function conclude() {
    if (!canOperate || !data) return;
    const r = await fetch(`/api/requisicoes/${data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (!r.ok) return alert((await safeJson(r))?.error || `Falha (HTTP ${r.status})`);
    await load();
  }

  async function saveItem(itemId: number) {
    if (!canOperate) return;
    const val = editQty[itemId];
    if (val == null) return;
    const qty = Number.parseInt(val, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      return alert("Quantidade inválida.");
    }
    setSavingRow(itemId);
    try {
      const r = await fetch(`/api/requisicoes/itens/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveredQty: qty }),
      });
      const j = await safeJson(r);
      if (!r.ok) {
        throw new Error(j?.error || `Falha (HTTP ${r.status})`);
      }
      await load();
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setSavingRow(null);
    }
  }

  if (!Number.isFinite(id)) {
    return <div className="p-6 text-red-600">ID inválido.</div>;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-sm">
          <Link href="/requisicoes" className="underline">
            ← Voltar
          </Link>
        </div>

        {loading ? (
          <div className="rounded-2xl border bg-white p-6">Carregando...</div>
        ) : err ? (
          <div className="rounded-2xl border bg-white p-6 text-red-600">{err}</div>
        ) : !data ? (
          <div className="rounded-2xl border bg-white p-6">Não encontrado.</div>
        ) : (
          <>
            <header className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">
                  Requisição #{data.id}
                </h1>
                <p className="text-sm text-gray-600">
                  Status: <Badge status={data.status} />{" "}
                  {data.assignedTo?.name ? (
                    <span className="ml-2">• Responsável: {data.assignedTo.name}</span>
                  ) : null}
                </p>
                {data.note ? (
                  <p className="mt-1 text-sm text-gray-500">Obs.: {data.note}</p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {canOperate && data.status === "pending" && (
                  <button
                    onClick={assume}
                    className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                  >
                    Assumir
                  </button>
                )}
                {canOperate && data.status === "in_progress" && (
                  <button
                    onClick={conclude}
                    className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                  >
                    Concluir
                  </button>
                )}
              </div>
            </header>

            {/* Itens */}
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3">Solicitado</th>
                      <th className="px-4 py-3">Entregue</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-500" colSpan={6}>
                          Sem itens.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((it, idx) => {
                        const editable = canOperate && data.status !== "completed" && data.status !== "cancelled";
                        const current = editQty[it.id] ?? String(it.deliveredQty);
                        return (
                          <tr key={it.id} className="border-t border-gray-100">
                            <td className="px-4 py-3">#{idx + 1}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium">{it.productName ?? "-"}</div>
                              <div className="text-xs text-gray-500">
                                {it.productSku ?? ""} {it.productUnit ? `• ${it.productUnit}` : ""}
                              </div>
                            </td>
                            <td className="px-4 py-3">{it.requestedQty}</td>
                            <td className="px-4 py-3">
                              {editable ? (
                                <input
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="w-24 rounded-lg border px-2 py-1.5"
                                  value={current}
                                  onChange={(e) =>
                                    setEditQty((m) => ({ ...m, [it.id]: e.target.value }))
                                  }
                                />
                              ) : (
                                it.deliveredQty
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <SmallBadge status={it.status} />
                            </td>
                            <td className="px-4 py-3">
                              {editable ? (
                                <button
                                  onClick={() => saveItem(it.id)}
                                  disabled={savingRow === it.id}
                                  className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  {savingRow === it.id ? "Salvando..." : "Salvar"}
                                </button>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="mt-6 text-sm text-gray-500">
              Criada em {formatDate(data.createdAt)} • Atualizada em {formatDate(data.updatedAt)}
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

function Badge({ status }: { status: ReqStatus }) {
  const map: Record<ReqStatus, string> = {
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

function SmallBadge({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    partial: "bg-blue-100 text-blue-800",
    delivered: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status]}`}>
      {status === "pending"
        ? "Pendente"
        : status === "partial"
        ? "Parcial"
        : status === "delivered"
        ? "Entregue"
        : "Cancelado"}
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
  try {
    return await r.json();
  } catch {
    return null as any;
  }
}
