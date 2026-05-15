# Arquitetura IA Hub

Este repositorio esta organizado por apps e packages compartilhados.

## Apps

### `apps/IAHUB`

Aplicacao principal da plataforma.

- login
- sessao
- selecao de empresa
- selecao de sistema
- multiempresa
- multisistema
- permissoes globais
- backend global da plataforma

### `apps/IA Administracao`

Interface administrativa global.

- empresas
- usuarios
- sistemas
- permissoes
- seguranca
- auditoria
- configuracoes globais

As rotas globais usadas pela Administracao ficam em `apps/IAHUB/backend`.

### `apps/IA Recruit`

Sistema de recrutamento.

- dashboard de recrutamento
- curriculos
- vagas
- funcoes
- analise de curriculos
- monitores de WhatsApp e e-mail
- integracoes SE
- IA e consumo por empresa

O `system_code` permanece `recrutamento` para compatibilidade com permissoes e
dados existentes.

## Packages

### `packages/ui`

Design system e helpers visuais compartilhados.

As URLs publicas continuam como `/css/...` e `/js/...` durante a transicao.

### `packages/auth`

Helpers de sessao, autenticacao e empresa ativa no frontend.

## Compatibilidade temporaria

As pastas `modules/` ainda existem por dois motivos:

- manter stubs de compatibilidade para imports antigos;
- manter algumas telas internas em `modules/*/frontend` ate uma migracao visual
  posterior.

Novos recursos devem nascer dentro de `apps/<Sistema>` ou `packages/<pacote>`,
nao em `modules/`, exceto quando forem stubs temporarios.

## IA Command

Sistema operacional conversacional integrado ao ERP.

- dashboard do IA Command
- monitor de WhatsApp
- conexoes ERP
- configuracao de IA
- intencoes, datasets, execucoes e auditoria

O `system_code` e `ia-command`. As telas e APIs ficam protegidas pelo IAHub via
`requireSystemAccess('ia-command')`.
