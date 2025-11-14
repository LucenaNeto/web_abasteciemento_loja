// src/app/api/relatorios/requisicoes/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";

type Totals = {
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
};

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISODate(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fmt = (searchParams.get("format") || "").toLowerCase();
    const to = (searchParams.get("to") || todayISODate()).slice(0, 10);
    const from = (searchParams.get("from") || daysAgoISODate(29)).slice(0, 10);

    // -------- Totais por status --------
    const totalsRows = await db
      .select({
        s: schema.requests.status,
        c: sql<number>`count(*)`,
      })
      .from(schema.requests)
      .where(sql`substr(${schema.requests.createdAt}, 1, 10) between ${from} and ${to}`)
      .groupBy(schema.requests.status);

    const totals: Totals = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const r of totalsRows) {
      const s = String(r.s) as keyof Totals;
      const c = Number(r.c) || 0;
      if (s in totals) totals[s] = c;
    }
    const totalAll = totals.pending + totals.in_progress + totals.completed + totals.cancelled;

    // -------- Série diária (todas as requisições) --------
    const dayExpr = sql<string>`substr(${schema.requests.createdAt}, 1, 10)`;
    const dailyRows = await db
      .select({
        day: dayExpr,
        count: sql<number>`count(*)`,
      })
      .from(schema.requests)
      .where(sql`substr(${schema.requests.createdAt}, 1, 10) between ${from} and ${to}`)
      .groupBy(dayExpr)
      .orderBy(dayExpr);

    // ---- Saída CSV opcional (só a série diária) ----
    if (fmt === "csv") {
      // Usando ';' para abrir melhor no Excel PT-BR. Se preferir ',', eu troco.
      const SEP = ";";
      const lines = ["day" + SEP + "count", ...dailyRows.map((r) => `${r.day}${SEP}${r.count}`)];
      const csv = lines.join("\r\n");

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="relatorio_requisicoes_${from}_a_${to}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    // ---- Saída JSON padrão ----
    return NextResponse.json({
      data: {
        range: { from, to },
        totals: { ...totals, all: totalAll },
        byDay: dailyRows,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Falha ao gerar relatório.", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
