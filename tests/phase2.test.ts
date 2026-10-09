// tests/phase2.test.ts — integração (banco de HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { db, schema } from "@/server/db";
import { PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { POST as postUser } from "@/app/api/usuarios/route";
import { PATCH as patchUser } from "@/app/api/usuarios/[id]/route";
import { PATCH as patchProduct } from "@/app/api/produtos/[id]/route";
import { POST as postProduct } from "@/app/api/produtos/route";
import { POST as importProducts } from "@/app/api/produtos/import/route";
import { PATCH as patchUnit } from "@/app/api/units/[id]/route";
import bcrypt from "bcryptjs";
import { authOptions } from "@/server/auth/options";
import { clearSessionCache, refreshTokenFromDb } from "@/server/auth/session-check";
import {
  createProduct,
  createRequest,
  createWorld,
  ctx,
  destroyWorld,
  itemOf,
  jsonReq,
  loginAs,
  movementsOf,
  requestOf,
  stockOf,
  uid,
  type World,
} from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  if (w) await destroyWorld(w);
});

const asAdmin = () => loginAs(w.admin.id, "admin");
const asWarehouse = () => loginAs(w.warehouse.id, "warehouse");

async function auditCount(table: string, recordId: number | string, action?: string) {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.tableName, table),
        eq(schema.auditLogs.recordId, String(recordId)),
        action ? eq(schema.auditLogs.action, action) : undefined,
      ),
    );
  return rows[0].n;
}

describe("2.1 sessão revalidada no banco", () => {
  it("reflete mudança de papel e invalida usuário desativado ou removido", async () => {
    const [u] = await db
      .insert(schema.users)
      .values({ name: "sess", email: `sess-${uid()}@vitest.local`, passwordHash: "x", role: "store", isActive: true })
      .returning();
    w.extraUserIds.push(u.id);

    clearSessionCache();
    let t = await refreshTokenFromDb({ sub: String(u.id), role: "admin" });
    expect(t.invalid).toBe(false);
    expect(t.role).toBe("store"); // papel vem do banco, não do token antigo

    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, u.id));
    clearSessionCache();
    t = await refreshTokenFromDb({ sub: String(u.id), role: "store" });
    expect(t.invalid).toBe(true);

    await db.delete(schema.users).where(eq(schema.users.id, u.id));
    clearSessionCache();
    t = await refreshTokenFromDb({ sub: String(u.id), role: "store" });
    expect(t.invalid).toBe(true);
  });
});

describe("2.1 login", () => {
  const authorize = (email: string, password: string) =>
    (authOptions.providers[0] as any).options.authorize({ email, password });

  it("aceita o e-mail com qualquer caixa e recusa usuário inativo ou senha errada", async () => {
    const email = `login-${uid()}@vitest.local`;
    const [u] = await db
      .insert(schema.users)
      .values({ name: "login", email, passwordHash: await bcrypt.hash("senha123", 4), role: "store", isActive: true })
      .returning();
    w.extraUserIds.push(u.id);

    expect((await authorize(email.toUpperCase(), "senha123"))?.id).toBe(String(u.id));
    expect(await authorize(email, "errada")).toBeNull();

    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, u.id));
    expect(await authorize(email, "senha123")).toBeNull();
  });
});

describe("2.3 usuários", () => {
  const body = (email: string, extra = {}) => ({
    name: "Fulano",
    email,
    password: "senha123",
    role: "store",
    unitIds: [w.unit.id],
    ...extra,
  });

  it("grava o e-mail em minúsculas e recusa o mesmo e-mail com outra caixa", async () => {
    asAdmin();
    const email = `Mixed-${uid()}@Vitest.Local`;
    let res = await postUser(jsonReq("POST", body(email)));
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    w.extraUserIds.push(created.id);
    expect(created.email).toBe(email.toLowerCase());
    expect(await auditCount("users", created.id, "CREATE")).toBe(1);

    res = await postUser(jsonReq("POST", body(email.toUpperCase())));
    expect(res.status).toBe(409);
  });

  it("não cria usuário se a unidade não existe (nada fica pela metade)", async () => {
    asAdmin();
    const email = `semunidade-${uid()}@vitest.local`;
    const res = await postUser(jsonReq("POST", body(email, { unitIds: [999999999] })));
    expect(res.status).toBe(400);
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows).toHaveLength(0);
  });

  it("admin não pode desativar nem rebaixar a si mesmo", async () => {
    asAdmin();
    const params = { params: Promise.resolve({ id: String(w.admin.id) }) };
    expect((await patchUser(jsonReq("PATCH", { isActive: false }), params)).status).toBe(400);
    expect((await patchUser(jsonReq("PATCH", { role: "store" }), params)).status).toBe(400);
    const [still] = await db.select().from(schema.users).where(eq(schema.users.id, w.admin.id));
    expect(still.isActive).toBe(true);
    expect(still.role).toBe("admin");
  });

  it("admin consegue desativar outro usuário e isso é auditado", async () => {
    asAdmin();
    const params = { params: Promise.resolve({ id: String(w.store.id) }) };
    const res = await patchUser(jsonReq("PATCH", { isActive: false }), params);
    expect(res.status).toBe(200);
    expect(await auditCount("users", w.store.id, "UPDATE")).toBe(1);
    await db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, w.store.id));
  });
});

