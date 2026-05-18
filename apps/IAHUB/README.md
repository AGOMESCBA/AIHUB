# IAHUB

Aplicacao principal da plataforma.

Responsabilidades:
- login
- selecao de empresa
- selecao de sistema
- sessao e autenticacao central
- regras globais de multiempresa e multisistema
- redirecionamento para os sistemas

Estrutura atual:
- `frontend/`: telas principais do shell da plataforma
- `backend/`: modulos globais da plataforma
- `data/`: dados globais da plataforma, ignorados pelo git

Os assets compartilhados ficam em `packages/ui` e `packages/auth`.
Os caminhos antigos em `modules/` permanecem apenas como stubs temporarios de
compatibilidade para imports existentes.
