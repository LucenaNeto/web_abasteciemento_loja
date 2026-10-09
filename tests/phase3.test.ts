// tests/phase3.test.ts — marcos de tempo e cancelamento pela loja (integração, HOMOLOGAÇÃO)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { db, schema } from "@/server/db";
import { GET as getRequest, PATCH as patchRequest } from "@/app/api/requisicoes/[id]/route";
import { GET as listRequests } from "@/app/api/requisicoes/route";
import {
  createProduct,
  createRequest,
  createWorld,
  ctx,
  destroyWorld,
  jsonReq,
  loginAs,
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

const asStore = () => loginAs(w.store.id, "store");
const asWarehouse = () => loginAs(w.warehouse.id, "warehouse");
const asAdmin = () => loginAs(w.admin.id, "admin");

async function newRequest(stock = 20, qty = 5) {
  const p = await createProduct(w, stock);
  const r = await createRequest(w, [{ productId: p.id, qty }]);
  return { p, ...r };
}

describe("3.1 marcos de tempo", () => {
  it("started_at no 1º 'em progresso' (e não muda depois), completed_at ao concluir, limpo ao reabrir", async () => {
    const { request } = await newRequest();
    asWarehouse();

    let r = await requestOf(request.id);
    expect([r.startedAt, r.completedAt, r.cancelledAt]).toEqual([null, null, null]);

    expect((await patchRequest(jsonReq("PATCH", { status: "in_progress", assignToMe: true }), ctx(request.id))).status).toBe(200);
    r = await requestOf(request.id);
    expect(r.startedAt).toBeInstanceOf(Date);
    expect(r.completedAt).toBeNull();
    const firstStart = r.startedAt!.getTime();

    // marcar "em progresso" de novo não mexe no início
    await patchRequest(jsonReq("PATCH", { status: "in_progress" }), ctx(request.id));
    expect((await requestOf(request.id)).startedAt!.getTime()).toBe(firstStart);

    expect((await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id))).status).toBe(200);
    r = await requestOf(request.id);
    expect(r.completedAt).toBeInstanceOf(Date);
    expect(r.completedAt!.getTime()).toBeGreaterThanOrEqual(firstStart);

    // admin reabre: completed_at some, started_at permanece
    asAdmin();
    await patchRequest(jsonReq("PATCH", { status: "in_progress" }), ctx(request.id));
    r = await requestOf(request.id);
    expect(r.completedAt).toBeNull();
    expect(r.startedAt!.getTime()).toBe(firstStart);
  });

  it("conclusão direta (sem passar por 'em progresso') grava só completed_at", async () => {
    const { request } = await newRequest();
    asWarehouse();
    await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(request.id));
    const r = await requestOf(request.id);
    expect(r.startedAt).toBeNull();
    expect(r.completedAt).toBeInstanceOf(Date);
  });
});

describe("3.2 loja cancela a própria requisição", () => {
  it("cancela, fica no histórico com quem/quando/motivo e não mexe no estoque", async () => {
    const { p, request } = await newRequest(20, 5);
    asStore();

    const res = await patchRequest(
      jsonReq("PATCH", { status: "cancelled", cancelReason: "  Pedi por engano  " }),
      ctx(request.id),
    );
    expect(res.status).toBe(200);

    const r = await requestOf(request.id);
    expect(r.status).toBe("cancelled");
    expect(r.cancelledByUserId).toBe(w.store.id);
    expect(r.cancelledAt).toBeInstanceOf(Date);
    expect(r.cancelReason).toBe("Pedi por engano");
    expect(await stockOf(p.id)).toBe(20);

    // continua no histórico (listagem) e o detalhe mostra quem cancelou
    const list = await listRequests(jsonReq("GET", undefined, `http://localhost/api/requisicoes?status=cancelled&unitId=${w.unit.id}`));
    const ids = (await list.json()).data.map((x: { id: number }) => x.id);
    expect(ids).toContain(request.id);

    const detail = await getRequest(jsonReq("GET"), ctx(request.id));
    expect((await detail.json()).data.cancelledBy.name).toBe("vitest store");

    // auditoria guarda o motivo
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.recordId, String(request.id)));
    expect(logs.some((l) => l.tableName === "requests" && (l.payload ?? "").includes("Pedi por engano"))).toBe(true);
  });

  it("loja não cancela requisição de outro usuário, nem já em atendimento, nem faz outras alterações", async () => {
    // de outro usuário (a fixture cria sempre como w.store; aqui a sessão é de uma 2ª loja da mesma unidade)
    const [other] = await db
      .insert(schema.users)
      .values({ name: "outra loja", email: `loja2-${uid()}@vitest.local`, passwordHash: "x", role: "store", isActive: true })
      .returning();
    w.extraUserIds.push(other.id);
    await db.insert(schema.userUnits).values({ userId: other.id, unitId: w.unit.id, isPrimary: true });

    const a = await newRequest();
    loginAs(other.id, "store");
    expect((await patchRequest(jsonReq("PATCH", { status: "cancelled" }), ctx(a.request.id))).status).toBe(403);

    // já em atendimento: só o almoxarifado cancela
    const b = await newRequest();
    asWarehouse();
    await patchRequest(jsonReq("PATCH", { status: "in_progress", assignToMe: true }), ctx(b.request.id));
    asStore();
    const late = await patchRequest(jsonReq("PATCH", { status: "cancelled" }), ctx(b.request.id));
    expect(late.status).toBe(400);
    expect((await late.json()).code).toBe("NOT_PENDING");

    // loja não entrega nem conclui nem assume
    const c = await newRequest();
    asStore();
    expect((await patchRequest(jsonReq("PATCH", { status: "completed" }), ctx(c.request.id))).status).toBe(403);
    expect((await patchRequest(jsonReq("PATCH", { status: "in_progress", assignToMe: true }), ctx(c.request.id))).status).toBe(403);
    expect((await patchRequest(jsonReq("PATCH", { items: [{ id: c.items[0].id, deliveredQty: 1 }] }), ctx(c.request.id))).status).toBe(403);
    expect((await requestOf(c.request.id)).status).toBe("pending");
  });

  it("loja sem vínculo com a unidade não cancela (403)", async () => {
    const { request } = await newRequest();
    // usuário 'store' sem vínculo: reaproveita o outsider como loja
    loginAs(w.outsider.id, "store");
    expect((await patchRequest(jsonReq("PATCH", { status: "cancelled" }), ctx(request.id))).status).toBe(403);
  });
});
