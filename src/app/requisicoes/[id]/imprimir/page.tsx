// src/app/requisicoes/[id]/imprimir/page.tsx
// Impressão da requisição: ?formato=a4 (padrão) ou ?formato=termica (bobina 80 mm).
"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

type Item = {
  id: number;
  requestedQty: number;
  deliveredQty: number;
  status: string;
  statusNote?: string | null;
  productSku: string | null;
  productName: string | null;
  productUnit: string | null;
};

type Detail = {
  id: number;
  status: string;
  criticality: "cashier" | "service" | "restock";
  note: string | null;
  createdAt: string;
  unit?: { code: string; name: string } | null;
  createdBy?: { name: string } | null;
  assignedTo?: { name: string } | null;
  items: Item[];
};

const STATUS: Record<string, string> = {
  pending: "Pendente",
  in_progress: "Em progresso",
  completed: "Concluída",
  cancelled: "Cancelada",
};
const CRIT: Record<string, string> = {
  cashier: "Caixa (urgente)",
  service: "Atendimento",
  restock: "Reposição",
};
const ITEM_STATUS: Record<string, string> = {
  unavailable: "SEM ESTOQUE",
  cancelled: "CANCELADO",
};

function fmtDate(iso: string) {
  // created_at é gravado em UTC (sem fuso): acrescenta Z para converter ao horário local
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function ImprimirRequisicaoPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const formato = search.get("formato") === "termica" ? "termica" : "a4";

  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/requisicoes/${params.id}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || `Falha (HTTP ${r.status})`);
        if (alive) setData(j.data);
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.id]);

  const totalQty = data?.items.reduce((s, i) => s + i.requestedQty, 0) ?? 0;

  return (
    <div className="print-root min-h-screen bg-gray-100 print:bg-white">
      {/* tamanho da página conforme o formato escolhido */}
      <style>{
        formato === "termica"
          ? "@media print { @page { size: 80mm auto; margin: 3mm; } html, body { background: #fff !important; } }"
          : "@media print { @page { size: A4; margin: 12mm; } html, body { background: #fff !important; } }"
      }</style>

      {/* barra de controle (não sai na impressão) */}
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 p-3 print:hidden">
        <Link href={`/requisicoes/${params.id}`} className="text-sm underline">
          ← Voltar
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/requisicoes/${params.id}/imprimir?formato=a4`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${formato === "a4" ? "border-brand-800 bg-brand-800 text-white" : "bg-white hover:bg-gray-50"}`}
          >
            A4
          </Link>
          <Link
            href={`/requisicoes/${params.id}/imprimir?formato=termica`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${formato === "termica" ? "border-brand-800 bg-brand-800 text-white" : "bg-white hover:bg-gray-50"}`}
          >
            Térmica 80 mm
          </Link>
          <button
            onClick={() => window.print()}
            disabled={!data}
            className="rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Imprimir
          </button>
        </div>
      </div>

      {err ? (
        <div className="mx-auto max-w-[210mm] rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{err}</div>
      ) : !data ? (
        <div className="mx-auto max-w-[210mm] p-6 text-gray-500">Carregando…</div>
      ) : formato === "termica" ? (
        <Termica data={data} totalQty={totalQty} />
      ) : (
        <A4 data={data} totalQty={totalQty} />
      )}
    </div>
  );
}

/* ---------------- A4 ---------------- */
function A4({ data, totalQty }: { data: Detail; totalQty: number }) {
  return (
    <article className="mx-auto w-[210mm] max-w-full bg-white p-[12mm] text-[11pt] text-black shadow print:w-auto print:p-0 print:shadow-none">
      <header className="flex items-center gap-4 border-b-2 border-black pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-grupo.png" alt="Grupo Ana Sobral" className="h-16 w-16 object-contain" />
        <div className="flex-1">
          <div className="text-xl font-bold">Grupo Ana Sobral</div>
          <div className="text-sm">Requisição de Reposição de Estoque</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">Nº {data.id}</div>
          <div className="text-xs">{fmtDate(data.createdAt)}</div>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div>
          <b>Unidade:</b> {data.unit ? `${data.unit.code} — ${data.unit.name}` : "-"}
        </div>
        <div>
          <b>Solicitante:</b> {data.createdBy?.name ?? "-"}
        </div>
        <div>
          <b>Prioridade:</b> {CRIT[data.criticality] ?? data.criticality}
        </div>
        <div>
          <b>Situação:</b> {STATUS[data.status] ?? data.status}
        </div>
        {data.assignedTo?.name ? (
          <div>
            <b>Separador:</b> {data.assignedTo.name}
          </div>
        ) : null}
        {data.note ? (
          <div className="col-span-2">
            <b>Observação:</b> {data.note}
          </div>
        ) : null}
      </section>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-200 text-left print:bg-gray-200">
            <th className="border border-black px-2 py-1.5 w-8">#</th>
            <th className="border border-black px-2 py-1.5 w-32">Código (SKU)</th>
            <th className="border border-black px-2 py-1.5">Produto</th>
            <th className="border border-black px-2 py-1.5 w-12 text-center">Un.</th>
            <th className="border border-black px-2 py-1.5 w-20 text-right">Solicitado</th>
            <th className="border border-black px-2 py-1.5 w-24 text-center">Separado</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={it.id} className="break-inside-avoid">
              <td className="border border-black px-2 py-1.5">{i + 1}</td>
              <td className="border border-black px-2 py-1.5 font-mono">{it.productSku ?? "-"}</td>
              <td className="border border-black px-2 py-1.5">
                {it.productName ?? "-"}
                {ITEM_STATUS[it.status] ? (
                  <div className="text-xs font-bold">
                    {ITEM_STATUS[it.status]}
                    {it.statusNote ? ` — ${it.statusNote}` : ""}
                  </div>
                ) : null}
              </td>
              <td className="border border-black px-2 py-1.5 text-center">{it.productUnit ?? "-"}</td>
              <td className="border border-black px-2 py-1.5 text-right font-semibold">{it.requestedQty}</td>
              <td className="border border-black px-2 py-1.5 text-center">
                {data.status === "completed" || it.deliveredQty > 0 ? it.deliveredQty : ""}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="border border-black px-2 py-1.5 text-right font-bold">
              Total ({data.items.length} {data.items.length === 1 ? "item" : "itens"})
            </td>
            <td className="border border-black px-2 py-1.5 text-right font-bold">{totalQty}</td>
            <td className="border border-black" />
          </tr>
        </tfoot>
      </table>

      <footer className="mt-12 grid grid-cols-3 gap-8 text-center text-xs break-inside-avoid">
        {["Solicitante", "Separador", "Conferente / Recebimento"].map((l) => (
          <div key={l}>
            <div className="border-t border-black pt-1">{l}</div>
            <div className="mt-1 text-[10px]">Data: ____/____/______</div>
          </div>
        ))}
      </footer>
    </article>
  );
}

/* ---------------- Térmica 80 mm ---------------- */
function Termica({ data, totalQty }: { data: Detail; totalQty: number }) {
  return (
    <article className="mx-auto w-[74mm] bg-white p-1 font-mono text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none">
      <div className="flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-grupo.png" alt="" className="h-12 w-12 object-contain" />
        <div className="mt-1 text-sm font-bold">GRUPO ANA SOBRAL</div>
        <div>REQUISIÇÃO DE REPOSIÇÃO</div>
      </div>

      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-base font-bold">Nº {data.id}</div>
      <div>{fmtDate(data.createdAt)}</div>
      <div>Unid.: {data.unit ? `${data.unit.code} ${data.unit.name}` : "-"}</div>
      <div>Solic.: {data.createdBy?.name ?? "-"}</div>
      <div>Prior.: {CRIT[data.criticality] ?? data.criticality}</div>
      {data.note ? <div>Obs.: {data.note}</div> : null}

      <div className="my-1 border-t border-dashed border-black" />
      {data.items.map((it, i) => (
        <div key={it.id} className="mb-1 break-inside-avoid">
          <div className="font-bold">
            {i + 1}. {it.productName ?? "-"}
          </div>
          <div className="flex justify-between">
            <span>{it.productSku ?? "-"}</span>
            <span className="font-bold">
              {it.requestedQty} {it.productUnit ?? ""}
            </span>
          </div>
          {ITEM_STATUS[it.status] ? (
            <div className="font-bold">
              ** {ITEM_STATUS[it.status]}
              {it.statusNote ? `: ${it.statusNote}` : ""} **
            </div>
          ) : null}
        </div>
      ))}

      <div className="my-1 border-t border-dashed border-black" />
      <div className="flex justify-between font-bold">
        <span>
          {data.items.length} {data.items.length === 1 ? "item" : "itens"}
        </span>
        <span>Total: {totalQty}</span>
      </div>

      <div className="mt-6 border-t border-black pt-0.5 text-center">Separador</div>
      <div className="mt-6 border-t border-black pt-0.5 text-center">Recebimento</div>
      <div className="mt-3 text-center text-[9px]">— fim —</div>
    </article>
  );
}
