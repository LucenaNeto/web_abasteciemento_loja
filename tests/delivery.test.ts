// tests/delivery.test.ts — integração (banco de HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { GET as getItem, PATCH as patchItem } from "@/app/api/requisicoes/itens/[itemId]/route";
import {
  createProduct,
  createRequest,
  createWorld,
  ctx,
  destroyWorld,
  itemCtx,
  itemOf,
  jsonReq,
  loginAs,
  movementsOf,
  requestOf,
  stockOf,
  type World,
} from "./helpers";

let w: World;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  if (w) await destroyWorld(w);
});

const asWarehouse = () => loginAs(w.warehouse.id, "warehouse");

describe("entrega e baixa de estoque", () => {
  it("duas entregas parciais geram 2 movimentos e baixam o total (bug do índice único)", async () => {
    const p = await createProduct(w, 100);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 10 }]);
    const itemId = items[0].id;
    asWarehouse();

    let res = await patchRequest(jsonReq("PATCH", { items: [{ id: itemId, deliveredQty: 3 }] }), ctx(request.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(97);
    expect((await itemOf(itemId)).status).toBe("partial");
    expect((await requestOf(request.id)).status).toBe("in_progress");

    res = await patchRequest(jsonReq("PATCH", { items: [{ id: itemId, deliveredQty: 7 }] }), ctx(request.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(93);

    res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(90);
    expect((await itemOf(itemId)).status).toBe("delivered");
    expect((await requestOf(request.id)).status).toBe("completed");

    const mv = await movementsOf(p.id);
    expect(mv.map((m) => [m.type, m.qty])).toEqual([["out", 3], ["out", 4], ["out", 3]]);
  });

  it("estoque insuficiente pede confirmação (409) e, confirmado, entrega e deixa negativo", async () => {
    const p = await createProduct(w, 2);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 5 }]);
    asWarehouse();

    let res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_STOCK");
    expect(body.warnings[0]).toMatchObject({ productId: p.id, available: 2, requested: 5 });
    expect(await stockOf(p.id)).toBe(2); // nada mudou
    expect((await itemOf(items[0].id)).deliveredQty).toBe(0);

    res = await patchRequest(
      jsonReq("PATCH", { status: "completed", confirmInsufficientStock: true }),
      ctx(request.id),
    );
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(-3);
    expect((await requestOf(request.id)).status).toBe("completed");
  });

  it("reduzir a quantidade entregue estorna o estoque (movimento 'in')", async () => {
    const p = await createProduct(w, 100);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 10 }]);
    asWarehouse();

    await patchRequest(jsonReq("PATCH", { items: [{ id: items[0].id, deliveredQty: 5 }] }), ctx(request.id));
    expect(await stockOf(p.id)).toBe(95);

    const res = await patchRequest(jsonReq("PATCH", { items: [{ id: items[0].id, deliveredQty: 2 }] }), ctx(request.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(98);
    const mv = await movementsOf(p.id);
    expect(mv.map((m) => [m.type, m.qty])).toEqual([["out", 5], ["in", 3]]);
  });

  it("a rota de item agora baixa estoque (antes não baixava)", async () => {
    const p = await createProduct(w, 50);
    const { request, items } = await createRequest(w, [
      { productId: p.id, qty: 4 },
    ]);
    asWarehouse();

    const res = await patchItem(jsonReq("PATCH", { deliveredQty: 4 }), itemCtx(items[0].id));
    expect(res.status).toBe(200);
    expect(await stockOf(p.id)).toBe(46);
    expect((await itemOf(items[0].id)).status).toBe("delivered");
    expect((await requestOf(request.id)).status).toBe("completed");
    expect(await movementsOf(p.id)).toHaveLength(1);
  });

  it("dois 'concluir' simultâneos baixam o estoque uma vez só", async () => {
    const p = await createProduct(w, 100);
    const { request } = await createRequest(w, [{ productId: p.id, qty: 10 }]);
    asWarehouse();

    const [a, b] = await Promise.all([
      patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id)),
      patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await stockOf(p.id)).toBe(90);
    const mv = await movementsOf(p.id);
    expect(mv.reduce((s, m) => s + m.qty, 0)).toBe(10);
  });

  it("item cancelado não recebe entrega e não impede concluir", async () => {
    const p1 = await createProduct(w, 10);
    const p2 = await createProduct(w, 10);
    const { request, items } = await createRequest(w, [
      { productId: p1.id, qty: 2 },
      { productId: p2.id, qty: 2 },
    ]);
    asWarehouse();

    expect((await patchItem(jsonReq("PATCH", { status: "cancelled" }), itemCtx(items[1].id))).status).toBe(200);
    const res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p1.id)).toBe(8);
    expect(await stockOf(p2.id)).toBe(10);
    expect((await requestOf(request.id)).status).toBe("completed");
  });
});

describe("acesso por unidade", () => {
  it("almoxarife sem vínculo com a unidade não atende (403)", async () => {
    const p = await createProduct(w, 10);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 1 }]);
    loginAs(w.outsider.id, "warehouse");

    const res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(403);
    const resItem = await patchItem(jsonReq("PATCH", { deliveredQty: 1 }), itemCtx(items[0].id));
    expect(resItem.status).toBe(403);
    expect(await stockOf(p.id)).toBe(10);
  });

  it("GET do item respeita a unidade do usuário", async () => {
    const p = await createProduct(w, 10);
    const { items } = await createRequest(w, [{ productId: p.id, qty: 1 }]);

    loginAs(w.outsider.id, "warehouse");
    expect((await getItem(jsonReq("GET"), itemCtx(items[0].id))).status).toBe(403);

    loginAs(w.store.id, "store");
    expect((await getItem(jsonReq("GET"), itemCtx(items[0].id))).status).toBe(200);

    loginAs(w.admin.id, "admin");
    expect((await getItem(jsonReq("GET"), itemCtx(items[0].id))).status).toBe(200);
  });

  it("sem login: 401", async () => {
    loginAs(null);
    expect((await patchRequest(jsonReq("PATCH", {}), ctx(1))).status).toBe(401);
    expect((await getItem(jsonReq("GET"), itemCtx(1))).status).toBe(401);
  });
});
