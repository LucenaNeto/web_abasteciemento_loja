// src/lib/patchWithStockConfirm.ts
// PATCH que trata o aviso de estoque insuficiente da API (409 + code INSUFFICIENT_STOCK):
// pergunta ao usuário e, se confirmar, reenvia com confirmInsufficientStock: true.

type StockWarning = {
  sku: string;
  name: string;
  available: number;
  requested: number;
};

export async function patchWithStockConfirm(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const send = (extra?: Record<string, unknown>) =>
    fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });

  const resp = await send();
  if (resp.status !== 409) return resp;

  let json: { code?: string; warnings?: StockWarning[] } | null = null;
  try {
    json = await resp.clone().json();
  } catch {
    return resp;
  }
  if (json?.code !== "INSUFFICIENT_STOCK") return resp;

  const lines = (json.warnings ?? [])
    .map((w) => `• ${w.sku} — ${w.name}: entrega ${w.requested}, estoque no sistema ${w.available}`)
    .join("\n");

  const ok = window.confirm(
    `O estoque no sistema é menor que a quantidade a entregar:\n\n${lines}\n\nConfirmar a entrega mesmo assim?`,
  );
  if (!ok) return resp; // quem chamou mostra a mensagem de erro da API

  return send({ confirmInsufficientStock: true });
}
