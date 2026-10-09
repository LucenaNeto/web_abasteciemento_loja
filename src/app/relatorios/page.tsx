// src/app/relatorios/page.tsx — Dashboard (admin)
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

type Dash = {
  range: { from: string; to: string };
  unitId: number | null;
  kpis: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    cancelled: number;
    completionRate: number | null;
    avgHours: number | null;
    medianHours: number | null;
    items: number;
    itemsQty: number;
    unavailableItems: number;
    unavailableRate: number | null;
  };
  openNow: {
    pending: number;
    inProgress: number;
    olderThan24h: number;
    olderThan7d: number;
    oldest: { id: number; status: string; unit: string; createdLocal: string; hoursOpen: number }[];
  };
  byDay: { day: string; created: number; completed: number }[];
  byUnit: {
    unitId: number;
    code: string;
    name: string;
    total: number;
    completed: number;
    cancelled: number;
    open: number;
    avgHours: number | null;
    unavailableItems: number;
  }[];
  requesters: { userId: number; name: string; total: number; cancelled: number }[];
  warehouse: { userId: number; name: string; completed: number; avgHours: number | null }[];
  topProducts: Product[];
  topUnavailable: Product[];
  byHour: { hour: number; n: number }[];
  byCriticality: { criticality: string; total: number; avgHours: number | null }[];
};
type Product = { sku: string; name: string; times: number; qty: number; unavailable: number };
type UnitOpt = { id: number; code: string; name: string };

const TZ = "America/Sao_Paulo";
const isoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
function fmtHours(h: number | null) {
  if (h == null) return "—";
  if (h < 1) return "< 1 h";
  if (h < 48) return `${h.toFixed(1).replace(".", ",")} h`;
  return `${(h / 24).toFixed(1).replace(".", ",")} dias`;
}
const CRIT: Record<string, string> = { cashier: "Caixa (urgente)", service: "Atendimento", restock: "Reposição" };
const STATUS_LABEL: Record<string, string> = { pending: "Pendente", in_progress: "Em progresso" };