describe("2.4 produtos", () => {
  const pctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

  it("aceita null em unit/stock (ignora) sem erro 500", async () => {
    const p = await createProduct(w, 7);
    asAdmin();
    const res = await patchProduct(
      jsonReq("PATCH", { name: "Novo nome", unit: null, stock: null }) as never,
      pctx(p.id),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.name).toBe("Novo nome");
    expect(data.unit).toBe("UN");
    expect(data.stock).toBe(7);
  });

  it("ajuste manual de estoque vira movimento 'adjust' e auditoria", async () => {
    const p = await createProduct(w, 10);
    asAdmin();
    const res = await patchProduct(jsonReq("PATCH", { stock: 25, expectedStock: 10 }) as never, pctx(p.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(25);
    const mv = await movementsOf(p.id);
    expect(mv).toHaveLength(1);
    expect([mv[0].type, mv[0].qty]).toEqual(["adjust", 15]);
    expect(await auditCount("products", p.id, "UPDATE")).toBe(1);
  });

  it("tela desatualizada não sobrescreve o estoque (409) nem quando só o nome muda", async () => {
    const p = await createProduct(w, 50);
    asAdmin();
    // outra pessoa entregou 10 enquanto a tela estava aberta (estoque real = 40)
    await db.update(schema.products).set({ stock: 40 }).where(eq(schema.products.id, p.id));

    // tela abriu com 50 e o usuário tentou mudar o estoque para 60 -> conflito
    let res = await patchProduct(jsonReq("PATCH", { stock: 60, expectedStock: 50 }) as never, pctx(p.id));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STOCK_CHANGED");
    expect(await stockOf(p.id)).toBe(40);

    // o usuário só trocou o nome (stock enviado = o que a tela mostrava): estoque fica em 40
    res = await patchProduct(jsonReq("PATCH", { name: "Só o nome", stock: 50, expectedStock: 50 }) as never, pctx(p.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(40);
  });

  it("cadastro com estoque inicial registra movimento e auditoria", async () => {
    asAdmin();
    const sku = `NEW-${uid()}`;
    const res = await postProduct(
      jsonReq("POST", { unitId: w.unit.id, sku, name: "Novo", stock: 12 }) as never,
    );
    expect(res.status).toBe(201);
    const p = (await res.json()).data;
    const mv = await movementsOf(p.id);
    expect(mv.map((m) => [m.type, m.qty])).toEqual([["adjust", 12]]);
    expect(await auditCount("products", p.id, "CREATE")).toBe(1);
  });
});

describe("2.5 requisição concluída e cancelamento", () => {
  it("concluída não aceita alterações; repetir 'concluir' é inofensivo; só admin reabre", async () => {
    const p = await createProduct(w, 20);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 5 }]);
    asWarehouse();
    expect((await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id))).status).toBe(200);
    expect(await stockOf(p.id)).toBe(15);

    // repetir é idempotente
    expect((await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id))).status).toBe(200);
    expect(await stockOf(p.id)).toBe(15);

    // alterar quantidades ou reabrir (como almoxarife) é recusado
    const edit = await patchRequest(jsonReq("PATCH", { items: [{ id: items[0].id, deliveredQty: 1 }] }), ctx(request.id));
    expect(edit.status).toBe(400);
    expect((await edit.json()).code).toBe("REQUEST_COMPLETED");
    expect((await patchRequest(jsonReq("PATCH", { status: "in_progress" }), ctx(request.id))).status).toBe(400);
    expect((await requestOf(request.id)).status).toBe("completed");

    // admin reabre
    asAdmin();
    expect((await patchRequest(jsonReq("PATCH", { status: "in_progress" }), ctx(request.id))).status).toBe(200);
    expect((await requestOf(request.id)).status).toBe("in_progress");
  });

  it("não cancela com itens entregues; depois de zerar (estorno) cancela e o estoque volta", async () => {
    const p = await createProduct(w, 30);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 6 }]);
    asWarehouse();
    await patchRequest(jsonReq("PATCH", { items: [{ id: items[0].id, deliveredQty: 4 }] }), ctx(request.id));
    expect(await stockOf(p.id)).toBe(26);

    const refused = await patchRequest(jsonReq("PATCH", { status: "cancelled" }), ctx(request.id));
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe("HAS_DELIVERED_ITEMS");
    expect(await stockOf(p.id)).toBe(26);
    expect((await requestOf(request.id)).status).not.toBe("cancelled");

    const ok = await patchRequest(
      jsonReq("PATCH", { status: "cancelled", items: [{ id: items[0].id, deliveredQty: 0 }] }),
      ctx(request.id),
    );
    expect(ok.status).toBe(200);
    expect(await stockOf(p.id)).toBe(30);
    expect((await requestOf(request.id)).status).toBe("cancelled");
    expect((await itemOf(items[0].id)).deliveredQty).toBe(0);
  });
});

