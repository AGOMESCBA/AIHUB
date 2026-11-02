# Plano de APIs — IA Service e SoftExpert fora da rede do Agente Local

Data: 02/11/2026. Escopo: pesquisa, auditoria de código e proposta; nenhuma implementação ou publicação. Nenhuma chamada à instalação SoftExpert ou leitura de produção foi executada nesta análise. As consultas externas foram apenas à documentação pública.

## 1. Decisão recomendada

Adotar **conjuntos de dados oficiais para as leituras estruturadas**, consumidos por um novo adapter do IA Service, e **download de arquivos por mecanismo oficialmente homologado pela SoftExpert**. Manter a base e o cache locais do IA Service e o transporte SOAP de escrita existente.

Não começar criando arquivos PHP ou serviços dentro do servidor SoftExpert. Primeiro comprovar, em homologação, duas capacidades: consulta parametrizada e paginada aos dados ITSM; download das cinco origens de anexos, incluindo arquivos fora do banco. O segundo item é um critério obrigatório para a migração completa.

Se houver API nativa de download aplicável, utilizá-la. Se não houver, contratar uma extensão/exportação suportada para o plano de nuvem específico. Um serviço intermediário externo ajuda a uniformizar contratos, controlar tráfego e armazenar cache, mas **não consegue obter um arquivo que a nuvem não disponibiliza**. Se o fornecedor não oferecer acesso suportado, a migração integral fica impedida; retornar apenas metadados não atende ao requisito da IA.

Na instalação própria ou nuvem privada sob administração do cliente, um conector próximo ao banco e ao armazenamento é alternativa viável mediante autorização de infraestrutura. Isso desloca a integração para perto da origem; continua existindo um componente com acesso local. Não é solução automaticamente disponível na nuvem gerenciada da SoftExpert.

## 2. Inventário confirmado no código

Foram rastreados os usos de `executarSelectNaFonte`, os acessos ao provider do agente, o registro de adapters, os consumidores de importação/snapshot/anexos, o retorno SOAP e o registro das rotas em `index.js`. O workspace contém alterações locais anteriores e também mudou durante a leitura; este inventário considera o conteúdo observado, sem presumir que esteja publicado em produção.

### 2.1 Operações e carga

Frequências abaixo são gatilhos e limites do código, não medições de tráfego de produção. Volumes históricos fornecidos no pedido não foram recontados.

| Leitura / função | Dados e tabelas | Gatilho, volume e limite observados | Criticidade |
|---|---|---|---|
| `listarChamadosPeriodo` | Cabeçalho ITSM, pessoas, descrição, classificação, solução, horas, Kanban, status/SLA e durações. `DYNITSM`, `WFPROCESS`, `ITSM_CHAMADOS` | Carga histórica e janela incremental; 500 chamados por lote por padrão, máximo 5.000 no adapter; período de abertura `[início,fim)`. Base informada: aproximadamente 12.438 chamados | Alta: base da correlação e pesquisa histórica |
| `contarChamadosPeriodo` | Contagem de `DYNITSM` com os filtros de `WFPROCESS` | Contagem inicial, quando ainda não registrada na importação; uma linha | Alta para reconciliar completude |
| `contarPosicionamentosPeriodo` | `DYNITSMGRIDREGISTR`, selecionada pelos chamados do período em `DYNITSM`/`WFPROCESS` | Contagem inicial de todas as mensagens desses chamados, independentemente da data da mensagem | Alta para reconciliar histórico |
| `listarChamadosPorIds` | Mesmo cabeçalho; modo leve omite as durações da view e mantém `AGUARDANDO` | Refresh, abertura e retorno; orquestrador divide por 40 IDs por padrão; adapter limita a quantidade solicitada + 5 | Alta: situação atual e cabeçalho |
| `listarPosicionamentosDoChamado` | Histórico, autor, situação, descrição, resultado, apontamento e referências de arquivo em `DYNITSMGRIDREGISTR` | Por chamado; limite atual de 5.000 linhas | Crítica: contexto técnico e cronologia |
| `listarPosicionamentosDoLote` | Mesmos dados, agrupados por `CHAMADO` | Uma consulta para os chamados do lote; limite atual de 50.000 linhas. Total atual desconhecido | Crítica: evita uma consulta por chamado |
| `listarSnapshotAbertos` | Situação/responsável da view; transições em `WFSTRUCT`; contagens e marcas de mensagens/anexos de formulário. `WFPROCESS`, `ITSM_CHAMADOS`, `DYNITSM`, grids | Usado pela fila e pelo gate de pesquisa. TTL de 60 s, timeout de 20 s, fallback de até 5 min marcado antigo; até 3.000 abertos + uma linha para detectar truncamento | Crítica: decisões sobre atuação e atualização |
| `listarAnexosDoChamado`, sem conteúdo | Identidade, nome, tamanho, origem, referência e acessibilidade; cinco origens descritas abaixo | Listagem e garantia antes da IA; limite atual de 100 linhas, sem indicador de truncamento. Quantidade total das cinco origens desconhecida | Crítica: saber que há evidência não recebida |
| Mesma função, com conteúdo/filtro `oid` | `SEBLOB.FLDATA` ou `GNFILE.FLFILE` em base64; um arquivo por download filtrado | Download individual; sincronização antiga ainda pode pedir todos os conteúdos do chamado; limite individual de 25 MiB no serviço | Crítica: conteúdo real da evidência |
| `lerArquivoDaPasta` / `/arquivo-softexpert` | Arquivo físico controlado, identificado por `CDFILE`, extensão e pasta configurada | Sob demanda para workflow fora do banco; agente descompacta gzip e limita saída a 25 MiB. Depende de acesso físico do agente | Crítica: cobre os arquivos ausentes de `GNFILE.FLFILE` |
| `resolverResponsavel` | Cabeçalho e atividade ativa, nomes e habilitação. `DYNITSM`, `WFPROCESS`, `WFSTRUCT`, **`ADUSER`** | Antes do retorno e na reconciliação posterior; até 21 linhas, rejeita resultado excessivo ou ambíguo | Crítica para segurança funcional da escrita |
| `resolverOid` | OID de posicionamento e vínculo ao pai em `DYNITSMGRIDREGISTR` | Após inclusão SOAP, antes de anexar ao registro; até duas linhas, exige exatamente uma | Crítica: impedir anexo no registro errado |
| Rota `.../fontes/:id/diagnostico` | SELECTs de diagnóstico de datas, filtros e modelo | Manual; inclui consulta SQL direta fora do adapter | Operacional; precisa equivalente por capacidade no modo API |
| `testarFonte`, `testarConexao`, `listarConexoesDoAgente` | `SELECT 1`, disponibilidade do agente e catálogo de conexões | Configuração/diagnóstico, sob demanda | Operacional; não equivale a validar cobertura ITSM |

