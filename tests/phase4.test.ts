// tests/phase4.test.ts — "sem estoque" e avisos (integração, HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { db, schema } from "@/server/db";
import { GET as listRequests, POST as createRequestApi } from "@/app/api/requisicoes/route";
import { PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { PATCH as patchItem } from "@/app/api/requisicoes/itens/[itemId]/route";
import { GET as getNotifications, PATCH as readNotifications } from "@/app/api/notificacoes/route";
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
  requestOf,
  stockOf,
  type World,
} from "./helpers";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  if (w) {
    // avisos referenciam usuários/requisições; saem em cascata, mas limpamos os do mundo de teste
    await destroyWorld(w);
  }
});

const asStore = () => loginAs(w.store.id, "store");
const asWarehouse = () => loginAs(w.warehouse.id, "warehouse");

async function notificationsOf(userId: number) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).orderBy(schema.notifications.id);
}

describe("4.3 aviso de nova requisição ao almoxarifado", () => {
  it("notifica o almoxarife da unidade (e só ele) quando a loja cria uma requisição", async () => {
    const p = await createProduct(w, 10);
    asStore();
    const res = await createRequestApi(
      jsonReq("POST", { items: [{ productId: p.id, requestedQty: 2 }], criticality: "cashier" }),
    );
    expect(res.status).toBe(201);
    const id = (await res.json()).data.id as number;

    const mine = await notificationsOf(w.warehouse.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "request_created", requestId: id, readAt: null });
    expect(mine[0].message).toContain(`#${id}`);
    expect(mine[0].message).toContain("URGENTE");

    expect(await notificationsOf(w.outsider.id)).toHaveLength(0); // almoxarife sem vínculo com a unidade
    expect(await notificationsOf(w.store.id)).toHaveLength(0); // quem criou não é avisado
  });

  it("GET /api/notificacoes devolve só os avisos do próprio usuário e permite marcar como lidos", async () => {
    asWarehouse();
    let res = await getNotifications();
    let body = await res.json();
    expect(body.unreadCount).toBe(1);
    expect(body.latestId).toBeGreaterThan(0);

    // outro usuário não consegue marcar o aviso alheio
    loginAs(w.store.id, "store");
    await readNotifications(jsonReq("PATCH", { ids: [body.data[0].id] }));
    asWarehouse();
    expect((await (await getNotifications()).json()).unreadCount).toBe(1);

    await readNotifications(jsonReq("PATCH", { all: true }));
    res = await getNotifications();
    body = await res.json();
    expect(body.unreadCount).toBe(0);
    expect(body.data[0].readAt).not.toBeNull();
  });

  it("sem login: 401", async () => {
    loginAs(null);
    expect((await getNotifications()).status).toBe(401);
  });
});

describe("4.2 item sem estoque avisa o solicitante", () => {
  it("marca sem estoque (com observação), notifica quem pediu uma única vez e permite concluir o resto", async () => {
    const p1 = await createProduct(w, 10);
    const p2 = await createProduct(w, 0);
    const { request, items } = await createRequest(w, [
      { productId: p1.id, qty: 3 },
      { productId: p2.id, qty: 4 },
    ]);
    asWarehouse();

    let res = await patchItem(jsonReq("PATCH", { status: "unavailable", statusNote: "  acabou ontem " }), itemCtx(items[1].id));
    expect(res.status).toBe(200);
    expect((await itemOf(items[1].id)).status).toBe("unavailable");
    expect((await itemOf(items[1].id)).statusNote).toBe("acabou ontem");

    // repetir não duplica o aviso
    await patchItem(jsonReq("PATCH", { status: "unavailable", statusNote: "acabou ontem" }), itemCtx(items[1].id));
    const notes = (await notificationsOf(w.store.id)).filter((n) => n.type === "item_unavailable");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ requestId: request.id, requestItemId: items[1].id });
    expect(notes[0].message).toContain("sem estoque");
    expect(notes[0].message).toContain("acabou ontem");

    // a loja vê o aviso na API dela e o contador na lista de requisições
    asStore();
    expect((await (await getNotifications()).json()).unreadCount).toBeGreaterThanOrEqual(1);
    const list = await listRequests(jsonReq("GET", undefined, `http://localhost/api/requisicoes?unitId=${w.unit.id}&pageSize=100`));
    const row = (await list.json()).data.find((r: { id: number }) => r.id === request.id);
    expect(row.unavailableCount).toBe(1);

    // concluir entrega o que existe e não exige o item sem estoque
    asWarehouse();
    res = await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    expect(res.status).toBe(200);
    expect(await stockOf(p1.id)).toBe(7);
    expect(await stockOf(p2.id)).toBe(0); // nada baixou do item sem estoque
    expect((await itemOf(items[1].id)).status).toBe("unavailable");
    expect((await requestOf(request.id)).status).toBe("completed");
  });

  it("salvar a tela sem mexer na quantidade não desfaz o 'sem estoque'; desfazer volta ao normal", async () => {
    const p = await createProduct(w, 10);
    const { request, items } = await createRequest(w, [
      { productId: p.id, qty: 5 },
      { productId: (await createProduct(w, 10)).id, qty: 1 },
    ]);
    asWarehouse();
    await patchItem(jsonReq("PATCH", { status: "unavailable", statusNote: "sem saldo" }), itemCtx(items[0].id));

    // "salvar parcial" da tela envia todas as quantidades atuais
    await patchRequest(
      jsonReq("PATCH", { items: [{ id: items[0].id, deliveredQty: 0 }, { id: items[1].id, deliveredQty: 0 }] }),
      ctx(request.id),
    );
    expect((await itemOf(items[0].id)).status).toBe("unavailable");

    // chegou produto: desfaz
    const res = await patchItem(jsonReq("PATCH", { status: "pending" }), itemCtx(items[0].id));
    expect(res.status).toBe(200);
    const it0 = await itemOf(items[0].id);
    expect([it0.status, it0.statusNote]).toEqual(["pending", null]);

    // desfazer algo que não está sem estoque é recusado
    expect((await patchItem(jsonReq("PATCH", { status: "pending" }), itemCtx(items[1].id))).status).toBe(400);
  });

  it("só almoxarifado/admin marcam sem estoque", async () => {
    const p = await createProduct(w, 1);
    const { items } = await createRequest(w, [{ productId: p.id, qty: 1 }]);
    asStore();
    expect((await patchItem(jsonReq("PATCH", { status: "unavailable" }), itemCtx(items[0].id))).status).toBe(403);
    expect((await itemOf(items[0].id)).status).toBe("pending");
  });

  it("todos os itens sem estoque encerram a requisição sem movimentar estoque", async () => {
    const p = await createProduct(w, 5);
    const { request, items } = await createRequest(w, [{ productId: p.id, qty: 2 }]);
    asWarehouse();
    await patchItem(jsonReq("PATCH", { status: "unavailable" }), itemCtx(items[0].id));
    const r = await requestOf(request.id);
    expect(r.status).toBe("completed");
    expect(r.completedAt).toBeInstanceOf(Date);
    expect(await stockOf(p.id)).toBe(5);
  });
});
