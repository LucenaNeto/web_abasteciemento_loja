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
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const canHandle = role === "warehouse" || role === "admin";

  const [req, setReq] = useState<ReqData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // edição local das quantidades
  const [qty, setQty] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const disabled = useMemo(() => !req || req.status === "completed", [req]);

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
    setErr(null);
    try {
      const r = await fetch(`/api/requisicoes/${params.id}`, { cache: "no-store" });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      const data: ReqData = (j?.data ?? j) as ReqData;

      // normaliza quantidades locais (default = delivered || requested)
      const initial: Record<number, number> = {};
      for (const it of data.items ?? []) {
        const d = (it.deliveredQty ?? undefined);
        initial[it.id] = Number.isFinite(d as any) ? (d as number) : it.requestedQty;
      }

      setReq(data);
      setQty(initial);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function setItemQty(itemId: number, value: string) {
    const n = Number.parseInt(value, 10);
    setQty((m) => ({
      ...m,
      [itemId]: Number.isFinite(n) && n >= 0 ? n : 0,
    }));
  }

  function setFillAll(type: "zero" | "full") {
    if (!req) return;
    const next: Record<number, number> = {};
    for (const it of req.items) {
      next[it.id] = type === "zero" ? 0 : it.requestedQty;
    }
    setQty(next);
  }

  async function salvarParciais() {
    if (!req) return;
    setSaving(true);
    try {
      const body = {
        items: req.items.map((it) => ({
          id: it.id,
          deliveredQty: clamp(qty[it.id], 0, it.requestedQty),
        })),
      };

      // 1ª tentativa: rota dedicada /items
      let resp = await fetch(`/api/requisicoes/${req.id}/items`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      // fallback: PATCH no próprio /:id
      if (resp.status === 404) {
        resp = await fetch(`/api/requisicoes/${req.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const j = await maybeJson(resp); // trata 204/sem JSON
      if (!resp.ok) throw new Error(j?.error || `Falha (HTTP ${resp.status})`);

      await load();
      alert("Quantidades salvas.");
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function concluir() {
    if (!req) return;
    if (!confirm("Concluir requisição? Os itens serão marcados conforme as quantidades informadas.")) return;

    setSaving(true);
    try {
      const body = {
        status: "completed",
        items: req.items.map((it) => ({
          id: it.id,
          deliveredQty: clamp(qty[it.id], 0, it.requestedQty),
        })),
      };

      // 1ª tentativa: endpoint dedicado
      let resp = await fetch(`/api/requisicoes/${req.id}/complete`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      // fallback: PATCH no /:id (status + items)
      if (resp.status === 404) {
        resp = await fetch(`/api/requisicoes/${req.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const j = await maybeJson(resp); // trata 204/sem JSON
      if (!resp.ok) throw new Error(j?.error || `Falha (HTTP ${resp.status})`);

      alert("Requisição concluída!");
      router.push(`/requisicoes/${req.id}`);
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || loading) {
    return <div className="p-6">Carregando...</div>;
  }
  if (!canHandle) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Almoxarifado</strong> ou <strong>Admin</strong> podem atender requisições.
          </div>
        </div>
      </main>
    );
  }
  if (err) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">{err}</div>
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
            <Link href="/requisicoes" className="underline">← Voltar</Link>
            <Link href={`/requisicoes/${req.id}`} className="underline">Ver detalhes</Link>
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
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Un.</th>
                  <th className="px-4 py-3">Solicitado</th>
                  <th className="px-4 py-3">Entregue</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {req.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-4 py-3">{it.product?.sku}</td>
                    <td className="px-4 py-3">{it.product?.name}</td>
                    <td className="px-4 py-3">{it.product?.unit ?? "UN"}</td>
                    <td className="px-4 py-3">{it.requestedQty}</td>
                    <td className="px-4 py-3">
                      <input
                        className="w-28 rounded-lg border px-2 py-1.5"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={disabled}
                        value={String(qty[it.id] ?? 0)}
                        onChange={(e) => setItemQty(it.id, e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          disabled={disabled}
                          onClick={() => setQty((m) => ({ ...m, [it.id]: 0 }))}
                          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Zerar
                        </button>
                        <button
                          disabled={disabled}
                          onClick={() => setQty((m) => ({ ...m, [it.id]: it.requestedQty }))}
                          className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Completar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ações em lote */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex gap-2">
              <button
                disabled={disabled}
                onClick={() => setFillAll("zero")}
                className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
              >
                Zerar tudo
              </button>
              <button
                disabled={disabled}
                onClick={() => setFillAll("full")}
                className="rounded-lg border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
              >
                Completar tudo
              </button>
            </div>

            <div className="flex gap-2">
              <button
                disabled={disabled || saving}
                onClick={salvarParciais}
                className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
                title="Salva quantidades sem concluir a requisição"
              >
                {saving ? "Salvando..." : "Salvar parciais"}
              </button>
              <button
                disabled={disabled || saving}
                onClick={concluir}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? "Concluindo..." : "Concluir requisição"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ---------- helpers ---------- */

function clamp(n: any, min: number, max: number) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}
function labelStatus(s: string) {
  if (s === "pending") return "Pendente";
  if (s === "in_progress") return "Em Progresso";
  if (s === "completed") return "Concluída";
  return s;
}
function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
async function safeJson(r: Response) {
  // Robusto para respostas que não são JSON
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
  // Alias semântico para operações PATCH/DELETE que podem devolver 204
  return safeJson(r);
}
