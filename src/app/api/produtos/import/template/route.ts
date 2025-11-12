// src/app/api/produtos/import/template/route.ts
import { ensureRoleApi } from "@/server/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/produtos/import/template?delimiter=,|;
export async function GET(req: Request) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { searchParams } = new URL(req.url);
  const delim = searchParams.get("delimiter") === ";" ? ";" : ",";

  const header = ["sku", "name", "unit", "isActive"].join(delim);
  const rows = [
    header,
    ["SKU-001", "Shampoo 500ml", "UN", "true"].join(delim),
    ["SKU-002", "Condicionador 250ml", "UN", "1"].join(delim),
    ["SKU-003", "Sabonete 90g", "UN", "sim"].join(delim),
  ];

  const csv = rows.join("\r\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="modelo_produtos.csv"',
      "cache-control": "no-store",
    },
  });
}
