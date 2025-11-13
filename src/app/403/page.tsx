// src/app/403/page.tsx
export const metadata = { title: "Acesso negado • 403" };

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-gray-50 p-6">
      <section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-2xl">
          ⛔
        </div>

        <h1 className="mt-4 text-2xl font-semibold text-gray-900">Acesso negado</h1>
        <p className="mt-2 text-sm text-gray-600">
          Você não tem permissão para acessar esta página. Verifique seu perfil de acesso
          (Admin, Loja ou Almoxarifado).
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href="/"
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
          >
            ← Voltar ao início
          </a>
          <a
            href="/login"
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            Entrar com outra conta
          </a>
        </div>

        <p className="mt-6 text-xs text-gray-500">
          Precisa de acesso? Solicite a um Administrador a atribuição do seu perfil.
        </p>
      </section>
    </main>
  );
}
