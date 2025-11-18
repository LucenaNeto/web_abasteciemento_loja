// src/app/relatorios/page.tsx
import { redirect } from "next/navigation";

export default function RelatoriosIndexPage() {
  // sempre que acessar /relatorios, vai cair em /relatorios/requisicoes
  redirect("/relatorios/requisicoes");
}
