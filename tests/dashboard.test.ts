// tests/dashboard.test.ts — métricas do dashboard (integração, HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { GET as dashboard } from "@/app/api/relatorios/dashboard/route";
import { PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { PATCH as patchItem } from "@/app/api/requisicoes/itens/[itemId]/route";
import { createProduct, createRequest, createWorld, ctx, destroyWorld, itemCtx, jsonReq, loginAs, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  if (w) await destroyWorld(w);
});

const get = async (qs = "") => {
  const res = await dashboard(jsonReq("GET", undefined, `http://localhost/api/relatorios/dashboard?${qs}`));
  return { res, body: res.status === 200 ? (await res.clone().json()).data : await res.clone().json() };
};

describe("dashboard", () => {
  it("exige admin", async () => {
    loginAs(null);
    expect((await get()).res.status).toBe(401);
    loginAs(w.warehouse.id, "warehouse");
    expect((await get()).res.status).toBe(403);
  });

  it("valida parâmetros", async () => {
    loginAs(w.admin.id, "admin");
    expect((await get("from=2026-13-01")).res.status).toBe(400);
    expect((await get("from=2026-02-01&to=2026-01-01")).res.status).toBe(400);
    expect((await get("from=2020-01-01&to=2026-01-01")).res.status).toBe(400);
    expect((await get("unitId=abc")).res.status).toBe(400);
  });

  it("calcula KPIs, rankings, produtividade e séries da unidade de teste", async () => {
    const p1 = await createProduct(w, 50);
    const p2 = await createProduct(w, 0);
    const a = await createRequest(w, [{ productId: p1.id, qty: 4 }, { productId: p2.id, qty: 6 }]);
    const b = await createRequest(w, [{ productId: p1.id, qty: 2 }]);
    await createRequest(w, [{ productId: p1.id, qty: 1 }]); // fica pendente

    // a: p2 sem estoque, p1 entregue -> concluída; b: concluída direto
    loginAs(w.warehouse.id, "warehouse");
    await patchItem(jsonReq("PATCH", { status: "unavailable", statusNote: "sem saldo" }), itemCtx(a.items[1].id));
    await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(a.request.id));
    await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(b.request.id));

    loginAs(w.admin.id, "admin");
    const { res, body } = await get(`unitId=${w.unit.id}`);
    expect(res.status).toBe(200);

    expect(body.kpis).toMatchObject({ total: 3, completed: 2, pending: 1, inProgress: 0, cancelled: 0 });
    expect(body.kpis.completionRate).toBeCloseTo(2 / 3);
    expect(body.kpis.avgHours).not.toBeNull();
    expect(body.kpis.items).toBe(4);
    expect(body.kpis.unavailableItems).toBe(1);
    expect(body.kpis.unavailableRate).toBeCloseTo(1 / 4);

    // série diária: 3 criadas e 2 concluídas hoje
    const sumCreated = body.byDay.reduce((s: number, d: { created: number }) => s + d.created, 0);
    const sumCompleted = body.byDay.reduce((s: number, d: { completed: number }) => s + d.completed, 0);
    expect([sumCreated, sumCompleted]).toEqual([3, 2]);

    // por unidade / solicitante / almoxarife
    expect(body.byUnit).toHaveLength(1);
    expect(body.byUnit[0]).toMatchObject({ unitId: w.unit.id, total: 3, completed: 2, open: 1, unavailableItems: 1 });
    expect(body.requesters[0]).toMatchObject({ userId: w.store.id, total: 3 });
    expect(body.warehouse[0]).toMatchObject({ userId: w.warehouse.id, completed: 2 });

    // produtos mais pedidos / mais sem estoque
    expect(body.topProducts.find((x: { sku: string }) => x.sku === p1.sku)).toMatchObject({ times: 3, qty: 7 });
    expect(body.topUnavailable).toHaveLength(1);
    expect(body.topUnavailable[0]).toMatchObject({ sku: p2.sku, unavailable: 1 });

    expect(body.byHour).toHaveLength(24);
    expect(body.byHour.reduce((s: number, h: { n: number }) => s + h.n, 0)).toBe(3);
    expect(body.byCriticality[0]).toMatchObject({ criticality: "restock", total: 3 });
    expect(body.openNow.pending).toBe(1);
    expect(body.openNow.oldest[0]).toMatchObject({ status: "pending" });
  });

  it("roda no volume real da homologação (sem filtro de unidade) em tempo razoável", async () => {
    loginAs(w.admin.id, "admin");
    const t0 = Date.now();
    const { res, body } = await get("from=2025-11-01&to=2026-12-01");
    expect(res.status).toBe(200);
    expect(body.kpis.total).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});