O refresh é disparado por requisições de fila/atualização; não foi identificado um cron autônomo no `index.js` para essa sincronização. A tela oferece atualização manual, 30 s, 60 s, 5 min e 15 min. O backend impõe intervalo mínimo de 60 s, salvo caminhos forçados. Há limites de 60 atualizações de chamados por ciclo, até três ciclos extras, dez releituras completas por ciclo e cinco sincronizações de anexos por ciclo. A janela incremental padrão é de sete dias, aplicada à **abertura** do chamado.

Fontes locais principais:

- [Adapter SQL](../../apps/IA%20Service/backend/services/import/softexpert-sqlserver-adapter.js): todas as funções de leitura de negócio da tabela, exceto responsável/vínculo e diagnóstico.
- [Importador](../../apps/IA%20Service/backend/services/import/historical-import-service.js), [sincronização incremental](../../apps/IA%20Service/backend/services/import/historical-sync-service.js) e [registro de adapters](../../apps/IA%20Service/backend/services/import/adapters/index.js).
- [Refresh](../../apps/IA%20Service/backend/services/radar-refresh-service.js), [snapshot](../../apps/IA%20Service/backend/services/situacao-snapshot-service.js), [anexos](../../apps/IA%20Service/backend/services/anexos-softexpert-service.js) e [investigação](../../apps/IA%20Service/backend/services/investigacao-service.js).
- [Leituras do retorno](../../apps/IA%20Service/backend/services/retorno-softexpert-source.js), [executor](../../apps/IA%20Service/backend/services/retorno-softexpert-executor.js), [cliente SOAP](../../apps/IA%20Service/backend/services/softexpert-soap-client.js) e [rotas](../../apps/IA%20Service/backend/routes/index.js).
- [Agente HTTP](../../apps/IA%20Command/agente-local/main.py), [execução SQL](../../apps/IA%20Command/agente-local/modules/erp_executor.py) e [leitura física](../../apps/IA%20Command/agente-local/modules/arquivo_softexpert.py).

### 2.2 Campos que o contrato precisa preservar

O adapter consulta explicitamente os seguintes campos de `DYNITSM`; alguns são mantidos no RAW mesmo quando não participam da normalização:

```text
OID, IDPROCESS, DT, CNPJCPF, DP,
CDUSER, IDUSER, NMSOLICITANTE, EMAIL, TELERAMAL,
CDUSERANA, NOMEANALISTARES, EMAILANALISTA,
PRODUTO, FAMILIA, MD, SERVICOS,
TIPODECHAMADO, TIPODECHAMADOSE, TIPODOCHAMADO, NATUREZADOCHAMAD, NIVELCHAMADO,
TITULOCHAMADO, TITULOWF, TEXTO31, BREVEDESCRICAO, DESCRICAO01, PARAGRAFO3, INFO, OBS,
IDSLA, SLAHORAS, SLASTATUS, SLAFINALSTATUS, IDSLAINICIAL, IDSLAANTERIOR,
SOLUCAOAPLICADA, AVALIACAO, TOTALHORAS, NCHAMADOREF,
IDKANBAN, KEYKANBAN, ATRIBUTOSKANBAN, DATAINICIOKANBA,
OIDARQUIVO1, OIDARQUIVO2, RECORDIDANEXO
```

Campos adicionais: `STATUS_ENCERRAMENTO`, `SLA_PRAZO`, `SLA_DATA_PREV_FIM`, calculados com `WFPROCESS`; e `AGUARDANDO`, `DIAS_DUR`, `HR_DUR`, `DIAS_DUR_SUP`, `DIAS_DUR_FSW`, `DIAS_DUR_DIST`, `DIAS_DUR_CLI`, `DIAS_DUR_TICLI` da view.

Campos dos posicionamentos:

```text
OID, CHAMADO, DATAATUAL, HORAATUAL, EMPRESA, COLABCLIENTE,
SITUACAOCHAMADO, ANALISTAJ2A, CDUSERANA,
TIPOPOSICIONAME, MOTIVOAPONTAMEN, ASSUNTO, DESCRICAO, RESULTADO,
HORAINI, HORAFIM, HORAINT, HORATOTALNUM, AGUARDANRETORNO,
OIDARQUIVO1, OIDARQUIVO2
```

Preservar identificadores como texto, inclusive zeros iniciais. `HORAATUAL` é interpretado como epoch em segundos; `DATAATUAL` serve de fallback. A ordenação SQL atual é `DATAATUAL, HORAATUAL, OID`. Não filtrar posicionamentos pelo período de abertura consultado: trazer todo o histórico dos chamados selecionados.

Preservar as regras locais: modelo `1759`, grupo de workflow `1`, formulário habilitado, automações não nulas excluindo `160/202/275`, e exclusão de `FGSTATUS=3`. Esses códigos são configuração da instalação atual, não constantes universais do produto. O SLA atual depende do relógio da origem; não é equivalente ao status histórico de encerramento.

### 2.3 As cinco origens dos anexos

