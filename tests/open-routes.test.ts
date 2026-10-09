// tests/open-routes.test.ts — rotas que estavam sem autenticação (integração, HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { GET as resolve } from "@/app/api/produtos/resolve/route";
import { GET as relatorio } from "@/app/api/relatorios/requisicoes/route";
import { createProduct, createRequest, createWorld, destroyWorld, jsonReq, loginAs, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  if (w) await destroyWorld(w);
});

const call = (fn: (r: Request) => Promise<Response>, url: string) => fn(jsonReq("GET", undefined, `http://localhost${url}`));

describe("GET /api/produtos/resolve", () => {
  it("exige login", async () => {
    loginAs(null);
    expect((await call(resolve, "/api/produtos/resolve?code=abc")).status).toBe(401);
  });

  it("resolve por SKU (sem diferenciar maiúsculas) e por ID, só dentro da unidade", async () => {
    const p = await createProduct(w, 5);
    const other = await createProduct(w, 5, w.otherUnit.id);
    loginAs(w.store.id, "store");

    let res = await call(resolve, `/api/produtos/resolve?code=${encodeURIComponent(p.sku.toLowerCase())}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(p.id);

    res = await call(resolve, `/api/produtos/resolve?code=${p.id}`);
    expect(res.status).toBe(200);

    // produto de outra unidade não aparece para quem é da unidade principal
    res = await call(resolve, `/api/produtos/resolve?code=${other.id}`);
    expect(res.status).toBe(404);

    // pedir explicitamente uma unidade sem vínculo é proibido
    res = await call(resolve, `/api/produtos/resolve?code=${other.id}&unitId=${w.otherUnit.id}`);
    expect(res.status).toBe(403);
  });

  it("admin precisa informar a unidade", async () => {
    loginAs(w.admin.id, "admin");
    expect((await call(resolve, "/api/produtos/resolve?code=x")).status).toBe(400);
  });
});

describe("GET /api/relatorios/requisicoes", () => {
  it("exige login e papel admin", async () => {
    loginAs(null);
    expect((await call(relatorio, "/api/relatorios/requisicoes")).status).toBe(401);
    loginAs(w.warehouse.id, "warehouse");
    expect((await call(relatorio, "/api/relatorios/requisicoes")).status).toBe(403);
  });

  it("funciona no Postgres e conta as requisições do período (por unidade)", async () => {
    const p = await createProduct(w, 5);
    await createRequest(w, [{ productId: p.id, qty: 1 }]);
    await createRequest(w, [{ productId: p.id, qty: 1 }]);
    loginAs(w.admin.id, "admin");

    const res = await call(relatorio, `/api/relatorios/requisicoes?unitId=${w.unit.id}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.totals.all).toBe(2);
    expect(data.totals.pending).toBe(2);
    expect(data.byDay.reduce((s: number, d: { count: number }) => s + d.count, 0)).toBe(2);
  });

  it("valida datas", async () => {
    loginAs(w.admin.id, "admin");
    expect((await call(relatorio, "/api/relatorios/requisicoes?from=2026-13-40")).status).toBe(400);
    expect((await call(relatorio, "/api/relatorios/requisicoes?from=2026-02-01&to=2026-01-01")).status).toBe(400);
  });
});
