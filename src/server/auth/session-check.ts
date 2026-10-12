// src/server/auth/session-check.ts
//
// O papel e o status do usuário ficam no JWT. Para que desativar ou rebaixar alguém
// tenha efeito rápido (e não só quando o token expira), cada leitura de sessão
// reconfere o usuário no banco, com um cache curto por instância.

import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

const TTL_MS = 30_000;

type Status = { at: number; active: boolean; role: string; name: string };
const cache = new Map<string, Status>();

export function clearSessionCache() {
  cache.clear();
}

async function loadStatus(userId: string): Promise<Status | null> {
  const id = Number(userId);
  if (!Number.isInteger(id)) return null;

  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const [u] = await db
    .select({ role: schema.users.role, isActive: schema.users.isActive, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);

  if (!u) {
    cache.delete(userId);
    return null;
  }
  const status: Status = { at: Date.now(), active: u.isActive, role: u.role, name: u.name };
  cache.set(userId, status);
  return status;
}

type TokenLike = {
  sub?: string;
  role?: string;
  name?: string | null;
  invalid?: boolean;
  [k: string]: unknown;
};

/**
 * Atualiza o token com o estado atual do usuário no banco.
 * - usuário removido/inativo -> token.invalid = true (sessão deixa de valer)
 * - papel mudou -> token.role atualizado
 * Se o banco falhar, mantém o token como está (a rota que usa o banco vai falhar de qualquer jeito).
 */
export async function refreshTokenFromDb<T extends TokenLike>(token: T): Promise<T & { invalid?: boolean }> {
  if (!token.sub) return token;
  try {
    const s = await loadStatus(token.sub);
    if (!s || !s.active) {
      token.invalid = true;
    } else {
      token.invalid = false;
      token.role = s.role;
      token.name = s.name;
    }
  } catch (err) {
    console.error("Auth: falha ao revalidar usuário", err);
  }
  return token;
}
