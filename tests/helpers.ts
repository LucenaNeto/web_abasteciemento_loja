// tests/helpers.ts
import { inArray, or, and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type Role = "admin" | "store" | "warehouse";

export const sessionMock = { current: null as null | { user: { id: string; role: Role; name: string } } };

export function loginAs(userId: number | null, role: Role = "warehouse") {
  sessionMock.current = userId == null ? null : { user: { id: String(userId), role, name: "teste" } };
}

export function jsonReq(method: string, body?: unknown, url = "http://localhost/api/test") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
export const itemCtx = (itemId: number) => ({ params: Promise.resolve({ itemId: String(itemId) }) });

export function uid() {
  return Math.random().toString(36).slice(2, 8);
}

/** Fixture isolada: 1 unidade, 1 usuário por papel (vinculados à unidade) e 1 usuário SEM vínculo. */
export async function createWorld() {
  const tag = uid();

  const [unit] = await db
    .insert(schema.units)
    .values({ code: `T${tag}`, name: `Teste ${tag}`, isActive: true })
    .returning();
  const [otherUnit] = await db
    .insert(schema.units)
    .values({ code: `U${tag}`, name: `Outra ${tag}`, isActive: true })
    .returning();

  const mkUser = async (role: Role, label: string = role) => {
    const [u] = await db
      .insert(schema.users)
      .values({
        name: `vitest ${role}`,
        email: `${label}-${tag}@vitest.local`,
        passwordHash: "x",
        role,
        isActive: true,
      })
      .returning();
    return u;
  };

  const admin = await mkUser("admin");
  const store = await mkUser("store");
  const warehouse = await mkUser("warehouse");
  const outsider = await mkUser("warehouse", "outsider"); // sem vínculo com a unidade


  await db.insert(schema.userUnits).values([
    { userId: store.id, unitId: unit.id, isPrimary: true },
    { userId: warehouse.id, unitId: unit.id, isPrimary: true },
  ]);

  return { tag, unit, otherUnit, admin, store, warehouse, outsider, extraUserIds: [] as number[] };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

export async function createProduct(w: World, stock: number, unitId = w.unit.id) {
  const [p] = await db
    .insert(schema.products)
    .values({ unitId, sku: `SKU-${uid()}`, name: "Produto de teste", unit: "UN", isActive: true, stock })
    .returning();
  return p;
}

export async function createRequest(w: World, items: Array<{ productId: number; qty: number }>) {
  const [r] = await db
    .insert(schema.requests)
    .values({ unitId: w.unit.id, createdByUserId: w.store.id, status: "pending", criticality: "restock" })
    .returning();
  const its = await db
    .insert(schema.requestItems)
    .values(items.map((i) => ({ requestId: r.id, productId: i.productId, requestedQty: i.qty })))
    .returning();
  return { request: r, items: its };
}

export async function stockOf(productId: number) {
  const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
  return p.stock;
}

export async function movementsOf(productId: number) {
  return db
    .select()
    .from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.productId, productId))
    .orderBy(schema.inventoryMovements.id);
}

export async function itemOf(itemId: number) {
  const [i] = await db.select().from(schema.requestItems).where(eq(schema.requestItems.id, itemId));
  return i;
}

export async function requestOf(id: number) {
  const [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, id));
  return r;
}

/** Remove tudo que a fixture criou (e só isso). */
export async function destroyWorld(w: World) {
  const unitIds = [w.unit.id, w.otherUnit.id];
  const userIds = [w.admin.id, w.store.id, w.warehouse.id, w.outsider.id, ...w.extraUserIds];

  const prods = await db.select({ id: schema.products.id }).from(schema.products).where(inArray(schema.products.unitId, unitIds));
  const prodIds = prods.map((p) => p.id);
  const reqs = await db.select({ id: schema.requests.id }).from(schema.requests).where(inArray(schema.requests.unitId, unitIds));
  const reqIds = reqs.map((r) => r.id);
  const items = reqIds.length
    ? await db.select({ id: schema.requestItems.id }).from(schema.requestItems).where(inArray(schema.requestItems.requestId, reqIds))
    : [];

  if (reqIds.length) {
    await db.delete(schema.auditLogs).where(
      or(
        and(eq(schema.auditLogs.tableName, "requests"), inArray(schema.auditLogs.recordId, reqIds.map(String))),
        items.length
          ? and(eq(schema.auditLogs.tableName, "request_items"), inArray(schema.auditLogs.recordId, items.map((i) => String(i.id))))
          : undefined,
      ),
    );
  }
  if (prodIds.length) {
    await db.delete(schema.auditLogs).where(and(eq(schema.auditLogs.tableName, "products"), inArray(schema.auditLogs.recordId, prodIds.map(String))));
  }
  await db.delete(schema.auditLogs).where(and(eq(schema.auditLogs.tableName, "units"), inArray(schema.auditLogs.recordId, unitIds.map(String))));
  await db.delete(schema.auditLogs).where(and(eq(schema.auditLogs.tableName, "users"), inArray(schema.auditLogs.recordId, userIds.map(String))));
  if (prodIds.length) await db.delete(schema.inventoryMovements).where(inArray(schema.inventoryMovements.productId, prodIds));
  if (reqIds.length) await db.delete(schema.requests).where(inArray(schema.requests.id, reqIds));
  if (prodIds.length) await db.delete(schema.products).where(inArray(schema.products.id, prodIds));
  await db.delete(schema.userUnits).where(inArray(schema.userUnits.userId, userIds));
  await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await db.delete(schema.units).where(inArray(schema.units.id, unitIds));
}
