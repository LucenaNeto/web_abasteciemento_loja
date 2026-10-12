# Plano de entrada em produção

Regra do projeto: **nada em produção sem autorização explícita, a cada passo.** Este plano só vira ação
quando o Carlos disser "pode executar" para o passo em questão.

## 1. Situação verificada (leitura apenas, 2026-10-09)

| Item | Produção hoje | Observação |
|---|---|---|
| Banco | Supabase (conta antiga), PostgreSQL **17.6**, **102 MB** | Mesma versão major da homologação (17) |
| Migrações aplicadas | 5 (até `0004`) | Faltam `0005` e `0006` |
| Código no ar | `main` = `d0810b4` (antes de todas as fases) | `homolog` já tem tudo (PR #8) |
| Volume | ~27,9 mil requisições, 54 mil itens, 129 mil produtos, 163 mil logs | ~218 requisições nas últimas 24 h |
| Atividade | Seg–sáb, **08h–18h (Brasília)**; domingo e noite ≈ zero | Janela segura: **domingo** ou dia útil **após 19h** |
| Dados que poderiam quebrar o código novo | **Nenhum**: 0 e-mails duplicados/maiúsculos, 0 SKUs duplicados (ignorando caixa), 0 unidades fora do padrão, 0 usuários sem unidade, 2 admins ativos | |
| Backup | `npm run db:backup` testado em produção (somente leitura): 85 MB, contagens conferidas | Ver seção 4 |

## 2. Estratégia recomendada: duas etapas separadas

Misturar "código novo" e "banco novo" no mesmo dia soma os riscos. Separando, qualquer problema tem uma causa só.

- **Etapa A — Release do código novo** no banco de produção **atual** (migrações aditivas + deploy).
- **Etapa B — Mudança para o banco novo** (conta nova), depois de a Etapa A estar estável.

### Por que a Etapa A é de baixo risco

- As migrações `0005` e `0006` só **adicionam** colunas/tabela (todas opcionais) e **trocam um índice**.
  O código antigo continua funcionando com o banco migrado, então a ordem "migrar → publicar" não derruba nada.
- Voltar atrás = voltar o deploy na Vercel (Instant Rollback, ~30 s). O banco migrado não atrapalha o código antigo.
- Já foram ensaiadas na homologação com a cópia real dos dados (inclusive o preenchimento do histórico).

## 3. Pré-requisitos (antes de marcar a data)

- [ ] **Decisões do Carlos** (seção 8).
- [ ] Confirmar na Vercel, escopo **Production**, que `DATABASE_URL` e `NEXTAUTH_SECRET` existem e não foram
      alterados por engano (as variáveis de Production aparecem como "atualizadas há 4 h" em 2026-10-09).
      Teste simples: o sistema de produção deve continuar com login normal.
- [ ] Preview da `homolog` aprovado (feito: login funcionando).
- [ ] Roteiro de testes de homologação concluído (seção 6, itens 1–8).
- [ ] Combinar com o almoxarifado e as lojas o aviso da novidade (seção 7).
- [ ] Ter instalado o `pg_dump` **ou** confirmar o backup automático do Supabase da conta antiga (plano Pro tem; plano Free não).

## 4. Backups (sempre antes de qualquer mudança)

1. **Backup do Supabase** (painel da conta antiga → Database → Backups), se o plano permitir.
2. **Cópia lógica do projeto**: `npm run db:backup` → `backups/AAAA-MM-DDTHH-MM-SS/` (NDJSON + `manifest.json` com contagens e SHA-256).
   Contém dados reais e hashes de senha: guardar fora do repositório (a pasta já está no `.gitignore`) e apagar depois de 30 dias.
3. **`pg_dump`** (recomendado, formato restaurável):
   `pg_dump "<URL de sessão: mesma do pooler, porta 5432>" -Fc -f reposicao-AAAA-MM-DD.dump`
   (cliente PostgreSQL **17** — instalar só as "Command Line Tools").

Critério para seguir: pelo menos **2** dos 3 backups feitos e conferidos no mesmo dia.

## 5. Etapa A — Release (passo a passo do dia)

Duração estimada: 45–60 min. Sem indisponibilidade esperada. Sugestão: **domingo de manhã**.

| # | Passo | Quem | Como confirmar |
|---|---|---|---|
| A1 | Backups (seção 4) | Claude + Carlos | `manifest.json` com as contagens esperadas |
| A2 | Aplicar `0005` e `0006` em produção | Claude (com "pode executar") | Contador de migrações = **7**; `requests` com `started_at`, `completed_at`, `cancelled_*`; tabela `notifications`; índice `idx_im_ref` presente e `uq_im_req_item` ausente; contagens de tabelas iguais às do backup |
| A3 | Abrir PR **`homolog` → `main`** (base **main**) e juntar com *merge commit* | Carlos | PR marcado Merged; `main` = `homolog` |
| A4 | Vercel faz o deploy de Produção sozinho | automático | Deployment **Ready** |
| A5 | Testes de fumaça em produção (seção 6) | Carlos + Claude | Todos os itens OK |
| A6 | Acompanhar 24 h | Carlos | Logs da Vercel sem erros novos; fila andando; sino funcionando |

Comando da A2 (só no dia, com autorização), no PowerShell:

```powershell
Copy-Item .env.local .env.local.homo -Force        # guarda a homologação
Copy-Item .env.local.prod .env.local -Force        # ativa a produção
$env:ALLOW_PROD_DB="yes"; npx drizzle-kit migrate  # aplica 0005 e 0006
Remove-Item Env:ALLOW_PROD_DB
Copy-Item .env.local.homo .env.local -Force        # volta para a homologação
```

A trava `scripts/guard-db.ts` impede rodar isso sem `ALLOW_PROD_DB=yes`.

### Se algo der errado na Etapa A

| Problema | Ação |
|---|---|
| Migração falha | Parar. Conferir o contador de migrações; nada de deploy. Corrigir na homologação e repetir. |
| Deploy com erro de build | A Vercel mantém o deploy anterior no ar. Nada a fazer em produção. |
| Erro no sistema depois do deploy | **Vercel → Deployments → deploy anterior de Production → Instant Rollback.** O banco migrado continua compatível. |
| Dados incorretos (muito improvável) | Restaurar do backup (decisão conjunta; é o último recurso). |

## 6. Testes de fumaça (produção, usando a unidade de teste `99999 — VD TESTE`)

Usar só unidades de teste, para não criar lixo nos dados reais; cancelar as requisições criadas ao final.

1. Login com admin, loja e almoxarifado.
2. Lista de requisições e produtos carregam; contagens batem com o que se espera.
3. Loja cria requisição → almoxarife (outra janela) recebe aviso no sino e **som** (ligar o alerta).
4. Almoxarife marca um item **Sem estoque** → loja recebe o aviso; lista mostra "⚠ sem estoque".
5. Entrega parcial, depois concluir; conferir o estoque do produto de teste.
6. Cancelamento pela loja (requisição pendente) com motivo.
7. Imprimir **A4** e **térmica**.
8. Dashboard (`/relatorios`) abre com dados reais e tempos razoáveis.
9. Login de um usuário **real** que não seja admin (com o consentimento dele) para confirmar o fluxo normal.

## 7. Comunicação aos usuários (modelo)

- **Almoxarifado:** "Agora há um sino 🔔 no menu. Clique nele e ative o *Alerta sonoro*: toca quando chega requisição
  nova da sua unidade (o navegador precisa estar aberto no sistema). Na tela de atender, o botão **Sem estoque**
  avisa a loja. Dá para imprimir a lista de separação (A4 ou térmica)."
- **Lojas:** "Você pode **cancelar** sua requisição enquanto estiver pendente. Se um item faltar, você recebe um aviso no sino
  e vê '⚠ sem estoque' na lista."
- **Todos:** layout novo com menu lateral; nada mudou na forma de criar e acompanhar requisições.

## 8. Etapa B — Mudança para o banco novo (conta nova)

**Pré-requisitos**
- Projeto de **produção** criado na conta nova: PostgreSQL **17**, mesma região (`sa-east-1`), URL do **pooler** (porta 6543) com IPv4.
- A Etapa A estável por pelo menos alguns dias.
- Script de cópia sem anonimização (`--keep-data`) — a preparar e ensaiar na homologação antes (o atual anonimiza).

**Passos (domingo, sem atividade)**
1. Aviso: sistema parado por ~30 min.
2. Backups (seção 4).
3. Aplicar **todas** as migrações no banco novo (`drizzle-kit migrate` → 7 migrações; confirmar com `db:generate` sem diferenças).
4. Copiar todos os dados (usuários reais, ids e sequências preservados) e **conferir contagens** tabela a tabela.
5. Na Vercel (Production): trocar `DATABASE_URL` para o pooler do banco novo; **girar** `NEXTAUTH_SECRET` (todos precisarão entrar de novo).
6. Redeploy de Produção; testes de fumaça (seção 6).
7. Manter o banco antigo **intacto e somente para consulta por 30 dias**; depois pausar/excluir.

**Voltar atrás:** trocar `DATABASE_URL` de volta para o banco antigo e redeploy (por isso o antigo fica intocado). Qualquer dado
criado no banco novo depois da virada precisaria ser reaplicado manualmente — por isso a janela é de baixa atividade.

## 9. Riscos conhecidos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Alguém usando o sistema durante a migração | Baixa (janela de domingo) | Migração aditiva e rápida; código antigo continua funcionando |
| Endereço do banco só IPv6 na Vercel | Já ocorreu na homologação | Sempre usar o **pooler** (`aws-1-sa-east-1.pooler.supabase.com`) |
| Estoque cadastrado nunca foi baixado pelo sistema (0 movimentações em produção) | Fato | Com o código novo o estoque passa a baixar (pode ficar negativo após confirmação). **Alinhar com o almoxarifado como o estoque é controlado hoje** antes do release |
| Usuários não ativam o som | Alta | Comunicação (seção 7); o sino mostra "clique para liberar o som" |
| Senha do banco exposta em capturas/chat | Ocorreu (homologação) | Resetar após os testes; nunca colar URLs completas |
| 2.528 requisições "em progresso" antigas aparecem no dashboard | Fato | Está no backlog; avaliar limpeza com o almoxarifado |

## 10. Decisões do Carlos (2026-10-09)

1. Projeto de **produção na conta nova**: ainda **não existe** → a Etapa B fica para depois.
2. Estratégia em **duas etapas**: **aprovada**.
3. Etapa A: **domingo de manhã** (data a confirmar).
4. Conta antiga do Supabase **sem backup automático** → os backups da seção 4 (cópia lógica + `pg_dump`) são obrigatórios.
5. **O estoque é controlado em outro sistema.** Em produção 129.396 de 129.399 produtos têm estoque 0; por isso o
   controle de estoque do sistema fica **desligado** (`STOCK_CONTROL=off`, padrão): entregas registram só a
   quantidade entregue, sem aviso de estoque, movimentação ou baixa. Na Vercel (Production) definir
   `STOCK_CONTROL=off` explicitamente (é o padrão, mas fica documentado).
6. Testes de fumaça: o Carlos usa os dois perfis (loja e almoxarifado).

### Alterações de permissão aprovadas antes do release
- Dashboard (`/relatorios`) **liberado para todos os perfis**; loja e almoxarifado veem só as próprias unidades.
- Criação de usuários, de unidades e importação de produtos continuam **somente do admin** (ver `docs/PERMISSOES.md`).
