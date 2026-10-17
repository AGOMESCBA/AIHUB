# Restauração do cabeçalho e validação da fila — 036807

## Resultado em 16/10/2026

O usuário informou que o chamado desapareceu da barra de chamados do Edson e apresentou o cabeçalho sem analista. Foi confirmado por SELECT que a atividade `ATV-02` permanecia atribuída ao usuário 124 (Edson Assis), mas `DYNITSM.RESPONSAVEL`, `CDUSERANA`, `NOMEANALISTARES` e `CODRESPONSAVELC` estavam nulos. Outros chamados recentes do Edson têm, respectivamente, `Edson Assis`, `124`, `Edson Assis` e `124` nesses campos.

Esses quatro campos foram restaurados exclusivamente por `editEntityRecord`, formulário lógico `itsm`, WorkflowID `036807`. Resposta: HTTP 200, SUCCESS/1, em 16/10/2026 às 15:37 (America/Manaus). A leitura posterior confirmou os quatro valores. Os dois posicionamentos, seu conteúdo, o anexo e todas as atividades foram comparados antes/depois e permaneceram intactos. Não foi criada outra interação nem movimentada atividade.

O importador seletivo atualizou o responsável local e o status passou de `Pendente` para `Andamento`, conforme a regra existente baseada em `DYNITSM.RESPONSAVEL`. A consulta real `radar-repository.listarFila`, filtrada pelo técnico de origem 124, passou a retornar `036807` com `tecnicoResponsavelNome=Edson Assis`. As duas mensagens de posicionamento permanecem únicas e com autor Edson.

Limite da verificação: a base local não possui cadastro de consultor 124 na tabela `consultores`; por isso foi validada a consulta real por técnico usada pelo serviço da fila, sem criar identidade ou simular sessão. A sessão de navegador publicada não foi acessada. A instância publicada precisa sincronizar a origem restaurada para refletir o resultado.

## Causalidade

A leitura anterior salva em `tmp/softexpert-meta-036807-dono-campos.json` já mostrava os campos nulos antes da última interação. Isso não invalida a observação visual do usuário de que o cabeçalho estava preenchido, mas impede atribuir com certeza a limpeza especificamente à última chamada. As chamadas de grid e comentário não enviaram esses campos do formulário principal. A causa inicial da perda ainda não foi comprovada; não se conclui que a API de grid é isenta de efeitos indiretos apenas por seu payload.

## Proteção acrescentada

- Cliente SOAP ganhou `montarEdicaoFormulario` e a operação oficial `editEntityRecord`, documentada e confirmada no WSDL instalado. Não foi incluída restauração automática de responsável no fluxo de envio: isso poderia sobrescrever transferências legítimas.
- `retorno-softexpert-source.sincronizar` agora só confirma atualização após comparar o responsável do cabeçalho na origem com o técnico importado no chamado local. Cabeçalho sem código salvo, técnico ausente ou divergente mantêm a sincronização pendente. Isso evita anunciar sucesso apenas porque o texto da mensagem entrou no chat; não substitui a confirmação visual nem impede por si só eventos internos do SoftExpert.
- As verificações pertinentes passaram: 46 testes, zero falhas. Contrato da edição contra o WSDL, bloqueio da operação no caminho somente leitura e regressões da autoria/sincronização estão cobertos.
- Nenhuma migração aplicada no banco real: versão 44 preservada. As mudanças de código não foram publicadas nesta ação.

## Referências

- `.claude/skills/softexpert-wf-ws/references/editEntityRecord.md`: parâmetros, estrutura e retorno.
- `tmp/softexpert-legado-wf_ws.php.wsdl`: tipo `editEntityRecordRequestType`, campos WorkflowID e EntityID obrigatórios; EntityAttributeList, RelationshipList e EntityAttributeFileList opcionais.
- `tmp/softexpert-restauracao-cabecalho-036807.json`: resposta oficial e comparações antes/depois.
- `tmp/softexpert-importacao-cabecalho-036807.log`: importação do cabeçalho restaurado.
- `tmp/softexpert-fila-edson-036807.json`: resultado da consulta da fila e autoria das mensagens.
- `tmp/softexpert-cabecalho-testes.log`: execução completa dos 46 testes.
