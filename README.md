# Sistema de Reposição — Grupo Ana Sobral

Requisições de reposição de estoque entre lojas e almoxarifado.
Next.js (App Router) · NextAuth · Drizzle ORM · Postgres (Supabase) · Vercel.

Papéis: `admin`, `store` (loja, cria requisições) e `warehouse` (almoxarifado, atende e baixa estoque).

## Ambientes e branches

| Branch | Ambiente | Banco |
|---|---|---|
| `main` | Produção | Supabase produção |
| `homolog` | Preview (Vercel) | Supabase homologação |
| `feat/*`, `fix/*`, `chore/*` | Local / preview | Homologação |

Regra: **nada é alterado em produção diretamente**. Todo trabalho nasce numa branch a partir de `homolog`,
é testado na homologação e só depois chega à `main` por pull request.

## Rodando localmente

```bash
cp .env.example .env.local   # preencha com os dados da HOMOLOGAÇÃO
npm install
npm run db:migrate           # aplica as migrações (drizzle_supabase/)
npm run dev
```

Arquivos locais de ambiente (todos fora do git): `.env.local` (ativo), `.env.local.prod` e `.env.local.homo` (guardados).

### Trava de segurança do banco

`db:migrate`, `db:studio` e `db:seed` exigem `APP_ENV` definido no `.env.local` (ver `scripts/guard-db.ts`).
Com `APP_ENV=production` eles são bloqueados, a menos que se rode com `ALLOW_PROD_DB=yes` de propósito.

## Scripts

- `npm run lint` · `npx tsc --noEmit` · `npm run build` — o mesmo que roda no CI.
- `npm run db:generate` — gera migração a partir de `src/server/db/schema.ts`.
- `npm run db:migrate` — aplica migrações no banco do `.env.local`.
- `npm run db:seed` — cria unidade padrão e admin (defina `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`).
