// src/app/requisicoes/[id]/atender/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Role = "admin" | "store" | "warehouse";

type ReqItem = {
  id: number;
  productId: number;
  requestedQty: number;
  deliveredQty: number | null;
  status?: string | null;
  product?: { sku: string; name: string; unit?: string | null };
};

type ReqData = {
  id: number;
  status: "pending" | "in_progress" | "completed" | string;
  createdAt: string;
  createdByName?: string | null;
  note?: string | null;
  items: ReqItem[];
};

export default function AtenderRequisicaoPage() {
  // --- Bloco de Hooks e Estado (Atualizado) ---
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requestId = Number(params?.id);
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const canHandle = role === "warehouse" || role === "admin";

  const [req, setReq] = useState<ReqData | null>(null);
  const [loading, setLoading] = useState(true);

  // mapa: itemId -> deliveredQty (edição local)
  const [delivered, setDelivered] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const disabled = useMemo(
    () => !req || req.status === "completed" || req.status === "cancelled",
    [req],
  );

  // se você já tem "items" carregados, inicializa o mapa
  useEffect(() => {
    if (Array.isArray(req?.items) && req.items.length > 0) {
      setDelivered(
        Object.fromEntries(
          req.items.map((it: any) => [it.id, it.deliveredQty ?? 0]),
        ),
      );
    }
  }, [req]); // Depende do 'req' ser carregado

  // --- Fim: Bloco de Hooks e Estado ---

  useEffect(() => {
    if (status === "authenticated" && canHandle) {
      load();
    } else if (status === "authenticated" && !canHandle) {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canHandle, params?.id]);

  async function load() {
    setLoading(true);
    setErrMsg(null); // <- Atualizado de setErr
    try {
      const r = await fetch(`/api/requisicoes/${params.id}`, {
        cache: "no-store",
      });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      const data: ReqData = (j?.data ?? j) as ReqData;

      setReq(data);
    } catch (e: any) {
      setErrMsg(String(e?.message ?? e)); // <- Atualizado de setErr
    } finally {
      setLoading(false);
    }
  }

  // --- Bloco de Funções (Atualizado) ---

  // setter seguro para editar a quantidade entregue
  function setDeliveredQty(itemId: number, value: string, requestedQty?: number) {
    // aceita apenas dígitos; vazio vira 0
    const onlyDigits = value.replace(/\D/g, "");
    let n = onlyDigits === "" ? 0 : parseInt(onlyDigits, 10);
    if (Number.isFinite(requestedQty)) {
      // clamp: 0..requestedQty
      n = Math.max(0, Math.min(n, requestedQty as number));
    } else {
      n = Math.max(0, n);
    }
    setDelivered((prev) => ({ ...prev, [itemId]: n }));
  }

  // Função adaptada para usar 'setDelivered'
  function setFillAll(type: "zero" | "full") {
    if (!req) return;
    const next: Record<number, number> = {};
    for (const it of req.items) {
      next[it.id] = type === "zero" ? 0 : it.requestedQty;
    }
    setDelivered(next); // <- Atualizado de setQty
  }

  async function salvarParcial() {
    if (!Number.isFinite(requestId)) return;
    try {
      setSaving(true);
      setErrMsg(null);

      // monta payload com os itens que têm id conhecido
      const payloadItems = Object.entries(delivered).map(([id, qty]) => ({
        id: Number(id),
        deliveredQty: Number(qty) || 0,
      }));

      const resp = await fetch(`/api/requisicoes/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      });

      if (!resp.ok) {
        const j = await safeJson(resp);
        throw new Error(j?.error || `Falha (HTTP ${resp.status})`);
      }

      // recarrega dados
      if (typeof load === "function") {
        await load();
      } else {
        router.refresh();
      }
      alert("Quantidades salvas."); // Adicionado feedback
    } catch (e: any) {
      setErrMsg(String(e?.message ?? e));
      alert(String(e?.message ?? e)); // simples; podemos trocar por toast depois
    } finally {
      setSaving(false);
    }
  }

  async function concluir() {
    if (!Number.isFinite(requestId)) return;
    if (
      !confirm(
        "Concluir requisição? Os itens serão marcados conforme as quantidades informadas.",
      )
    )
      return;

    try {
      setSaving(true);
      setErrMsg(null);

      const resp = await fetch(`/api/requisicoes/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });

      if (!resp.ok) {
        const j = await safeJson(resp);
        throw new Error(j?.error || `Falha (HTTP ${resp.status})`);
      }

      alert("Requisição concluída!"); // Adicionado feedback

      if (typeof load === "function") {
        await load();
      } else {
        router.refresh();
      }
    } catch (e: any) {
      setErrMsg(String(e?.message ?? e));
      alert(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }
  // --- FIM: Bloco de Funções (Atualizado) ---

  if (status === "loading" || loading) {
    return <div className="p-6">Carregando...</div>;
  }
  if (!canHandle) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Almoxarifado</strong> ou{" "}
            <strong>Admin</strong> podem atender requisições.
          </div>
        </div>
      </main>
    );
  }
  if (errMsg && !req) { // <- Atualizado (só mostra erro em tela cheia se 'req' falhar)
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            {errMsg}
          </div>
        </div>
      </main>
    );
  }
  if (!req) return null;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <Link href="/requisicoes" className="underline">
              ← Voltar
            </Link>
            <Link href={`/requisicoes/${req.id}`} className="underline">
              Ver detalhes
            </Link>
          </div>
          <span className="text-gray-500">
            Req <strong>#{req.id}</strong> • Status:{" "}
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
              {labelStatus(req.status)}
            </span>
          </span>
        </div>

        {/* Cabeçalho */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-gray-500">Criado em</div>
              <div className="text-sm">{formatDate(req.createdAt)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Aberta por</div>
              <div className="text-sm">{req.createdByName ?? "-"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Observação</div>
              <div className="text-sm text-gray-700">{req.note ?? "-"}</div>
            </div>
          </div>
        </div>

        {/* Itens */}
        <section className="mt-4 rounded-2xl border bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3 text-right">Solicitada</th>
                  <th className="px-4 py-3 text-right">Entregue</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {/* CORRIGIDO: de 'items' para 'req.items' */}
                {(!req.items || req.items.length === 0) ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-gray-500"
                    >
                      Sem itens nesta requisição.
                    </td>
                  </tr>
                ) : (
                  // CORRIGIDO: de 'items.map' para 'req.items.map'
                  req.items.map((it: any) => {
                    const current = delivered[it.id] ?? it.deliveredQty ?? 0;
                    return (
                      <tr key={it.id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {it.productName ?? "-"}
                          </div>
                          <div className="text-xs text-gray-500">
                            SKU: {it.productSku ?? it.productId} • UN:{" "}
                            {it.productUnit ?? "-"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {it.requestedQty}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="w-28 rounded-lg border px-2 py-1.5 text-right"
                            value={String(current)}
                            onChange={(e) =>
                              setDeliveredQty(
                                it.id,
                                e.target.value,
                                it.requestedQty,
                              )
                            }
                            disabled={saving} // Simplificado (disabled já cobre isso)
                            title="Quantidade entregue"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " +
                              (it.status === "delivered"
                                ? "bg-green-100 text-green-800"
                                : it.status === "partial"
                                  ? "bg-blue-100 text-blue-800"
                                  : it.status === "cancelled"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-yellow-100 text-yellow-800")
                            }
                          >
                            {it.status === "delivered"
                              ? "Entregue"
                              : it.status === "partial"
                                ? "Parcial"
                                : it.status === "cancelled"
                                  ? "Cancelado"
                                  : "Pendente"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
        
        {/* --- INÍCIO DO BLOCO ADICIONADO --- */}
        {/* (Substitui o bloco 'Ações em lote' antigo) */}

        {/* Feedback de erro simples */}
        {errMsg && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errMsg}
          </div>
        )}

        {/* Ações */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={salvarParcial}
            // CORRIGIDO: de 'items' para 'req.items'
            disabled={saving || !req.items || req.items.length === 0}
            className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
            title="Grava entregas parciais (baixa apenas o delta em estoque)"
          >
            {saving ? "Salvando..." : "Salvar parcial"}
          </button>

          <button
            onClick={concluir}
            // CORRIGIDO: de 'items' para 'req.items'
            disabled={saving || !req.items || req.items.length === 0}
            className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-60"
            title="Concluir requisição (exige 100% entregue)"
          >
            {saving ? "Concluindo..." : "Concluir requisição"}
          </button>
        </div>
        {/* --- FIM DO BLOCO ADICIONADO --- */}
        
      </div>
    </main>
  );
}

/* ---------- helpers ---------- */

function labelStatus(s: string) {
  if (s === "pending") return "Pendente";
  if (s === "in_progress") return "Em Progresso";
  if (s === "completed") return "Concluída";
  if (s === "cancelled") return "Cancelada";
  return s;
}
function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ATUALIZADO: safeJson
async function safeJson(r: Response) {
  try {
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) return null;
    return await r.json();
  } catch {
    return null;
  }
}