// src/components/BrandLogo.tsx
import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  showText?: boolean;
  href?: string;
  className?: string;
};

export function BrandLogo({
  showText = true,
  href = "/",
  className = "",
}: BrandLogoProps) {
  return (
    <Link
      href={href}
      className={`inline-flex flex-col items-center gap-3 ${className}`}
    >
      {/* Logo bem destacada */}
      <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-gray-300 bg-white shadow-md">
        <Image
          src="/logo-grupo.png"   // 👈 usa direto do /public
          alt="Logo do Grupo"
          fill
          className="object-contain"
          priority
        />
      </div>

      {showText && (
        <div className="text-center leading-tight">
          <div className="text-lg font-semibold text-gray-900">
            Sistema de Reposição
          </div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Loja ↔ Almoxarifado
          </div>
        </div>
      )}
    </Link>
  );
}