| Origem atual | Caminho de leitura | Relação demonstrável no código |
|---|---|---|
| `chamado` | `DYNITSM.OIDARQUIVO2 → SEBLOB.OID` | Arquivo do chamado; referência ao OID do cabeçalho |
| `posicionamento` | `DYNITSMGRIDREGISTR.OIDARQUIVO2 → SEBLOB.OID` | Posicionamento exato |
| `posicionamento_anexo` | `DYNITSMGRIDANEXOAP.OIDABCCMV6IBMOTU70 → posicionamento.OID`; arquivo por `OIDARQUIVO1` | Posicionamento exato; leitura depende de habilitação por empresa/fonte |
| `anexo` | `DYNITSMGRIDANEXO.OIDABC58815SXW3N8D → DYNITSM.OID`; arquivo por `OIDARQUIVO1` | Chamado, sem mensagem exata demonstrada |
| `workflow` | `DYNITSM → WFPROCESS → WFPROCATTACHMENT → ADATTACHMENT/ADATTACHFILE → GNFILE`; `WFSTRUCT` para etapa | Processo e atividade; referência à mensagem é inferida |

Metadados atuais: `origem`, `OID_REFERENCIA`, `DATA_REFERENCIA`, `AUTOR_REFERENCIA`, `OID`, `NMNAME`, `IDEXTENSION`, `NRSIZE`, `CONTEUDO_ACESSIVEL`; `FLDATA` somente quando solicitado. O ID de workflow é sintetizado como `wf-<CDFILE>`.

Os números de 1.716 arquivos de workflow em 909 chamados, 321 chamados apenas nessa origem, 1.683 arquivos em diretório e 33 no banco são **levantamentos anteriores informados pelo usuário**, não totais atuais confirmados nesta análise. Não estimar bytes ou quantidade total de posicionamentos/anexos das demais origens a partir deles.

## 3. Capacidades oficiais e nível de evidência

“Documentado” significa publicado pelo fornecedor; não comprova permissão, licença, versão ou funcionamento no ambiente do cliente. Não houve teste autenticado nesta etapa.