function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // últimos 30 dias por padrão
  useEffect(() => {
    const t = isoToday();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTo(t);
    setFrom(addDays(t, -29));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/units?active=all", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setUnits(j?.data ?? []))
      .catch(() => undefined);
  }, [isAdmin]);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setErr(null);
    try {
      const usp = new URLSearchParams({ from, to });
      if (unitId) usp.set("unitId", unitId);
      const r = await fetch(`/api/relatorios/dashboard?${usp}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);
      setData(j.data);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [from, to, unitId]);

  useEffect(() => {
    if (status === "authenticated" && isAdmin) void load();
  }, [status, isAdmin, load]);

  function quick(days: number) {
    const t = isoToday();
    setTo(t);
    setFrom(addDays(t, -(days - 1)));
  }

  if (status === "loading") return <div className="p-6">Carregando…</div>;
  if (!isAdmin) {
    return (
      <main className="p-6">
        <Card className="mx-auto max-w-xl p-6 text-red-600">
          Sem permissão. Apenas <strong>Admin</strong> acessa o dashboard.
        </Card>
      </main>
    );
  }

  const k = data?.kpis;
  const unitName = units.find((u) => String(u.id) === unitId);

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="Dashboard"
        subtitle={
          data
            ? `${fmtDay(data.range.from)} a ${fmtDay(data.range.to)} · ${unitName ? `${unitName.code} — ${unitName.name}` : "todas as unidades"}`
            : "Carregando…"
        }
        actions={
          <Link href="/relatorios/requisicoes" className="text-sm text-brand-700 underline">
            Relatório simples
          </Link>
        }
      />

      {/* filtros */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            De
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block rounded-xl border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            Até
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block rounded-xl border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            Unidade
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="mt-1 block min-w-[14rem] rounded-xl border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Todas as unidades</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} variant="outline" onClick={() => quick(d)} className="px-3 py-2">
                {d} dias
              </Button>
            ))}
          </div>
          {loading && <span className="pb-2 text-sm text-gray-500">Atualizando…</span>}
        </div>
        {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      </Card>

      {!data || !k ? null : (
        <>
          {/* KPIs */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Requisições" value={k.total.toLocaleString("pt-BR")} hint={`${k.cancelled} canceladas`} />
            <Kpi
              label="Concluídas"
              value={k.completed.toLocaleString("pt-BR")}
              hint={`${pct(k.completionRate)} das não canceladas`}
              tone="success"
            />
            <Kpi label="Tempo médio até concluir" value={fmtHours(k.avgHours)} hint={`mediana ${fmtHours(k.medianHours)}`} />
            <Kpi
              label="Em aberto há mais de 24 h"
              value={data.openNow.olderThan24h.toLocaleString("pt-BR")}
              hint={`${data.openNow.olderThan7d} há mais de 7 dias`}
              tone={data.openNow.olderThan24h > 0 ? "warning" : undefined}
            />
            <Kpi
              label="Itens pedidos"
              value={k.items.toLocaleString("pt-BR")}
              hint={`${k.itemsQty.toLocaleString("pt-BR")} unidades`}
            />
            <Kpi
              label="Itens sem estoque"
              value={k.unavailableItems.toLocaleString("pt-BR")}
              hint={`${pct(k.unavailableRate)} dos itens`}
              tone={k.unavailableItems > 0 ? "danger" : undefined}
            />
          </section>

          {/* série diária + em aberto */}
          <section className="mt-5 grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <h2 className="text-sm font-semibold text-gray-900">Requisições por dia</h2>
              <LineChart data={data.byDay} />
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-gray-900">Em aberto agora</h2>
              <div className="mt-2 flex gap-2 text-sm">
                <Badge tone="warning">{data.openNow.pending} pendentes</Badge>
                <Badge tone="info">{data.openNow.inProgress} em progresso</Badge>
              </div>
              <p className="mt-3 text-xs text-gray-500">Mais antigas (independe do período):</p>
              <ul className="mt-1 divide-y text-sm">
                {data.openNow.oldest.length === 0 ? (
                  <li className="py-3 text-gray-500">Nada em aberto.</li>
                ) : (
                  data.openNow.oldest.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link href={`/requisicoes/${r.id}`} className="font-medium underline">
                        #{r.id}
                      </Link>
                      <span className="truncate text-xs text-gray-600" title={r.unit}>
                        {r.unit}
                      </span>
                      <span className="whitespace-nowrap text-xs text-gray-700">
                        {STATUS_LABEL[r.status] ?? r.status} · {fmtHours(r.hoursOpen)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </section>

          {/* por unidade + horário */}
          <section className="mt-5 grid gap-4 lg:grid-cols-3">
            <Card className="overflow-hidden lg:col-span-2">
              <TableHead
                title="Por unidade"
                onCsv={() =>
                  downloadCsv(
                    "dashboard-unidades.csv",
                    ["Código", "Unidade", "Requisições", "Concluídas", "Canceladas", "Em aberto", "Tempo médio (h)", "Itens sem estoque"],
                    data.byUnit.map((u) => [u.code, u.name, u.total, u.completed, u.cancelled, u.open, u.avgHours, u.unavailableItems]),
                  )
                }
              />
              <Table
                cols={["Unidade", "Total", "Concluídas", "Canceladas", "Em aberto", "Tempo médio", "Sem estoque"]}
                rows={data.byUnit.map((u) => [
                  <span key="n" title={u.name}>
                    {u.code} — {u.name}
                  </span>,
                  <Bar key="b" value={u.total} max={data.byUnit[0]?.total ?? 1} label={u.total} />,
                  u.completed,
                  u.cancelled,
                  u.open,
                  fmtHours(u.avgHours),
                  u.unavailableItems,
                ])}
                empty="Sem requisições no período."
              />
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-gray-900">Pedidos por horário (Brasília)</h2>
              <HourChart data={data.byHour} />
              <h2 className="mb-2 mt-5 text-sm font-semibold text-gray-900">Por prioridade</h2>
              <ul className="space-y-1.5 text-sm">
                {data.byCriticality.map((c) => (
                  <li key={c.criticality} className="flex items-center justify-between">
                    <span>{CRIT[c.criticality] ?? c.criticality}</span>
                    <span className="text-gray-700">
                      {c.total} · {fmtHours(c.avgHours)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          {/* produtos */}
          <section className="mt-5 grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <TableHead
                title="Produtos mais pedidos"
                onCsv={() =>
                  downloadCsv(
                    "dashboard-produtos-mais-pedidos.csv",
                    ["SKU", "Produto", "Vezes pedido", "Quantidade", "Sem estoque"],
                    data.topProducts.map((p) => [p.sku, p.name, p.times, p.qty, p.unavailable]),
                  )
                }
              />
              <ProductTable rows={data.topProducts} empty="Sem pedidos no período." />
            </Card>
            <Card className="overflow-hidden">
              <TableHead
                title="Produtos que mais faltaram (sem estoque)"
                onCsv={() =>
                  downloadCsv(
                    "dashboard-produtos-sem-estoque.csv",
                    ["SKU", "Produto", "Vezes sem estoque", "Vezes pedido", "Quantidade"],
                    data.topUnavailable.map((p) => [p.sku, p.name, p.unavailable, p.times, p.qty]),
                  )
                }
              />
              <ProductTable
                rows={data.topUnavailable}
                highlight
                empty="Nenhum item marcado como sem estoque no período."
              />
            </Card>
          </section>

          {/* pessoas */}
          <section className="mt-5 grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <TableHead
                title="Almoxarifado — requisições concluídas por usuário"
                onCsv={() =>
                  downloadCsv(
                    "dashboard-almoxarifado.csv",
                    ["Usuário", "Concluídas", "Tempo médio até concluir (h)"],
                    data.warehouse.map((u) => [u.name, u.completed, u.avgHours]),
                  )
                }
              />
              <Table
                cols={["Usuário", "Concluídas", "Tempo médio"]}
                rows={data.warehouse.map((u) => [
                  u.name,
                  <Bar key="b" value={u.completed} max={data.warehouse[0]?.completed ?? 1} label={u.completed} />,
                  fmtHours(u.avgHours),
                ])}
                empty="Nenhuma conclusão registrada no período."
              />
            </Card>
            <Card className="overflow-hidden">
              <TableHead
                title="Lojas — requisições abertas por solicitante"
                onCsv={() =>
                  downloadCsv(
                    "dashboard-solicitantes.csv",
                    ["Solicitante", "Requisições", "Canceladas"],
                    data.requesters.map((u) => [u.name, u.total, u.cancelled]),
                  )
                }
              />
              <Table
                cols={["Solicitante", "Requisições", "Canceladas"]}
                rows={data.requesters.map((u) => [
                  u.name,
                  <Bar key="b" value={u.total} max={data.requesters[0]?.total ?? 1} label={u.total} />,
                  u.cancelled,
                ])}
                empty="Sem requisições no período."
              />
            </Card>
          </section>
          <p className="mt-4 text-xs text-gray-500">
            Tempo até concluir = da criação da requisição até a conclusão. A produtividade do almoxarifado conta
            quem concluiu a requisição (registro de auditoria).
          </p>
        </>
      )}
    </main>
  );
}

/* ---------------- peças ---------------- */
function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning" | "danger";
}) {
  const color =
    tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : tone === "success" ? "text-brand-700" : "text-brand-950";
  return (
    <Card className="p-4">
      <div className="text-xs text-gray-600">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-gray-500">{hint}</div> : null}
    </Card>
  );
}

function TableHead({ title, onCsv }: { title: string; onCsv: () => void }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <button onClick={onCsv} className="text-xs text-brand-700 underline">
        Exportar CSV
      </button>
    </div>
  );
}

function Table({ cols, rows, empty }: { cols: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-600">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-4 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-4 py-6 text-center text-gray-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                {r.map((c, j) => (
                  <td key={j} className="px-4 py-2 align-middle">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ProductTable({ rows, empty, highlight }: { rows: Product[]; empty: string; highlight?: boolean }) {
  const max = Math.max(1, ...rows.map((p) => (highlight ? p.unavailable : p.times)));
  return (
    <Table
      cols={highlight ? ["Produto", "Sem estoque", "Pedido", "Qtd."] : ["Produto", "Vezes pedido", "Qtd.", "Sem estoque"]}
      rows={rows.map((p) =>
        highlight
          ? [
              <span key="n" title={p.name}>
                <span className="font-mono text-xs text-gray-500">{p.sku}</span> {p.name}
              </span>,
              <Bar key="b" value={p.unavailable} max={max} label={p.unavailable} tone="danger" />,
              p.times,
              p.qty,
            ]
          : [
              <span key="n" title={p.name}>
                <span className="font-mono text-xs text-gray-500">{p.sku}</span> {p.name}
              </span>,
              <Bar key="b" value={p.times} max={max} label={p.times} />,
              p.qty,
              p.unavailable || "—",
            ],
      )}
      empty={empty}
    />
  );
}

function Bar({ value, max, label, tone }: { value: number; max: number; label: number; tone?: "danger" }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${tone === "danger" ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums">{label}</span>
    </div>
  );
}

function LineChart({ data }: { data: { day: string; created: number; completed: number }[] }) {
  const W = 720;
  const H = 230;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.completed)));
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b);
  const line = (key: "created" | "completed") => data.map((d, i) => `${x(i)},${y(d[key])}`).join(" ");
  const ticks = useMemo(() => {
    const n = Math.min(6, data.length);
    return Array.from({ length: n }, (_, i) => Math.round((i / Math.max(1, n - 1)) * (data.length - 1)));
  }, [data.length]);

  return (
    <div>
      <div className="mt-2 flex gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-4 rounded bg-brand-600" /> Criadas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-4 rounded bg-amber-500" /> Concluídas
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Requisições criadas e concluídas por dia">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(niceMax * f)} y2={y(niceMax * f)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={pad.l - 6} y={y(niceMax * f) + 4} textAnchor="end" fontSize={10} fill="#6b7280">
              {Math.round(niceMax * f)}
            </text>
          </g>
        ))}
        <polyline points={line("created")} fill="none" stroke="#567a30" strokeWidth={2} strokeLinejoin="round" />
        <polyline points={line("completed")} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
        {data.length <= 45 &&
          data.map((d, i) => (
            <g key={d.day}>
              <circle cx={x(i)} cy={y(d.created)} r={2.5} fill="#567a30">
                <title>{`${fmtDay(d.day)} — criadas: ${d.created}, concluídas: ${d.completed}`}</title>
              </circle>
              <circle cx={x(i)} cy={y(d.completed)} r={2.5} fill="#f59e0b">
                <title>{`${fmtDay(d.day)} — criadas: ${d.created}, concluídas: ${d.completed}`}</title>
              </circle>
            </g>
          ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#6b7280">
            {data[i] ? fmtDay(data[i].day) : ""}
          </text>
        ))}
      </svg>
    </div>
  );
}

function HourChart({ data }: { data: { hour: number; n: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="mt-3">
      <div className="flex h-28 items-end gap-[3px]">
        {data.map((d) => (
          <div
            key={d.hour}
            title={`${String(d.hour).padStart(2, "0")}h — ${d.n} requisições`}
            className="flex-1 rounded-t bg-brand-500/80 hover:bg-brand-700"
            style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  );
}
