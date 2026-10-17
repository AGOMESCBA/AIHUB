# Correção do dono técnico — 036807

Em 16/10/2026, o usuário apontou no print que o analista do cabeçalho era **Edson Assis**, mas o posicionamento de homologação exibia **se Config**. No teste inicial, os campos da grid haviam sido preenchidos com a identidade da credencial da API. Isso comprovava quem executou a integração, mas não representava o dono técnico solicitado.

## Evidência e correção real

- ADUSER confirmou **Edson Assis, CDUSER 124**, habilitado.
- No momento da consulta, `DYNITSM.CDUSERANA` e `NOMEANALISTARES` estavam nulos; `ITSM_CHAMADOS` também não fornecia o responsável. A única atividade ativa (`WFSTRUCT`, `ATV-02`) tinha `CDUSER=124`, coerente com o cabeçalho exibido ao usuário.
- O registro de teste existente tinha `CDUSERANA=35`, `ANALISTAJ2A=se Config`.
- Foi usado **editChildEntityRecord**, contrato confirmado em `.claude/skills/softexpert-wf-ws/references/editChildEntityRecord.md` e no WSDL instalado `editChildEntityRecordRequestType`.
- Alvo: `WorkflowID=036807`, `MainEntityID=itsm`, `ChildRelationshipID=relagridregistr`, `ChildRecordOID=16531126e49345b28e2068dd2cbfeab0`.
- Alterados somente `cduserana=124` e `analistaj2a=Edson Assis`.
- Resposta real: **HTTP 200, SUCCESS, Code 1**. SELECT posterior confirmou ambos os valores no mesmo OID.

Foi preservado o Memo, o anexo e seu vínculo. Permaneceu um posicionamento e um anexo, sem movimentar a atividade. O comentário nativo manteve `CDUSER=35`, correspondente à conta que efetivamente executou a API: não foi forjada sua auditoria como se Edson tivesse autenticado a chamada.

Evidência sanitizada: `tmp/softexpert-correcao-responsavel-036807.json`. O relatório original de homologação permanece como registro do estado anterior e deve ser lido junto desta correção.

## Comportamento implementado para próximos envios

`retorno-softexpert-source.resolverResponsavel` consulta a origem, com escopo de empresa/fonte e filtro simultâneo por OID e número do chamado:

1. Se o código do cabeçalho estiver salvo em DYNITSM, confirma nome e habilitação em ADUSER.
2. Se o código ainda não estiver salvo, aceita somente o responsável identificado da única atividade ativa, também confirmado em ADUSER.
3. Código inválido, usuário desabilitado, ausência de responsável, processo encerrado ou atividades ambíguas impedem a inclusão. Não usa a conta da API como fallback.

O executor resolve o dono antes da primeira inclusão, exige que ele corresponda ao consultor autorizado e preenche `cduserana`/`analistaj2a` com esses valores. Esses dois campos prevalecem sobre valores fixos ou identidade da credencial na configuração, inclusive identificadores em maiúsculas. Transferência na origem não confirmada no cache local bloqueia o envio, sem ampliá-lo para o antigo responsável.

Retomar anexos de uma tentativa parcial não resolve outro dono nem reescreve um posicionamento já confirmado. A regra de autorização existente por usuário/empresa/chamado foi preservada; a nova consulta não concede permissão por si só. O envio geral não foi ativado, não houve deploy nem migração.

## Sincronização do IA Service

Foi identificado um segundo problema: o upsert comparava o hash do conteúdo e ignorava correções que alterassem somente o analista. Agora compara também `tecnico_id`, `tecnico_nome_origem` e `usuario_cliente_id`, preservando o formato dos hashes existentes. Assim, não força reindexação de todos os registros anteriores.

Após corrigir esse comportamento e reimportar somente 036807 pelo serviço existente, o IA Service atualizou o posicionamento para **Edson Assis**, preservando seu registro local e o único anexo. Foram recompostas duas mensagens importadas (abertura e posicionamento). A versão local do banco permaneceu 44.

Não foi criado fallback de autoria para todos os posicionamentos históricos, nem alterado o responsável de outros chamados. O fallback por atividade acima é restrito à resolução do dono para novos envios de Retorno.

## Validação

**45 testes aprovados** nos arquivos `retorno-softexpert{,-executor,-source}.test.js` e `softexpert-contrato.test.js`. Incluem precedência do cabeçalho, fallback por atividade única, rejeição de ambiguidade/ausência, bloqueio após transferência, separação da conta da API, retomada sem reescrita e sincronização de mudanças apenas no analista. Snapshot do WSDL atualizado para conferir a operação de edição.

Regressões aprovadas: `refresh-situacao-snapshot`, `pendencia-externa-gate`, `anexos-softexpert-sync`, `fase3-rotas-http`. Logs em `tmp/softexpert-responsavel-test.log` e `tmp/softexpert-responsavel-<nome>.log`. Validação real da edição e importação descrita acima, sem executar outro posicionamento ou comentário de teste.
