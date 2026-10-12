// src/components/WhatsNew.tsx
// Aviso de novidades: aparece UMA vez para cada usuário (neste navegador) quando a versão sobe.
// Para publicar um novo aviso no futuro, troque RELEASE_NOTICE_ID e o conteúdo abaixo.
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export const RELEASE_NOTICE_ID = "2026-10-v1";
const STORAGE_KEY = `novidades:${RELEASE_NOTICE_ID}`;

type Role = "admin" | "store" | "warehouse";

const COMMON = [
  "Novo visual, com menu lateral e as cores do Grupo Ana Sobral.",
  "Sino 🔔 com os seus avisos (canto superior do menu).",
  "Dashboard com os indicadores da sua unidade (pedidos, tempos e produtos mais pedidos).",
];

const BY_ROLE: Record<Role, { title: string; items: string[] }> = {
  store: {
    title: "Para a Loja",
    items: [
      "Você pode cancelar a sua requisição enquanto ela estiver pendente (abra a requisição e clique em Cancelar). Ela continua no histórico.",
      "Se um item estiver sem estoque no almoxarifado, você recebe um aviso no sino e vê “⚠ sem estoque” na lista.",
      "Dá para imprimir a requisição (A4 ou térmica) na tela de detalhes.",
    ],
  },
  warehouse: {
    title: "Para o Almoxarifado",
    items: [
      "Alerta sonoro: toca quando uma loja da sua unidade cria uma requisição. Ative abaixo (vale para este navegador) e deixe o sistema aberto.",
      "Na tela de atender, o botão “Sem estoque” avisa a loja. Use “Desfazer” se o produto chegar.",
      "Imprima a lista de separação em A4 ou na impressora térmica (botão Imprimir na fila e nos detalhes).",
      "Atenção: requisição concluída não pode mais ser alterada (só o administrador reabre).",
    ],
  },
  admin: {
    title: "Para o Administrador",
    items: [
      "Dashboard completo, com todas as unidades, por usuário e exportação em CSV.",
      "Só o administrador cria usuários e unidades e importa produtos.",
      "Requisição concluída só pode ser reaberta pelo administrador.",
    ],
  },
};

export default function WhatsNew({
  role,
  soundOn,
  onToggleSound,
  openSignal,
}: {
  role?: Role;
  soundOn: boolean;
  onToggleSound: () => void;
  /** muda de valor quando alguém clica em “Novidades” no menu */
  openSignal: number;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // abre sozinho na primeira vez
  useEffect(() => {
    if (!role) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "seen") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOpen(true);
      }
    } catch {
      setOpen(true); // sem localStorage: mostra (uma vez por carregamento)
    }
  }, [role]);

  // abre quando clicam em “Novidades”
  useEffect(() => {
    if (openSignal > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "seen");
    } catch {
      /* ignora */
    }
  }

  if (!open || !role) return null;
  const mine = BY_ROLE[role];

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="novidades-titulo">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="bg-brand-900 px-6 py-5 text-white">
          <div className="text-xs uppercase tracking-wider text-brand-300">Grupo Ana Sobral</div>
          <h2 id="novidades-titulo" className="mt-1 text-xl font-semibold">
            Sistema atualizado — veja o que mudou
          </h2>
        </div>

        <div className="space-y-5 px-6 py-5 text-sm text-gray-800">
          <section>
            <h3 className="mb-1.5 font-semibold text-brand-900">Para todos</h3>
            <ul className="list-disc space-y-1 pl-5">
              {COMMON.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 font-semibold text-brand-900">{mine.title}</h3>
            <ul className="list-disc space-y-1 pl-5">
              {mine.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

          {role === "warehouse" && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
              <span className="flex items-center gap-2 font-medium text-brand-900">
                <Icon name="bell" className="h-5 w-5" />
                Ativar alerta sonoro neste computador
              </span>
              <input
                type="checkbox"
                checked={soundOn}
                onChange={onToggleSound}
                className="h-5 w-5 accent-brand-800"
              />
            </label>
          )}

          <p className="text-xs text-gray-500">
            Dúvidas? Fale com o setor de Inteligência. Você pode rever este aviso a qualquer momento em “Novidades”, no menu.
          </p>
        </div>

        <div className="border-t px-6 py-4 text-right">
          <button
            ref={closeRef}
            onClick={close}
            className="rounded-xl bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}
