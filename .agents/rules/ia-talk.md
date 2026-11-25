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
- **Sem dependência nova, sem framework, sem build.**
- Contrato faltando ou errado: registre em `apps/IA Talk/docs/andamento.md` e espere; não invente campo.
- Nenhuma chave, token ou número real em código, teste, captura ou log.
- Entrega = `node --test "apps/IA Talk/tests/*.test.js"` passando + capturas (1440/390 px, claro/escuro,
  vazio, carregando, erro) + lista de arquivos com caminho completo + linha atualizada no `andamento.md`.
