# IA Talk — regras obrigatórias para o Antigravity

Vale sempre que a tarefa envolver o IA Talk (`apps/IA Talk/`). Antes de qualquer alteração, leia
por inteiro e siga:

1. `apps/IA Talk/AGENTS.md` — regras do produto.
2. `apps/IA Talk/docs/guia-antigravity.md` — sua trilha (G4 → G1 → G2 → G3 → G5 → A0, depois G6),
   donos de cada pasta, comandos, padrão de telas e o que é "pronto".
3. `apps/IA Talk/docs/contratos.md` — API e Socket.IO congelados.
4. `AGENTS.md` da raiz e `.claude/DESIGN.md` — padrões gerais do IAHub.

Resumo do que não pode faltar:

- Responder e escrever tudo em **português do Brasil**.
- **Só edite os caminhos do Antigravity** (guia §1). Nunca mexa fora de `apps/IA Talk/`: IA Command,
  IA Service, IAHUB, `index.js`, `packages/`, `deploy/`, `data/`, `tmp/` e arquivos de outras pessoas.
  Não apague arquivos que você não criou.
- Esta pasta é compartilhada com o Claude Code. **Não rode `git commit`, `git push`, `git checkout`,
  `git switch`, `git stash`, `git reset` nem `git clean`.** Quem faz commit é o usuário, depois da revisão.
- **Telas:** HTML e JS puros com `/app/ia-talk/ui/css/iahub.css` + `/app/ia-talk/css/talk.css`, shell com
  abas (cada tela é um HTML aberto em iframe), grade Tabulator 6.3.1 com agrupamento
  (`grid-group-panel.js`), chamadas só por `TalkApi`, estados por `TalkUI`. Modelo obrigatório:
  `apps/IA Talk/frontend/empresas.html`. Referências visuais: Histórico de Interpretações (IA Command)
  e Jobs (IA Gestão).
- **Cada tela do Talk copia uma tela que já existe no IA Service / IA Command** (estrutura, componentes,
  espaçamentos e comportamento). Antes de escrever uma tela, abra a tela modelo e siga-a:

  | Tela do IA Talk | Tela modelo (copiar o padrão) |
  |---|---|
  | Qualquer lista com filtro, agrupamento e detalhe (usuários, aplicações, histórico de mensagens, eventos, auditoria) | `apps/IA Command/frontend/admin-interpretacoes-v2.html` (Histórico de Interpretações) + agrupamento de `apps/IA Administracao/frontend/jobs.html` — já aplicado em `apps/IA Talk/frontend/empresas.html` |
  | Formulário de cadastro em página (usuário, aplicação) | `apps/IA Service/frontend/numeros-autorizados.html` (editor em página) e `apps/IA Command/frontend/admin-intencao-form.html` |
  | Página de entrada / login por telefone (`entrar.html`) | `apps/IA Service/frontend/entrar.html` |
  | Configurações (link, sites autorizados, e-mail de envio) | `apps/IA Service/frontend/config-ia.html` e `apps/IA Command/frontend/config-ia.html`; e-mail: "E-mail Geral" em `modules/configuracoes/frontend/configuracoes.html` |
  | Canais: lista, QR Code e terminal ao vivo | `apps/IA Command/frontend/whatsapp-services.html` e `apps/IA Command/frontend/admin-canais-whatsapp.html` |
  | Painel / monitoramento | `apps/IA Administracao/frontend/jobs.html` (painel) e `apps/IA Command/frontend/dashboard.html` |
  | Auditoria / histórico de acessos | `apps/IA Command/frontend/admin-auditoria.html` e `apps/IA Service/frontend/historico-acessos.html` |
  | Versão celular de listas muito usadas | `apps/IA Service/frontend/css/iaservice-mobile.css` (cartões) |

  Se a tela modelo e o `empresas.html` divergirem, vale o `empresas.html` (já adaptado ao Talk). Na entrega,
  inclua **uma captura da tela modelo ao lado da tela nova** e diga o que foi copiado e o que foi diferente, e por quê.
  A tela modelo exige login no IAHub; sem acesso, compare pelo código-fonte dela e liste os elementos copiados
  (nunca peça nem use senha de usuário real).
- **Sem dependência nova, sem framework, sem build.**
- Contrato faltando ou errado: registre em `apps/IA Talk/docs/andamento.md` e espere; não invente campo.
- Nenhuma chave, token ou número real em código, teste, captura ou log.
- Entrega = `node --test "apps/IA Talk/tests/*.test.js"` passando + capturas (1440/390 px, claro/escuro,
  vazio, carregando, erro) + lista de arquivos com caminho completo + linha atualizada no `andamento.md`.
