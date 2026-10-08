# IA Service - Auditoria Tecnica e Comportamental do Motor Investigativo V1.0

Data da auditoria: 2026-10-07  
Commit/revisao auditada: `213303bb25938144bf21c854a56650c2bceacb34`  
Escopo: auditoria estatica por codigo real, inventario de testes existentes e execucao controlada de testes locais/offline.  
Regra aplicada: nenhuma alteracao foi feita no motor, prompts, providers, queries, ranking, contexto, dossie, banco, frontend ou configuracao. Este arquivo e o unico artefato criado.

## 1. Resumo executivo

O motor V1.0 nao e apenas um gerador de respostas plausiveis. Pelo codigo auditado, ele possui um fluxo investigativo real com: ingestao de chamado/mensagens/anexos, extracao de conteudo, selecao de evidencias por score e orcamento, dossie persistente, pesquisa tecnica externa com providers e fallback, leitura segura de paginas, ranking, Quality Gate e trilha de auditoria em `investigacao_execucoes`.

A classificacao desta auditoria e:

**B - MOTOR V1.0 BOM, MAS NECESSITA CALIBRACOES PONTUAIS**

A evidencia mais forte a favor do motor e que ha mecanismos implementados para diferenciar evidencia selecionada/omitida, fonte encontrada/lida, retry por Quality Gate, memoria multi-turno e protecao contra prompt injection. A principal limitacao e que o benchmark comportamental disponivel ainda e sintetico/offline, com 14 casos, e nao substitui um Golden Set real de 20 a 30 chamados resolvidos e anonimizados.

Confianca da auditoria: **MEDIA**. Houve leitura de codigo e execucao de testes locais, mas nao houve benchmark real com chamados produtivos anonimizados nem validacao humana especialista caso a caso.

## 2. Escopo

Auditoria do motor investigativo do IA Service em:

- backend de atendimento, anexos e investigacao;
- pipeline de contexto;
- pesquisa tecnica externa;
- providers de IA;
- Quality Gate;
- dossie/memoria persistente;
- observabilidade e persistencia;
- testes existentes e benchmark offline.

Fora do escopo executado:

- chamadas reais a providers pagos;
- pesquisa web real em producao;
- uso destrutivo de chamados reais;
- alteracao de qualquer componente do motor.

## 3. Limitacoes da auditoria

- O codigo possui alteracoes preexistentes no worktree em `apps/IA Service/backend/routes/externo-routes.js`, `apps/IA Service/backend/routes/index.js`, `apps/IA Service/backend/services/consultor-service.js`, `apps/IA Service/backend/services/context-engine.js`, `apps/IA Service/backend/services/investigacao-service.js`, `repomix-output.xml` e arquivo nao rastreado `apps/IA Service/backend/_verify_analista.js`. Esta auditoria nao reverteu nem editou esses arquivos.
- Os testes executados foram locais/offline ou com mocks. Nao foi executado benchmark real contra providers externos.
- O relatorio diferencia "implementado por codigo" de "validado por teste". Onde nao houve teste comportamental, a conclusao permanece como lacuna ou inferencia.

## 4. Arquitetura REAL encontrada

Entrypoints principais:

- `apps/IA Service/backend/routes/index.js`: rotas internas de atendimento, upload de anexos, investigacao, radar e pesquisa. A rota `/api/ia-service/atendimentos/:id/investigar` chama `investigacaoService.processarTurno` com `texto`, `anexoIds`, `anexosComoContexto` e `forcarPesquisa`.
- `apps/IA Service/backend/routes/externo-routes.js`: rotas externas equivalentes para sessao externa por telefone, mantendo isolamento por `svcEmpresaId`.
- `apps/IA Service/backend/services/investigacao-service.js`: orquestrador do turno investigativo.
- `apps/IA Service/backend/services/context-engine.js`: selecao de mensagens, anexos, imagens, PDFs visuais, dossie e pesquisa externa dentro do orcamento.
- `apps/IA Service/backend/services/technical-research-service.js`: planejamento e execucao de pesquisa tecnica.
- `apps/IA Service/backend/services/ai-provider-client.js`: chamada multi-provider com fallback.
- `apps/IA Service/backend/services/quality-gate-service.js`: avaliacao pos-resposta e retry corretivo.
- `apps/IA Service/backend/services/investigacao-dossie-*`: dossie tecnico persistente, memoria operacional e atualizacao semantica.

