# Quem pode fazer o quê

Perfis: **Admin**, **Loja** (`store`) e **Almoxarifado** (`warehouse`).
Loja e almoxarifado só enxergam/operam as **unidades às quais estão vinculados**; o admin vê todas.
✅ = pode · ❌ = não pode · (observação entre parênteses)

## Requisições

| Ação | Admin | Loja | Almoxarifado |
|---|---|---|---|
| Ver lista e detalhe | ✅ todas | ✅ da(s) sua(s) unidade(s), inclusive de colegas | ✅ da(s) sua(s) unidade(s) |
| Criar requisição | ✅ (escolhe a unidade) | ✅ (nas suas unidades) | ❌ |
| Cancelar requisição pendente | ✅ | ✅ **somente a que ela mesma criou** | ✅ |
| Marcar "em progresso" / assumir | ✅ | ❌ | ✅ |
| Informar quantidades entregues e concluir | ✅ | ❌ | ✅ |
| Marcar item **Sem estoque** / desfazer | ✅ | ❌ | ✅ |
| Reabrir requisição concluída | ✅ | ❌ | ❌ |
| Imprimir (A4 / térmica) | ✅ | ✅ | ✅ |
| Fila de pendentes e tela de atender | ✅ | ❌ | ✅ |

Observações: cancelar exige que nenhum item tenha sido entregue; a loja só cancela enquanto está **pendente**
(depois que o almoxarifado começa, quem cancela é o almoxarifado/admin).

## Avisos (sino e som)

| Evento | Quem é avisado |
|---|---|
| Loja cria uma requisição | **Almoxarifes ativos vinculados à unidade** (toca o alerta sonoro, se ativado no navegador) |
| Item marcado "Sem estoque" | Quem criou a requisição |

Admin não recebe aviso de nova requisição. Cada usuário só vê e marca como lidos os **próprios** avisos.

## Produtos, unidades e usuários

| Ação | Admin | Loja | Almoxarifado |
|---|---|---|---|
| Consultar produtos (da unidade) | ✅ | ✅ | ✅ |
| Cadastrar / editar / ativar-inativar produto, ajustar estoque | ✅ | ❌ | ❌ |
| **Importar produtos** (CSV/XLSX) | ✅ | ❌ | ❌ |
| Listar unidades | ✅ todas | ✅ só as suas | ✅ só as suas |
| **Criar / editar / ativar unidades** | ✅ | ❌ | ❌ |
| **Criar / editar usuários, redefinir senha, vincular unidades** | ✅ | ❌ | ❌ |
| Trocar a própria unidade principal | ✅ | ✅ | ✅ |

## Relatórios e auditoria

| Ação | Admin | Loja | Almoxarifado |
|---|---|---|---|
| **Dashboard** (`/relatorios`) | ✅ todas as unidades | ✅ só as suas | ✅ só as suas |
| Relatório simples (`/relatorios/requisicoes`) | ✅ | ❌ | ❌ |
| Auditoria | ✅ | ❌ | ❌ |

O dashboard mostra, para loja e almoxarifado, também as tabelas por pessoa (solicitantes e produtividade do
almoxarifado) das suas unidades.

## Regras gerais

- Sessão de 7 dias; usuário desativado ou com papel alterado perde/muda o acesso em até 30 segundos.
- O admin não pode desativar nem rebaixar a si mesmo; sempre sobra ao menos um admin ativo.
- Toda alteração relevante fica na **auditoria** (usuários, unidades, produtos, requisições, estoque).
