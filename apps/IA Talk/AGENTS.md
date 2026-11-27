# IA Talk — regras para quem desenvolve aqui (Claude Code, Antigravity e Codex)

Vale junto com o `AGENTS.md` da raiz. Se houver conflito dentro de `apps/IA Talk/`, este arquivo vence.

**Plano e divisão de trabalho:** `docs/plano-produto.md` (ondas, etapas, dono de cada etapa).

**Para o Antigravity:** configure este arquivo e `docs/guia-antigravity.md` como regras do
workspace antes de começar. Depois leia `docs/contratos.md`.

**Para o Codex:** você faz **bibliotecas puras** em `backend/lib/<pasta da etapa>/` com testes em
`tests/x*-*.test.js` — sem banco, sem rede, sem tela, sem mexer em nenhum outro arquivo. Não rode
git que altere nada, não instale dependência, não faça commit. Siga o estilo de
`backend/lib/reentrega/index.js` (pt-BR, funções puras, instante por parâmetro). Ao terminar,
entregue a lista de arquivos com caminho completo; o Claude Code audita antes de ligar no sistema.

## Produto

IA Talk: mensageria e atendimento por WhatsApp, multiempresa, vendável sem o IAHub.
Processo próprio (`backend/servidor.js`, porta 3050), banco próprio (`data/ia-talk.db`),
tudo sob `/app/ia-talk/`. Fase 1: só WhatsApp Web; Meta preparada pela interface de provedor.

## Regras

1. **pt-BR** em telas, mensagens, nomes de campo da API e textos visíveis.
2. **Stack fechada:** Node + Express 4, HTML/JS puro com `iahub.css` (sem framework, sem build),
   Tabulator 6.3.1 (unpkg) para grades, SQLite (better-sqlite3), Socket.IO 4, `node:test`.
   Dependência nova só com aprovação do usuário.
3. **Dono de cada pasta:** tabela em `docs/guia-antigravity.md` §1. Nunca editar fora da sua
   coluna. Fora de `apps/IA Talk/` só o Claude Code mexe, e só em etapa aprovada.
4. **Contrato congelado:** `docs/contratos.md` + `backend/contratos/index.js`. Precisa mudar?
   Registre em `docs/andamento.md` e combine; não invente campo no front nem no back.
5. **Isolamento entre empresas:** empresa vem da sessão ou do token, nunca do corpo/URL. Dado de
   empresa só por `escopo(contexto)` (`backend/repositorios/base.js`). Registro de outra empresa = 404.
6. **Reaproveitar antes de criar:** apelido + login por telefone (J2iA), sites autorizados
   (IAHub), token de sessão servidor a servidor (chat Protheus), token por empresa (Agente
   Local), e-mail de envio ("E-mail Geral" do IA Recruit), telas de referência (Histórico de
   Interpretações, Jobs). Citar o arquivo de origem no comentário quando copiar um padrão.
7. **Segurança:** nenhuma chave, token ou senha no código, nos testes (só valores falsos) ou
   em `.env` para dado por empresa. Logs sem número completo, sem texto de mensagem e sem token.
   Token/segredo mostrado uma única vez.
8. **Estados honestos:** só o que o sistema ou o provedor comprova; `aceita` não é entrega;
   `desconhecida` nunca é reenviada sozinha; recurso não suportado é recusado (422), não simulado.
9. **Migrações:** só o Claude Code; nunca alterar versão publicada.
10. **Sem commit, push, pacote ou deploy** sem pedido explícito do usuário na mensagem atual.
11. **Pronto significa** testes passando + capturas (1440/390, claro/escuro, vazio, carregando,
    erro) + `docs/andamento.md` atualizado + lista de arquivos com caminho completo.