## 5. Fluxo completo

Fluxo real encontrado:

ATENDIMENTO / CHAMADO  
-> MENSAGEM DO ANALISTA OU PRE-ANALISE  
-> VINCULO DE ANEXOS DO TURNO  
-> DOSSIÊ CRIADO/CARREGADO  
-> CLASSIFICACAO DE TURNO CURTO, quando aplicavel  
-> PLANEJAMENTO DE PESQUISA  
-> PESQUISA EXTERNA / FALLBACK / LEITURA SEGURA  
-> SELECAO DE CONTEXTO E EVIDENCIAS  
-> CARGA DE IMAGENS E PDFs VISUAIS  
-> CHAMADA AO PROVIDER DE IA  
-> QUALITY GATE  
-> RETRY CORRETIVO, se necessario  
-> PERSISTENCIA DA RESPOSTA  
-> PERSISTENCIA DE EXECUCAO/AUDITORIA  
-> ATUALIZACAO SEMANTICA DO DOSSIÊ

Evidencias:

- `investigacao-service.js`: `processarTurno` em linha 202; chamada de contexto em linha 350; chamada ao provider em linha 464; Quality Gate em linha 468; retry em linha 475; persistencia de execucao em linhas 590 e 636; atualizacao do dossie em torno das linhas 678-686.
- `context-engine.js`: `montarContextoInvestigacao` em linha 209; candidatos/selecionados/omitidos em linhas 256-365; manifesto em linhas 388-415.
- `technical-research-service.js`: sinais tecnicos em linha 166; planejamento semantico em linhas 667 e 715; ranking em linha 960; abertura/leitura de resultados em linha 1010; providers de pesquisa em linhas 1080, 1138 e 1219.

## 6. Extracao de sinais

Implementado por codigo:

- Detecta dominio por termos e por produto estruturado, com peso especial para `chamado.produto`.
- Extrai produtos, rotinas, funcoes, tabelas/campos, versoes/builds, HTTP status, arquivos e linhas com erro/stack/timeout.
- Para Protheus, cobre sinais como ADVPL/TLPP, AppServer, DBAccess, SmartClient, RPO, SX, REST/SOAP e rotinas padronizadas.
- Para SoftExpert, cobre workflow, WFPROCESS, DYNITSM, DYNITSMGRIDREGISTR, SEBLOB e anexos.

Evidencia: `technical-research-service.js`, funcoes `detectarDominio` e `_extrairSinaisTecnicos` em torno das linhas 130-214.

Lacuna:

- A extracao e regex/heuristica. Nao ha evidencia de avaliacao ampla em chamados reais para medir recall/precision por campo tecnico.

## 7. Context Engine

Pontos fortes comprovados por codigo:

- Seleciona evidencias por score, prioridade e orcamento.
- Diferencia mensagens, anexos textuais, imagens, PDFs visuais e anexos nao suportados.
- Registra `selecionados`, `omitidos`, motivo, status, score e tokens estimados no manifesto.
- Limita pesquisa externa a ate 25% do orcamento de entrada restante.
- Preserva evidencias criticas mesmo quando o orcamento ficaria apertado.

Evidencia: `context-engine.js`, linhas 209-464.

Lacuna:

- O manifesto mostra o que foi selecionado e omitido, mas a auditoria nao validou empiricamente com anexos reais grandes se a selecao sempre preserva o anexo decisivo.

## 8. Anexos

Pipeline real:

UPLOAD / SINCRONIZACAO SOFTEXPERT  
-> DETECCAO MIME REAL  
-> EXTRACAO TEXTUAL / MARCACAO DE IMAGEM  
-> DETECCAO DE LINGUAGEM  
-> PERSISTENCIA EM `anexos`  
-> SELECAO PELO CONTEXT ENGINE  
-> ENVIO TEXTUAL OU MULTIMODAL AO MODELO  
-> MANIFESTO DE SELECAO/OMISSAO

Formatos suportados por codigo:

