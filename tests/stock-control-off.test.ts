// tests/stock-control-off.test.ts — STOCK_CONTROL=off (estoque controlado fora do sistema)
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { PATCH as patchItem } from "@/app/api/requisicoes/itens/[itemId]/route";
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
afterEach(() => {
  process.env.STOCK_CONTROL = "on"; // volta ao padrão dos testes
});
afterAll(async () => {
  process.env.STOCK_CONTROL = "on";
  if (w) await destroyWorld(w);
});

describe("STOCK_CONTROL=off", () => {
  it("entrega com estoque 0 não pede confirmação, não mexe no estoque e não gera movimento", async () => {
    process.env.STOCK_CONTROL = "off";
    const p = await createProduct(w, 0);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 5 }]);
    loginAs(w.warehouse.id, "warehouse");

    // entrega parcial pela rota da requisição
    let res = await patchRequest(jsonReq("PATCH", { items: [{ id: items[0].id, deliveredQty: 2 }] }), ctx(request.id));
    expect(res.status).toBe(200);
    expect((await itemOf(items[0].id)).deliveredQty).toBe(2);

    // entrega pela rota do item e conclusão
    res = await patchItem(jsonReq("PATCH", { deliveredQty: 4 }), itemCtx(items[0].id));
    expect(res.status).toBe(200);
    res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(200);

    expect((await itemOf(items[0].id)).deliveredQty).toBe(5);
    expect((await requestOf(request.id)).status).toBe("completed");
    expect(await stockOf(p.id)).toBe(0); // estoque do sistema intocado
    expect(await movementsOf(p.id)).toHaveLength(0);
  });

  it("com STOCK_CONTROL=on o comportamento anterior continua (aviso 409 quando insuficiente)", async () => {
    process.env.STOCK_CONTROL = "on";
    const p = await createProduct(w, 0);
    const { request } = await createRequest(w, [{ productId: p.id, qty: 1 }]);
    loginAs(w.warehouse.id, "warehouse");
    const res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(409);
  });
});
