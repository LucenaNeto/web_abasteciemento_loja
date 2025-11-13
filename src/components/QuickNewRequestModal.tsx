// src/components/QuickNewRequestModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ResolvedProduct = { id: number; sku: string; name: string; unit: string | null };

type Row = {
  productCode: string; // string p/ preservar zeros à esquerda
  qty: string;         // mantemos como string durante edição
  resolving?: boolean;
  error?: string | null;
  product?: ResolvedProduct | null;
};

export default function QuickNewRequestModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([{ productCode: "", qty: "" }]);
  const [saving, setSaving] = useState(false);

  function addRow() {
    setRows((r) => [...r, { productCode: "", qty: "" }]);
  }
  function removeRow(i: number) {
    setRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((r) => {
      const next = [...r];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  async function resolveRow(i: number) {
    const code = rows[i].productCode.trim();
    if (!code) {
      setRow(i, { error: "Informe SKU ou ID.", product: null });
      return;
    }
    setRow(i, { resolving: true, error: null });
    try {
      const resp = await fetch(`/api/produtos/resolve?code=${encodeURIComponent(code)}`, {
        headers: { "cache-control": "no-store" },
      });
      const data = await safeJson(resp);
      if (!resp.ok) throw new Error(data?.error || `Falha (HTTP ${resp.status})`);
      setRow(i, { product: data.data as ResolvedProduct, error: null });
    } catch (e: any) {
      setRow(i, { error: String(e?.message ?? e), product: null });
    } finally {
      setRow(i, { resolving: false });
    }
  }

  function mergeItems(rows: Row) {}

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();

    // valida e resolve o que faltar
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.product || r.error) {
        await resolveRow(i);
      }
    }

    // valida final
    const problems: string[] = [];
    const valid = rows
      .map((r, idx) => {
        const qty = parseInt(r.qty, 10);
        if (!r.product) problems.push(`Linha ${idx + 1}: produto inválido.`);
        if (!Number.isFinite(qty) || qty <= 0) problems.push(`Linha ${idx + 1}: quantidade inválida.`);
        return r.product && Number.isFinite(qty) && qty > 0
          ? { productId: r.product.id, requestedQty: qty }
          : null;
      })
      .filter(Boolean) as { productId: number; requestedQty: number }[];

    if (problems.length) {
      alert("Corrija os itens antes de salvar:\n\n" + problems.join("\n"));
      return;
    }

    // agrupa duplicados (mesmo produto somado)
    const grouped = new Map<number, number>();
    for (const it of valid) {
      grouped.set(it.productId, (grouped.get(it.productId) ?? 0) + it.requestedQty);
    }
    const items = Array.from(grouped.entries()).map(([productId, requestedQty]) => ({
      productId,
      requestedQty,
    }));

    setSaving(true);
    try {
      const resp = await fetch("/api/requisicoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined, items }),
      });
      const j = await safeJson(resp);
      if (!resp.ok) throw new Error(j?.error || `Falha (HTTP ${resp.status})`);

      const id = j?.data?.id ?? j?.id;
      alert("Requisição criada!");
      setOpen(false);
      setRows([{ productCode: "", qty: "" }]);
      setNote("");
      if (id) router.push(`/requisicoes/${id}`);
    } catch (e: any) {
      alert(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Botão gatilho (substitui o antigo) */}
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
      >
        Nova Requisição
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Nova Requisição</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {/* Observação */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Observação</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="ex.: reposição loja 01"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {/* Itens */}
              <div className="rounded-2xl border">
                <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-600">
                  <span>Itens</span>
                  <span>Dica: digite <strong>SKU</strong> (ex.: 01004) ou <strong>ID</strong>.</span>
                </div>

                <div className="divide-y">
                  {rows.map((r, i) => (
                    <div key={i} className="grid gap-2 p-3 sm:grid-cols-[1.5fr_1fr_auto]">
                      {/* SKU ou ID */}
                      <div>
                        <div className="text-xs text-gray-600 mb-1">SKU ou ID</div>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="\d*|[A-Za-z0-9\-_.]+"
                          className={`w-full rounded-xl border px-3 py-2 ${r.error ? "border-red-500" : ""}`}
                          placeholder="ex.: 01004"
                          value={r.productCode}
                          onChange={(e) => setRow(i, { productCode: e.target.value.replace(/[^\w\-_.]/g, ""), product: null, error: null })}
                          onBlur={() => resolveRow(i)}
                        />
                        <div className="mt-1 text-xs text-gray-500">
                          {r.resolving ? "Resolvendo..." : r.product
                            ? <span className="text-gray-700">✔ {r.product.sku} — {r.product.name} ({r.product.unit ?? "UN"})</span>
                            : r.error ? <span className="text-red-600">{r.error}</span> : null}
                        </div>
                      </div>

                      {/* Quantidade */}
                      <div>
                        <div className="text-xs text-gray-600 mb-1">Qtd solicitada</div>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="\d*"
                          className="w-full rounded-xl border px-3 py-2"
                          placeholder="ex.: 5"
                          value={r.qty}
                          onChange={(e) => setRow(i, { qty: e.target.value.replace(/[^\d]/g, "") })}
                        />
                      </div>

                      {/* Ações linha */}
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={() => resolveRow(i)}
                          className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                        >
                          Resolver
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                          disabled={rows.length === 1}
                          title={rows.length === 1 ? "Mantenha ao menos um item" : "Remover linha"}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    type="button"
                    onClick={addRow}
                    className="rounded-xl border px-3 py-2 hover:bg-gray-50"
                  >
                    + Adicionar item
                  </button>
                </div>
              </div>

              {/* Rodapé */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl border px-4 py-2 hover:bg-gray-50"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Helpers ---------- */

async function safeJson(r: Response) {
  // Trata 204/sem corpo e tipos não-JSON
  if (r.status === 204 || r.status === 205 || r.status === 304) return null;
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("application/json")) return null;
  const txt = await r.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