- Imagem: PNG, JPEG, GIF, WEBP.
- PDF: `pdf-parse` com fallback bruto; PDF visual pode ser rasterizado por Playwright quando necessario.
- Texto/codigo: TXT, LOG, JSON, XML, CSV, SQL, ADVPL/PRW, TLPP, CH, JS, TS, PY, Java, config/INI.

Evidencia:

- `extracao-conteudo.js`, linhas 11-21, 26-42, 56-80, 83-100, 130-193.
- `pdf-visual-service.js`, linhas 14-38 e 38-77.
- `context-engine.js`, linhas 292-340 e 368-383.

Teste executado:

- `node "apps\IA Service\tests\anexos-softexpert-sync.test.js"` passou. Validou idempotencia por OID SoftExpert, reparo de arquivo fisico ausente e preservacao de registro.

## 9. Pesquisa

Implementado por codigo:

- Planejamento de pesquisa por dominio, sinais tecnicos, pedido explicito e dossie.
- Deduplicacao de consultas por nucleo tecnico.
- Priorizacao de dominios oficiais por produto.
- Providers de busca: Serper/Google, Gemini/Google Search e OpenAI/Web Search; Bing aparece como fallback legado por env var.
- Serper recebe todas as consultas planejadas; Gemini/OpenAI recebem a consulta mais relevante, conforme comentarios e codigo de roteamento.
- Leitura segura das paginas por `safe-web-fetch-service`, nao apenas titulo/snippet.

Evidencia:

- `technical-research-service.js`, `_montarConsultaPorSinais` linha 321; `_deduplicarConsultas` linha 348; `_dominiosPrioritarios` linha 291; `_rankearResultados` linha 960; `_abrirResultados` linha 1010; providers em linhas 1080, 1138 e 1219; roteamento em `pesquisar` linha 1279.
- `safe-web-fetch-service.js`, bloqueio SSRF/protocolo/redirects/limites em linhas 30-92 e 130-153.

Teste executado:

- `node "apps\IA Service\tests\etapa-v1-pesquisa-web-motor.test.js"` passou: fallback multi-provider, proveniencia e degradacao segura.

## 10. Providers

Providers de IA reais no cliente:

- Groq, OpenAI, DeepSeek, Claude e Gemini.
- Ordem default: `groq`, `deepseek`, `openai`, `claude`, `gemini`.
- Providers sem suporte a imagem sao pulados quando ha payload visual.
- Erros transitorios podem ser retentados; erros permanentes de chave/cota/modelo param martelamento no provider.

Evidencia: `ai-provider-client.js`, linhas 16-20, 35, 82-176, 179-280.

## 11. Queries

Pontos fortes:

- Query usa produto, rotina, funcao, tabela/campo, versao/build, HTTP status e termos relevantes de erro.
- Evita frase exata longa para erros, reduzindo risco de zero resultado.
- Sanitiza consulta externa e redige dados sensiveis.

Lacunas:

- Ha benchmark offline mostrando excesso de pesquisa em alguns casos com evidencia interna suficiente.
- Nao foi medido, em web real, Top-1/Top-3/Top-5 por fonte correta.

## 12. Ranking

Implementado por codigo:

- Ranking considera oficialidade, dominios prioritarios, produto, sinais tecnicos e similaridade por tokens.
- Fontes oficiais ganham peso.
- Resultados ordenados por `rankingScore` e oficialidade.

Evidencia: `technical-research-service.js`, linhas 928-964.

Lacuna:

- Ainda falta validacao com Golden Set real para saber se documentacao oficial especifica vence fontes genericas nos casos importantes.

## 13. Deduplicacao

Implementado:

- Deduplicacao de consultas por nucleo tecnico.
- Historico de consultas, URLs encontradas e URLs lidas e usado para evitar repeticao sem evidencia nova.

Evidencia: `technical-research-service.js`, linhas 266-285, 348-429.

## 14. Fontes oficiais

Implementado:

- Protheus/TOTVS prioriza `tdn.totvs.com`, `centraldeatendimento.totvs.com` e `totvs.com`.
- SoftExpert prioriza `developer.softexpert.com`, `documentation.softexpert.com`, `softexpert.com` e `help.softexpert.com`.

Evidencia: `technical-research-service.js`, linhas 47-63 e 291-307.

## 15. Encontrada x Lida x Utilizada

O motor distingue estados relevantes:

- Fonte encontrada: resultados em `pesquisa.resultados`.
- Fonte lida: `pesquisa.paginasLidas` com status como `lida`, `reutilizada`, `erro_fetch`, `timeout`, `bloqueada`, `content_type_invalido`, `limite_download`.
- Fonte utilizada no contexto: `context-engine` seleciona trechos de `paginasLidas` dentro do orcamento e registra `fontesSelecionadas`, `fontesOmitidas`, `trechosSelecionados` e `trechosOmitidos`.

Evidencia:

- `technical-research-service.js`, linhas 1010-1068, 1390-1416, 1455-1460.
- `context-engine.js`, linhas 146-206.

## 16. Evidencias

O manifesto operacional registra:

- evidencias selecionadas;
- evidencias omitidas;
- status de anexo nao suportado;
- motivo de omissao;
- score;
- tokens estimados;
- dossie usado;
- pesquisa externa selecionada/omitida;
- imagens selecionadas;
- PDF visual selecionado.

Evidencia: `context-engine.js`, linhas 388-415.

## 17. Raciocinio investigativo

Pontos fortes:

- Prompt instrui explicitamente a separar fato, hipotese, causa provavel e conclusao confirmada.
- Quality Gate verifica respostas genericas, template robotico, correcao pouco acionavel, descarte de customizacao sem base, uso indevido de IDs internos, resposta visual generica e regressao investigativa.
- A disciplina investigativa avalia afirmacoes contra evidencias disponiveis.

Evidencia:

- `prompt-builder.js`, inicio do `SYSTEM_PROMPT`.
- `quality-gate-service.js`, linhas 1-286.

Lacuna:

- Parte da qualidade final depende do comportamento do LLM e nao so de regras deterministicas.

## 18. Multi-turno

Implementado:

- Historico anterior e carregado.
- Dossie registra fatos, hipoteses, testes, resultados e relacoes.
- Memoria operacional injeta hipoteses descartadas e testes executados com instrucao de nao repetir sem nova evidencia.
- Quality Gate detecta repeticao de teste/hipotese/solucao ja encerrada.

Evidencia:

- `dossie-context-service.js`, linhas 93-204.
- `quality-gate-service.js`, linhas 99-160.
- `investigacao-dossie-atualizador-service.js`, linhas 76-97, 223-263, 419-535.

Teste executado:

- `node "apps\IA Service\tests\etapa3a-dossie-persistente.test.js"` passou.
- `node "apps\IA Service\tests\etapa4b-disciplina-investigativa.test.js"` passou: pos-disciplina com `posFalhas=0`, `posHallucinations=0`, `posPesquisas=5`, `posResolvidos=5` no recorte do teste.

## 19. Dossie/memoria

Implementado:

- Tabelas `investigacao_dossies`, `investigacao_itens`, `investigacao_item_relacoes` e `investigacao_dossie_atualizacoes`.
- Controle de versao/optimistic locking.
- Idempotencia por hash/idempotency key.
- Stale handling em falha de atualizacao.
- Evidencias validadas por empresa/atendimento.

Evidencia:

- `migrations.js`, linhas 759-868.
- `investigacao-dossie-service.js`, linhas 102-226.
- `investigacao-dossie-atualizador-service.js`, linhas 127-184, 419-535.

## 20. Quality Gate

Natureza real:

- Heuristico/deterministico, nao uma segunda avaliacao LLM.
- Executa apos resposta.
- Pode forcar retry corretivo uma vez.
- Usa manifesto, pesquisa e pergunta para detectar falhas.

Evidencia:

- `quality-gate-service.js`, `avaliarResposta` em torno da linha 172; `montarInstrucaoRetry` em torno da linha 288.
- `investigacao-service.js`, linhas 468-519.

## 21. Confianca

O motor nao usa score probabilistico de confianca como "90% correto". Ele extrai termos textuais da resposta (`causa confirmada`, `forte evidencia`, `hipotese provavel`, `evidencia insuficiente`) e persiste em mensagem.

Evidencia: `investigacao-service.js`, `_extrairNivelConfianca` em torno da linha 58.

## 22. Prompts

Pontos positivos:

- Regra clara contra invencao.
- Orientacao para pedir evidencia especifica.
- Separacao de fato/hipotese/causa/conclusao.
- Instrucao explicita contra prompt injection em anexos/logs.
- Ajuste conversacional para evitar laudo repetitivo.

