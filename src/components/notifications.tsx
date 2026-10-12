// src/components/notifications.tsx
// Sino de avisos + alerta sonoro. Atualiza por consulta periódica (a Vercel é serverless,
// sem conexão aberta): a cada 30 s com a aba visível (~60 s em segundo plano) e ao voltar para a aba.
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export type AppNotification = {
  id: number;
  type: "request_created" | "request_cancelled" | "item_unavailable";
  requestId: number | null;
  message: string;
  createdAt: string;
  readAt: string | null;
};

// Consulta a cada 30 s com a aba visível e a cada ~60 s em segundo plano.
// (Plano Hobby da Vercel: 1 milhão de chamadas/mês; menos consultas = folga no limite.)
const POLL_MS = 30_000;
const SOUND_KEY = "alertaSonoro";

/* ---------- som (Web Audio: sem arquivos de áudio) ---------- */
type AudioCtor = typeof AudioContext;

function getAudioCtor(): AudioCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
}

function beep(ctx: AudioContext, freq: number, start: number, dur: number, gain = 0.25) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Nova requisição: dois toques agudos (chama atenção). Item sem estoque: toque grave descendente. */
function playTone(ctx: AudioContext, kind: "request" | "alert" | "test") {
  const t = ctx.currentTime + 0.02;
  if (kind === "alert") {
    beep(ctx, 520, t, 0.22);
    beep(ctx, 392, t + 0.25, 0.3);
  } else {
    beep(ctx, 880, t, 0.18);
    beep(ctx, 1175, t + 0.22, 0.28);
    if (kind === "request") {
      beep(ctx, 880, t + 0.7, 0.18);
      beep(ctx, 1175, t + 0.92, 0.28);
    }
  }
}

/* ---------- hook ---------- */
export function useNotifications(enabled: boolean) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const lastIdRef = useRef<number | null>(null); // null = ainda não carregou (sem som na 1ª carga)
  const soundOnRef = useRef(false);
  const baseTitleRef = useRef<string>("");

  // preferência guardada neste navegador
  useEffect(() => {
    try {
      const on = localStorage.getItem(SOUND_KEY) === "on";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSoundOn(on);
      soundOnRef.current = on;
    } catch {
      /* navegador sem localStorage: segue desligado */
    }
  }, []);

  const ensureAudio = useCallback(async () => {
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    if (ctxRef.current.state === "suspended") {
      try {
        await ctxRef.current.resume();
      } catch {
        /* bloqueado até haver interação */
      }
    }
    setAudioBlocked(ctxRef.current.state !== "running");
    return ctxRef.current;
  }, []);

  // navegadores só liberam som depois de uma interação: qualquer clique/tecla destrava
  useEffect(() => {
    if (!soundOn) return;
    const unlock = () => void ensureAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundOn, ensureAudio]);

  // ao abrir o sistema com o som ligado, já avisa se o navegador ainda está bloqueando (precisa de 1 clique)
  useEffect(() => {
    if (soundOn) void ensureAudio();
  }, [soundOn, ensureAudio]);

  const toggleSound = useCallback(async () => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* ignora */
    }
    if (next) {
      const ctx = await ensureAudio(); // o clique do usuário libera o áudio
      if (ctx && ctx.state === "running") playTone(ctx, "test");
    }
  }, [ensureAudio]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notificacoes", { cache: "no-store" });
      if (!r.ok) return; // 401 etc.: deslogado, não faz nada
      const j = (await r.json()) as { data: AppNotification[]; unreadCount: number; latestId: number };

      const prev = lastIdRef.current;
      if (prev !== null && j.latestId > prev) {
        const fresh = j.data.filter((n) => n.id > prev && !n.readAt);
        if (fresh.length > 0 && soundOnRef.current) {
          const ctx = ctxRef.current;
          if (ctx && ctx.state === "running") {
            playTone(ctx, fresh.some((n) => n.type === "request_created") ? "request" : "alert");
          } else {
            setAudioBlocked(true); // precisa de um clique na página
          }
        }
      }
      lastIdRef.current = j.latestId;
      setItems(j.data);
      setUnread(j.unreadCount);
    } catch {
      /* sem rede: tenta de novo no próximo ciclo */
    }
  }, []);

  // consulta periódica + ao voltar para a aba.
  // Continua mesmo com a aba em segundo plano (o navegador reduz a frequência para ~1 por minuto,
  // mas o aviso e o som ainda chegam): o almoxarife não precisa deixar a aba na frente.
  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    let tick = 0;
    const timer = window.setInterval(() => {
      tick++;
      // em segundo plano, consulta a cada 2 ciclos (~60 s)
      if (document.visibilityState === "visible" || tick % 2 === 0) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, load]);

  // contador no título da aba: "(2) Sistema de Reposição"
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!baseTitleRef.current) baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "");
    const base = document.title.replace(/^\(\d+\)\s*/, "") || baseTitleRef.current;
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread]);

  const markRead = useCallback(
    async (ids?: number[]) => {
      await fetch("/api/notificacoes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ids ? { ids } : { all: true }),
      }).catch(() => undefined);
      await load();
    },
    [load],
  );

  return { items, unread, soundOn, audioBlocked, toggleSound, markRead, ensureAudio };
}

