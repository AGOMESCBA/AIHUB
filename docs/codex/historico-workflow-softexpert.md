# Histórico nativo do Workflow — investigação específica

## Conclusão

**Homologação real em 16/10/2026:** `newComment` acrescentou o texto do Memo ao histórico padrão do [chamado 036807](softexpert-homologacao-036807.md), associado à atividade sem movimentá-la. `WFHISTORY` confirmou uma ocorrência, autoria da credencial e evento tipo 11; o usuário confirmou a exibição normal dos acentos. A grid não havia produzido uma cópia do Memo antes dessa chamada. A comparação SQL do texto precisou considerar a representação UTF-8 do armazenamento. Isso valida o comentário deste teste, sem comprovar todas as regras do botão manual ou de outras atividades.

**Atualização de 16/10/2026:** o catálogo real confirmou `WFHISTORY`, PK `IDOBJECT`, vínculo `IDPROCESS → WFPROCESS.IDOBJECT`, campos de atividade, usuário, texto e data/hora. [Evidências e limites atuais](softexpert-itsm-investigacao-tabelas.md). O parecer original abaixo relata a documentação local; a ausência de identificação da tabela ali não representa o conhecimento atual do banco. A equivalência ao posicionamento manual continua sem homologação de escrita.

As referências acessíveis comprovam duas operações diferentes: `newChildEntityRecord` inclui uma linha descendente de formulário e `newComment` acrescenta um comentário à instância, opcionalmente associado a uma atividade. Não comprovam que inserir um posicionamento reproduza automaticamente o evento nativo gerado pelo botão do formulário ITSM. Também não comprovam que um comentário equivalha a esse evento.

Consequentemente, não está demonstrada uma operação única, nem uma sequência definitiva, que garanta a presença do retorno nas duas superfícies sem duplicação. A solução candidata é gravar a grid pelo serviço de formulário/Workflow validado e acrescentar `newComment` somente se o processo não gerar o registro desejado automaticamente e se comentário for a representação funcional aceita no histórico.

## Evidências locais

Todas as linhas abaixo são relativas aos arquivos atuais:

| Arquivo | Linha | Evidência |
|---|---:|---|
| `.claude/skills/softexpert-wf-ws/references/newComment.md` | 13 | “Adiciona um comentário a uma instância (workflow), opcionalmente vinculado a uma atividade específica.” |
| mesmo arquivo | 19 | `WorkflowID` e `Text` obrigatórios; `ActivityID` e `Private` opcionais. |
| mesmo arquivo | 68 | Descreve o comentário como trilha de auditoria adicional ao histórico nativo. Essa observação não comprova equivalência ao evento do posicionamento. |
| `.claude/skills/softexpert-wf-ws/references/getWorkflow.md` | 13 | Consulta informações da instância; não é uma operação de inclusão. |
| mesmo arquivo | 48 | Distingue metadados da instância dos dados do formulário. Não fornece contrato de leitura integral do histórico nativo. |
| `.claude/skills/softexpert-wf-ws/references/newChildEntityRecord.md` | 13 | Inclusão de registro na tabela descendente. Não declara geração do evento do posicionamento no histórico. |
| `.claude/skills/softexpert-wf-ws/references/editWorkflowData.md` | 63 | Menciona histórico para alteração do cabeçalho, sem demonstrar comportamento de inclusão na grid. |
| `.claude/skills/softexpert-wf-ws/references/cancelWorkflow.md` | 23 | Descreve autoria do cancelamento no histórico. Operação de ciclo de vida, inadequada para registrar retorno. |
| `.claude/skills/softexpert-wf-ws/references/reactivateWorkflow.md` | 21 | Descreve autoria da reativação. Não resolve o retorno sem mudar estado. |

A pesquisa cobriu a skill e suas referências por histórico/history, comentários, eventos, tabelas e operações. Esta cópia contém referências Markdown; os PDFs citados e o dicionário físico do formulário/histórico não estão presentes na pasta.

## Referências oficiais complementares