Risco:

- Prompt e longo e contem varias regras; ha risco de competicao de instrucoes, mitigado parcialmente por classificador de turno curto e Quality Gate.

Evidencia: `prompt-builder.js`, linhas 1-148.

## 23. Seguranca

Implementado:

- Conteudo de anexos/logs e tratado como dado no prompt.
- Fetch seguro bloqueia localhost, `.local`, IPs privados, protocolos nao HTTP/HTTPS e redirects inseguros.
- Limites de timeout/download/content-type.
- Isolamento por `empresa_id` aparece nos repositorios e validacoes de evidencia.
- Codigo-fonte anexado e lido como texto/evidencia, nao executado.

Evidencia:

- `prompt-builder.js`, secao de seguranca.
- `safe-web-fetch-service.js`, linhas 30-92 e 130-153.
- `investigacao-dossie-atualizador-service.js`, linhas 167-184.
- `extracao-conteudo.js`, linhas 162-193.

Teste existente:

- Caso `prompt-injection-log` consta no benchmark offline e foi classificado como OK no relatorio baseline.

## 24. Observabilidade

Pontos fortes:

- `investigacao_execucoes` persiste manifesto, contexto, pesquisa, Quality Gate, usage, tentativas, tokens, prompt chars, resposta chars, latencia e retry de Quality Gate.
- Permite reconstruir muito do "por que respondeu isso".

Evidencia:

- `migrations.js`, linhas 721-752.
- `investigacao-execucao-repository.js`, linhas citadas por `rg`: salva `manifesto_json`, `contexto_json`, `pesquisa_json`, `quality_gate_json`, `usage_json`, `tentativas_json`, tokens, prompt chars, resposta chars e latencia.

Lacuna:

- Nao foi validado, em uma investigacao real produtiva, se todos os campos estao preenchidos de forma suficiente para auditoria humana completa.

## 25. Custos

Implementado:

- Estimativa de tokens de prompt e resposta.
- Persistencia de `usage_json`, quando provider retorna.
- Separacao de tokens por contexto/pesquisa no manifesto.

Nao disponivel nesta auditoria:

- Custo monetario real por provider/chamada.
- Custo real de chamadas de busca.

## 26. Latencia

Implementado:

- Latencia geral e por tentativa de provider em `ai-provider-client`.
- Persistencia de `latencia_ms` em execucoes.
- Safe fetch com timeout.

Nao medido nesta auditoria:

- Latencia real por etapa em ambiente produtivo.

## 27. Testes existentes

Inventario relevante encontrado:

- `benchmark-motor-investigacao.test.js`
- `etapa-v1-pesquisa-web-motor.test.js`
- `etapa-v1-pesquisa-explicita.test.js`
- `etapa-v1-next-best-test.test.js`
- `etapa3a-dossie-persistente.test.js`
- `etapa3b-atualizacao-dossie.test.js`
- `etapa3c-contexto-dossie.test.js`
- `etapa3d-pesquisa-investigativa.test.js`
- `etapa4b-disciplina-investigativa.test.js`
- `anexos-softexpert-sync.test.js`
- `ai-provider-retry.test.js`
- `tests/benchmark/cases/development/*.json`

Cobertura boa para fundacao, mocks, dossie, pesquisa, disciplina e anexos; ainda insuficiente para afirmar desempenho real em chamados produtivos.

## 28. Testes comportamentais executados

Executados em 2026-10-07:

1. `node "apps\IA Service\tests\benchmark-motor-investigacao.test.js"`
   - Resultado: passou.
   - Saida relevante: `{"total":14,"ok":2,"inconclusivos":8,"falhas":4,"hallucinations":1,"diagnosticosPrematuros":0,"regressoes":0}`.
   - Observacao: divergente do relatorio markdown anterior em proporcao de OK/inconclusivo, mas confirma falhas e 1 hallucination critica no baseline offline.

2. `node "apps\IA Service\tests\etapa3a-dossie-persistente.test.js"`
   - Resultado: passou.

