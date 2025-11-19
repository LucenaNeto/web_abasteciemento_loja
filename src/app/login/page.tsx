"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lê ?error=... da URL (ex.: CredentialsSignin)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const err = sp.get("error");
    if (err) {
      setErrorMsg(
        err === "CredentialsSignin"
          ? "Credenciais inválidas. Verifique e tente novamente."
          : "Não foi possível fazer login. Tente novamente."
      );
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    // Usamos o provider "credentials" definido no NextAuth
    const result = await signIn("credentials", {
      email,
      password,
      redirect: true,
      callbackUrl: "/", // depois vamos redirecionar para o dashboard
    });

    if (result?.error) {
      setErrorMsg("Falha ao autenticar. Revise suas credenciais.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      {/* Card com borda e sombra suave */}
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        
        {/* Logo Componentizada */}
        <div className="mb-6 flex justify-center">
          <BrandLogo showText />
        </div>

        <h1 className="text-center text-2xl font-semibold text-gray-900">
          Acessar o Sistema
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Faça login para continuar
        </p>

        {errorMsg && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              E-mail
            </label>
            <input
              type="email"
              autoComplete="email"
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Senha
            </label>
            <input
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-gray-900/10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-gray-900 px-4 py-2.5 font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>
              <span className="opacity-70">Esqueceu a senha?</span>{" "}
              <span className="opacity-50">(em breve)</span>
            </span>
            <Link href="/" className="hover:underline">
              Voltar à página inicial
            </Link>
          </div>
        </form>

        <p className="mt-6 text-[11px] text-gray-400 text-center">
          Em caso de dúvida, contate o setor de Inteligência.
        </p>
      </div>
    </main>
  );
}