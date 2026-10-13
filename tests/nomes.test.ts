// tests/nomes.test.ts — nomes do solicitante e do repositor (integração, HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { GET as listRequests } from "@/app/api/requisicoes/route";
import { GET as getRequest, PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { createProduct, createRequest, createWorld, ctx, destroyWorld, jsonReq, loginAs, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  if (w) await destroyWorld(w);
});

describe("nomes na requisição", () => {
  it("concluída direto (sem 'assumir') mostra quem pediu e quem concluiu, no detalhe e na lista", async () => {
    const p = await createProduct(w, 10);
    const { request } = await createRequest(w, [{ productId: p.id, qty: 2 }]);

    loginAs(w.warehouse.id, "warehouse");
    expect((await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id))).status).toBe(200);

    // detalhe, visto pela LOJA: vê o nome do repositor que atendeu
    loginAs(w.store.id, "store");
    const d = (await (await getRequest(jsonReq("GET"), ctx(request.id))).json()).data;
    expect(d.createdBy.name).toBe("vitest store");
    expect(d.assignedTo).toBeNull();
    expect(d.completedBy).toMatchObject({ id: w.warehouse.id, name: "vitest warehouse" });

    // lista
    const list = await listRequests(jsonReq("GET", undefined, `http://localhost/api/requisicoes?unitId=${w.unit.id}&pageSize=100`));
    const row = (await list.json()).data.find((r: { id: number }) => r.id === request.id);
    expect(row.createdByName).toBe("vitest store");
    expect(row.responsibleName).toBe("vitest warehouse");
    expect(row.itemsCount).toBe(1);
  });

  it("quem assumiu aparece como responsável; pendente ainda não tem repositor", async () => {
    const p = await createProduct(w, 10);
    const a = await createRequest(w, [{ productId: p.id, qty: 1 }]);
    const b = await createRequest(w, [{ productId: p.id, qty: 1 }]);

    loginAs(w.warehouse.id, "warehouse");
    await patchRequest(jsonReq("PATCH", { status: "in_progress", assignToMe: true }), ctx(a.request.id));

    const list = await listRequests(jsonReq("GET", undefined, `http://localhost/api/requisicoes?unitId=${w.unit.id}&pageSize=100`));
    const rows = (await list.json()).data as { id: number; responsibleName: string | null }[];
    expect(rows.find((r) => r.id === a.request.id)?.responsibleName).toBe("vitest warehouse");
    expect(rows.find((r) => r.id === b.request.id)?.responsibleName).toBeNull();
  });
});
