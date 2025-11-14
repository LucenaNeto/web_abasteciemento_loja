// src/app/relatorios/requisicoes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {useParams, useRouter} from "next/navigation";
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
  data: {
    range: { from: string; to: string };
    totals: Totals;
    byDay: ByDay[];
  };
};

export default function RelatorioRequisicoesPage() {
  // período (AAAA-MM-DD)
  const [from, setFrom] = useState(lastNDaysISO(29)); // hoje -29
  const [to, setTo] = useState(todayISO());
  // dados
  const [totals, setTotals] = useState<Totals>({
    pending: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    all: 0,
  });
  const [byDay, setByDay] = useState<ByDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const query = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("from", from);
    usp.set("to", to);
    return usp.toString();
  }, [from, to]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/relatorios/requisicoes?${query}`, { cache: "no-store" });
      const j = (await safeJson(r)) as ApiResp | null;
      if (!r.ok) throw new Error((j as any)?.error || `Falha (HTTP ${r.status})`);
      setTotals(j!.data.totals);
      setByDay(j!.data.byDay);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
  const url = `/api/relatorios/requisicoes?${query}&format=csv`;
  // força download respeitando o content-disposition do backend
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio_requisicoes_${from}_a_${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // escala para as barras diárias
  const maxCount = useMemo(
    () => Math.max(1, ...byDay.map((d) => d.count)),
    [byDay]
  );

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Cabeçalho */}
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Relatório — Requisições</h1>
            <p className="text-sm text-gray-600">
              Visão simples por período.{" "}
              <Link href="/requisicoes" className="underline">
                Voltar às Requisições
              </Link>
            </p>
          </div>
        </header>

        {/* Filtros de período */}
       <section className="rounded-2xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700">De</label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Até</label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div>
              <button
                onClick={load}
                className="w-full rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
              >
                Aplicar
              </button>
            </div>
            <div>
              <button
                onClick={exportCsv}
                className="w-full rounded-xl border px-4 py-2 hover:bg-gray-50"
                title="Baixar série diária em CSV"
              >
                Exportar CSV
              </button>
            </div>
          </div>
        </section>


        {/* Cards de totais */}
        <section className="mt-4 grid gap-3 sm:grid-cols-5">
          <TotalCard title="Total" value={totals.all} />
          <TotalCard title="Pendente" value={totals.pending} tone="yellow" />
          <TotalCard title="Em progresso" value={totals.in_progress} tone="blue" />
          <TotalCard title="Concluída" value={totals.completed} tone="green" />
          <TotalCard title="Cancelada" value={totals.cancelled} tone="red" />
        </section>

        {/* Série diária */}
        <section className="mt-4 rounded-2xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Série diária (qtd. criadas)</h2>

          {loading ? (
            <div className="py-10 text-center text-gray-500">Carregando…</div>
          ) : err ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{err}</div>
          ) : byDay.length === 0 ? (
            <div className="py-10 text-center text-gray-500">Sem dados no período.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Dia</th>
                    <th className="px-3 py-2 w-32">Quantidade</th>
                    <th className="px-3 py-2">Distribuição</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map((d) => (
                    <tr key={d.day} className="border-t">
                      <td className="px-3 py-2">{formatDate(d.day)}</td>
                      <td className="px-3 py-2">{d.count}</td>
                      <td className="px-3 py-2">
                        <div className="h-3 w-full rounded-full bg-gray-100">
                          <div
                            className="h-3 rounded-full bg-gray-900"
                            style={{ width: `${Math.max(4, (d.count / maxCount) * 100)}%` }}
                            title={`${d.count}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ---------- Componentes ---------- */

function TotalCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone?: "yellow" | "blue" | "green" | "red";
}) {
  const map: Record<string, string> = {
    yellow: "bg-yellow-50 text-yellow-800",
    blue: "bg-blue-50 text-blue-800",
    green: "bg-green-50 text-green-800",
    red: "bg-red-50 text-red-800",
    default: "bg-gray-50 text-gray-800",
  };
  const cls = map[tone || "default"];
  return (
    <div className={`rounded-2xl border bg-white p-4`}>
      <div className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/* ---------- Helpers ---------- */

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function lastNDaysISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function formatDate(yyyyMMdd: string) {
  // yyyy-mm-dd -> locale
  try {
    const [y, m, d] = yyyyMMdd.split("-").map((s) => parseInt(s, 10));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString();
  } catch {
    return yyyyMMdd;
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
