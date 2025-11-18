// src/app/relatorios/requisicoes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Totals = {
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  all: number;
};
type ByDay = { day: string; count: number };
type ApiResp = {
  data?: {
    range: { from: string; to: string };
    totals: Totals;
    byDay: ByDay[];
  } | null;
  error?: string;
};

export default function RelatorioRequisicoesPage() {
  // período (AAAA-MM-DD)
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  // dados
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [byDay, setByDay] = useState<ByDay[]>([]);

  // inicia com últimos 30 dias
  useEffect(() => {
    const today = isoDate(new Date());
    const d30 = isoDate(daysAgo(29));
    setFrom(d30);
    setTo(today);
  }, []);

  const query = useMemo(() => {
    const usp = new URLSearchParams();
    if (from) usp.set("from", from);
    if (to) usp.set("to", to);
    return usp.toString();
  }, [from, to]);

  async function load() {
    if (!from || !to) return;

    setLoading(true);
    setErr(null);

    try {
      const resp = await fetch(`/api/relatorios/requisicoes?${query}`, {
        cache: "no-store",
      });

      const j = (await safeJson(resp)) as ApiResp | null;

      // se HTTP não for OK, tenta usar a mensagem de erro da API
      if (!resp.ok) {
        const msgFromApi = j?.error || `Falha (HTTP ${resp.status})`;
        throw new Error(msgFromApi);
      }

      // aqui tratamos o caso em que o corpo veio vazio ou "null"
      if (!j || !j.data) {
        // limpa os dados da tela e mostra mensagem amigável
        setTotals(null);
        setByDay([]);
        throw new Error("Resposta inválida da API (sem dados).");
      }

      // se chegou aqui, temos dados válidos
      setTotals(j.data.totals ?? null);
      setByDay(j.data.byDay ?? []);
    } catch (e: any) {
      console.error(e);
      setErr(String(e?.message ?? e));
      // garante que não fica nada “velho” na tela após erro
      setTotals(null);
      setByDay([]);
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    if (from && to) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function quick(days: number) {
    setFrom(isoDate(daysAgo(days - 1)));
    setTo(isoDate(new Date()));
  }

  // sparkline
  const counts = byDay.map((d) => d.count);
  const path = buildSparklinePath(counts, 600, 120, 8);

  // ----- Exportações -----
  function exportTotalsCSV() {
    if (!totals) return;
    const rows: (string | number)[][] = [
      ["status", "count"],
      ["pending", totals.pending],
      ["in_progress", totals.in_progress],
      ["completed", totals.completed],
      ["cancelled", totals.cancelled],
      ["all", totals.all],
    ];
    const name = `requisicoes_totais_${(from || "").replaceAll(
      "-",
      "",
    )}-${(to || "").replaceAll("-", "")}.csv`;
    downloadCSV(name, rows);
  }

  function exportDailyCSV() {
    const rows: (string | number)[][] = [
      ["day", "count"],
      ...byDay.map((r) => [r.day, r.count]),
    ];
    const name = `requisicoes_serie_${(from || "").replaceAll(
      "-",
      "",
    )}-${(to || "").replaceAll("-", "")}.csv`;
    downloadCSV(name, rows);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-sm">
          <Link href="/" className="underline">
            ← Início
          </Link>
        </div>

        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Relatório — Requisições
            </h1>
            <p className="text-sm text-gray-600">
              Totais por status e série diária no período selecionado.
            </p>
          </div>
        </header>

        {/* Filtros */}
        <section className="mt-6 rounded-2xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                De
              </label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Até
              </label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <button
              onClick={load}
              className="h-10 rounded-xl border px-4 text-sm hover:bg-gray-50"
            >
              Aplicar
            </button>
            <button
              onClick={() => quick(7)}
              className="h-10 rounded-xl border px-3 text-sm hover:bg-gray-50"
            >
              Últimos 7d
            </button>
            <button
              onClick={() => quick(30)}
              className="h-10 rounded-xl border px-3 text-sm hover:bg-gray-50"
            >
              Últimos 30d
            </button>
          </div>
        </section>

        {/* Cards de totais */}
        <section className="mt-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <CardStat
              title="Total"
              value={totals?.all ?? 0}
              className="border-gray-300"
            />
            <CardStat
              title="Pendente"
              value={totals?.pending ?? 0}
              className="border-yellow-300"
            />
            <CardStat
              title="Em progresso"
              value={totals?.in_progress ?? 0}
              className="border-blue-300"
            />
            <CardStat
              title="Concluída"
              value={totals?.completed ?? 0}
              className="border-green-300"
            />
            <CardStat
              title="Cancelada"
              value={totals?.cancelled ?? 0}
              className="border-red-300"
            />
          </div>

          {/* --- INÍCIO DO BLOCO JSX ATUALIZADO --- */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={exportTotalsCSV}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Exportar Totais (CSV)
            </button>
            <button
              onClick={exportDailyCSV}
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Exportar Série Diária (CSV)
            </button>

            {/* novos: via API */}
            <a
              href={apiCsvUrl("totals", from, to)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Via API — Totais (CSV)
            </a>
            <a
              href={apiCsvUrl("daily", from, to)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Via API — Série Diária (CSV)
            </a>
          </div>
          {/* --- FIM DO BLOCO JSX ATUALIZADO --- */}
        </section>

        {/* Série diária */}
        <section className="mt-4 rounded-2xl border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-800">
              Série diária (total de requisições)
            </h3>
            {loading && (
              <span className="text-xs text-gray-500">Carregando…</span>
            )}
          </div>

          {err ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          ) : byDay.length === 0 ? (
            <div className="text-sm text-gray-500">
              Sem dados para o período.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <svg
                  width="100%"
                  height="140"
                  viewBox="0 0 616 140"
                  preserveAspectRatio="none"
                >
                  {/* grid eixos */}
                  <rect x="0" y="0" width="616" height="140" fill="none" />
                  <path d="M8 120 H608" stroke="#e5e7eb" />
                  <path d="M8 80 H608" stroke="#f1f5f9" />
                  <path d="M8 40 H608" stroke="#f1f5f9" />
                  {/* linha */}
                  <path
                    d={path}
                    fill="none"
                    stroke="#111827"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-3 py-2">Dia</th>
                      <th className="px-3 py-2">Requisições</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDay.map((r) => (
                      <tr key={r.day} className="border-t">
                        <td className="px-3 py-2">{formatPt(r.day)}</td>
                        <td className="px-3 py-2">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

// --- INÍCIO DA FUNÇÃO HELPER ADICIONADA ---
function apiCsvUrl(kind: "totals" | "daily", from?: string, to?: string) {
  const usp = new URLSearchParams();
  usp.set("kind", kind);
  if (from) usp.set("from", from);
  if (to) usp.set("to", to);
  return `/api/relatorios/requisicoes.csv?${usp.toString()}`;
}
// --- FIM DA FUNÇÃO HELPER ADICIONADA ---

/* ----------------- UI helpers ----------------- */

function CardStat({
  title,
  value,
  className = "",
}: {
  title: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-4 ${className}`}>
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/* ----------------- Utils ----------------- */

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function formatPt(iso: string) {
  try {
    const [y, m, da] = iso.split("-").map((x) => parseInt(x, 10));
    const d = new Date(y, m - 1, da);
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

async function safeJson(r: Response) {
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

/**
 * Gera um caminho SVG (sparkline) com padding e escala automática.
 * width=600, height=120 mapeados para o viewBox (com padding 8px).
 */
function buildSparklinePath(
  data: number[],
  width = 600,
  height = 120,
  pad = 8,
) {
  const w = width - pad * 2;
  const h = height - pad * 2;
  const n = data.length;

  if (n <= 1) {
    // linha mínima
    return `M${pad} ${pad + h} L${pad + w} ${pad + h}`;
  }

  const max = Math.max(1, ...data);
  const stepX = w / (n - 1);

  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + h - (v / max) * h; // 0 embaixo, max em cima
    return { x, y };
  });

  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

/* ------------ CSV helpers (download no cliente) ------------ */

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows: (string | number)[][]) {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          const needsQuote = /[",\n]/.test(s);
          const escaped = s.replace(/"/g, '""');
          return needsQuote ? `"${escaped}"` : escaped;
        })
        .join(","),
    )
    .join("\r\n");
}