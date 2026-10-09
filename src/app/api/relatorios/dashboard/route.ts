// src/app/api/relatorios/dashboard/route.ts
// Métricas do dashboard (somente admin).
// GET /api/relatorios/dashboard?from=AAAA-MM-DD&to=AAAA-MM-DD[&unitId=N]
//
// Regras de tempo: created_at/completed_at ficam gravados em UTC (timestamp sem fuso);
// os dias e horas exibidos são os do fuso de Brasília. Tempo de atendimento = criação -> conclusão
// (a maioria das requisições nunca passa por "em progresso", então started_at não serve de base).
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";
const tzLit = sql.raw(`'${TZ}'`);

function isoDateInTz(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}
function isValidISODate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;
async function q(query: ReturnType<typeof sql>) {
  const res = await db.execute(query);
  return res.rows as Row[];
}
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  try {
    const { searchParams } = new URL(req.url);
    const today = isoDateInTz(new Date());
    const to = (searchParams.get("to") || today).slice(0, 10);
    const from = (searchParams.get("from") || addDays(to, -29)).slice(0, 10);

    if (!isValidISODate(from) || !isValidISODate(to)) {
      return NextResponse.json({ error: "Datas inválidas. Use AAAA-MM-DD." }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: "A data inicial é maior que a final." }, { status: 400 });
    }
    if (addDays(from, 400) < to) {
      return NextResponse.json({ error: "Período máximo de 400 dias." }, { status: 400 });
    }

    const unitParam = searchParams.get("unitId");
    const unitId = unitParam ? Number(unitParam) : null;
    if (unitParam && (!Number.isInteger(unitId) || (unitId as number) <= 0)) {
      return NextResponse.json({ error: "unitId inválido." }, { status: 400 });
    }

    // intervalo [from 00:00, to+1 00:00) de Brasília, convertido para UTC (naive) — usa índice
    const fromUtc = sql`((${from}::date)::timestamp AT TIME ZONE ${tzLit}) AT TIME ZONE 'UTC'`;
    const toUtc = sql`(((${to}::date + 1)::timestamp) AT TIME ZONE ${tzLit}) AT TIME ZONE 'UTC'`;
    const unitR = unitId ? sql`AND r.unit_id = ${unitId}` : sql``;
    const created = sql`r.created_at >= ${fromUtc} AND r.created_at < ${toUtc} ${unitR}`;
    const hours = sql`extract(epoch from (r.completed_at - r.created_at)) / 3600`;
    // dia/hora local de Brasília (sem parâmetros: a expressão é a mesma no SELECT e no GROUP BY)
    const localOf = (col: string) => sql.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`);

    const [
      kpiRows,
      itemRows,
      openRows,
      oldestRows,
      createdDayRows,
      completedDayRows,
      unitRows,
      unitUnavailRows,
      requesterRows,
      warehouseRows,
      topRows,
      topUnavailRows,
      hourRows,
      critRows,
    ] = await Promise.all([
      q(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
               count(*) FILTER (WHERE r.status = 'pending')::int AS pending,
               count(*) FILTER (WHERE r.status = 'in_progress')::int AS in_progress,
               count(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
               round((avg(${hours}) FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL))::numeric, 1) AS avg_hours,
               round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${hours}) FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL))::numeric, 1) AS median_hours
          FROM requests r WHERE ${created}`),
      q(sql`
        SELECT count(*)::int AS items,
               coalesce(sum(ri.requested_qty), 0)::int AS qty,
               count(*) FILTER (WHERE ri.status = 'unavailable')::int AS unavailable
          FROM request_items ri JOIN requests r ON r.id = ri.request_id
         WHERE ${created} AND r.status <> 'cancelled'`),
      // em aberto agora (não depende do período): fila parada
      q(sql`
        SELECT count(*) FILTER (WHERE r.status = 'pending')::int AS pending,
               count(*) FILTER (WHERE r.status = 'in_progress')::int AS in_progress,
               count(*) FILTER (WHERE r.created_at < (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS older_24h,
               count(*) FILTER (WHERE r.created_at < (now() AT TIME ZONE 'UTC') - interval '7 days')::int AS older_7d
          FROM requests r WHERE r.status IN ('pending', 'in_progress') ${unitR}`),
      q(sql`
        SELECT r.id, r.status, u.code AS unit_code, u.name AS unit_name,
               to_char(${localOf("r.created_at")}, 'YYYY-MM-DD HH24:MI') AS created_local,
               round((extract(epoch from ((now() AT TIME ZONE 'UTC') - r.created_at)) / 3600)::numeric, 0)::int AS hours_open
          FROM requests r JOIN units u ON u.id = r.unit_id
         WHERE r.status IN ('pending', 'in_progress') ${unitR}
         ORDER BY r.created_at ASC LIMIT 10`),
      q(sql`
        SELECT to_char(${localOf("r.created_at")}::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM requests r WHERE ${created}
         GROUP BY ${localOf("r.created_at")}::date ORDER BY 1`),
      q(sql`
        SELECT to_char(${localOf("r.completed_at")}::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM requests r
         WHERE r.status = 'completed' AND r.completed_at >= ${fromUtc} AND r.completed_at < ${toUtc} ${unitR}
         GROUP BY ${localOf("r.completed_at")}::date ORDER BY 1`),
      q(sql`
        SELECT u.id, u.code, u.name,
               count(*)::int AS total,
               count(*) FILTER (WHERE r.status = 'completed')::int AS completed,
               count(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
               count(*) FILTER (WHERE r.status IN ('pending', 'in_progress'))::int AS open,
               round((avg(${hours}) FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL))::numeric, 1) AS avg_hours
          FROM requests r JOIN units u ON u.id = r.unit_id
         WHERE ${created}
         GROUP BY u.id, u.code, u.name ORDER BY total DESC`),
      q(sql`
        SELECT r.unit_id, count(*)::int AS n
          FROM request_items ri JOIN requests r ON r.id = ri.request_id
         WHERE ${created} AND ri.status = 'unavailable'
         GROUP BY r.unit_id`),
      q(sql`
        SELECT us.id, us.name,
               count(*)::int AS total,
               count(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled
          FROM requests r JOIN users us ON us.id = r.created_by_user_id
         WHERE ${created}
         GROUP BY us.id, us.name ORDER BY total DESC LIMIT 15`),
      // produtividade do almoxarifado: quem concluiu (auditoria de mudança de status)
      q(sql`
        SELECT a.user_id AS id, us.name,
               count(DISTINCT r.id)::int AS completed,
               round(avg(extract(epoch from (a.created_at - r.created_at)) / 3600)::numeric, 1) AS avg_hours
          FROM audit_logs a
          JOIN requests r ON r.id::text = a.record_id
          JOIN users us ON us.id = a.user_id
         WHERE a.table_name = 'requests' AND a.action = 'STATUS_CHANGE'
           AND (CASE WHEN a.payload ~ '^\s*\{' THEN a.payload::jsonb ->> 'to' END) = 'completed'
           AND a.created_at >= ${fromUtc} AND a.created_at < ${toUtc} ${unitR}
         GROUP BY a.user_id, us.name ORDER BY completed DESC LIMIT 15`),
      q(sql`
        SELECT p.sku, max(p.name) AS name,
               count(*)::int AS times, coalesce(sum(ri.requested_qty), 0)::int AS qty,
               count(*) FILTER (WHERE ri.status = 'unavailable')::int AS unavailable
          FROM request_items ri
          JOIN requests r ON r.id = ri.request_id
          JOIN products p ON p.id = ri.product_id
         WHERE ${created} AND r.status <> 'cancelled'
         GROUP BY p.sku ORDER BY times DESC, qty DESC LIMIT 15`),
      q(sql`
        SELECT p.sku, max(p.name) AS name,
               count(*)::int AS times, coalesce(sum(ri.requested_qty), 0)::int AS qty,
               count(*) FILTER (WHERE ri.status = 'unavailable')::int AS unavailable
          FROM request_items ri
          JOIN requests r ON r.id = ri.request_id
          JOIN products p ON p.id = ri.product_id
         WHERE ${created} AND r.status <> 'cancelled'
         GROUP BY p.sku HAVING count(*) FILTER (WHERE ri.status = 'unavailable') > 0
         ORDER BY unavailable DESC, times DESC LIMIT 15`),
      q(sql`
        SELECT extract(hour from ${localOf("r.created_at")})::int AS hour, count(*)::int AS n
          FROM requests r WHERE ${created}
         GROUP BY extract(hour from ${localOf("r.created_at")}) ORDER BY 1`),
      q(sql`
        SELECT r.criticality,
               count(*)::int AS total,
               round((avg(${hours}) FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL))::numeric, 1) AS avg_hours
          FROM requests r WHERE ${created}
         GROUP BY r.criticality ORDER BY total DESC`),
    ]);

    // série diária completa (dias sem pedidos aparecem com 0)
    const createdMap = new Map(createdDayRows.map((r) => [String(r.day), num(r.n)]));
    const completedMap = new Map(completedDayRows.map((r) => [String(r.day), num(r.n)]));
    const byDay: { day: string; created: number; completed: number }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      byDay.push({ day: d, created: createdMap.get(d) ?? 0, completed: completedMap.get(d) ?? 0 });
    }

    const unavailByUnit = new Map(unitUnavailRows.map((r) => [num(r.unit_id), num(r.n)]));
    const k = kpiRows[0] ?? {};
    const it = itemRows[0] ?? {};
    const open = openRows[0] ?? {};

    const total = num(k.total);
    const completed = num(k.completed);
    const cancelled = num(k.cancelled);
    const items = num(it.items);
    const unavailable = num(it.unavailable);

    return NextResponse.json({
      data: {
        range: { from, to },
        unitId,
        kpis: {
          total,
          completed,
          pending: num(k.pending),
          inProgress: num(k.in_progress),
          cancelled,
          // taxa sobre o que não foi cancelado
          completionRate: total - cancelled > 0 ? completed / (total - cancelled) : null,
          avgHours: numOrNull(k.avg_hours),
          medianHours: numOrNull(k.median_hours),
          items,
          itemsQty: num(it.qty),
          unavailableItems: unavailable,
          unavailableRate: items > 0 ? unavailable / items : null,
        },
        openNow: {
          pending: num(open.pending),
          inProgress: num(open.in_progress),
          olderThan24h: num(open.older_24h),
          olderThan7d: num(open.older_7d),
          oldest: oldestRows.map((r) => ({
            id: num(r.id),
            status: String(r.status),
            unit: `${r.unit_code} — ${r.unit_name}`,
            createdLocal: String(r.created_local),
            hoursOpen: num(r.hours_open),
          })),
        },
        byDay,
        byUnit: unitRows.map((r) => ({
          unitId: num(r.id),
          code: String(r.code),
          name: String(r.name),
          total: num(r.total),
          completed: num(r.completed),
          cancelled: num(r.cancelled),
          open: num(r.open),
          avgHours: numOrNull(r.avg_hours),
          unavailableItems: unavailByUnit.get(num(r.id)) ?? 0,
        })),
        requesters: requesterRows.map((r) => ({
          userId: num(r.id),
          name: String(r.name),
          total: num(r.total),
          cancelled: num(r.cancelled),
        })),
        warehouse: warehouseRows.map((r) => ({
          userId: num(r.id),
          name: String(r.name),
          completed: num(r.completed),
          avgHours: numOrNull(r.avg_hours),
        })),
        topProducts: topRows.map((r) => ({
          sku: String(r.sku),
          name: String(r.name),
          times: num(r.times),
          qty: num(r.qty),
          unavailable: num(r.unavailable),
        })),
        topUnavailable: topUnavailRows.map((r) => ({
          sku: String(r.sku),
          name: String(r.name),
          times: num(r.times),
          qty: num(r.qty),
          unavailable: num(r.unavailable),
        })),
        byHour: Array.from({ length: 24 }, (_, h) => ({
          hour: h,
          n: num(hourRows.find((r) => num(r.hour) === h)?.n),
        })),
        byCriticality: critRows.map((r) => ({
          criticality: String(r.criticality),
          total: num(r.total),
          avgHours: numOrNull(r.avg_hours),
        })),
      },
    });
  } catch (e) {
    console.error("GET /api/relatorios/dashboard error:", e);
    return NextResponse.json({ error: "Falha ao gerar o dashboard." }, { status: 500 });
  }
}
