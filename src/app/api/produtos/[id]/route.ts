import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db, schema, withTransaction } from "@/server/db";
import { ensureRoleApi } from "@/server/auth/rbac";
import { and, eq, ne } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(idRaw: string) {
  const id = Number(idRaw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const [row] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

  return NextResponse.json({ data: row });
}

// `null` é aceito e ignorado (mantém o valor atual): as colunas são NOT NULL
const patchSchema = z.object({
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  unit: z.string().trim().min(1).max(10).nullish(),
  isActive: z.boolean().optional(),
  stock: z.number().int().min(0).nullish(),
  // estoque que a tela mostrava ao abrir; evita sobrescrever entregas feitas nesse meio tempo
  expectedStock: z.number().int().nullish(),
});

class StockChangedError extends Error {
  current: number;
  constructor(current: number) {
    super("O estoque mudou desde que você abriu a tela.");
    this.current = current;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await ensureRoleApi(["admin"]);
  if (!guard.ok) return guard.res;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  let payload: z.infer<typeof patchSchema>;
  try {
    payload = patchSchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { error: "Dados inválidos", details: err?.issues ?? String(err) },
      { status: 400 },
    );
  }

  const adminId = Number((guard.session.user as any).id);
  const userId = Number.isFinite(adminId) ? adminId : null;

  try {
    const updated = await withTransaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, id))
        .for("update")
        .limit(1);

      if (!current) throw new NotFoundError();

      // se trocar SKU, garante unicidade dentro da unidade
      if (payload.sku && payload.sku !== current.sku) {
        const [exists] = await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(
            and(
              eq(schema.products.unitId, current.unitId),
              eq(schema.products.sku, payload.sku),
              ne(schema.products.id, id),
            ),
          )
          .limit(1);
        if (exists) throw new SkuConflictError();
      }

      // estoque: só muda se o usuário realmente alterou o valor
      let newStock = current.stock;
      if (payload.stock != null) {
        const untouched = payload.expectedStock != null && payload.stock === payload.expectedStock;
        if (!untouched && payload.stock !== current.stock) {
          if (payload.expectedStock != null && payload.expectedStock !== current.stock) {
            throw new StockChangedError(current.stock);
          }
          newStock = payload.stock;
        }
      }

      const next = {
        sku: payload.sku ?? current.sku,
        name: payload.name ?? current.name,
        unit: payload.unit ?? current.unit,
        isActive: payload.isActive ?? current.isActive,
        stock: newStock,
      };

      const [after] = await tx
        .update(schema.products)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(schema.products.id, id))
        .returning();

      // ajuste manual de estoque vira movimento (qty sempre positiva; o sentido vai na nota)
      if (newStock !== current.stock) {
        await tx.insert(schema.inventoryMovements).values({
          productId: id,
          qty: Math.abs(newStock - current.stock),
          type: "adjust",
          refType: "manual",
          note: `Ajuste manual de estoque: ${current.stock} -> ${newStock}`,
          createdByUserId: userId,
        });
      }

      await tx.insert(schema.auditLogs).values({
        tableName: "products",
        action: "UPDATE",
        recordId: String(id),
        userId,
        payload: JSON.stringify({
          before: {
            sku: current.sku,
            name: current.name,
            unit: current.unit,
            isActive: current.isActive,
            stock: current.stock,
          },
          after: next,
        }),
      });

      return after;
    });

    return NextResponse.json({ data: updated });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }
    if (e instanceof SkuConflictError) {
      return NextResponse.json({ error: "SKU já existe nesta unidade." }, { status: 409 });
    }
    if (e instanceof StockChangedError) {
      return NextResponse.json(
        {
          error: `${e.message} Estoque atual: ${e.current}. Recarregue a página e confira antes de salvar.`,
          code: "STOCK_CHANGED",
          currentStock: e.current,
        },
        { status: 409 },
      );
    }
    console.error("PATCH /api/produtos/:id error:", e);
    return NextResponse.json({ error: "Falha ao atualizar produto." }, { status: 500 });
  }
}

class NotFoundError extends Error {}
class SkuConflictError extends Error {}
