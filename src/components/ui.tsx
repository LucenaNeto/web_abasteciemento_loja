// src/components/ui.tsx
// Peças básicas do novo visual (tema verde do Grupo Ana Sobral).
// Usadas nas telas novas (Fase 4) e adotadas aos poucos nas antigas.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-950">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

type Variant = "primary" | "outline" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-800 text-white hover:bg-brand-700 disabled:bg-brand-800/50",
  outline: "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  ghost: "text-brand-800 hover:bg-brand-50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    />
  );
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  info: "bg-blue-100 text-blue-800",
  success: "bg-brand-100 text-brand-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Status de requisição com cor e rótulo padronizados. */
export function RequestStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    pending: { tone: "warning", label: "Pendente" },
    in_progress: { tone: "info", label: "Em progresso" },
    completed: { tone: "success", label: "Concluída" },
    cancelled: { tone: "danger", label: "Cancelada" },
  };
  const m = map[status] ?? { tone: "neutral" as Tone, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
