# Consulta técnica à SoftExpert: revisão em registro descendente incluído por API

Precisamos incluir posicionamentos em uma grid de Workflow por APIs oficiais, preservando a equivalência com o registro manual. Não utilizaremos INSERT/UPDATE nas tabelas internas nem movimentaremos atividades para apenas registrar o retorno.

Entidade principal: `itsm` (`DYNITSM`). Entidade descendente: `ITSMGRIDREGISTR` (`DYNITSMGRIDREGISTR`). Relacionamento: `relagridregistr`.

Nos registros nativos, a coluna `OIDREVISIONFORM` referencia o OID `8a80938c83894b86018389e31c6f0130`, confirmado em `EFREVISIONFORM` como o formulário `ITSMGRIDREGISTRO`, nome `Registro`, revisão vigente (`FGCURRENT=1`, CDREVISION 3198).

Nos testes de homologação do Workflow 036807:

1. `newChildEntityRecord` inclui o registro corretamente, mas `OIDREVISIONFORM` permanece NULL.
2. A REST oficial `POST /apigateway/v1/workflow/table-related-records` também retorna SUCCESS/1, inclui o registro, mas deixa a mesma coluna NULL. Foram informados `workflowId=036807`, `table=itsm`, `relationshipId=relagridregistr` e os campos lógicos em `records[].fields`.
3. A tentativa de atribuir `oidrevisionform` com o valor confirmado por `editChildEntityRecord` retorna FAILURE/-41: “Não foi encontrado um campo da tabela de formulário com este identificador”.

O dicionário de atributos lógicos não lista esse campo como atributo de negócio. A coluna é nullable e não encontramos FK física declarada para ela no catálogo consultado. Isso não esclarece o efeito funcional na aplicação.

Solicitamos orientação oficial:

1. É esperado que registros descendentes incluídos por essas APIs fiquem com OIDREVISIONFORM nulo? Há alguma diferença ao abrir/editar o registro, carregar regras, visualizar anexos ou utilizar o formulário no mobile?
2. Qual API ou operação suportada permite associar a revisão do formulário a um registro descendente, na inclusão ou na edição? Favor informar endpoint/operação, versão mínima, parâmetros e exemplo de requisição.
3. Há configuração de relacionamento/formulário que faça o preenchimento automático da revisão? Como verificar essa configuração?
4. Caso o preenchimento devesse ocorrer automaticamente, existe correção/patch aplicável? Como corrigir oficialmente os registros de homologação já incluídos, sem SQL direto nas tabelas internas?

Referência do teste REST: posicionamento `341bfb14c38b4153b911a6971b015292`, criado em 16/10/2026 às 16:49 America/Manaus. Foram conferidos vínculo, conteúdo e ausência de mudança no cabeçalho/processo/atividades.

Não estamos solicitando autorização para gravar diretamente em tabelas internas, e sim o mecanismo suportado para manter a integridade funcional da integração.
