// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import Topbar from "@/components/Topbar";

export const metadata: Metadata = {
  title: "Sistema de Reposição",
  description: "Loja ↔ Almoxarifado",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>
          <Topbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
