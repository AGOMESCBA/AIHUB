# OIDREVISIONFORM: investigação específica e API alternativa

Investigação em 16/10/2026. Nenhum SQL de escrita, nenhuma movimentação de atividade e nenhuma publicação de código.

## Conclusão

Foi encontrada e testada uma segunda API oficial de inclusão na grid: a REST `POST /apigateway/v1/workflow/table-related-records`. Ela confirmou a inclusão, mas também deixou `OIDREVISIONFORM` nulo. Portanto, trocar somente a chamada SOAP por essa REST não resolveu a associação da revisão na instalação consultada.

O valor informado pelo usuário está correto. A limitação identificada não é um OID inválido: o campo interno não é aceito como atributo lógico pela edição SOAP testada, e os contratos consultados não documentam um parâmetro específico para associar a revisão. O preenchimento automático não ocorreu nas duas modalidades reais de inclusão verificadas.

Não ficou comprovado que a ausência do valor seja um defeito do produto, nem que seja funcionalmente inofensiva. É necessário confirmar com a SoftExpert o comportamento esperado e a operação suportada para incluir/ajustar registros com a revisão associada, ou obter confirmação documentada de que NULL é esperado e não afeta o uso nativo nessa modalidade.

## Metadados e integridade física

Consultas somente leitura confirmaram:

- `DYNITSMGRIDREGISTR.OIDREVISIONFORM`: `varchar(32)`, `IS_NULLABLE=YES`.
- A consulta ao catálogo `sys.foreign_key_columns`/`sys.foreign_keys` não retornou uma chave estrangeira física declarada para essa coluna. Isso descreve o catálogo consultado; não prova ausência de validações na aplicação.
- `EFREVISIONFORM.OID=8a80938c83894b86018389e31c6f0130`, `IDFORM=ITSMGRIDREGISTRO`, `NMFORM=Registro`, `FGCURRENT=1`, `CDREVISION=3198`.
- O dicionário `EMATTRMODEL` da entidade `ITSMGRIDREGISTR` não apresentou `oidrevisionform` como atributo lógico.

As referências oficiais de modelo de dados descrevem `EFREVISIONFORM` como tabela de revisão do formulário e a relacionam a `GNREVISION` por `CDREVISION`. Exemplos oficiais também relacionam a estrutura e as regras do formulário à revisão. Esses exemplos explicam o contexto do identificador; não documentam o comportamento de um registro DYN criado via API com a coluna nula.

Assim, não há evidência de violação de uma restrição NOT NULL/FK declarada no banco, mas a equivalência funcional com inclusão manual permanece sem comprovação. Possíveis efeitos em abrir/editar, carregar regras ou identificar o formulário devem ser investigados, sem afirmar antecipadamente que ocorrem.

## APIs e documentação consultadas

| Alternativa | Resultado documental ou real |
|---|---|
| SOAP Workflow `newChildEntityRecord` | Inclusões anteriores confirmadas com a coluna nula. Contrato usa workflow, entidade principal, relacionamento, atributos, relacionamentos e arquivos; não documenta revisão como parâmetro. |
| SOAP Workflow `editChildEntityRecord` | Teste do identificador `oidrevisionform` com o valor correto: FAILURE/-41, campo da tabela não encontrado. Registro e cabeçalho preservados. |
| SOAP Workflow `newChildEntityRecordList` | Contrato de lote dos mesmos grupos de atributos/relacionamentos/arquivos. Nenhum parâmetro de revisão encontrado; não foi executado novo lote para especular sobre efeito automático. |
| SOAP Form `newTableRecord`, `newTableRecordList`, `editTableRecord` | Operações sobre tabela dinâmica. Foram lidos os contratos e comparados com o WSDL instalado. Nenhum parâmetro específico de revisão foi encontrado. Não foi comprovado que a edição direta por TableFieldID aceite metadados internos. |
| REST Workflow `table-related-records` | API específica de inclusão de registros descendentes. Teste real confirmou que a revisão também ficou nula. |
| REST `dynamicentity/api/table` | Cria definição de tabela; não equivale a incluir um posicionamento. Não executada. |
| REST `responsive/api/form` | Cria definição de formulário e possui `revisionDate` (data), não um parâmetro para vincular OIDREVISIONFORM em um registro existente. Não executada. |

O catálogo público mudou de organização. Alguns endereços antigos sem versão retornaram 404; foi consultado o sitemap oficial com 7.151 URLs para localizar os endereços atuais e os documentos versionados. As páginas atuais indicavam 3.1; foi também lida a documentação versionada 3.0.0, que já descreve a REST de registros relacionados. A versão exata da instalação não foi deduzida apenas da versão do portal.

As novas páginas OpenAPI carregam seus parâmetros por JavaScript. Foram lidas em navegador headless com requisições restritas a GET/HEAD no domínio oficial, sem executar os exemplos de criação exibidos nas páginas. Não se confundiu documentação inicialmente sem schema renderizado com ausência de parâmetros.

