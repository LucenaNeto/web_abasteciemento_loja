"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

type Role = "admin" | "store" | "warehouse";

type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string | null;
  isActive: boolean | 0 | 1;
  stock: number | null;
  unitId?: number;   // drizzle costuma retornar assim
  unit_id?: number;  // fallback
};

export default function EditarProdutoPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;

  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const productId = useMemo(() => {
    const n = Number(params?.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params]);

  const unitIdFromQuery = useMemo(() => {
    const raw = searchParams.get("unitId");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  const canEdit = role === "admin";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("UN");
  const [stock, setStock] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);

  function backHref() {
    // volta mantendo o contexto da unidade, se tiver
    return unitIdFromQuery ? `/produtos?unitId=${unitIdFromQuery}` : "/produtos";
  }

  async function load() {
    if (!productId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/produtos/${productId}`, { cache: "no-store" });
      const j = await safeJson(r);

      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      const p: Product = j?.data;

      setSku(p.sku ?? "");
      setName(p.name ?? "");
      setUnit((p.unit ?? "UN").toString());
      setStock(Number(p.stock ?? 0));
      setIsActive(p.isActive === true || p.isActive === 1);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) return;

    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/produtos/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          unit: unit.trim() || "UN",
          stock: Number.isFinite(stock) ? stock : 0,
          isActive,
        }),
      });

      const j = await safeJson(r);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);

      alert("Produto atualizado!");
      router.push(backHref());
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!canEdit) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canEdit, productId]);

  if (status === "loading") return <div className="p-6">Carregando...</div>;

  if (!canEdit) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-xl rounded-2xl border bg-white p-6 text-red-600">
          Sem permissão. Apenas <strong>Admin</strong> pode editar produtos.
          <div className="mt-4">
            <Link href="/produtos" className="underline text-sm">← Voltar</Link>
          </div>
        </div>
      </main>
    );
  }

  if (!productId) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-xl rounded-2xl border bg-white p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
            Parâmetro de produto inválido.
          </div>
          <div className="mt-4">
            <Link href="/produtos" className="underline text-sm">← Voltar</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-center justify-between text-sm">
          <Link href={backHref()} className="underline">← Voltar</Link>
          <span className="text-xs text-gray-500">Editar Produto #{productId}</span>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          {err && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
              {err}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-gray-600">Carregando produto...</div>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">SKU</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Nome</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Unidade</label>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="UN"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Estoque</label>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2"
                    inputMode="numeric"
                    value={String(stock)}
                    onChange={(e) => setStock(Number(e.target.value || 0))}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Ativo
              </label>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
                <span className="text-xs text-gray-500">
                  Alterações valem para produto importado ou criado.
                </span>
              </div>
            </form>
          )}
        </section>
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
