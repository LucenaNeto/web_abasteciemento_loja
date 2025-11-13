// src/app/api/produtos/resolve/route.ts
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { db } from "@/server/db";

/**
 * GET /api/produtos/resolve?code=SKU-ou-ID
 *
 * Regras:
 * - Se "code" for só dígitos E não começar com zero -> trata como ID numérico
 * - Caso contrário -> trata como SKU (case-insensitive, match exato)
 *
 * Retorna: { data: { id, sku, name, unit } } ou 404
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("code") || "").trim();

  if (!raw) {
    return NextResponse.json(
      { error: "Parâmetro 'code' é obrigatório." },
      { status: 400 },
    );
  }

  const onlyDigits = /^\d+$/.test(raw);
  const leadingZero = onlyDigits && raw.length > 1 && raw.startsWith("0");

  try {
    let row:
      | {
          id: number;
          sku: string;
          name: string;
          unit: string | null;
        }
      | undefined;

    if (onlyDigits && !leadingZero) {
      // Trata como ID
      const id = Number.parseInt(raw, 10);
      row = await db.query.products.findFirst({
        where: eq(schema.products.id, id),
        columns: { id: true, sku: true, name: true, unit: true },
      });
    } else {
      // Trata como SKU (case-insensitive, exato)
      const sku = raw.toLowerCase();
      row = await db.query.products.findFirst({
        where: sql`lower(${schema.products.sku}) = ${sku}`,
        columns: { id: true, sku: true, name: true, unit: true },
      });
    }

    if (!row) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ data: row });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Falha ao resolver produto.", details: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
