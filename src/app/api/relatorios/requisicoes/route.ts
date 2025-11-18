// src/app/api/relatorios/requisicoes/route.ts
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { NextResponse } from "next/server";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISODate(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const to = (searchParams.get("to") || todayISODate()).slice(0, 10);
    const from = (searchParams.get("from") || daysAgoISODate(29)).slice(0, 10);

    // --------- TOTAIS POR STATUS ---------
    const rowsTotals = await db
      .select({
        s: schema.requests.status,
        c: sql<number>`count(*)`,
      })
      .from(schema.requests)
      .where(
        sql`substr(${schema.requests.createdAt}, 1, 10) between ${from} and ${to}`,
      )
      .groupBy(schema.requests.status);

    const totals: Totals = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      all: 0,
    };

    for (const r of rowsTotals) {
      const key = String(r.s) as keyof Totals;
      if (key in totals) {
        totals[key] = Number(r.c) || 0;
      }
    }

    totals.all =
      totals.pending +
      totals.in_progress +
      totals.completed +
      totals.cancelled;

    // --------- SÉRIE DIÁRIA ---------
    const rowsDaily = await db
      .select({
        day: sql<string>`substr(${schema.requests.createdAt}, 1, 10)`,
        c: sql<number>`count(*)`,
      })
      .from(schema.requests)
      .where(
        sql`substr(${schema.requests.createdAt}, 1, 10) between ${from} and ${to}`,
      )
      .groupBy(sql`substr(${schema.requests.createdAt}, 1, 10)`)
      .orderBy(sql`substr(${schema.requests.createdAt}, 1, 10) asc`);

    const byDay: ByDay[] = (rowsDaily as any).map((r: any) => ({
      day: String(r.day),
      count: Number(r.c) || 0,
    }));

    // --------- RESPOSTA JSON ---------
    return NextResponse.json(
      {
        data: {
          range: { from, to },
          totals,
          byDay,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      {
        error: "Falha ao gerar relatório de requisições.",
        details: String(e?.message ?? e),
      },
      { status: 500 },
    );
  }
}