3. `node "apps\IA Service\tests\etapa4b-disciplina-investigativa.test.js"`
   - Resultado: passou.
   - Saida relevante: `{"baselineHallucinations":1,"posHallucinations":0,"baselinePesquisas":13,"posPesquisas":5,"posResolvidos":5,"posFalhas":0}`.

4. `node "apps\IA Service\tests\anexos-softexpert-sync.test.js"`
   - Resultado: passou.

5. `node "apps\IA Service\tests\etapa-v1-pesquisa-web-motor.test.js"`
   - Resultado: passou.
   - Saida relevante: fallback multi-provider, proveniencia e degradacao segura.

## 29. Golden Set proposto/encontrado

Encontrado:

- Dataset sintetico/development com 14 casos em `apps/IA Service/tests/benchmark/cases/development/initial-cases.json`.
- Casos semanticos adicionais em `etapa4b-cases.json` e `etapa4b1-semantic-cases.json`.

Nao encontrado:

- Golden Set real de 20 a 30 chamados resolvidos e anonimizados, com ground truth validado por especialista.

Proposta:

- Montar 20 a 30 chamados anonimizados separados em input do motor e ground truth do avaliador.
- Separar retrieval conhecido de investigacao/generalizacao.
- Incluir Protheus, SoftExpert, logs, screenshots, PDFs, codigo, multi-turno e casos sem evidencia suficiente.

## 30. Benchmark Retrieval

Nao executado como benchmark real.

Desenho recomendado:

- Medir fonte correta encontrada, posicao Top-1/Top-3/Top-5, oficialidade, compatibilidade de versao, pagina realmente lida e trecho efetivamente enviado ao modelo.
- Nao usar qualidade da resposta final como unico proxy de retrieval.

## 31. Benchmark End-to-End

Executado apenas offline/sintetico.

Resultado disponivel no relatorio existente `apps/IA Service/tests/benchmark/reports/baseline-1-offline-summary.md`:

- Total: 14 casos.
- Resolvidos corretamente: 9.
- Nao resolvidos: 4.
- Inconclusivos corretamente: 1.
- Hallucinations criticas: 1.
- Regressoes investigativas: 0.

Resultado do teste executado nesta auditoria:

- Total: 14.
- OK: 2.
- Inconclusivos: 8.
- Falhas: 4.
- Hallucinations: 1.
- Diagnosticos prematuros: 0.
- Regressoes: 0.

Interpretacao: existe harness de medicao, mas ele ainda nao e suficiente para conclusao de qualidade produtiva.

## 32. Falhas por camada

| ID | Severidade | Tipo | Camada | Evidencia | Impacto | Recomendacao futura | Como validar | Nao implementar agora |
|---|---|---|---|---|---|---|---|---|
| A-001 | ALTA | FATO | I - Raciocinio / Analise | Benchmark offline registrou 1 hallucination critica no caso sem evidencia | Risco de diagnostico inventado quando faltam dados | Criar casos reais sem evidencia e exigir pergunta/lacuna explicita | Golden Set holdout com avaliador humano | Sim |
| A-002 | MEDIA | FATO | F - Retrieval / Busca | Baseline aponta pesquisa desnecessaria em casos com evidencia interna suficiente | Aumenta custo/latencia e pode contaminar raciocinio com fonte externa dispensavel | Calibrar condicao de pesquisa somente apos baseline real | Medir pesquisas uteis vs redundantes | Sim |
| A-003 | MEDIA | LACUNA DE TESTE | G/H - Ranking/Evidencia | Ranking oficial existe por codigo, mas sem medicao real Top-K | Nao sabemos se fonte oficial especifica vence fonte generica em producao | Construir Benchmark Retrieval separado | Top-1/Top-3/Top-5 por caso | Sim |
| A-004 | MEDIA | LACUNA DE TESTE | B/H - Extracao/Selecao de anexos | Manifesto registra omissao/selecao, mas nao houve teste real com anexos grandes decisivos | Anexo importante pode ser omitido por orcamento sem avaliacao quantitativa | Criar casos com anexos grandes e ground truth | Verificar anexo recebido/extraido/selecionado/enviado/referenciado | Sim |
| A-005 | MEDIA | RISCO | K/L - Multi-turno/Feedback | Dossie e Quality Gate implementam abandono de hipotese, mas sem Golden Set real longo | Pode preservar ou descartar hipoteses de modo errado em investigacoes longas | Simular 5+ turnos reais anonimizados | Medir repeticao, abandono e evolucao | Sim |
| A-006 | BAIXA | LACUNA DE TESTE | O - Observabilidade | `investigacao_execucoes` persiste muitos campos, mas nao foi auditada uma execucao real completa | Pode faltar campo pratico para explicar decisao final | Rodar caso controlado e revisar registro de auditoria ponta a ponta | Checklist 20 itens de observabilidade | Sim |
| A-007 | BAIXA | LACUNA DE TESTE | C/E - Sinais/Queries | Extracao regex cobre muitos sinais, mas sem metrica por campo | Pode perder versao/build/rotina em formatos reais variados | Avaliar amostra real anonima | Precision/recall por sinal | Sim |

