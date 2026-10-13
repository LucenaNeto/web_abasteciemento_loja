# Etapa B — Mudança para o banco novo (conta nova do Supabase)

Pré-requisito: a Etapa A (código novo em produção) já está concluída e estável (feita em 2026-10-12/13).
Regra do projeto: nada em produção sem o "pode executar" do Carlos, passo a passo.

## 1. Como vamos copiar (testado em 2026-10-13)

**Método principal: `pg_dump` / `pg_restore` oficiais, rodando pelo Docker** (imagem `postgres:17`, já baixada).
Copia estrutura, dados, índices, chaves estrangeiras, sequências e a tabela de migrações do Drizzle.

- Backup de produção testado: `pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=drizzle`
  pelo pooler (**porta 6543**; a 5432 recusa conexão no projeto antigo). Gera ~8 MB em ~1 min.
- **Restauração provada** num PostgreSQL 17 limpo (container descartável): 10 unidades, 63 usuários, 129.459 produtos,
  28.285 requisições, 55.005 itens, 164.993 registros de auditoria, 1.134 avisos, 7 migrações, **30 índices, 14 chaves
  estrangeiras e 8 sequências iguais às da produção** (a diferença de poucas linhas é uso real durante a conferência).
- **Plano B:** o script `npm run db:copy-prod` (Node), já usado na homologação, com opção sem anonimização a preparar.

## 2. Pré-requisitos (Carlos)

1. Criar o projeto de **produção** na conta nova: PostgreSQL **17**, região **sa-east-1 (São Paulo)**, senha forte do banco.
2. Guardar a URL do **Transaction pooler** (porta 6543, usuário `postgres.<código-do-projeto>`) num arquivo local
   `.env.local.novo` (fora do git) com `DATABASE_URL=...` e `APP_ENV=production`. O Claude lê o arquivo sem mostrar a senha.
3. Conferir na conta nova: backups diários ligados (plano Pro) e, se quiser, PITR.
4. Escolher o **dia/hora** da virada (sugestão: domingo de manhã, sem movimento).
5. Plano **Pro da Vercel** (o Hobby é para uso não comercial).

## 3. Fases

### Fase B1 — Ensaio no banco novo (sem impacto nos usuários)
1. `pg_dump` da produção atual.
2. `pg_restore` no banco novo (vazio). Conferir contagens, índices, chaves e sequências.
3. **Endurecer a Data API** (`scripts/harden-supabase.sql`) no banco novo.
4. Rodar o sistema **localmente** apontando para o banco novo (`.env.local.novo`) e fazer o teste de fumaça.
5. Ensaiar também o plano B (cópia Node) se o `pg_restore` falhar pelo pooler (usar a conexão direta ou sessão).

### Fase B2 — Virada (domingo, ~40 min)
| # | Passo | Quem |
|---|---|---|
| 1 | Conferir que **não há requisições nas últimas 1–2 h**; avisar os usuários | Claude |
| 2 | Backup final: `db:backup` + `pg_dump` (guardar os dois) | Claude |
| 3 | **Congelar o banco antigo** (somente leitura): `ALTER DATABASE postgres SET default_transaction_read_only = on` e derrubar conexões abertas. Se alguém tentar gravar, **dá erro na hora** em vez de perder dado em silêncio | Claude (com "pode executar") |
| 4 | `pg_dump` final e `pg_restore` no banco novo (apagando o ensaio: `--clean --if-exists`) | Claude |
| 5 | Conferir contagens e a última requisição (mesmo id) nos dois bancos | Claude |
| 6 | Vercel (Production): trocar `DATABASE_URL` para o pooler do banco novo e **girar** `NEXTAUTH_SECRET` (todos entram de novo) | Carlos |
| 7 | Redeploy de Produção (Deployments → deploy atual → Redeploy) | Carlos |
| 8 | Teste de fumaça na unidade `99999 — VD TESTE` (criar, aviso/som, sem estoque, concluir, imprimir, dashboard) | Carlos + Claude |
| 9 | Aviso aos usuários: "voltou ao normal" | Carlos |

### Voltar atrás (se algo falhar nos passos 6–8)
1. Vercel: `DATABASE_URL` e `NEXTAUTH_SECRET` de volta aos valores antigos + Redeploy.
2. Banco antigo: `ALTER DATABASE postgres SET default_transaction_read_only = off`.
3. Dados criados no banco novo depois da virada seriam reaplicados à mão (janela pequena, domingo).

### Depois da virada
- Banco antigo **intacto e só leitura por 30 dias**; depois pausar/excluir.
- Trocar a senha do banco antigo e remover `.env.local.prod` antigo; renomear o novo para `.env.local.prod`.
- Atualizar `.env.example`/README com o novo projeto.

## 4. Segurança do Supabase (achado de 2026-10-13)

Produção e homologação estão com **RLS desligado** e **9/9 tabelas acessíveis aos papéis da API pública**
(`anon`/`authenticated`). Quem tiver a chave pública do projeto poderia ler/gravar tabelas (inclusive `users`, com hashes
de senha) pela Data API do Supabase. O sistema não usa essa API (conecta direto com o papel `postgres`, que ignora RLS).

Correção: `scripts/harden-supabase.sql` (liga RLS sem políticas + revoga permissões + novos padrões).
- **Homologação:** aplicado e testado — RLS em 9/9, 0 tabelas acessíveis, **51 testes de integração passam**.
- **Produção:** aplicar com aprovação (sem indisponibilidade; confirmar antes que nenhum outro sistema/planilha use
  a API do Supabase dessas tabelas).
- **Banco novo:** aplicar no ensaio (B1).

## 5. Riscos

| Risco | Mitigação |
|---|---|
| Escritas durante a virada ficam só no banco antigo | Congelar o antigo (passo 3) e escolher horário sem movimento |
| `pg_restore` pelo pooler (modo transação) falhar | Usar conexão de sessão/direta ou o plano B (cópia Node), ensaiado antes |
| Variáveis erradas na Vercel | Conferir host/usuário (formato `postgres.<código>@...pooler.supabase.com:6543`) antes do redeploy |
| Usuários deslogados pela troca do `NEXTAUTH_SECRET` | Esperado e avisado; é uma vantagem de segurança |
| Senha exposta em captura de tela | Nunca colar a URL completa; cobrir o campo da senha |
