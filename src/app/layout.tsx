// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Sistema de Reposição",
  description: "Loja ↔ Almoxarifado",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-surface text-gray-900">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