describe("2.6 importação", () => {
  function csvRequest(rows: string[], mode: "insert" | "upsert") {
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("unitId", String(w.unit.id));
    fd.set("file", new Blob([["sku;name;unit", ...rows].join("\n")], { type: "text/csv" }), "produtos.csv");
    return new Request("http://localhost/api/produtos/import", { method: "POST", body: fd });
  }

  it("não duplica SKU que só difere na caixa (insert ignora, upsert atualiza o existente)", async () => {
    const sku = `Imp-${uid()}`;
    const [existing] = await db
      .insert(schema.products)
      .values({ unitId: w.unit.id, sku, name: "Original", unit: "UN", stock: 3 })
      .returning();
    asAdmin();

    let res = await importProducts(csvRequest([`${sku.toLowerCase()};Mudou;CX`], "insert"));
    expect(res.status).toBe(200);
    let rows = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), sql`lower(${schema.products.sku}) = ${sku.toLowerCase()}`));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Original");

    res = await importProducts(csvRequest([`${sku.toUpperCase()};Mudou;CX`], "upsert"));
    expect(res.status).toBe(200);
    rows = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), sql`lower(${schema.products.sku}) = ${sku.toLowerCase()}`));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
    expect(rows[0].name).toBe("Mudou");
    expect(rows[0].unit).toBe("CX");
    expect(rows[0].stock).toBe(3); // importação não mexe no estoque
  });
});

describe("2.6 importação de planilha (.xlsx)", () => {
  it("lê um .xlsx com cabeçalhos em português e cria os produtos", async () => {
    const XLSX = await import("xlsx");
    const sku = `XLS-${uid()}`;
    const ws = XLSX.utils.aoa_to_sheet([
      ["Código", "Descrição", "Unidade"],
      [sku, "Produto da planilha", "CX"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const fd = new FormData();
    fd.set("mode", "insert");
    fd.set("unitId", String(w.unit.id));
    fd.set("file", new Blob([new Uint8Array(buf)]), "produtos.xlsx");

    asAdmin();
    const res = await importProducts(new Request("http://localhost/api/produtos/import", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    expect((await res.json()).type).toBe("excel");

    const rows = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), eq(schema.products.sku, sku)));
    expect(rows).toHaveLength(1);
    expect([rows[0].name, rows[0].unit]).toEqual(["Produto da planilha", "CX"]);
  });
});

describe("2.2 unidades", () => {
  const uctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

  it("código precisa ter 5 dígitos e a alteração é auditada", async () => {
    asAdmin();
    expect((await patchUnit(jsonReq("PATCH", { code: "12" }), uctx(w.otherUnit.id))).status).toBe(400);

    const res = await patchUnit(jsonReq("PATCH", { name: "Renomeada" }), uctx(w.otherUnit.id));
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe("Renomeada");
    expect(await auditCount("units", w.otherUnit.id, "UPDATE")).toBe(1);
  });
});
