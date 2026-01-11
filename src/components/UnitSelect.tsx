"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "admin" | "store" | "warehouse" | undefined;

type Unit = {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  isPrimary?: boolean;
};

export default function UnitSelect({
  role,
  value,
  onChange,
}: {
  role: Role;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [primaryUnitId, setPrimaryUnitId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const visibleUnits = useMemo(
    () => units.filter((u) => u.isActive),
    [units],
  );

  // carrega unidades do usuário (para todos os perfis)
  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const r = await fetch("/api/me/units", { cache: "no-store" });
        const txt = await r.text();
        const j = txt ? JSON.parse(txt) : null;

        if (!alive) return;
        if (!r.ok) {
          setUnits([]);
          setPrimaryUnitId(null);
          return;
        }

        setUnits((j?.data ?? []) as Unit[]);
        setPrimaryUnitId((j?.primaryUnitId ?? null) as number | null);
      } catch {
        if (!alive) return;
        setUnits([]);
        setPrimaryUnitId(null);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  // auto-seleciona unidade quando ainda não tem value
  useEffect(() => {
    if (loading) return;
    if (visibleUnits.length === 0) return;

    // admin pode ficar em "Todas" em telas que aceitam (value = null)
    // mas store/warehouse precisam sempre ter unitId
    if (role !== "admin" && value == null) {
      const preferred =
        (primaryUnitId != null
          ? visibleUnits.find((u) => u.id === primaryUnitId)?.id
          : undefined) ??
        visibleUnits[0]?.id ??
        null;

      if (preferred != null) onChange(preferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, role, value, primaryUnitId, visibleUnits.length]);

  const canChange = role === "admin" ? true : visibleUnits.length > 1;
  const disabled = loading || !canChange;

  async function setPrimary(unitId: number) {
    try {
      await fetch("/api/me/units/primary", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unitId }),
      });
      setPrimaryUnitId(unitId);
    } catch {
      // se falhar, não quebra a UI; só não persiste
    }
  }

  return (
    <select
      className="w-full rounded-xl border border-gray-300 px-3 py-2"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        const v = raw ? Number(raw) : null;

        onChange(Number.isFinite(v as number) ? (v as number) : null);

        // store/warehouse: persistir primária no banco
        if (role !== "admin" && v != null && Number.isFinite(v)) {
          void setPrimary(v);
        }
      }}
    >
      {role === "admin" && <option value="">Todas</option>}

      {visibleUnits.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.code})
        </option>
      ))}
    </select>
  );
}
