// src/server/import/existing-skus.ts
// Busca, dentro de UMA unidade, os SKUs que já existem — sem diferenciar maiúsculas/minúsculas.
// Devolve  sku-em-minúsculas -> sku exatamente como está gravado no banco.

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

export async function findExistingSkus(unitId: number, skus: string[]) {
  const found = new Map<string, string>();
  const lowered = Array.from(new Set(skus.map((s) => s.toLowerCase())));

  for (let i = 0; i < lowered.length; i += 1000) {
    const chunk = lowered.slice(i, i + 1000);
    const rows = await db
      .select({ sku: schema.products.sku })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.unitId, unitId),
          sql`lower(${schema.products.sku}) in (${sql.join(
            chunk.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        ),
      );
    for (const r of rows) found.set(r.sku.toLowerCase(), r.sku);
  }
  return found;
}

/** Limite de tamanho do arquivo importado (xlsx/csv). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
