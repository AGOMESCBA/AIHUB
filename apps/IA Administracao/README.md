# IA Administracao

Sistema administrativo generico da plataforma IA Hub.

Responsabilidades:
- empresas
- usuarios
- sistemas
- permissoes globais
- configuracoes globais
- seguranca e auditoria

Este app deve conter apenas funcionalidades genericas reutilizaveis por todos os sistemas.

Estrutura atual:
- `frontend/`: telas administrativas globais
- `backend/`: reservado para servicos administrativos proprios

As rotas globais usadas pela Administracao hoje ficam em `apps/IAHUB/backend`,
pois fazem parte do core da plataforma.
