// src/server/import/write-products.ts
// Gravação de produtos importados (usada pela importação por arquivo e pela importação por colunas).

import { sql } from "drizzle-orm";
import { schema, withTransaction } from "@/server/db";
import { findExistingSkus } from "@/server/import/existing-skus";

export type CleanProduct = { sku: string; name: string; unit: string; isActive: boolean };
export type ImportMode = "insert" | "upsert";

export type ApplyResult = {
  /** quantos SKUs já existiam na unidade (sem diferenciar maiúsculas) */
  existInDb: number;
  newSkus: number;
  inserted: number;
  updated: number;
  skipped: number;
};

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * - dryRun: só calcula o que aconteceria (nada é gravado)
 * - insert: ignora SKUs que já existem; upsert: atualiza nome/unidade/ativo dos que existem
 * - estoque nunca é alterado pela importação
 * - tudo (produtos + auditoria) numa transação
 */
export async function applyProducts(args: {
  unitId: number;
  mode: ImportMode;
  rows: CleanProduct[];
  adminId: number | null;
  dryRun?: boolean;
  /** dados extras para a auditoria (ex.: importId, parte N de M) */
  audit?: Record<string, unknown>;
  invalidRows?: number;
}): Promise<ApplyResult> {
  const { unitId, mode, rows, adminId, dryRun, audit, invalidRows = 0 } = args;

  const existingBySku = await findExistingSkus(unitId, rows.map((r) => r.sku));
  const existsLower = new Set(existingBySku.keys());

  const already = rows.filter((r) => existsLower.has(r.sku.toLowerCase())).length;
  const result: ApplyResult = {
    existInDb: already,
    newSkus: rows.length - already,
    inserted: rows.length - already,
    updated: mode === "upsert" ? already : 0,
    skipped: mode === "insert" ? already : 0,
  };

  if (dryRun || rows.length === 0) return result;

  await withTransaction(async (tx) => {
    // usa o SKU exatamente como está gravado (casa com o índice único unidade+SKU)
    const values = rows.map((r) => ({
      unitId,
      sku: existingBySku.get(r.sku.toLowerCase()) ?? r.sku,
      name: r.name,
      unit: r.unit,
      isActive: r.isActive,
      stock: 0,
    }));

    if (mode === "insert") {
      const toInsert = values.filter((v) => !existsLower.has(v.sku.toLowerCase()));
      for (const batch of chunk(toInsert, 500)) {
        if (batch.length) await tx.insert(schema.products).values(batch);
      }
    } else {
      for (const batch of chunk(values, 500)) {
        if (!batch.length) continue;
        await tx
          .insert(schema.products)
          .values(batch)
          .onConflictDoUpdate({
            target: [schema.products.unitId, schema.products.sku],
            set: {
              name: sql`excluded.name`,
              unit: sql`excluded.unit`,
              isActive: sql`excluded.is_active`,
              updatedAt: new Date(),
            },
          });
      }
    }

    await tx.insert(schema.auditLogs).values({
      tableName: "products",
      action: "IMPORT",
      recordId: `unit:${unitId}`,
      userId: adminId,
      payload: JSON.stringify({
        source: "import",
        unitId,
        mode,
        ...audit,
        totals: {
          totalValidRows: rows.length,
          inserted: result.inserted,
          updated: result.updated,
          skipped: result.skipped,
          invalidRows,
        },
      }),
    });
  });

  return result;
}
