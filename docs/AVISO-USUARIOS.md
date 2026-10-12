# Avisos aos usuários (textos prontos)

Há dois avisos: o **que aparece dentro do sistema** (já vem no código, só precisa subir) e os **textos para
enviar por WhatsApp/e-mail**.

## 1. Aviso dentro do sistema (automático)

- Ao entrar pela primeira vez depois da atualização, cada usuário vê a janela **"Sistema atualizado — veja o que mudou"**,
  com o conteúdo do **seu perfil** (loja, almoxarifado ou admin). Aparece **uma vez** por navegador; depois fica no botão
  **"Novidades"**, no rodapé do menu.
- No almoxarifado a janela traz a caixinha **"Ativar alerta sonoro neste computador"** (o clique já libera o som no navegador).
- Para publicar um novo aviso no futuro: trocar `RELEASE_NOTICE_ID` e o conteúdo em `src/components/WhatsNew.tsx`.

## 2. Texto para enviar ANTES (sábado ou na sexta)

> **Atualização do Sistema de Reposição — domingo de manhã**
> Neste domingo, pela manhã, vamos atualizar o sistema. Não deve haver indisponibilidade, mas se notar qualquer
> instabilidade, tente novamente em alguns minutos. Na segunda-feira o sistema terá **visual novo** e algumas
> novidades. Dúvidas: setor de Inteligência.

## 3. Texto para enviar DEPOIS (domingo, após os testes)

**Para todos**
> **Sistema de Reposição atualizado ✅**
> • Novo visual, com menu lateral
> • Sino 🔔 com seus avisos
> • Dashboard com indicadores da sua unidade
> Ao entrar, você verá uma janela com as novidades do seu perfil. Para rever depois, use **"Novidades"** no menu.

**Lojas**
> • Agora você pode **cancelar** sua requisição enquanto ela estiver **pendente** (abra a requisição e clique em Cancelar).
> • Se faltar um item no almoxarifado, você recebe um **aviso no sino** e vê "⚠ sem estoque" na lista.
> • Dá para **imprimir** a requisição (A4 ou térmica).

**Almoxarifado**
> • **Alerta sonoro** quando chega requisição nova da sua unidade: clique no sino 🔔 → ative "Alerta sonoro".
>   Funciona com o sistema aberto no navegador (pode ficar em outra aba). Depois de abrir ou atualizar a página, dê **um clique**
>   em qualquer lugar para o navegador liberar o som (o sino fica amarelo enquanto não liberar).
> • Botão **"Sem estoque"** na tela de atender: avisa a loja. Use "Desfazer" se o produto chegar.
> • **Imprimir** a lista de separação (A4 ou térmica).
> • Atenção: requisição **concluída não pode mais ser alterada** (só o administrador reabre).

## 4. Se algo der errado

> Estamos com uma instabilidade no sistema e já estamos resolvendo. Se precisar, continue o atendimento pelo
> processo anterior (anote e lance depois). Aviso assim que normalizar.
