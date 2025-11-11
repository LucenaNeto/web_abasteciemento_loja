// src/app/api/auditoria/route.ts
import { NextResponse } from "next/server";
import { db, schema } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, desc, eq, like, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auditoria
// Filtros: ?table=...&recordId=...&action=...&userId=...&q=...&page=1&pageSize=20
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin"]); // só Admin consulta auditoria
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const table = (searchParams.get("table") ?? "").trim();
  const recordId = (searchParams.get("recordId") ?? "").trim();
  const action = (searchParams.get("action") ?? "").trim();
  const userIdStr = (searchParams.get("userId") ?? "").trim();
  const q = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  const filters: any[] = [];
  if (table) filters.push(eq(schema.auditLogs.tableName, table));
  if (recordId) filters.push(eq(schema.auditLogs.recordId, recordId));
  if (action) filters.push(eq(schema.auditLogs.action, action));
  if (userIdStr) {
    const n = Number(userIdStr);
    if (Number.isFinite(n)) filters.push(eq(schema.auditLogs.userId, n));
  }
  if (q) filters.push(like(schema.auditLogs.payload, `%${q}%`));

  const whereClause = filters.length ? and(...filters) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(whereClause as any);

  const rows = await db
    .select({
      id: schema.auditLogs.id,
      tableName: schema.auditLogs.tableName,
      action: schema.auditLogs.action,
      recordId: schema.auditLogs.recordId,
      userId: schema.auditLogs.userId,
      payload: schema.auditLogs.payload,
      createdAt: schema.auditLogs.createdAt,
    })
    .from(schema.auditLogs)
    .where(whereClause as any)
    .orderBy(desc(schema.auditLogs.id))
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    data: rows,
    pagination: {
      page,
      pageSize,
      total: Number(count ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(count ?? 0) / pageSize)),
    },
  });
}
