import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db, schema } from "@/server/db";
import { eq } from "drizzle-orm";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          // 🔎 Busca usuário por e-mail
          const rows = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, credentials.email))
            .limit(1);

          const user = rows[0];

          if (!user) {
            console.log("Auth: usuário não encontrado", credentials.email);
            return null;
          }

          if (!user.isActive) {
            console.log("Auth: usuário inativo", credentials.email);
            return null;
          }

          // 🔐 Confere senha
          const ok = await bcrypt.compare(
            credentials.password,
            user.passwordHash,
          );

          if (!ok) {
            console.log("Auth: senha inválida", credentials.email);
            return null;
          }

          // ✅ Usuário autenticado – devolve os dados que irão para o token/session
          return {
            id: String(user.id),
            name: user.name,
            email: user.email,
            role: user.role,
          } as any;
        } catch (err: any) {
          // 👇 Aqui vamos ver o erro real na Vercel
          console.error("Auth DB error:", err);
          // Devolve null para não explodir a página, mas marcar como credenciais inválidas
          return null;
        }
      },
    }),
  ],

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub) {
        (session.user as any).id = token.sub;
      }
      if (token?.role) {
        (session.user as any).role = token.role as string;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
