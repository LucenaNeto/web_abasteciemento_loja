// src/app/api/relatorios/requisicoes/route.ts
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Os horários ficam gravados em UTC; os dias do relatório são os do fuso de Brasília.
const TZ = "America/Sao_Paulo";

function isoDateInTz(d: Date) {
  // en-CA formata como AAAA-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function daysAgoISODate(n: number) {
  return isoDateInTz(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

function isValidISODate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type Totals = {
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  all: number;
};

type ByDay = {
  day: string;
  count: number;
};

/**
 * GET /api/relatorios/requisicoes?from=AAAA-MM-DD&to=AAAA-MM-DD[&unitId=N]
 * Somente admin.
 */
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  try {
    const { searchParams } = new URL(req.url);

    const to = (searchParams.get("to") || isoDateInTz(new Date())).slice(0, 10);
    const from = (searchParams.get("from") || daysAgoISODate(29)).slice(0, 10);

    if (!isValidISODate(from) || !isValidISODate(to)) {
      return NextResponse.json({ error: "Datas inválidas. Use AAAA-MM-DD." }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: "A data inicial é maior que a final." }, { status: 400 });
    }

    const unitParam = searchParams.get("unitId");
    const unitId = unitParam ? Number(unitParam) : null;
    if (unitParam && (!Number.isInteger(unitId) || (unitId as number) <= 0)) {
      return NextResponse.json({ error: "unitId inválido." }, { status: 400 });
    }

    // created_at (timestamp sem fuso, em UTC) -> dia no fuso de Brasília
    // (fuso como literal: com parâmetro, o Postgres vê SELECT e GROUP BY como expressões diferentes)
    const localDay = sql`((${schema.requests.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${sql.raw(`'${TZ}'`)})::date`;

    const where = and(
      sql`${localDay} between ${from}::date and ${to}::date`,
      unitId ? eq(schema.requests.unitId, unitId as number) : undefined,
    );

    // --------- TOTAIS POR STATUS ---------
    const rowsTotals = await db
      .select({ s: schema.requests.status, c: sql<number>`count(*)` })
      .from(schema.requests)
      .where(where)
      .groupBy(schema.requests.status);

    const totals: Totals = { pending: 0, in_progress: 0, completed: 0, cancelled: 0, all: 0 };
    for (const r of rowsTotals) {
      const key = String(r.s) as keyof Totals;
      if (key in totals) totals[key] = Number(r.c) || 0;
    }
    totals.all = totals.pending + totals.in_progress + totals.completed + totals.cancelled;

    // --------- SÉRIE DIÁRIA ---------
    const rowsDaily = await db
      .select({ day: sql<string>`to_char(${localDay}, 'YYYY-MM-DD')`, c: sql<number>`count(*)` })
      .from(schema.requests)
      .where(where)
      .groupBy(localDay)
      .orderBy(localDay);

    const byDay: ByDay[] = rowsDaily.map((r) => ({
      day: String(r.day),
      count: Number(r.c) || 0,
    }));

    return NextResponse.json({ data: { range: { from, to }, totals, byDay } }, { status: 200 });
  } catch (e) {
    console.error("GET /api/relatorios/requisicoes error:", e);
    return NextResponse.json({ error: "Falha ao gerar relatório de requisições." }, { status: 500 });
  }
}