| Capacidade | Evidência e conclusão |
|---|---|
| Criar conjuntos de dados SQL com API REST | **Documentado oficialmente**. Menus DI006/DI007; parâmetros de query, ordenação e lista de segurança. [Cadastrar conjunto de dados](https://documents.softexpert.com/pt_BR/manage_dataset/di_006) |
| Consultar dataset | **Documentado oficialmente**: `GET /apigateway/v1/dataset-integration/:idDataset`. A página declara teto dos primeiros 10.000 registros e conversão de nulos em `""`. Não há paginação genérica comprovada nessa página. [GET dataset](https://developer.softexpert.com/docs/openapi/rest/data-integration/get-dataset-integration) |
| Consultar dataset com filtros | **Documentado oficialmente**: `POST` na mesma rota. Há erros 400, 404, 500 e 503; o 404 também pode representar falta de permissão. O corpo completo dos filtros não ficou disponível no conteúdo consultado; validar o esquema exportado, tipos e vinculação aos parâmetros antes de implementar. [POST dataset](https://developer.softexpert.com/docs/openapi/rest/data-integration/post-dataset-integration) |
| Leitura REST de workflow | Há operações documentadas de [consulta de workflow](https://developer.softexpert.com/docs/openapi/rest/workflow/get-instance) e [dados do workflow](https://developer.softexpert.com/docs/openapi/rest/workflow/get-instance-attribute). **Cobertura do formulário ITSM, grids, durações e anexos desconhecida**; não são substitutos comprovados das consultas atuais |
| SOAP Workflow/Formulário | `getWorkflow` é oficialmente documentado. Os WSDLs locais consultados publicam 23 operações de Workflow e seis de Formulário; o cliente local também implementa leitura `getTableRecord`. [Workflow SOAP](https://developer.softexpert.com/docs/openapi/soap/workflow/workflow), [getWorkflow](https://developer.softexpert.com/docs/openapi/soap/workflow/get-workflow) |
| Funcionamento já registrado na instalação própria | Há registro local de `getWorkflow` com sucesso em 15/10/2026 e obtenção dos WSDLs. Isso é **evidência histórica**, não disponibilidade atual. [Registro local](softexpert-consumo-real-leitura.md) |
| Funcionamento na nuvem de destino | **Não confirmado**. Os registros locais e o pedido relatam falhas de autorização; não inferir causa, equivalência de credencial entre domínios ou indisponibilidade definitiva |
| Download de anexo de workflow | **Não confirmado**. A lista pública consultada de Workflow SOAP não apresenta uma operação dedicada de download. Isso não exclui outra API ou mecanismo suportado. `newAttachment` é inclusão, não leitura. Não estender uma operação de Plano de Ação a Workflow |
| Autenticação | API Key e Basic são documentados; API Key é vinculada ao usuário e às suas permissões. Preferir API Key de conta exclusiva e menor privilégio. [Autorização](https://developer.softexpert.com/docs/data-integration/authentication-guides), [API Key](https://developer.softexpert.com/docs/data-integration/authentication-guides/api-key) |
| Limitação de tráfego | A documentação atual declara 10 requisições por segundo, resposta 429 e possíveis limites específicos. A abrangência por aplicação, usuário ou instância precisa ser confirmada. [Rate limits](https://developer.softexpert.com/docs/data-integration/auxiliary-information/rate-limits) |
| Automação e integrações de saída | O guia documenta integração e fontes REST/SOAP para consumo de outros sistemas. Isso **não prova** que cadastrar uma fonte publique uma API, nem que exista evento de anexo com payload binário. [Guia de integração](https://developer.softexpert.com/docs/data-integration/getting-started/integrate-with-softexpert-suite) |
| Customização na nuvem | Documento público de infraestrutura REV.14 distingue planos Standard/Premium sem customizações e Enterprise/Regulated com possibilidade. É evidência publicada antiga e não substitui o contrato vigente. Instalação de endpoint/serviço específico depende de aceite formal. [Infraestrutura Cloud](https://documentation.softexpert.com/en/cloud/SE22-EN_Cloud.Infrastructure.pdf) |

As páginas técnicas consultadas identificam a versão **3.1**; não presumir equivalência com a instalação ou com a skill local baseada em 3.0.0. A biblioteca não oficial citada no pedido deixa de ser necessária para provar a existência da rota de dataset: essa rota foi localizada na documentação oficial. A biblioteca não prova suporte a download nem viabilidade contratual.

## 4. Formas de desenvolver e hospedar

| Opção | Permissões e manutenção | Instalação própria / nuvem privada administrável | Nuvem gerenciada SoftExpert | Avaliação |
|---|---|---|---|---|
| Dataset parametrizado, configurado no produto | Administrador cria e versiona consultas; integração recebe apenas execução/visualização. SQL e view continuam sujeitos a mudanças de schema e SGBD | Viável se licenciada e autorizada | Candidata principal; confirmar acesso às tabelas/view e limites no plano | **Recomendada para dados estruturados** |
| APIs nativas REST/SOAP | Conta de integração, contrato de versão; menor dependência do schema físico | Validar cobertura | Validar versão, licença e permissão | Preferir onde houver equivalência comprovada, especialmente arquivos |
| Automação do produto enviando eventos | Exige configuração do processo, credenciais de saída, repetição, fila e reconciliação. Não assumir cobertura de alterações fora da atividade | Complemento possível | Depende de recursos e política de saída | Complemento futuro; não base exclusiva de carga histórica |
| Extensão suportada pela SoftExpert | Especificação e implantação aprovadas, responsabilidades de suporte e atualização contratadas | Possível mediante projeto | Dependente do plano e aceite do fornecedor | **Alternativa para o binário se faltar API nativa** |
| Serviço intermediário externo | Cache, normalização, autenticação, filas e observabilidade próprios | Pode usar APIs ou conector autorizado próximo à origem | Só usa interfaces que o fornecedor disponibilizar | Usar se houver necessidade operacional; não obrigatório para o primeiro adapter |
| Conector com banco/arquivos na rede da origem | Conta de leitura, escopo de diretórios, operação e atualizações próprias | Alternativa prática | Sem viabilidade presumida; exige acesso concedido | Contingência para ambientes administráveis |
| Endpoint PHP/customização informal no servidor | Acoplamento interno, risco de quebra e responsabilidade de suporte incerta | Tecnicamente concebível, mas suporte não comprovado | Não presumir acesso ou autorização | Não recomendado |

Como desenvolver os datasets: criar em homologação um pacote versionado de consultas explícitas, com parâmetros tipados, ordenação determinística e escopo fixo; comparar com o adapter; exportar a configuração pelo mecanismo que o produto efetivamente suportar; registrar IDs e versão do contrato. Não enviar SQL arbitrário pela API. Não presumir que o SGBD da nuvem seja SQL Server: `TOP`, `DATEADD`, `CONVERT`, tipos e nomes físicos devem ser adaptados e homologados.

## 5. Contratos propostos

Os nomes abaixo são **operações lógicas novas a especificar**, não endpoints existentes do SoftExpert. Elas podem ser implementadas por datasets e traduzidas pelo adapter; não exigem uma URL própria para cada operação. Só a rota oficial de dataset indicada na seção 3 está comprovada. Nenhum corpo oficial de request é inventado aqui.

### 5.1 Regras comuns

- Entrada de negócio: fonte e instalação resolvidas no servidor pelo usuário autenticado; escopo de clientes autorizado; parâmetros tipados e limitados. Não aceitar `empresaId` externo como prova de autorização.
- Saída normalizada no IA Service: `versaoContrato`, `geradoEm`, `itens`, `proximoCursor`, `completo`, `avisos` e, quando disponível, `snapshotId`. Tipos, nulos, precisão, timezone e enumerações são explícitos. Ausência de campo difere de valor nulo.
- Paginação preferencial por chave estável; cursor ligado a filtros, escopo e versão. Meta inicial: 500 chamados ou 1.000 posicionamentos por página; limites são **propostos**, abaixo do teto documentado do dataset, e dependem da homologação. Paginar pela linha de posicionamento, mesmo para um único chamado grande.
- Cursor por OID resolve deslocamentos de páginas, mas **não cria uma fotografia transacional**. Sem snapshot consistente da origem, usar marco superior, sobreposição e reconciliação final; apresentar a carga como observada ao longo do intervalo. Nunca prometer consistência pontual não suportada.
- Contagens e lista devem usar o mesmo escopo; diferenças sob concorrência são reconciliadas. `completo=false` nunca deve virar lista vazia bem-sucedida.
- Leituras são repetíveis e sem efeitos de negócio; respostas podem mudar com a origem. Reprocessamento local é idempotente por instalação/fonte + ID + revisão/hash, com checkpoint só depois de persistir o lote integralmente.
- Erro normalizado: `codigo`, mensagem em pt-BR sem segredos, `transitorio`, `retryAfterMs` quando houver, `correlacaoId` e escopo afetado. Tratar 401/403 como autenticação/permissão; não concluir inexistência a partir de 404 do dataset. Repetir apenas falhas transitórias, 429 e indisponibilidade, com prazo máximo.

### 5.2 Operações

| Operação proposta | Entrada e saída | Paginação, alterações e particularidades |
|---|---|---|
| `ConsultarChamadosPeriodo` | Início inclusivo/fim exclusivo da abertura, projeção completa, cursor/tamanho; todos os campos de 2.2 e derivados | Ordem por chave; snapshot ou reconciliação. Separar período de abertura de período de alteração |
| `ContarPeriodo` | Mesmo filtro; totais de chamados e posicionamentos, instante/consistência da contagem | Resposta única; pode usar dois datasets. Não contar posicionamentos por sua própria data |
| `ConsultarChamadosPorNumeros` | Lista limitada de números, projeção leve/completa; registros e resultado por número | Proposta: até 100 IDs por lote, subdivisível. Leve omite só durações e não apaga valores locais. Ausente/inacessível/fora do escopo não prova encerramento |
| `ConsultarPosicionamentos` | Um ou vários chamados, cursor; campos de 2.2 e chave do pai | Ordem determinística, páginas por linha. Suportar edição/exclusão por revisão ou reconciliação do conjunto; contar mensagens não detecta edição de texto |
| `ConsultarEstadoAtual` | Cursor de snapshot; abertos e versões de cabeçalho, histórico e anexos, responsável, situação e prazo | Paginar todos os abertos. Somente snapshot completo permite investigar ausências, ainda confirmadas por consulta individual. Incluir as cinco origens de anexos |
| `ListarAnexos` | Chamado e cursor; manifesto de metadados, sem base64 | Sem teto silencioso de 100; incluir remoções/revisões e total conhecido. Registrar listagem não verificada quando faltar qualquer página |
| `ObterConteudoAnexo` | Chamado, ID de anexo, revisão esperada; binário e metadados HTTP | Validar vínculo ao chamado e escopo em cada acesso. Não aceitar caminho de arquivo do cliente. Download retomável quando homologado |
| `ConsultarResponsavelAtual` | Número + OID do chamado; status do processo, cabeçalho, usuários habilitados e atividades ativas | Sem cache antigo para autorizar retorno. Preservar rejeição de ambiguidades; resposta insuficiente bloqueia a escrita |
| `ConfirmarPosicionamentoNoChamado` | Número/OID pai e `recordKey`; confirmação única e ID validado | Confirmação fresca. Não transformar texto de retorno SOAP em vínculo presumido; falha mantém etapa pendente |
| `ConsultarCapacidades` | Sem SQL externo; versão, operações suportadas, limites e resultado de verificações autorizadas | Substitui o teste SQL genérico e diagnóstico no modo API. Distinguir indisponível, proibido e não suportado |

Se o dataset só suportar parâmetros escalares, não presumir que aceite arrays ou operadores `IN`. Validar uma estratégia de lote suportada; enquanto isso, limitar a consulta individual sob controle de tráfego. A versão inicial não pode consolidar um lote enorme sujeito ao corte dos 10.000 registros.

### 5.3 Manifesto e conteúdo dos anexos

Cada item proposto precisa informar:

```text
id estável, origem, chamadoId/número, nome original, extensão e MIME,
tamanho do conteúdo original (ou desconhecido), revisão/ETag,
criadoEm, alteradoEm e autor quando realmente disponíveis,
atividadeId, posicionamentoId quando comprovado,
tipoVinculo (abertura | posicionamento | chamado | atividade),
qualidadeVinculo (exato | inferido | desconhecido), fundamentoVinculo,
disponibilidade (disponivel | pendente | negado | removido | erro),
motivo, compactacaoArmazenamento quando conhecida,
checksum do conteúdo original quando disponível.
```

Separar identidade do arquivo e identidade da associação: o mesmo arquivo pode aparecer em contextos diferentes. Manter o identificador legado para não duplicar o cache ao trocar o transporte; não assumir que `wf-<CDFILE>` sozinho identifique todas as associações possíveis.

O download deve devolver preferencialmente **o arquivo original descompactado**, por streaming, sem envolver base64 no JSON. Definir `Content-Type`, `Content-Disposition`, ETag e tamanho quando conhecidos. Descompactar gzip de armazenamento não é o mesmo que negociar `Content-Encoding: gzip` no HTTP. Conteúdo legitimamente ZIP/Office deve permanecer nesse formato.

Há código local recente para desembrulhar um ZIP de um único arquivo recebido em `GNFILE.FLFILE`; seu comentário registra observação de produção em 02/11. Não foi revalidada nesta análise. Logo, o contrato deve distinguir embalagem interna, arquivo original e compressão HTTP, sem aplicar gzip ou unzip indiscriminadamente. Validar CRC/checksum e tamanhos após expansão, limitar bytes, razão de expansão e tempo, e não extrair caminhos de arquivo do ZIP no filesystem.

Para arquivos grandes: manifesto sempre disponível, independentemente do limite da IA; streaming com backpressure e cancelamento; retomada via `Range`/`If-Range` somente se origem/extensão suportar. Se não suportar, declarar isso e reiniciar com limite de tentativas. Hash e range referem-se à mesma representação. Descompactação em streaming não dá acesso aleatório por si só: retomada pode exigir cache do original.

Proposta inicial: preservar 25 MiB como limite de ingestão na IA; arquivos maiores ficam identificados como não lidos. Aumentar o limite de download humano exige fluxo próprio e homologação, pois a implementação atual também limita o download no serviço. Não confundir arquivo baixado com arquivo extraído/processado e efetivamente entregue ao modelo.

### 5.4 Detecção de alterações

Preferir versão monotônica ou feed de mudanças **apenas se fornecido por interface suportada**, cobrindo inclusão, edição, exclusão, fechamento, reabertura, permissão e anexos. Não há esse feed comprovado nesta análise.

Sem isso: snapshot paginado de todos os abertos, consulta por ID para ausências, manifesto de anexos com revisão/hash, releitura com sobreposição e reconciliação periódica também dos encerrados. A janela de sete dias por abertura não captura edição de chamado antigo. Contagem + maior horário não detecta substituição sem mudança de quantidade ou edição de mensagem antiga. SLA pode mudar apenas pelo relógio: reavaliar prazo no instante correto mesmo sem alteração de registro.

## 6. Vínculo exato do anexo

É exato para anexos ligados diretamente ao OID do posicionamento, inclusive a grid `DYNITSMGRIDANEXOAP` quando habilitada. O arquivo principal tem vínculo ao chamado; a grid `DYNITSMGRIDANEXO` comprova pertencimento ao chamado, não a uma mensagem específica.

Para workflow, o código relaciona a atividade via `WFPROCATTACHMENT.IDSTRUCT → WFSTRUCT.IDOBJECT`. A regra atual trata `S.IDSTRUCT='ATV-01'` como abertura; nas outras atividades escolhe o primeiro posicionamento cujo `BNCREATED` é posterior ou igual a `ADATTACHMENT.BNUPDATED`, senão o anterior, senão o chamado. Isso é heurística local: horário de atualização não prova autoria ou correspondência, e o nome/código da etapa não é universal.

Uma API não recupera um relacionamento que nunca foi persistido. Solicitar ao fornecedor se existe chave de evento, comentário, execução de atividade ou relacionamento auditável que resolva isso. Se houver, validar casos de reabertura, atividades paralelas, upload tardio e edição. Se não houver, apresentar vínculo ao chamado/atividade e marcar inferência, preservando data/autor desconhecidos. Para novos anexos, uma futura mudança no formulário/processo poderia persistir o OID da mensagem; exigiria autorização própria e não corrigiria o histórico automaticamente.

## 7. Segurança e isolamento

A documentação recomenda API Key e usuário exclusivo; a configuração proposta usa conta de leitura separada da conta SOAP de escrita, menor privilégio e restrição aos datasets/objetos necessários. Confirmar licença MANAGER e recursos de conta de integração com a SoftExpert; não ampliar permissões apenas para contornar 401/404.

O escopo precisa existir em dois níveis: empresa/instalação/fonte do IAHub e clientes atendidos dentro do mesmo SoftExpert. `CNPJCPF` é dado de negócio, não autorização. Um parâmetro livre de CNPJ não isola empresas. Validar restrição obrigatória na origem ou serviço confiável, e se o SQL do dataset respeita ACL de objetos: a lista de segurança do dataset, isoladamente, não comprova filtragem por linha.

Vincular toda requisição, cursor, cache e anexo ao escopo autorizado. Verificar novamente autorização no download; IDs enumeráveis e arquivos já cacheados não podem contornar revogação. Não fazer fallback automático para outra instalação, credencial ou fonte. Compartilhamento de conhecimento entre clientes precisa de política explícita, não decorre do acesso técnico aos dados.

Usar HTTPS com validação de certificado e hostname, segredos apenas no backend/cofre, rotação e logs sanitizados. Não usar token em URL nem registrar corpo de mensagem/binário por padrão. O provider atual do agente contém `rejectUnauthorized:false`; **não reutilizar essa configuração no novo transporte**. Correção do legado é mudança de segurança separada, sujeita à aprovação do projeto.

Auditar operação, identidade técnica e usuário solicitante, empresa/fonte, IDs autorizados, instante, revisão, resultado, duração e bytes, sem conteúdo sensível desnecessário. URLs temporárias de download, se suportadas, devem ter validade curta e não ir para logs. Restringir hosts/redirects para evitar envio de credenciais a destinos externos. Antes de usar cache, revalidar acesso; indisponibilidade não autoriza ampliar o escopo.

## 8. Encaixe no IA Service

O ponto de extensão já existe em `fontes_historicas.adapter` e no registro `import/adapters/index.js`. Criar futuramente um `SoftExpertApiAdapter` que devolva os mesmos formatos esperados pelo importador. Normalizar explicitamente os vazios da API de dataset; campos numéricos vazios não podem virar zero por acidente.

Impacto previsto, antes de qualquer implementação:

1. Registro de adapter e cliente HTTP próprio com TLS válido, limites, cancelamento e classificação de erros.
2. Configuração por fonte para transporte, URL, referência do segredo, IDs/versionamento dos datasets e capacidades; manter fontes SQL existentes. O cadastro atual exige `connectionKey` e vários testes assumem agente, portanto **trocar só o nome do adapter não basta**.
3. Paginação e checkpoint: o importador atual trabalha com offset. O adapter pode traduzir sequencialmente para cursor, mas retomada confiável pede persistir cursor/contexto de exportação ou uma equivalência comprovada; não guardar cursor apenas em memória.
4. Novas capacidades para responsável e confirmação de OID, removendo a dependência direta de agente em `retorno-softexpert-source.js` para fontes API.
5. Leitura binária separada da listagem no serviço de anexos. Como o serviço atual espera `FLDATA` base64, streaming real exige evoluir essa interface interna; mera tradução para base64 funciona apenas como transição limitada.
6. Diagnóstico/teste por capacidade nas rotas; manter SQL de diagnóstico somente para fonte SQL. Nenhum SQL arbitrário será encaminhado ao SoftExpert remoto.
7. Refresh/snapshot com cobertura de workflow e validade explícita; investigação continua usando os serviços locais e os avisos de anexos faltantes.

Preservar `sistemaOrigem='softexpert'`, identidade da instalação/fonte, IDs e referências existentes para a troca não duplicar chamados, mensagens ou arquivos. Manter o fluxo do consultor e as telas de pesquisa; a configuração administrativa precisará representar o novo transporte, por API/configuração ou posterior adaptação do configurador. Não prometer configurar a integração nova apenas pela tela atual.

`index.js` já inicializa banco e monta rotas do IA Service; não requer alteração presumida para registrar um adapter. Se houver worker/fila adicional, definir lifecycle e implantação explicitamente. Não introduzir serviço de background escondido. Conta SOAP e seus estados de idempotência permanecem separados; timeout de escrita não autoriza repetir inclusão automaticamente.

## 9. Desempenho, cache e indisponibilidade

Para 12.438 chamados, páginas de 500 representam aproximadamente 25 páginas de cabeçalho e pelo menos outras 25 consultas de posicionamentos, **se** cada lote de mensagens couber na página suportada. Acrescentar contagens, páginas extras e manifestos; arquivos são buscados sob demanda. Não extrapolar duração total sem volume de mensagens/bytes e medições da view.

Proposta inicial de operação: limitador compartilhado por instalação, começando em duas requisições por segundo e duas simultâneas, com prioridade para consulta interativa; ajustar com homologação e cota efetiva. A referência pública de 10/s não é meta para saturação. Coordenar outros consumidores da mesma instalação, respeitar `Retry-After` quando fornecido e usar backoff exponencial com jitter e orçamento total.

Cache de metadados por empresa/fonte/escopo, aproveitando TTL de 60 s do snapshot; arquivos por ID + revisão + checksum, gravação temporária seguida de rename atômico, deduplicação de downloads em andamento e orçamento de disco/retenção. Download incompleto nunca é arquivo válido. Validar hash, pois o código atual de integridade local verifica existência/tamanho com tolerância, não checksum.

O código atual verifica anexos em todo turno, com até três tentativas por operação. A investigação limita a espera por padrão a **45 s**, e pausa novas tentativas por empresa por dois minutos após estouro; o provider do agente possui timeout de 240 s. `Promise.race` limita espera mas não cancela a operação subjacente. Esses valores não demonstram chat rápido na nuvem.

Para o modo API, propor orçamento de até 3 s adicionais para verificação no caminho do turno, mantendo transferências longas em fila com cancelamento do request e sem bloquear o chat. É meta a medir, não garantia atual. Antes de enviar contexto ao modelo, consolidar o estado: recebido/processado, pendente, não suportado, negado, removido, corrompido ou não verificado. Se o prazo acabar, gerar aviso para IA e analista com nomes conhecidos; se nem o manifesto estiver completo, avisar que podem existir outros arquivos. Entrega posterior só entra em uma nova análise explícita/seguramente agendada.

Manter a estrutura já existente de `garantirAnexosParaIA` e `descreverGarantia`, mas não inferir “sem anexos” de adapter sem capacidade, paginação incompleta, timeout ou erro. O código atual retorna lista vazia quando o adapter não implementa anexos; esse comportamento não é aceitável como comprovação no modo API.

Fora do ar: mostrar data da última sincronização e pendências; permitir uso do contexto local conforme autorização e validade; impedir ações que dependam de confirmação atual do responsável/status. Snapshot antigo não autoriza encerramento ou escrita. Arquivo disponível para download humano ainda pode estar indisponível ao modelo por tipo, tamanho ou falha de extração; comunicar cada condição.

## 10. Plano por fases e homologação

Esforço relativo: P = pequeno, M = médio, G = grande. Não são estimativas de calendário; a extensão de arquivos depende do fornecedor.

| Fase | Entrega | Esforço / risco / dependência | Aceite |
|---|---|---|---|
| 0 — Viabilidade | Confirmar versão/plano, API de datasets, schema, permissões e download de arquivos de cada origem | M; risco alto de bloqueio no SaaS; depende da SoftExpert | Recuperar manifesto e bytes corretos de arquivo fora do banco, sem acesso ao servidor do cliente |
| 1 — Contratos em homologação | Datasets versionados, normalização e estratégia de paginação/isolamento; contrato binário aprovado | M/G; schema/view/SGBD e limite de dataset | Resultados equivalentes ao SQL para o mesmo escopo e período, inclusive nulos e zeros iniciais |
| 2 — Adapter de leitura | Carga completa, por IDs, posicionamentos, snapshot e diagnóstico; checkpoint persistente | M/G; depende da fase 1 | Importar mais de 10.000 chamados sem perda, retomar falha no meio e reconciliar alterações concorrentes |
| 3 — Anexos e garantia | Download individual, streaming/cache, versões, associação e avisos; incluir workflow no refresh | G; risco de compressão, arquivos grandes e vínculo histórico | Todas as cinco origens cobertas, erro nunca silencioso e orçamento do turno cumprido |
| 4 — Retorno existente | Leitura de responsável/vínculo por API, preservando executor SOAP | M; segurança funcional alta | Mesmos bloqueios em ambiguidade, usuário desabilitado, processo fechado e pai incorreto; escrita somente em homologação autorizada |
| 5 — Comparação e implantação | Comparação SQL/API em ambiente autorizado, métricas, habilitação por fonte e rollback | M; quotas, concorrência e suporte | Reconciliação aprovada, isolamento testado, procedimento de atualização e reversão documentado |

Casos mínimos de homologação: chamado antigo alterado; encerramento/reabertura e cancelamento; mudança de responsável sem mensagem; edição e exclusão de posicionamento; mais de 100 anexos; mais de 10.000 resultados; várias páginas de mensagens para um chamado; anexo novo de workflow sem outro evento; arquivo trocado mantendo nome/quantidade; mesmo conteúdo em associações diferentes; gzip inválido; embalagem ZIP e Office legítimo; MIME divergente; arquivo vazio e acima de 25 MiB; download interrompido; 401/403/404 ambíguo/429/500/503; revogação de acesso; isolamento entre clientes e entre fontes; reinício do processo no meio do lote; latência e memória sob concorrência; ausência de segredos nos logs.

Usar os testes locais de listagem leve, sincronização por origem, garantia de anexos, turno e retorno como referência para testes futuros de contrato. Nesta etapa não foram executadas suítes: não houve alteração funcional, e alguns testes fazem escrita em bancos temporários. Não executar scripts de investigação existentes que possam chamar produção sem autorização específica.

Rollback proposto: selecionar novamente transporte SQL na mesma fonte quando ainda disponível e autorizado, preservando IDs e checkpoints compatíveis; se a origem migrou e ficou inacessível ao agente, rollback depende de manter temporariamente o acesso anterior ou restaurar a integração, não apenas mudar configuração.

## 11. Perguntas prontas para o suporte SoftExpert

Assunto sugerido: **Integração de leitura ITSM na nuvem — datasets parametrizados e download de anexos de workflow**.

Precisamos migrar o consumo do IA Service, atualmente via SELECT e leitura de diretório, para interfaces oficialmente suportadas sem acesso direto ao banco ou servidor. Há aproximadamente 12,4 mil chamados e anexos tanto em formulário quanto em workflow, inclusive arquivos fora do banco. Solicitamos:

1. Qual versão/build, plano de nuvem e licenças serão usados? Quais recursos de integração, homologação e customização estão incluídos?
2. DI006/DI007 e `GET/POST /apigateway/v1/dataset-integration/:idDataset` estão disponíveis nesse ambiente? Enviar OpenAPI/esquema completo de request/response da versão instalada, com exemplos sanitizados.
3. Como os parâmetros de SQL são enviados e tipados? Há suporte a arrays/lotes, cursor, paginação e ordenação? O teto de 10.000 também se aplica ao POST? Há indicador de truncamento, limite de bytes e timeout?
4. Podemos consultar as tabelas ITSM dinâmicas, `WFPROCESS`, `WFSTRUCT`, `ADUSER` e a view consolidada? A view `ITSM_CHAMADOS` pode ser mantida/migrada de forma suportada? Qual será o SGBD e como mudanças de schema são comunicadas?
5. A execução do dataset aplica permissões por objeto/linha ou apenas a segurança do próprio dataset? Como restringir clientes distintos dentro de uma única instalação sem confiar em parâmetro livre?
6. Qual é a API oficial para listar e baixar **anexos de Workflow**, incluindo os associados por `WFPROCATTACHMENT/ADATTACHFILE/GNFILE`, estejam no banco, diretório ou object storage? Enviar operação, contrato, versões mínimas e permissões. APIs de Documento/Plano de Ação não demonstram essa cobertura.
7. A interface devolve bytes originais ou embalagem gzip/ZIP? Como informa tamanho original, MIME, revisão, checksum e integridade? Suporta streaming, Range/If-Range, retomada, URLs temporárias e arquivos grandes? Quais limites e custos de tráfego?
8. Existe relacionamento persistido entre anexo do workflow e mensagem/posicionamento/abertura? Há ID de evento, execução de atividade ou trilha auditável que resolva isso? Como tratar reaberturas e atividades paralelas?
9. Há recurso suportado de mudanças/eventos cobrindo edição, exclusão, fechamento, reabertura e inclusão/substituição de anexos? Qual a garantia de entrega, repetição, ordem e retenção? Permite recuperar histórico anterior à ativação?
10. Como consultar responsável do cabeçalho, atividades ativas, usuário habilitado e vínculo de um registro de grid ao pai por API? Essas leituras permitem validar os mesmos bloqueios antes/depois das operações SOAP existentes?
11. O limite público de 10 requisições/s é por instância, aplicação, IP ou usuário? Quais limites de concorrência e exceções para datasets/download? Há `Retry-After` e métricas de consumo acessíveis?
12. Quais permissões mínimas e licença da conta exclusiva de leitura? API Key tem expiração/rotação e restrição por origem? Como diagnosticar os 401 recentes sem enviar credenciais no chamado de suporte?
13. Se não existir download nativo adequado, qual extensão/exportação a SoftExpert oferece e suporta no nosso plano? Quem implanta, mantém e homologa após upgrades? Quais custos, SLA e restrições de acesso ao armazenamento?
14. Como exportar/versionar datasets entre homologação e produção, validar contratos antes de upgrade e auditar consultas/downloads? Qual ambiente de homologação e procedimento de mudança são oferecidos?

## 12. Premissas corrigidas ou incompletas

- As tabelas informadas não incluíam **ADUSER**, usada para confirmar responsável/habilitação no retorno.
- Não basta substituir o adapter SQL: configuração/teste de fonte, diagnóstico direto, leitura física de arquivos e validações do retorno ainda dependem do agente.
- Há cinco origens de anexos; comentários antigos no código ainda citam três/quatro. A grid de anexos do posicionamento é habilitada por empresa/fonte.
- O snapshot atual **não inclui anexos de workflow**. Também não é um feed completo de alterações: contagens/maior horário não detectam toda edição/substituição.
- O snapshot usa `INNER JOIN` com a view; a carga de chamados usa `LEFT JOIN`. Logo, não demonstram o mesmo universo se a view não tiver todas as linhas. Não interpretar ausência como encerramento.
- Os limites de 100 anexos, 5.000 posicionamentos individuais e 50.000 em lote não oferecem paginação/completude explícita ao consumidor. O novo contrato deve corrigir isso, em vez de reproduzir truncamentos silenciosos.
- O incremento por abertura de sete dias não cobre sozinho alterações em históricos antigos ou encerrados.
- A API REST de datasets está **confirmada na documentação oficial**, com ressalvas de teto e conversão de nulos; deixou de ser apenas indício de biblioteca externa.
- A documentação pública atual é 3.1. Capacidades da versão atual não comprovam capacidades da instalação antiga nem do plano contratado.
- A situação de 401 relatada não prova ausência da API, revogação da chave, ou mudança de autenticação: a causa permanece desconhecida.
- A convenção de nome `.gz` é de armazenamento observado, não contrato universal de download. Há também tratamento local recente de ZIP no binário de workflow; os totais antigos de arquivos não são fotografia atual comprovada.
- Vínculo temporal do workflow à mensagem continua inferido. Uma API só poderá torná-lo exato se houver informação persistida adicional.
- Há cache e avisos de anexos faltantes já implementados, mas a verificação de integridade é baseada em tamanho, o tempo padrão de espera pode chegar a 45 s e o trabalho subjacente não é cancelado por `Promise.race`.
- O transporte legado do agente desativa validação de certificado HTTPS. O novo cliente precisa de TLS validado; não herdar essa opção.

A próxima decisão técnica depende de respostas do fornecedor sobre datasets no ambiente contratado e, principalmente, acesso suportado ao conteúdo dos anexos de workflow. A execução de qualquer prova autenticada em produção, configuração do SoftExpert ou implementação depende de nova autorização.
