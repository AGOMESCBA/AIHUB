# Retorno: horas, agendamento, anexos, revisão e autoria

Atualização posterior: o usuário substituiu múltiplos anexos por um arquivo em `OIDARQUIVO2` e solicitou `texto4=IA SERVICE`. A regra atual está em [softexpert-retorno-anexo-unico.md](softexpert-retorno-anexo-unico.md). O teste de dois anexos descrito abaixo é evidência da regra anterior.

Estado em 16/10/2026: ajustes implementados localmente; homologação funcional parcial. Não publicado nem habilitado o envio geral. Permanecem pendentes a associação oficial da revisão do formulário e a autoria nativa com credencial do analista.

## Comportamento implementado

- Hora inicial, intervalo e hora final: seletores obrigatórios com 48 horários, de 00:00 a 23:30, em intervalos de 30 minutos. Intervalo zero é permitido. Não é aceita passagem para o dia seguinte: final menor que inicial é rejeitado.
- Total: `(final - inicial - intervalo)`, mostrado com duas casas e vírgula em pt-BR. Intervalo maior que o período é rejeitado para impedir total negativo. O servidor recalcula o total e as conversões, independentemente do que vier do navegador.
- Conversões em horas decimais: início para `HORAINICONV`, intervalo para `HORAINTCONV`, final para `HORAFIMCONV`. A menção do segundo item 9 a `HORAINICONV` foi interpretada como erro de digitação, conforme a imagem e o dicionário confirmado.
- Agendamento: campo nativo de data, sem hora, com idioma pt-BR; transporte `YYYY-MM-DD`. Campo de hora sem segundos, transporte `HH:MM`; não exige passos de 30 minutos nesse campo. A apresentação do seletor nativo de data também depende do idioma do navegador/sistema.
- Descrição: textarea/Memo de até 100.000 caracteres, com múltiplas linhas.
- Anexos: seleção múltipla já existente preservada; até 10 arquivos e limites de tamanho existentes. Teste real utilizou dois arquivos no mesmo posicionamento.
- Componente de UI compartilhado pelo J2A e Radar original, incluindo mobile. Testes com navegador verificam desktop e larguras móveis de 320/390 pixels.

## Teste real autorizado no 036807

Identificador `IAHUB036807-HORAS-eddd7620`; posicionamento `6650c055d52a41c19585a221af9cb3c3`.

| Campo | Valor confirmado |
|---|---|
| HORAINI / HORAINICONV | 08:30 / 8,5 |
| HORAINT / HORAINTCONV | 00:30 / 0,5 |
| HORAFIM / HORAFIMCONV | 11:00 / 11 |
| HORATOTALNUM | 2 |
| DTAGEND | 18/10/2026 |
| HRAGEND | 19:00 |
| Analista / CDUSERANA | Edson Assis / 124 |
| Memo | 3.487 caracteres, com acentuação e múltiplas linhas |

`newChildEntityRecord`, duas chamadas `newTableRecord` e `newComment`: HTTP 200, SUCCESS/1. Após cada chamada foi conferido que cabeçalho, processo e atividades permaneciam iguais. A leitura posterior confirmou Memo, conversões, vínculo e hash dos dois arquivos, e um único comentário com o mesmo conteúdo.

A hora de agendamento é armazenada como timestamp `1792191600`. Compará-la diretamente com UTC produziu uma falsa divergência; a consulta oficial `getTableRecord`, no registro identificado pelo Memo, confirmou `HRAGEND=19:00` e `DTAGEND=2026-10-18`. A verificação final usa essa resposta oficial, sem alterar a codificação ou reenviar o registro.

Anexos: `bf855459cfd6417fa08c473a682f3b15` e `697d39d3a22f47698db333093b7f6057`. O WSDL instalado devolve `RecordKey` em `newTableRecordResponseType`, enquanto a documentação pública mostra `RecordID`. O executor inicialmente marcou esses uploads como indeterminados por exigir RecordID; foi corrigido para reconhecer ambos. Os dois envios já realizados foram reconciliados na auditoria SQLite temporária após comprovar OID, vínculo e hash. Não houve reenvio.

Importação seletiva: três posicionamentos, quatro mensagens importadas (abertura mais três posicionamentos) e três anexos no total (um anterior e dois novos). A segunda sincronização dos anexos incluiu zero arquivos. Responsável do cabeçalho e autores das três mensagens de posicionamento continuam Edson; a consulta local da fila filtrada pelo técnico 124 continua incluindo o chamado. A sessão publicada não foi acessada nesta verificação. Banco real permaneceu na versão 44.

