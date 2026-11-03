// src/app/produtos/import/page.tsx
// Importação por COLUNAS: envie a planilha inteira, escolha as colunas (padrão: A = SKU, B = nome, H = unidade).
// A planilha é lida no próprio navegador; só os 3 campos escolhidos vão para o servidor, em lotes.
"use client";

import UnitSelect from "@/components/UnitSelect";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button, Card, PageHeader } from "@/components/ui";
import {
  DEFAULT_MAPPING,
  colLetter,
  columnCount,
  loadSpreadsheet,
  mapGrid,
  type LoadedSpreadsheet,
  type Mapping,
} from "@/lib/spreadsheet";

const CHUNK = 5000; // linhas por requisição (bem abaixo do limite de corpo da Vercel)
const STORAGE_KEY = "importProdutos:colunas:v1";

type Totals = {
  existInDb: number;
  newSkus: number;
  inserted: number;
  updated: number;
  skipped: number;
  serverErrors: { line: number; error: string }[];
};
const ZERO: Totals = { existInDb: 0, newSkus: 0, inserted: 0, updated: 0, skipped: 0, serverErrors: [] };

export default function ImportProdutosPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: "admin" | "store" | "warehouse" } | undefined)?.role;
  const isAdmin = role === "admin";

  const [unitId, setUnitId] = useState<number | null>(null);
  const [mode, setMode] = useState<"insert" | "upsert">("upsert");

  // arquivo
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<LoadedSpreadsheet | null>(null);
  const [sheet, setSheet] = useState("");
  const [delimiter, setDelimiter] = useState("");
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);

  // mapeamento
  const [mapping, setMapping] = useState<Mapping>(DEFAULT_MAPPING);
  const [hasHeader, setHasHeader] = useState(true);
  const [prefsReady, setPrefsReady] = useState(false);

  // execução
  const [phase, setPhase] = useState<"idle" | "simulating" | "importing" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sim, setSim] = useState<Totals | null>(null);
  const [result, setResult] = useState<Totals | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // lembra a última escolha de colunas neste navegador
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { mapping?: Mapping; hasHeader?: boolean };
        /* eslint-disable react-hooks/set-state-in-effect */
        if (p.mapping?.sku && p.mapping?.name) setMapping({ sku: p.mapping.sku, name: p.mapping.name, unit: p.mapping.unit ?? "" });
        if (typeof p.hasHeader === "boolean") setHasHeader(p.hasHeader);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      /* sem localStorage: usa o padrão */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefsReady(true);
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mapping, hasHeader }));
    } catch {
      /* ignora */
    }
  }, [mapping, hasHeader, prefsReady]);

  const grid = useMemo(() => (loaded && sheet ? loaded.grid(sheet) : []), [loaded, sheet]);
  const cols = useMemo(() => Math.min(52, Math.max(columnCount(grid), 8)), [grid]);
  const mapped = useMemo(() => mapGrid(grid, mapping, hasHeader), [grid, mapping, hasHeader]);

  function resetRun() {
    setPhase("idle");
    setSim(null);
    setResult(null);
    setRunErr(null);
    setProgress({ done: 0, total: 0 });
  }

  async function readFile(f: File, delim: string) {
    setReading(true);
    setReadErr(null);
    resetRun();
    try {
      const ss = await loadSpreadsheet(f, delim || undefined);
      setLoaded(ss);
      setSheet(ss.sheets[0] ?? "");
    } catch (e) {
      setLoaded(null);
      setSheet("");
      setReadErr(`Não consegui ler a planilha: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setReading(false);
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setLoaded(null);
    setSheet("");
    resetRun();
    if (f) await readFile(f, delimiter);
  }

  async function onDelimiter(v: string) {
    setDelimiter(v);
    if (file) await readFile(file, v);
  }

  async function send(dryRun: boolean) {
    if (!unitId || mapped.rows.length === 0) return;
    setRunErr(null);
    setPhase(dryRun ? "simulating" : "importing");
    if (dryRun) setSim(null);
    else setResult(null);

    const total = Math.ceil(mapped.rows.length / CHUNK);
    setProgress({ done: 0, total });
    const importId = Math.random().toString(36).slice(2, 10);
    const acc: Totals = { ...ZERO, serverErrors: [] };

    try {
      for (let i = 0; i < total; i++) {
        const part = mapped.rows.slice(i * CHUNK, (i + 1) * CHUNK);
        const r = await fetch("/api/produtos/import/rows", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            unitId,
            mode,
            dryRun,
            importId,
            part: { index: i + 1, total },
            rows: part.map((p) => ({ line: p.line, sku: p.sku, name: p.name, unit: p.unit })),
          }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) {
          const ok = i; // lotes anteriores já foram gravados
          throw new Error(
            `${j?.error || `Falha (HTTP ${r.status})`}` +
              (!dryRun && ok > 0
                ? ` — os lotes 1 a ${ok} de ${total} já foram gravados. É seguro enviar de novo: o que já existe não duplica.`
                : ""),
          );
        }
        acc.existInDb += j.existInDb ?? 0;
        acc.newSkus += j.newSkus ?? 0;
        acc.inserted += j.inserted ?? 0;
        acc.updated += j.updated ?? 0;
        acc.skipped += j.skipped ?? 0;
        if (Array.isArray(j.errors)) acc.serverErrors.push(...j.errors);
        setProgress({ done: i + 1, total });
      }
      if (dryRun) setSim(acc);
      else setResult(acc);
      setPhase(dryRun ? "idle" : "done");
    } catch (e) {
      setRunErr(String((e as Error)?.message ?? e));
      setPhase("idle");
    }
  }

  function onImport() {
    if (!unitId) return;
    const ok = window.confirm(
      `Importar ${mapped.rows.length.toLocaleString("pt-BR")} produtos na unidade selecionada (modo ${mode === "upsert" ? "atualizar/inserir" : "somente inserir"})?`,
    );
    if (ok) void send(false);
  }

  if (status === "loading") return <div className="p-6">Carregando...</div>;
  if (!isAdmin) {
    return (
      <main className="p-6">
        <Card className="mx-auto max-w-3xl p-6 text-red-600">
          Sem permissão. Apenas <strong>Admin</strong> pode importar produtos.
        </Card>
      </main>
    );
  }

  const busy = phase === "simulating" || phase === "importing";
  const mustPickUnit = !unitId;
  const letters = Array.from({ length: cols }, (_, i) => colLetter(i));
  const optLabel = (i: number) => {
    const sample = String(grid[0]?.[i] ?? "").trim();
    return `${colLetter(i)}${sample ? ` — ${sample.length > 26 ? sample.slice(0, 26) + "…" : sample}` : ""}`;
  };
  const sel = "mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-3 text-sm">
        <Link href="/produtos" className="underline">
          ← Voltar para Produtos
        </Link>
      </div>

      <PageHeader
        title="Importar produtos"
        subtitle={
          <>
            Envie a planilha <strong>inteira</strong> (.xlsx, .xls ou .csv) e escolha só as colunas que importam. Padrão:{" "}
            <strong>A</strong> = SKU, <strong>B</strong> = nome, <strong>H</strong> = unidade.
          </>
        }
      />

      <Card className="space-y-5 p-5">
        {/* 1. unidade e arquivo */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">1. Unidade destino</label>
            <div className="mt-1">
              <UnitSelect
                role={role}
                value={unitId}
                onChange={(v) => {
                  setUnitId(v);
                  resetRun();
                }}
              />
            </div>
            {mustPickUnit && <div className="mt-1 text-xs text-red-600">Escolha a unidade para importar.</div>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">2. Planilha</label>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="mt-1 block w-full text-sm"
              onChange={onPick}
            />
            {file && (
              <div className="mt-1 text-xs text-gray-500">
                {file.name} ({file.size >= 1_048_576 ? `${(file.size / 1_048_576).toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`})
                {reading ? " — lendo…" : ""}
              </div>
            )}
          </div>
        </div>

        {readErr && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{readErr}</div>}

        {loaded && (
          <>
            {/* 2. escolha das colunas */}
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
                <span className="font-medium">3. Colunas</span>
                <span className="text-xs text-gray-500">
                  {grid.length.toLocaleString("pt-BR")} linhas · {columnCount(grid)} colunas
                </span>
                <span className="flex gap-2 text-xs">
                  <button type="button" className="underline" onClick={() => setMapping({ sku: "A", name: "B", unit: "H" })}>
                    Usar A, B, H
                  </button>
                  <button type="button" className="underline" onClick={() => setMapping({ sku: "A", name: "B", unit: "C" })}>
                    Usar A, B, C (modelo simples)
                  </button>
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <label className="text-xs text-gray-600">
                  SKU (código)
                  <select className={sel} value={mapping.sku} onChange={(e) => (setMapping((m) => ({ ...m, sku: e.target.value })), resetRun())}>
                    {letters.map((l, i) => (
                      <option key={l} value={l}>
                        {optLabel(i)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Nome do produto
                  <select className={sel} value={mapping.name} onChange={(e) => (setMapping((m) => ({ ...m, name: e.target.value })), resetRun())}>
                    {letters.map((l, i) => (
                      <option key={l} value={l}>
                        {optLabel(i)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Unidade (UN, CX…)
                  <select className={sel} value={mapping.unit} onChange={(e) => (setMapping((m) => ({ ...m, unit: e.target.value })), resetRun())}>
                    <option value="">(não usar — todas “UN”)</option>
                    {letters.map((l, i) => (
                      <option key={l} value={l}>
                        {optLabel(i)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-2 text-xs text-gray-600">
                  <label className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      checked={hasHeader}
                      onChange={(e) => (setHasHeader(e.target.checked), resetRun())}
                      className="h-4 w-4 accent-brand-800"
                    />
                    1ª linha é cabeçalho
                  </label>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {loaded.sheets.length > 1 && (
                  <label className="text-xs text-gray-600">
                    Aba da planilha
                    <select className={sel} value={sheet} onChange={(e) => (setSheet(e.target.value), resetRun())}>
                      {loaded.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {loaded.kind === "csv" && (
                  <label className="text-xs text-gray-600">
                    Separador do CSV
                    <select className={sel} value={delimiter} onChange={(e) => void onDelimiter(e.target.value)}>
                      <option value="">Automático ({loaded.delimiter === ";" ? "ponto e vírgula" : loaded.delimiter === "\t" ? "tab" : "vírgula"})</option>
                      <option value=",">Vírgula (,)</option>
                      <option value=";">Ponto e vírgula (;)</option>
                      <option value="&#9;">Tab</option>
                    </select>
                  </label>
                )}
                <label className="text-xs text-gray-600">
                  Modo
                  <select className={sel} value={mode} onChange={(e) => (setMode(e.target.value as "insert" | "upsert"), resetRun())}>
                    <option value="upsert">Atualizar e inserir (por SKU)</option>
                    <option value="insert">Somente inserir (SKUs existentes são ignorados)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* amostra da planilha com as colunas escolhidas em destaque */}
            <div>
              <div className="mb-1 text-xs text-gray-500">As primeiras linhas da planilha (colunas escolhidas em destaque):</div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="px-2 py-1.5 text-left font-normal">#</th>
                      {letters.slice(0, Math.min(cols, 14)).map((l) => (
                        <th
                          key={l}
                          className={`px-2 py-1.5 text-left font-semibold ${
                            l === mapping.sku || l === mapping.name || l === mapping.unit ? "bg-brand-100 text-brand-900" : ""
                          }`}
                        >
                          {l}
                          {l === mapping.sku ? " · SKU" : l === mapping.name ? " · Nome" : l === mapping.unit ? " · Unid." : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.slice(0, 6).map((row, ri) => (
                      <tr key={ri} className={`border-t ${hasHeader && ri === 0 ? "bg-gray-50 font-medium text-gray-500" : ""}`}>
                        <td className="px-2 py-1 text-gray-400">{ri + 1}</td>
                        {letters.slice(0, Math.min(cols, 14)).map((l, ci) => (
                          <td
                            key={l}
                            className={`max-w-[14rem] truncate px-2 py-1 ${
                              l === mapping.sku || l === mapping.name || l === mapping.unit ? "bg-brand-50" : ""
                            }`}
                            title={String(row[ci] ?? "")}
                          >
                            {String(row[ci] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* resultado do mapeamento (local) */}
            <div>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <Stat label="Produtos a importar" value={mapped.rows.length} tone="ok" />
                <Stat label="Linhas com problema" value={mapped.errors.length} tone={mapped.errors.length ? "bad" : undefined} />
                <Stat label="Linhas vazias ignoradas" value={mapped.ignored} />
                <Stat label="Linhas lidas" value={mapped.considered + mapped.ignored} />
              </div>

              {mapped.rows.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-xl border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">Unidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapped.rows.slice(0, 8).map((r) => (
                        <tr key={r.line} className="border-t">
                          <td className="px-3 py-1.5 text-gray-400">#{r.line}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.sku}</td>
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5">{r.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {mapped.errors.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-red-700">
                    {mapped.errors.length} linha(s) com problema — essas não serão importadas (ver as 20 primeiras)
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-red-700">
                    {mapped.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>
                        {e.line ? `Linha ${e.line}: ` : ""}
                        {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* ações */}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button onClick={onImport} disabled={busy || mustPickUnit || mapped.rows.length === 0}>
                {phase === "importing" ? `Importando… ${progress.done}/${progress.total}` : `Importar ${mapped.rows.length.toLocaleString("pt-BR")} produtos`}
              </Button>
              <Button
                variant="outline"
                onClick={() => void send(true)}
                disabled={busy || mustPickUnit || mapped.rows.length === 0}
                title="Mostra quantos já existem e quantos são novos, sem gravar nada"
              >
                {phase === "simulating" ? `Simulando… ${progress.done}/${progress.total}` : "Simular (não grava)"}
              </Button>
              {busy && (
                <div className="h-2 w-40 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-brand-600 transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {runErr && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{runErr}</div>}
      </Card>

      {sim && (
        <Card className="mt-5 p-5">
          <h2 className="text-base font-semibold text-gray-900">Simulação (nada foi gravado)</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat label="Já existem na unidade" value={sim.existInDb} />
            <Stat label="Produtos novos" value={sim.newSkus} tone="ok" />
            <Stat label={mode === "upsert" ? "Seriam atualizados" : "Seriam ignorados"} value={mode === "upsert" ? sim.updated : sim.skipped} />
          </div>
          {sim.serverErrors.length > 0 && <ErrorList errors={sim.serverErrors} />}
        </Card>
      )}

      {result && (
        <Card className="mt-5 p-5">
          <h2 className="text-base font-semibold text-gray-900">Importação concluída</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat label="Inseridos" value={result.inserted} tone="ok" />
            <Stat label="Atualizados" value={result.updated} />
            <Stat label="Ignorados" value={result.skipped} />
          </div>
          {result.serverErrors.length > 0 ? (
            <ErrorList errors={result.serverErrors} />
          ) : (
            <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">Nenhum erro reportado pelo servidor.</div>
          )}
        </Card>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "ok" ? "text-brand-700" : "text-gray-900";
  return (
    <div className="rounded-xl border bg-gray-50 p-3 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value.toLocaleString("pt-BR")}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}

function ErrorList({ errors }: { errors: { line: number; error: string }[] }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium text-gray-900">Problemas apontados pelo servidor (primeiros 20)</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-700">
        {errors.slice(0, 20).map((e, i) => (
          <li key={i}>
            Linha {e.line}: {e.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
