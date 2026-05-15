# IA Command

Sistema conversacional para consultas e comandos operacionais integrados ao ERP.

## Responsabilidades

- dashboard do IA Command
- monitor de WhatsApp
- configuracao de conexoes ERP
- configuracao de IA
- intencoes, datasets, execucoes e auditoria

## Integracao com IAHub

- `system_code`: `ia-command`
- URL principal: `/app/ia-command`
- Shell interno: `/app/ia-command/shell.html`
- APIs: `/api/ia-command/*`

O acesso deve passar pelo IAHub e pelas validacoes globais de usuario, empresa,
sistema e permissoes. O app nao deve expor telas ou APIs sem
`requireSystemAccess('ia-command')`.

## Dados locais

O SQLite do sistema fica em `apps/IA Command/data/ia-command.db` e nao deve ser
versionado.
