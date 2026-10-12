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
      <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-brand-200 bg-white shadow-md">
        <img
          src="/logo-grupo.png" // arquivo em /public/logo-grupo.png
          alt="Grupo Ana Sobral"
          className="h-full w-full object-contain"
        />
      </div>

      {showText && (
        <div className="text-center leading-tight">
          <div className="text-lg font-semibold text-brand-900">
            Grupo Ana Sobral
          </div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Sistema de Reposição · Loja ↔ Almoxarifado
          </div>
        </div>
      )}
    </Link>
  );
}