/* ---------- sino ---------- */
type State = ReturnType<typeof useNotifications>;

function timeAgo(iso: string) {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  const min = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function NotificationBell({ state, variant }: { state: State; variant: "dark" | "light" }) {
  const [open, setOpen] = useState(false);
  const { items, unread, soundOn, audioBlocked, toggleSound, markRead, ensureAudio } = state;

  const blocked = soundOn && audioBlocked;
  const btn = blocked
    ? "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200" // som ligado, mas o navegador ainda não liberou
    : variant === "dark"
      ? "border-brand-700 text-brand-100 hover:bg-brand-800"
      : "border-gray-200 text-brand-900 hover:bg-gray-50";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `${unread} avisos não lidos` : "Avisos"}
        title={blocked ? "Som ligado, mas o navegador bloqueou: clique em qualquer lugar da página para liberar" : undefined}
        aria-expanded={open}
        className={`relative rounded-lg border p-2 ${btn}`}
      >
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-3 right-3 top-16 z-50 max-h-[70vh] overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl sm:left-4 sm:right-auto sm:w-96 lg:left-[17rem] lg:top-4">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold">Avisos</div>
              <button
                onClick={() => void markRead()}
                disabled={unread === 0}
                className="text-xs text-brand-700 underline disabled:text-gray-400 disabled:no-underline"
              >
                Marcar todos como lidos
              </button>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3 border-b bg-gray-50 px-4 py-2 text-xs text-gray-700">
              <span>
                Alerta sonoro neste navegador
                {soundOn && audioBlocked ? (
                  <button
                    onClick={() => void ensureAudio()}
                    className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"
                  >
                    clique para liberar o som
                  </button>
                ) : null}
              </span>
              <input
                type="checkbox"
                checked={soundOn}
                onChange={() => void toggleSound()}
                className="h-4 w-4 accent-brand-800"
              />
            </label>

            <ul className="max-h-[55vh] overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-gray-500">Nenhum aviso por enquanto.</li>
              ) : (
                items.map((n) => (
                  <li key={n.id} className={`border-b last:border-0 ${n.readAt ? "" : "bg-brand-50"}`}>
                    <Link
                      href={n.requestId ? `/requisicoes/${n.requestId}` : "/requisicoes"}
                      onClick={() => {
                        if (!n.readAt) void markRead([n.id]);
                        setOpen(false);
                      }}
                      className="block px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="flex items-start gap-2">
                        {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" />}
                        <div className="min-w-0">
                          <div className="text-sm leading-snug">{n.message}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{timeAgo(n.createdAt)}</div>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