## 33. Pontos fortes

1. Arquitetura investigativa real, com orquestrador, contexto, pesquisa, Quality Gate, dossie e auditoria persistente.
2. Boa separacao entre anexo recebido, extraido, selecionado, omitido e enviado ao modelo via manifesto.
3. Pesquisa externa nao para em snippet: ha abertura/leitura segura de paginas e distincao entre resultados e paginas lidas.
4. Dossie persistente registra fatos, hipoteses, testes, resultados, relacoes e guard contra regressao investigativa.
5. Seguranca bem considerada: prompt injection em anexos, SSRF, redirects e protocolos perigosos sao tratados explicitamente.

## 34. Pontos fracos comprovados

1. Benchmark offline registra hallucination critica em caso sem evidencia.
2. Benchmark offline registra pesquisa desnecessaria em casos em que evidencia interna bastava.
3. Nao ha Golden Set real validado por especialista.
4. Nao ha benchmark retrieval real separado.
5. Nao ha medicao real de custo/latencia por etapa em ambiente produtivo.

## 35. Lacunas ainda nao comprovadas

- Qualidade real em chamados Protheus produtivos anonimizados.
- Qualidade real em chamados SoftExpert produtivos anonimizados.
- Compatibilidade de fontes por versao/build.
- Robustez do OCR/visao em screenshots e PDFs escaneados variados.
- Eficacia do abandono de hipotese em investigacoes longas de dias.

## 36. Recomendacoes futuras

1. Congelar Baseline V1.0 com commit, configuracoes, providers, modelos, prompts e dataset.
2. Construir Golden Set real de 20 a 30 chamados anonimizados.
3. Separar Benchmark A Retrieval de Benchmark B End-to-End.
4. Medir pesquisas planejadas, executadas, uteis, redundantes e sem resultado relevante.
5. So depois propor calibracoes pontuais com evidencia por camada, ganho esperado, risco e metrica.

Nao recomendado nesta etapa:

- Trocar modelo por preferencia.
- Aumentar numero de queries sem evidencia.
- Reescrever motor.
- Adicionar novo framework/agentes/RAG sem problema medido.

## 37. Classificacao A/B/C/D

**B - MOTOR V1.0 BOM, MAS NECESSITA CALIBRACOES PONTUAIS**

Justificativa:

- Nao cabe A porque ha falhas comprovadas no benchmark offline, incluindo hallucination critica e pesquisa desnecessaria.
- Nao cabe C/D porque o codigo mostra arquitetura investigativa consistente e varios mecanismos corretos ja implementados; nao ha evidencia forte de necessidade estrutural ou redesenho.
- B e a classificacao mais fiel: o motor tem base solida, mas precisa de medicao real e calibracoes pontuais guiadas por evidencia.

## 38. Confianca da auditoria

**MEDIA**

Motivo:

- Alta confianca sobre a existencia dos mecanismos, porque foram verificados por codigo.
- Media confianca sobre comportamento local, porque testes offline foram executados.
- Baixa/media confianca sobre qualidade produtiva, porque nao houve Golden Set real, chamadas reais controladas ou avaliacao humana especialista.

## 39. Proximo passo recomendado

Criar e congelar o **Baseline V1.0 real** com Golden Set anonimo, separando Retrieval de End-to-End. Somente depois disso selecionar calibracoes pontuais, uma por vez, contra baseline e holdout.

## Checkpoint final

Auditoria encerrada. Nenhum ajuste, calibracao, refatoracao, commit ou push foi realizado.