- [newComment, documentação 3.0.0](https://developer.softexpert.com/docs/data-integration/reference/web-service-soap/workflow/newComment): confirma inclusão de comentário, seus quatro parâmetros e retorno `Status`, `Code`, `Detail`. Não apresenta tabela física, parâmetro de autoria `UserID` ou geração de evento de posicionamento.
- [Release notes Workflow — evento no histórico ao editar/excluir comentário](https://documentation.softexpert.com/rn20/por/workflow_2013.html): confirma relação entre comentários e eventos do histórico nesse contexto. Não prova que criar uma linha de formulário gere o mesmo evento nem que o processo ITSM atual tenha esse comportamento.

## Operação de comentário sem movimentação

Endpoint documentado na skill: `POST https://<dominio>/apigateway/se/ws/wf_ws.php`.

Operação: `newComment`, namespace `urn:workflow`.

| Parâmetro | Significado |
|---|---|
| `WorkflowID` | Identificador da instância, obrigatório. |
| `Text` | Texto do comentário, obrigatório. |
| `ActivityID` | Atividade à qual associar o comentário, opcional. Não significa executá-la. |
| `Private` | `1` oculta do solicitante. A visibilidade deve ser definida explicitamente no contrato da funcionalidade. |

Não enviar `UserID`, `ActionSequence` ou um ID de grid como parâmetro de `newComment`: eles não constam desse contrato. Nenhuma chamada de `executeActivity`/`executeSystemActivity` é necessária para invocar a operação documentada de comentário.

A autenticação usa a chave de usuário do SoftExpert no backend; o formato exato do cabeçalho e a codificação continuam sujeitos à versão instalada, conforme a investigação anterior. Não atribuir o evento ao analista apenas por inserir seu nome no texto.

## Tabela física

Os materiais locais consultados não identificam a tabela física padrão do histórico. Portanto, nome completo, chave primária, texto/tipo do evento e relações com instância, atividade, usuário e data/hora não foram comprovados.

No projeto, há evidência de `WFSTRUCT.IDPROCESS = WFPROCESS.IDOBJECT` e leitura de `WFSTRUCT.DHENABLED` para marca de transição. Isso não identifica a tabela do histórico nem demonstra onde comentários são armazenados. Não foi elaborada consulta com nome de tabela presumido.

## Uso existente no projeto

- `apps/IA Service/backend/services/import/softexpert-sqlserver-adapter.js:273`: `listarPosicionamentosDoChamado` lê `DYNITSMGRIDREGISTR`, por `CHAMADO`, ordenado por `DATAATUAL`, `HORAATUAL`, `OID`.
- Mesmo adapter, linha 398: lê a maior `WFSTRUCT.DHENABLED` relacionada à instância, para detectar transições.
- `apps/IA Service/backend/services/radar-service.js:225`: `_gravarHistoricoComoMensagens` constrói o histórico do chat a partir da abertura e dos posicionamentos. Isso não é uma cópia do histórico nativo completo.
- `apps/IA Command/agente-local/modules/erp_executor.py:110`: executor genérico SELECT, sem consulta específica do histórico nativo identificada.
- `apps/IA Command/agente-local/main.py:164`: registra execuções do próprio agente; esse log é distinto do histórico do Workflow.
- `apps/IA Service/backend/services/softexpert-soap-client.js`: implementa grid, formulário e `newComment`; o executor só permite comentário com `comentario_validado`, evidência de equivalência e visibilidade explícita. Por padrão não envia comentário.

Não foi localizado leitor dedicado do histórico nativo no IA Service ou no Agente Local. Reaproveitam-se transporte de leitura e contexto empresarial, mas não existe um leitor pronto demonstrado.

## Dependência específica restante e continuação

É preciso identificar o comportamento do comando manual do ITSM: configuração/evento do formulário ou evidência de um posicionamento já existente correlacionado com sua linha no histórico nativo. A inspeção pode ser somente leitura: configuração do formulário e requisições de consulta do histórico, sem criar posicionamentos.

Se houver geração automática confirmada também na inclusão pela API, não acrescentar comentário redundante. Se não houver e o requisito aceitar comentário no histórico, acrescentar `newComment` após a grid, com estado e tentativa independentes. Timeout na segunda operação não deve repetir a primeira nem repetir cegamente comentário, pois o contrato consultado não expõe chave de idempotência.

A equivalência e o comportamento automático ainda não estão resolvidos. A implementação posterior conectou o executor configurável sem ativar comentários por hipótese: `desabilitado` é o padrão; `automatico_validado` não gera comentário e informa `automatico_previsto`; `comentario_validado` exige evidência e habilitação explícitas. Estados separados impedem que timeout de comentário recrie a grid. Configuração e roteiro de comparação manual/API: [retorno-softexpert.md](retorno-softexpert.md).

Nenhuma gravação real, INSERT interno ou movimentação foi executada. O suporte a `newComment` não comprova equivalência funcional ao posicionamento manual, que continua pendente de homologação autorizada.
