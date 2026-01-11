// src/app/produtos/novo/page.tsx
"use client";

import UnitSelect from "@/components/UnitSelect";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Role = "admin" | "store" | "warehouse";

export default function NovoProdutoPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;

  const router = useRouter();
  const searchParams = useSearchParams();

  const canCreate = role === "admin";

  // ✅ unidade
  const [unitId, setUnitId] = useState<number | null>(null);

  // campos
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("UN");
  const [isActive, setIsActive] = useState(true);
  const [stock, setStock] = useState<string>("0");

  // ui
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ✅ tenta pré-preencher unitId vindo da URL (?unitId=4)
  useEffect(() => {
    if (status !== "authenticated") return;

    const fromUrl = searchParams.get("unitId");
    if (fromUrl) {
      const n = Number(fromUrl);
      if (Number.isFinite(n) && n > 0) setUnitId(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const stockNumber = useMemo(() => {
    const n = Number(stock);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }, [stock]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!canCreate) {
      setErr("Sem permissão. Apenas Admin pode criar produtos.");
      return;
    }

    if (!unitId) {
      setErr("Selecione uma unidade para cadastrar o produto.");
      return;
    }

    if (!sku.trim() || !name.trim()) {
      setErr("Informe SKU e Nome.");
      return;
    }

    setSaving(true);
    try {
      const r = await fetch("/api/produtos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitId,
          sku: sku.trim(),
          name: name.trim(),
          unit: (unit || "UN").trim(),
          isActive,
          stock: stockNumber,
        }),
      });

      const j = await safeJson(r);

      if (!r.ok) {
        throw new Error(j?.error || `Falha (HTTP ${r.status})`);
      }

      alert("Produto criado com sucesso!");
      router.push(`/produtos?unitId=${unitId}`);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") return <div className="p-6">Carregando...</div>;

  if (!canCreate) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Admin</strong> pode criar produtos.
          </div>
          <div className="mt-4">
            <Link href="/produtos" className="underline text-sm">
              ← Voltar
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between text-sm">
          <Link href="/produtos" className="underline">
            ← Voltar
          </Link>
          <span className="text-xs text-gray-500">Novo Produto</span>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-gray-900">Cadastrar produto</h1>
          <p className="mt-1 text-sm text-gray-500">
            Selecione a unidade e preencha SKU e nome.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {/* ✅ Unidade */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Unidade</label>
              <div className="mt-1 max-w-md">
                <UnitSelect
                  role={role}
                  value={unitId}
                  onChange={(v) => setUnitId(v)}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Este produto será criado dentro da unidade selecionada.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">SKU</label>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Ex.: 123456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Unidade (UN, CX...)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="UN"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Nome</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do produto"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Estoque (opcional)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="0"
                />
              </div>

              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  Ativo
                </label>
              </div>
            </div>

            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar produto"}
              </button>

              <Link
                href="/produtos"
                className="rounded-xl border px-4 py-2 hover:bg-gray-50"
              >
                Cancelar
              </Link>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

async function safeJson(r: Response) {
  // Robusto p/ respostas sem corpo ou não-JSON
  if (r.status === 204 || r.status === 205 || r.status === 304) return null as any;
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("application/json")) return null as any;
  const txt = await r.text();
  if (!txt) return null as any;
  try {
    return JSON.parse(txt);
  } catch {
    return null as any;
  }
}
