# Backlog

Itens descobertos durante o trabalho, para tratar depois (fora do plano das fases atuais).

## Dados reais (cópia de produção, 2026-10-09)

- **2.528 requisições paradas em "em progresso"** (de 27.869). Descobrir com o almoxarifado se foram esquecidas
  ou se há motivo; avaliar uma rotina/alerta para requisições antigas em progresso.
- **81% das concluídas (20.450 de 25.302) nunca passaram por "em progresso"**: o almoxarifado conclui direto.
  O dashboard usa criação → conclusão; discutir se o fluxo "assumir/atender" deve ser obrigatório.
- **`inventory_movements` está vazio em produção** (0 movimentos em 27 mil requisições): o estoque cadastrado
  nunca foi baixado pelo sistema. Confirmar como o estoque é controlado hoje (outro sistema? planilha?).

## Produto

- Link "Exportar CSV (via API)" do relatório apontava para `/api/relatorios/requisicoes.csv` (não existe).
- `QuickNewRequestModal` não é usado em nenhuma tela: remover ou aproveitar.
- Aviso (sino) para o almoxarifado quando a loja **cancela** uma requisição (a tabela de avisos já suporta).
- Fila "Pendentes" só lista `pending`; avaliar incluir `in_progress`.
- Web Push (alerta com a aba fechada) como evolução do alerta sonoro.
- Esqueci a senha / troca de senha pelo próprio usuário.

## Técnico

- ~190 avisos de lint (`no-explicit-any` e `react-hooks/set-state-in-effect`): reduzir ao reescrever cada tela.
- Limite de tentativas de login (rate limit).
- Migrar `middleware.ts` para `proxy.ts` (Next 16).
- Remover pastas de migração legadas (`drizzle/`, `drizzle_sqlite_backup/`) e o placeholder `0003`.
- Rodar os testes de integração no CI (precisa de segredo com a URL da homologação).
- Índice único em `lower(email)` na tabela de usuários (verificar duplicatas antes).
- PR #1 do bot da Vercel (CVE) está obsoleto: as dependências já foram atualizadas.

## Virada para o banco novo de produção

- Aplicar migrações 0005 e 0006 **antes** do deploy do código novo.
- Variáveis na Vercel: `DATABASE_URL` / `NEXTAUTH_SECRET` por ambiente (Preview = homologação).