## OIDREVISIONFORM: valor certo, operação pendente

O OID `8a80938c83894b86018389e31c6f0130` corresponde a `EFREVISIONFORM.OID` para `IDFORM=ITSMGRIDREGISTRO`, `FGCURRENT=1`. Ele existe como coluna física em `DYNITSMGRIDREGISTR`, mas não apareceu como atributo lógico de `EMATTRMODEL` dessa entidade.

A pedido explícito do usuário, foi testada a atribuição desse valor ao identificador `oidrevisionform` pela operação oficial `editChildEntityRecord`, somente no posicionamento de homologação acima. Resposta: HTTP 200, FAILURE/-41, **“Não foi encontrado um campo da tabela de formulário com este identificador”**. O campo permaneceu nulo; demais campos e cabeçalho foram preservados. O erro é sobre a identificação editável do campo, não sobre a validade do OID.

O registro ter sido aceito pela API e poder ser consultado não comprova equivalência de integridade funcional com o formulário nativo. Abertura/edição, regras e auditoria podem depender da revisão; o efeito específico da ausência ainda não foi comprovado. Não considerar homologada a manutenção desse campo vazio. É necessário obter da SoftExpert o mecanismo oficial de associação da revisão para inclusão via API, ou uma confirmação documentada de que pode permanecer nulo nessa modalidade. Nenhum UPDATE/INSERT SQL foi realizado ou será usado como alternativa.

## Autoria nativa: requisito obrigatório do usuário

Foi confirmado que os três comentários de teste em `WFHISTORY` possuem CDUSER 35, nome `se Config`, apesar de a responsabilidade do chamado e dos posicionamentos ser Edson 124. Isso decorre da credencial de API usada nos testes e não deve ser apresentado como autoria do Edson no histórico nativo.

O usuário rejeitou essa autoria. Não serão realizados novos testes de escrita com essa credencial. O validador de contrato passou a rejeitar histórico `comentario_validado` quando a autoria é `conta_integracao`; exige `credencial_analista`. Essa verificação de configuração não comprova sozinha o titular de um token: a credencial individual precisa ser localizada/configurada por meio seguro e sua autoria efetiva deve ser homologada antes da liberação. Foi solicitado ao usuário somente o caminho da configuração, sem envio do token pelo chat.

O IA Recruit consultado usa `config.se_token` diretamente no Authorization. Na configuração utilizada, a credencial corresponde à conta de integração. As operações `newComment` e `newChildEntityRecord` consultadas não oferecem um parâmetro documentado de substituição do autor autenticado. Não inventar `UserID` nessas operações nem alterar colunas internas de auditoria. Não foi localizada operação oficial de alteração de autoria dos comentários antigos; a correção deles permanece pendente de orientação oficial.

## Evidências e validação

- `tmp/softexpert-horas-anexos-036807.json`: respostas originais, campos esperados, leituras e reconciliação separada do resultado original.
- `tmp/softexpert-hora-api-036807.json`: leitura oficial do registro de teste.
- `tmp/softexpert-revisao-grid-036807.json`: rejeição -41 e preservação dos demais campos.
- `tmp/softexpert-autoria-teste-036807.json`: responsabilidade Edson e autoria nativa 35, sem mascaramento.
- `tmp/softexpert-importacao-horas-036807.log`: importação e anexos sem duplicação.
- `tmp/softexpert-horas-testes-final.log`: 58 testes aprovados após correção dos uploads e formato decimal.
- `tmp/softexpert-autoria-bloqueio-testes.log`: 15 testes pertinentes aprovados após a última alteração no bloqueio de autoria, incluindo a rejeição de conta de integração no histórico.
- `tmp/retorno-horas-1440.png` e `tmp/retorno-horas-320.png`: imagens da interface de teste.

Referências oficiais: [newTableRecord](https://developer.softexpert.com/docs/data-integration/reference/web-service-soap/form/newTableRecord), [newChildEntityRecord](https://developer.softexpert.com/docs/data-integration/reference/web-service-soap/workflow/newChildEntityRecord). Referências locais: `.claude/skills/softexpert-wf-ws/references/newChildEntityRecord.md`, `editChildEntityRecord.md`, `newComment.md`; `tmp/softexpert-legado-fm_ws.php.wsdl`, tipo `newTableRecordResponseType`, e `tmp/softexpert-legado-wf_ws.php.wsdl`, tipos de inclusão/edição da grid. Metadados consultados em `tmp/softexpert-meta-horas-revisao-*.json`.
