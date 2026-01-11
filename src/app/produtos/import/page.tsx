// src/app/produtos/import/page.tsx
"use client";

import UnitSelect from "@/components/UnitSelect";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type PreviewResp = {
  type: "csv" | "excel";
  delimiter?: string;
  stats: {
    totalRows: number;
    uniqueSkus: number;
    existInDb: number;
    newSkus: number;
    errorsCount: number;
  };
  sample: Array<{ line: number; sku: string; name: string; unit?: string; isActive?: boolean }>;
  errors: { line: number; error: string }[];
};

export default function ImportProdutosPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as "admin" | "store" | "warehouse" | undefined;
  const isAdmin = role === "admin";

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"insert" | "upsert">("upsert");
  const [delimiter, setDelimiter] = useState<"," | ";" | "">("");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  // ✅ unidade selecionada (obrigatória no import)
  const [unitId, setUnitId] = useState<number | null>(null);
  const mustPickUnit = isAdmin && !unitId;

  // preview
  const [pLoading, setPLoading] = useState(false);
  const [pErr, setPErr] = useState<string | null>(null);
  const [pResp, setPResp] = useState<PreviewResp | null>(null);

  // link do template acompanha o delimitador escolhido (se CSV)
  const templateUrl = useMemo(() => {
    const d = delimiter === ";" ? ";" : ",";
    return `/api/produtos/import/template?delimiter=${encodeURIComponent(d)}`;
  }, [delimiter]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResp(null);
    setErr(null);
    setPResp(null);
    setPErr(null);
  }

  function buildUrl(path: string) {
    const usp = new URLSearchParams();
    if (unitId) usp.set("unitId", String(unitId));
    return `${path}?${usp.toString()}`;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!isAdmin) return;

  
    if (!file) {
      setErr("Selecione um arquivo CSV ou Excel.");
      return;
    }

    if (!unitId) {
      setErr("Selecione uma unidade para importar os produtos.");
      return;
    }

    setLoading(true);
    setErr(null);
    setResp(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      if (delimiter) fd.append("delimiter", delimiter);

      const r = await fetch(buildUrl("/api/produtos/import"), {
        method: "POST",
        body: fd,
      });

      const json = await safeJson(r);
      if (!r.ok) throw new Error(json?.error || `Falha (HTTP ${r.status})`);
      setResp(json);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function onPreview() {
    if (!isAdmin) return;

    
    if (!file) {
      setPErr("Selecione um arquivo para simular.");
      return;
    }

    if (!unitId) {
      setPErr("Selecione uma unidade para simular a importação.");
      return;
    }

    setPLoading(true);
    setPErr(null);
    setPResp(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      if (delimiter) fd.append("delimiter", delimiter);

      const r = await fetch(buildUrl("/api/produtos/import/preview"), {
        method: "POST",
        body: fd,
      });

      const json = await safeJson(r);
      if (!r.ok) throw new Error(json?.error || `Falha (HTTP ${r.status})`);
      setPResp(json as PreviewResp);
    } catch (e: any) {
      setPErr(String(e?.message ?? e));
    } finally {
      setPLoading(false);
    }
  }

  if (status === "loading") return <div className="p-6">Carregando...</div>;

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border bg-white p-6 text-red-600">
            Sem permissão. Apenas <strong>Admin</strong> pode importar produtos.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 text-sm">
          <Link href="/produtos" className="underline">
            ← Voltar para Produtos
          </Link>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900">Importar Produtos (CSV/Excel)</h1>
        <p className="text-sm text-gray-600">
          Aceita <code>.csv</code>, <code>.xlsx</code> ou <code>.xls</code>. Cabeçalhos reconhecidos:
          <code> sku, name (ou nome/descrição), unit (unidade), isActive (ativo)</code>.
        </p>

        {/* Botões de modelo */}
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={templateUrl}
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
            title="Baixar modelo CSV conforme o delimitador selecionado"
            download
          >
            Baixar modelo CSV
          </a>
          <a
            href="/api/produtos/import/template?delimiter=%2C"
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
            download
          >
            Modelo CSV (vírgula)
          </a>
          <a
            href="/api/produtos/import/template?delimiter=%3B"
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
            download
          >
            Modelo CSV (;)
          </a>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border bg-white p-6">
          {/* ✅ Unidade destino */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Unidade destino</label>
            <div className="mt-1">
              <UnitSelect
                role={role}
                value={unitId}
                onChange={(v) => {
                  setUnitId(v);
                  setResp(null);
                  setErr(null);
                  setPResp(null);
                  setPErr(null);
                }}
              />
            </div>
            {mustPickUnit && (
              <div className="mt-2 text-xs text-red-600">
                Selecione uma unidade para importar/simular.
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Arquivo</label>
            <input
              type="file"
              accept=".csv, .xlsx, .xls, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              className="mt-1"
              onChange={onPick}
            />
            {file && (
              <div className="mt-2 text-xs text-gray-500">
                Selecionado: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Modo</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
              >
                <option value="upsert">Upsert (insere/atualiza por SKU)</option>
                <option value="insert">Insert (somente insere; SKUs existentes são ignorados)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Delimitador (somente CSV)
              </label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as any)}
              >
                <option value="">Auto</option>
                <option value=",">Vírgula (,)</option>
                <option value=";">Ponto e vírgula (;)</option>
              </select>
            </div>
          </div>

          {(err || pErr) && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err || pErr}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading || !file || mustPickUnit}
              className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? "Importando..." : "Importar"}
            </button>

            <button
              type="button"
              onClick={onPreview}
              disabled={pLoading || !file || mustPickUnit}
              className="rounded-xl border px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
              title="Simula o processamento sem gravar nada no banco"
            >
              {pLoading ? "Simulando..." : "Simular"}
            </button>

            <span className="text-xs text-gray-500">A sessão do admin é usada automaticamente.</span>
          </div>
        </form>

        {/* Preview */}
        {pResp && (
          <section className="mt-6 rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Preview (não grava no banco)</h2>
            <div className="mt-2 text-sm text-gray-700">
              <div>
                Tipo: <code>{pResp.type}</code>
              </div>
              {pResp.delimiter && (
                <div>
                  Delimitador: <code>{pResp.delimiter}</code>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-5 text-sm">
              <Stat label="Linhas totais" value={pResp.stats.totalRows} />
              <Stat label="SKUs únicos" value={pResp.stats.uniqueSkus} />
              <Stat label="Já existem" value={pResp.stats.existInDb} />
              <Stat label="Novos SKUs" value={pResp.stats.newSkus} />
              <Stat label="Erros" value={pResp.stats.errorsCount} />
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-900">Amostra (até 20 linhas)</h3>
              {pResp.sample.length === 0 ? (
                <div className="mt-2 text-sm text-gray-500">Sem amostra.</div>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-xl border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">Unidade</th>
                        <th className="px-3 py-2">Ativo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pResp.sample.map((s, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">#{s.line}</td>
                          <td className="px-3 py-2">{s.sku}</td>
                          <td className="px-3 py-2">{s.name}</td>
                          <td className="px-3 py-2">{s.unit ?? "UN"}</td>
                          <td className="px-3 py-2">{String(s.isActive ?? true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {pResp.errors?.length ? (
              <div className="mt-6">
                <h3 className="text-sm font-medium text-gray-900">Erros (primeiros 20)</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
                  {pResp.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Linha {e.line}: {String(e.error)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}

        {/* Resultado final da importação */}
        {resp && (
          <section className="mt-6 rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Resultado</h2>
            <div className="mt-2 text-sm text-gray-700">
              <div>
                Tipo: <code>{resp.type ?? "csv"}</code>
              </div>
              {resp.delimiter && (
                <div>
                  Delimitador: <code>{resp.delimiter}</code>
                </div>
              )}
              <div>
                Modo: <code>{resp.mode}</code>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Inseridos" value={resp.summary?.inserted ?? 0} />
              <Stat label="Atualizados" value={resp.summary?.updated ?? 0} />
              <Stat label="Ignorados" value={resp.summary?.skipped ?? 0} />
            </div>

            {resp.summary?.errors?.length ? (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-900">Erros (primeiros 20)</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
                  {resp.summary.errors.slice(0, 20).map((e: any, i: number) => (
                    <li key={i}>
                      Linha {e.line}: {String(e.error)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                Nenhum erro reportado.
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-gray-50 p-4 text-center">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}

async function safeJson(r: Response) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}