## Contrato da alternativa REST

Endpoint: `POST /apigateway/v1/workflow/table-related-records`.

Autenticação: header Authorization com token JWT, conforme documentação. O teste usou a mesma credencial de integração já utilizada no projeto, conforme autorização atual do usuário.

Campos de topo documentados: `workflowId`, `table`, `relationshipId`, `records`. Cada registro admite `fields` (pares `id`/`value`), `relationships` e `files` (identificador, nome e referência de arquivo previamente carregado). Não foi inventado um parâmetro de revisão.

Resposta documentada de sucesso: `status=SUCCESS`, `code=1`, `detail`, `recordList` com a chave de cada inclusão. A referência de arquivo dessa REST não foi integrada: o teste específico de revisão não enviou anexo, e o destino de arquivo2 do fluxo existente permanece baseado na edição SOAP já preparada.

## Teste real da alternativa

- Chamado de homologação autorizado: `036807`.
- Identificador: `IAHUB036807-RESTREV-306756de`.
- Em 16/10/2026 às 16:49, fuso America/Manaus.
- OPTIONS prévio retornou HTTP 200 e Allow genérico. Isso foi tratado apenas como preflight, sem concluir disponibilidade funcional pela resposta OPTIONS.
- Uma única inclusão POST, sem repetição, retornou HTTP 200, SUCCESS/1 e chave `341bfb14c38b4153b911a6971b015292`.
- SELECT posterior confirmou um único posicionamento, vínculo com o chamado, Memo exato, `CDUSERANA=124`, `ANALISTAJ2A=Edson Assis`, `TEXTO4=IA SERVICE` e `OIDREVISIONFORM=NULL`.
- Horas de teste foram zero, sem agendamento ou arquivo. Não foi criado comentário adicional: este foi um teste isolado da API de inclusão, não homologação completa do retorno.
- Cabeçalho, processo e todas as atividades foram comparados antes/depois e permaneceram iguais.
- Importação seletiva trouxe somente o novo posicionamento, mantendo os anteriores. Agora são quatro posicionamentos, cinco mensagens importadas (abertura mais quatro posicionamentos) e três anexos históricos, sem novos anexos. Banco local real permaneceu na versão 44.

## Evidências

- `tmp/softexpert-rest-revisao-036807.json`: requisição sem segredos, resposta e verificações do teste REST.
- `tmp/softexpert-rest-grid-opcoes.json`: consulta OPTIONS sem gravação.
- `tmp/softexpert-meta-integridade-revisao-coluna.json`, `-chaves.json`, `-revisao.json`: consultas do catálogo e revisão ativa.
- `tmp/softexpert-revisao-grid-036807.json`: rejeição -41 pela edição SOAP.
- `tmp/softexpert-importacao-rest-revisao-036807.log`: sincronização seletiva do teste.
- `tmp/softexpert-doc_docs_3_0_0_data-integration_reference_api-rest_rest-api-resources_workflow_table-related-records.txt`: contrato REST completo salvo.
- `tmp/softexpert-browser_docs_openapi_rest_workflow_post-table-related-records.json`: leitura renderizada do contrato atual.
- `tmp/softexpert-docs-sitemap.xml`: índice oficial consultado.

## Referências oficiais

- [REST: registro em tabela relacionada — versão 3.0.0](https://developer.softexpert.com/docs/3.0.0/data-integration/reference/api-rest/rest-api-resources/workflow/table-related-records).
- [REST: inclusão em entidade descendente — catálogo atual](https://developer.softexpert.com/docs/openapi/rest/workflow/post-table-related-records).
- [SOAP: edição de registro da tabela — versão 3.0.0](https://developer.softexpert.com/docs/3.0.0/data-integration/reference/web-service-soap/form/editTableRecord).
- [SOAP: inclusão em lote na grid — versão 3.0.0](https://developer.softexpert.com/docs/3.0.0/data-integration/reference/web-service-soap/workflow/newChildEntityRecordList).
- [REST: criação de formulário](https://developer.softexpert.com/docs/openapi/rest/form/post-responsive-api-form).
- [REST: criação de tabela](https://developer.softexpert.com/docs/openapi/rest/form/post-dynamicentity-api-table).
- [Modelo de dados: conjuntos de dados e revisão do formulário](https://developer.softexpert.com/docs/database-docs/data-template/form/ef001).
- [Modelo de dados: fonte de dados e revisão do formulário](https://developer.softexpert.com/docs/database-docs/data-template/form/ef002).

O texto para encaminhamento ao suporte está em [softexpert-consulta-suporte-oidrevisionform.md](softexpert-consulta-suporte-oidrevisionform.md). Ele não foi enviado a terceiros.
