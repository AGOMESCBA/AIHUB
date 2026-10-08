# IA Service - Auditoria Funcional e Plano de Evolucao do Motor Investigativo

Data da auditoria: 2026-10-08
Escopo: auditoria e planejamento. Nenhuma alteracao funcional foi aplicada ao motor, prompts, banco, frontend, provedores, testes ou configuracoes.

## 1. Resumo executivo

O IA Service ja possui uma base tecnica relevante para evoluir sem reescrever o Motor V1.0. A auditoria encontrou componentes implementados para extracao de anexos, deteccao de codigo, uso de fonte no contexto, resposta estruturada, quality gate, dossie persistente, pesquisa tecnica, chamados semelhantes e versionamento de fonte corrigida.

A lacuna principal nao e ausencia total de motor. O problema e fechamento de ciclo operacional: o analista ainda nao tem uma experiencia completa para receber um arquivo corrigido com diff/download evidentes, confirmar se a solucao resolveu, transformar essa confirmacao em conhecimento reutilizavel e receber respostas cada vez mais objetivas com base nesse aprendizado confirmado.

Classificacao geral:

- Correcao de fonte customizada: PARCIAL.
- Memoria no mesmo atendimento: IMPLEMENTADA E VALIDADA.
- Aprendizado operacional entre chamados: PARCIAL / NAO COMPROVADO como aprendizado confirmado.
- Objetividade das respostas: PARCIAL.
- Experiencia integrada do analista: PARCIAL.
- Priorizacao tecnica por impacto/esforco: POSSIVEL com componentes atuais, mas ainda nao materializada como fluxo de produto.

Conclusao: a proxima evolucao recomendada e conectar o fluxo de fonte corrigida ao frontend e ao historico de validacao, nao reconstruir o motor.

## 2. Estado do repo auditado

Base auditada: workspace local em `C:\Apps\iahub`.

Estado observado do git:

```text
 M repomix-output.xml
?? IA_SERVICE_AUDITORIA_MOTOR_V1.md
?? IA_SERVICE_VALIDACAO_BASELINE_V1.md
```

Arquivo criado por esta etapa:

```text
IA_SERVICE_AUDITORIA_FUNCIONAL_EVOLUCAO.md
```

Restricoes cumpridas nesta auditoria:

- Nao houve commit.
- Nao houve push.
- Nao houve chamada a API paga.
- Nao houve migracao de banco.
- Nao houve alteracao de codigo de producao, prompt, frontend, provider ou teste.
- A analise foi estatica, baseada no codigo local e nos artefatos anteriores.

## 3. Arquitetura funcional existente

O fluxo investigativo atual combina estas camadas:

1. Entrada do atendimento e anexos:
   - `apps/IA Service/backend/services/armazenamento-anexos.js`
   - `apps/IA Service/backend/services/extracao-conteudo.js`
   - `apps/IA Service/backend/repositories/anexo-repository.js`

2. Contexto investigativo:
   - `apps/IA Service/backend/services/context-engine.js`
   - prioriza anexos recentes, codigo/configuracao, contexto visual, historico e dossie.

3. Pesquisa tecnica e chamados relacionados:
   - `apps/IA Service/backend/services/technical-research-service.js`
   - `apps/IA Service/backend/repositories/chamado-repository.js`

4. Prompt e resposta:
   - `apps/IA Service/backend/services/prompt-builder.js`
   - `apps/IA Service/backend/services/investigacao-service.js`
   - `apps/IA Service/backend/services/quality-gate-service.js`

5. Memoria/dossie:
   - `apps/IA Service/backend/services/dossie-context-service.js`
   - `apps/IA Service/backend/services/investigacao-dossie-atualizador-service.js`
   - tabelas `investigacao_dossies` e `investigacao_itens`.

6. Experiencia do analista:
   - `apps/IA Service/frontend/atendimento.html`
   - `apps/IA Service/frontend/radar.html`
   - rotas de anexo, investigacao, versoes e diff em `apps/IA Service/backend/routes/index.js`.

## 4. Correcao de fontes - implementacao atual

Capacidade classificada: PARCIAL.

Evidencias implementadas:

- O upload aceita arquivos como `.prw`, `.tlpp`, `.sql`, `.txt`, `.log`, `.json`, `.xml`, `.csv`, PDF e imagens em `atendimento.html` e no fluxo Radar.
- `extracao-conteudo.js` detecta extensoes de codigo/configuracao, incluindo `.prw`, `.tlpp`, `.ch`, `.sql`, `.js`, `.ts`, `.py`, `.java`, `.ini`, `.cfg`, `.json`, `.xml`, `.log`, `.csv` e `.txt`.
- `context-engine.js` identifica contexto de customizacao Protheus, fonte, ADVPL/TLPP/PRW, ponto de entrada, MVC, gatilho e afins.
- `context-engine.js` marca anexo de codigo/configuracao como evidencia central e adiciona instrucao especifica para tratar codigo Protheus como evidencia primaria.
- `prompt-builder.js` pede resposta com secoes tecnicas, incluindo `Fonte corrigido`, `Alteracoes realizadas` e `Validacao`.
- `investigacao-service.js` extrai a secao `Fonte corrigido` da resposta da IA.
- `investigacao-service.js` cria versao corrigida automaticamente quando existe `Fonte corrigido` e exatamente um anexo de codigo no turno.
- `versao-fonte-service.js` grava a correcao como novo arquivo e nova linha em `anexos`, sem sobrescrever o original.
- `anexo-repository.js` lista versoes pelo `anexo_original_id`.
- `routes/index.js` expoe rotas para versoes, diff e download de anexo.
- `etapa2-extracao-e-versionamento.test.js` cobre extracao, deteccao, criacao de versao corrigida, historico, diff e isolamento multiempresa.

Ponto importante: a integracao backend nao esta ausente. Ela existe para o caso simples e seguro de um unico anexo de codigo no turno.

## 5. Correcao de fontes - lacunas

Lacunas funcionais:

- A experiencia visual ainda mostra a secao `Fonte corrigido` como texto/codigo dentro da resposta, mas nao deixa claro para o analista que uma nova versao de arquivo foi criada.
- O frontend possui funcoes de abrir/baixar anexos e o backend possui rotas de versao/diff, mas nao foi comprovada uma UI completa que liste "versoes corrigidas", permita baixar a versao gerada e compare diff diretamente a partir da resposta.
- O versionamento automatico so ocorre quando ha exatamente um anexo de codigo no turno. Em casos reais com varios fontes, includes ou arquivos auxiliares, o motor evita criar versao por ambiguidade.
- Nao ha selecao explicita de arquivo alvo pelo analista quando ha multiplos fontes.
- Nao ha validacao sintatica/compilacao do fonte corrigido.
- Nao ha garantia de que a IA retornou o arquivo completo; o parser extrai o bloco de codigo da secao, mas a completude depende do modelo e do limite de resposta.
- Nao ha fluxo de aprovacao do analista antes de promover uma versao corrigida como solucao validada.
- Nao ha uma tela dedicada para "original vs corrigido vs alteracoes realizadas".

Classificacao detalhada:

- Receber fonte customizado: IMPLEMENTADA E VALIDADA.
- Analisar fonte como contexto central: IMPLEMENTADA SEM VALIDACAO SUFICIENTE para todos os cenarios reais.
- Gerar fonte corrigido em resposta: PARCIAL, depende do LLM e do formato.
- Persistir versao corrigida: IMPLEMENTADA E VALIDADA para caso de um anexo de codigo.
- Retornar arquivo corrigido de forma ergonomica ao analista: PARCIAL / NAO COMPROVADA no frontend.

## 6. Memoria entre chamados - implementacao atual

Capacidade classificada: PARCIAL para aprendizado entre chamados; IMPLEMENTADA E VALIDADA para memoria dentro do atendimento.

Evidencias implementadas:

- `investigacao_dossies` armazena problema atual, resumo de estado, diagnostico atual, solucao proposta, solucao aplicada, resultado de validacao, proximos passos, versao e historicos usados.
- `investigacao_itens` registra fatos, hipoteses, testes, evidencias, riscos e decisoes.
- `dossie-context-service.js` monta memoria operacional com fatos, hipoteses ativas, hipoteses descartadas, testes pendentes/executados e regressao guard.
- `investigacao-dossie-atualizador-service.js` atualiza o dossie apos cada turno e valida alteracoes sem permitir conclusoes sem evidencia suficiente.
- `chamado-repository.js` calcula similaridade entre chamados usando produto, modulo, assunto, descricao, posicionamentos e sinais textuais.
- `chamado-repository.js` marca chamados com `solucaoAplicada === 'Sim'` e inclui esse sinal no ranking.
- `technical-research-service.js` formata chamados semelhantes da base interna no contexto enviado ao prompt.
- `investigacao-service.js` busca chamados relacionados pelo numero/referencia externa e injeta esses relacionados no contexto da investigacao.
- Importacao historica preserva campos como solucao aplicada, resultado e posicionamentos.

## 7. Memoria entre chamados - lacunas

Lacunas funcionais:

- O sistema recupera chamados semelhantes, mas isso ainda nao equivale a aprendizado operacional confirmado.
- Nao ha fluxo explicito de feedback do analista com botoes ou acoes como "resolveu", "nao resolveu", "aplicar solucao", "registrar validacao" ou "transformar em conhecimento".
- Nao foi comprovada uma base canonica de solucoes validadas separada de chamados, com causa, correcao, versoes afetadas, evidencias, riscos e criterio de aplicabilidade.
- A reutilizacao depende de similaridade e contexto textual; ainda nao ha deduplicacao semantica robusta de solucoes nem controle forte por versao/build/ambiente.
- O dossie guarda `solucaoAplicada` e `resultadoValidacao`, mas falta um caminho de produto que torne esses campos naturais no fim do atendimento.
- O uso de historico esta isolado por empresa. Isso e correto por seguranca, mas limita aprendizado global quando nao existir uma curadoria anonima/multiempresa.
- Nao foi comprovado que uma solucao confirmada em um ticket passa a aumentar prioridade em tickets futuros alem dos sinais ja presentes em chamados relacionados.

Classificacao detalhada:

- Memoria multi-turn no mesmo atendimento: IMPLEMENTADA E VALIDADA.
- Evitar repetir hipotese descartada/teste falho: IMPLEMENTADA E VALIDADA.
- Recuperar chamados semelhantes: IMPLEMENTADA SEM VALIDACAO SUFICIENTE para produtividade real.
- Aprender com solucoes confirmadas entre tickets: PARCIAL / NAO COMPROVADO.
- Curadoria de conhecimento validado: AUSENTE.

## 8. Objetividade das respostas - implementacao atual

Capacidade classificada: PARCIAL.

Evidencias implementadas:

- `prompt-builder.js` instrui a IA a ir direto ao ponto, evitar inventar causa, pedir evidencia especifica quando faltar dado e separar diagnostico, causa, evidencias, correcao e validacao.
- `context-engine.js` adiciona instrucao para evitar relatorio fixo, comecar pelo ponto que muda a analise, propor teste concreto e tratar codigo como evidencia central quando aplicavel.
- `quality-gate-service.js` detecta respostas genericas, template formal demais, correcao fraca, erro especifico nao priorizado, descarte indevido de customizacao e regressao investigativa.
- `investigacao-service.js` usa retry quando o quality gate reprova a primeira resposta.
- `atendimento.html` e `radar.html` renderizam diagnostico estruturado quando a resposta possui secoes extraidas.

## 9. Objetividade das respostas - lacunas

Lacunas funcionais:

- O formato objetivo ainda depende do comportamento do LLM; o quality gate e heuristico e nao garante sempre uma resposta resolutiva.
- A UI mostra secoes estruturadas, mas ainda nao orienta a leitura como uma ficha operacional compacta com "acao agora", "evidencia", "risco" e "validacao".
- Nao ha modo forte de resposta curta por padrao com detalhes recolhidos/expandidos.
- Quando faltam evidencias, a IA pode pedir evidencias, mas nao ha checklist interativo que transforme essa pergunta em tarefa do analista.
- Nao ha medicao de objetividade por indicadores de produto, como tempo ate primeira acao, percentual de respostas aceitas, resolucao sem retrabalho ou taxa de "resposta generica".
- Em casos de codigo longo, pesquisa extensa ou varios anexos, a resposta pode ficar grande e menos objetiva.

Classificacao detalhada:

- Prompt objetivo: IMPLEMENTADA.
- Quality gate contra resposta generica: IMPLEMENTADA SEM VALIDACAO SUFICIENTE em producao.
- UI de diagnostico estruturado: PARCIAL.
- Resposta operacional curta e acionavel por padrao: PARCIAL.

## 10. Integracao frontend fluxo analista

Capacidade classificada: PARCIAL.

Pontos existentes:

- `atendimento.html` permite anexar arquivos, enviar mensagem, chamar investigacao e renderizar resposta estruturada.
- `radar.html` integra chamados, anexos SoftExpert, anexos locais, sincronizacao, abertura/download e investigacao com anexos como contexto.
- O backend expoe download de anexos e rotas de versoes/diff para fontes corrigidos.
- O frontend renderiza blocos de codigo na secao `Fonte corrigido`.

Lacunas de experiencia:

- Nao ha, de forma comprovada, um componente visual para listar versoes corrigidas logo abaixo da resposta da IA.
- Nao ha botao evidente para baixar "fonte corrigido gerado pela IA".
- Nao ha diff visual integrado na resposta.
- Nao ha acao de "confirmar que resolveu" conectada ao dossie e ao aprendizado.
- Nao ha acao de "marcar como nao resolveu" que gere regressao guard e proxima investigacao.
- Nao ha fluxo guiado para multiplos arquivos de codigo.
- Nao ha tela/resumo de conhecimento reutilizavel derivado de atendimentos validados.

## 11. Matriz consolidada capacidades

| Capacidade | Classificacao | Evidencia principal | Lacuna principal |
|---|---|---|---|
| Upload de fonte customizado | IMPLEMENTADA E VALIDADA | extracao/versionamento e testes Etapa 2 | Cobertura real de todos os tipos/tamanhos |
| Deteccao de codigo/configuracao | IMPLEMENTADA E VALIDADA | `extracao-conteudo.js`, `context-engine.js` | Ambiguidade com `.txt` generico |
| Uso do fonte como evidencia central | IMPLEMENTADA SEM VALIDACAO SUFICIENTE | `context-engine.js` | Depende de selecao/context budget |
| Geracao de fonte corrigido | PARCIAL | prompt + parser `_extrairFonteCorrigido` | Depende do LLM e do formato completo |
| Persistencia de versao corrigida | IMPLEMENTADA E VALIDADA | `versao-fonte-service.js`, teste Etapa 2 | So caso simples de um anexo de codigo |
| Download/diff da versao corrigida | PARCIAL | rotas backend existem | UI nao comprovada/nao evidente |
| Dossie persistente no atendimento | IMPLEMENTADA E VALIDADA | servicos de dossie e testes Etapa 3 | Precisa melhor exposicao ao analista |
| Regressao guard | IMPLEMENTADA E VALIDADA | `dossie-context-service.js` | Nao esta visivel como controle de produto |
| Chamados semelhantes | IMPLEMENTADA SEM VALIDACAO SUFICIENTE | `listarChamadosRelacionados` | Ranking simples e sem curadoria |
| Aprendizado com solucao confirmada | PARCIAL / NAO COMPROVADO | campos existem | Falta feedback/validacao operacional |
| Resposta objetiva | PARCIAL | prompt + quality gate | Ainda pode ficar generica/longa |
| Experiencia integrada do analista | PARCIAL | Radar/Atendimento | Falta fechamento de ciclo |

## 12. Componentes reutilizaveis

Componentes recomendados para reuso:

- `extracao-conteudo.extrairConteudo`: extrair texto, detectar linguagem e classificar codigo.
- `armazenamento-anexos.salvarAnexo`: persistir arquivo original.
- `anexo-repository.salvarMetadadosAnexo`: criar registros de anexo.
- `anexo-repository.atualizarExtracao`: gravar conteudo extraido e metadados.
- `anexo-repository.listarVersoes`: recuperar historico de versoes.
- `versao-fonte-service.criarVersaoCorrigida`: gerar arquivo corrigido sem sobrescrever original.
- `versao-fonte-service.calcularDiff`: diff linha a linha suficiente para primeira entrega.
- `context-engine.montarContextoInvestigacao`: selecionar evidencias relevantes.
- `context-engine._prepararConteudoAnexo`: formatar anexos para prompt.
- `investigacao-service._extrairFonteCorrigido`: extrair bloco de codigo da resposta.
- `investigacao-service.processarTurno`: ponto de integracao para versao corrigida e dossie.
- `quality-gate-service.avaliarResposta`: barrar resposta generica ou regressiva.
- `quality-gate-service.montarInstrucaoRetry`: orientar segunda tentativa.
- `dossie-context-service.montarMemoriaOperacional`: montar memoria operacional.
- `investigacao-dossie-atualizador-service.atualizarAposTurno`: registrar fatos, hipoteses, testes e validacoes.
- `chamado-repository.listarChamadosRelacionados`: recuperar casos semelhantes.
- `technical-research-service.formatarContextoParaPrompt`: injetar pesquisa e chamados semelhantes.
- Rotas `GET /api/ia-service/anexos/:id/versoes`, diff e download em `routes/index.js`.
- Funcoes frontend de upload, abrir/baixar anexos e renderizacao de diagnostico em `atendimento.html` e `radar.html`.

## 13. Componentes desconectados ou incompletos

Itens que existem, mas ainda nao fecham o valor de produto:

- Backend cria versao corrigida, mas a resposta do frontend nao destaca automaticamente o arquivo gerado.
- Rotas de versao/diff existem, mas nao ha experiencia clara de diff/download vinculada ao diagnostico.
- Dossie guarda solucao aplicada/resultado, mas nao ha botao/fluxo natural de confirmacao pelo analista.
- Chamados semelhantes aparecem no contexto da IA, mas nao ha uma base curada de solucoes validadas.
- Quality gate melhora respostas, mas nao ha painel de qualidade por resposta, por atendimento ou por modulo.
- A extracao suporta codigo, mas nao ha seletor de arquivo alvo quando multiplos fontes participam da correcao.
- A pesquisa tecnica e o historico ajudam a IA, mas a UI nao mostra claramente "esta resposta reutilizou solucao validada do chamado X".

## 14. Riscos tecnicos e de seguranca

Riscos principais:

- Correcao de fonte incorreta: IA pode sugerir mudanca funcionalmente errada ou incompleta.
- Ambiguidade de alvo: em varios anexos de codigo, criar arquivo corrigido automaticamente pode corrigir o arquivo errado.
- Codigo sensivel: fontes customizados podem conter regras de negocio, credenciais acidentais ou dados de cliente.
- Reuso indevido de solucao: uma correcao valida em uma versao/build pode ser ruim em outra.
- Falso aprendizado: registrar uma solucao como validada sem confirmacao real aumenta risco nos proximos chamados.
- Excesso de confianca: resposta com codigo pode parecer definitiva mesmo sem compilacao/teste.
- Tamanho de arquivo/resposta: fontes grandes podem truncar contexto ou resposta.
- Isolamento multiempresa: deve ser preservado em qualquer base de aprendizado.

Mitigacoes recomendadas:

- Nunca sobrescrever original.
- Exigir selecao explicita quando houver mais de um fonte.
- Mostrar diff antes do download final.
- Separar "sugerido pela IA" de "validado pelo analista".
- Registrar versao/build/ambiente e evidencia de validacao.
- Manter isolamento por `empresa_id`.
- Criar testes de aceitacao para casos negativos.

## 15. Testes de aceitacao propostos

1. Fonte unico com erro evidente:
   - Dado um atendimento com um `.prw` e um log.
   - Quando o analista pede investigacao.
   - Entao a IA deve responder com diagnostico, correcao proposta e `Fonte corrigido`.
   - E o backend deve criar uma nova versao sem sobrescrever o original.
   - E o frontend deve exibir botao de baixar versao corrigida e ver diff.

2. Multiplos fontes:
   - Dado um atendimento com dois `.prw`.
   - Quando a IA gerar `Fonte corrigido`.
   - Entao o sistema nao deve versionar automaticamente.
   - E deve pedir/permitir selecao do arquivo alvo.

3. Fonte sem informacao suficiente:
   - Dado um erro sem log/stack/tela.
   - Quando o analista pede correcao.
   - Entao a IA deve pedir evidencia especifica e nao inventar correcao.

4. Validacao positiva:
   - Dado um atendimento com solucao aplicada e marcada como resolveu.
   - Quando o analista confirma.
   - Entao o dossie deve registrar solucao aplicada, evidencia e resultado positivo.
   - E a solucao deve ficar elegivel para reutilizacao futura.

5. Validacao negativa:
   - Dado uma solucao proposta que nao resolveu.
   - Quando o analista marca nao resolveu.
   - Entao o dossie deve registrar resultado negativo.
   - E a proxima resposta nao deve repetir a mesma hipotese sem evidencia nova.

6. Reuso de solucao validada:
   - Dado um novo chamado semelhante.
   - Quando houver solucao validada compativel.
   - Entao a IA deve citar a solucao reutilizada, condicoes de aplicabilidade e validacao minima.

7. Resposta objetiva:
   - Dado um atendimento com evidencias suficientes.
   - Quando a IA responder.
   - Entao a primeira tela deve mostrar causa provavel, acao recomendada e validacao sem exigir leitura de texto longo.

## 16. Plano incremental de evolucao

Fase 1 - Fechar fluxo de fonte corrigida:

- Mostrar no frontend quando uma versao corrigida foi criada.
- Listar versoes do anexo original.
- Permitir baixar versao corrigida.
- Mostrar diff simples.
- Bloquear versionamento automatico quando houver multiplos fontes e pedir alvo.

Fase 2 - Feedback operacional do analista:

- Adicionar acoes "Resolveu", "Nao resolveu", "Aplicado parcialmente" e "Precisa de mais evidencia".
- Gravar resultado no dossie.
- Registrar evidencia minima obrigatoria para validar solucao.
- Atualizar regressao guard automaticamente em validacao negativa.

Fase 3 - Base de solucoes validadas:

- Criar visao/logica de solucoes derivadas de dossies/chamados confirmados.
- Guardar causa, correcao, evidencias, versoes/builds, ambiente, riscos e criterio de aplicabilidade.
- Reusar solucoes apenas com compatibilidade suficiente.

Fase 4 - Experiencia objetiva:

- Transformar a resposta em ficha operacional: diagnostico, acao agora, arquivo corrigido, validacao, evidencias.
- Deixar detalhes e pesquisa expandiveis.
- Mostrar origem do conhecimento reutilizado.

Fase 5 - Medicao e qualidade:

- Medir taxa de respostas genericas, uso de fonte corrigida, confirmacoes positivas/negativas e reuso de solucao.
- Criar suite de aceitacao end-to-end com casos sinteticos e historicos anonimizados.

## 17. Priorizacao beneficio/esforco

1. Expor versao corrigida/diff/download no frontend.
   - Beneficio: muito alto.
   - Esforco: medio.
   - Motivo: backend ja tem grande parte pronta; melhora diretamente produtividade do analista.

2. Adicionar confirmacao de resultado pelo analista.
   - Beneficio: muito alto.
   - Esforco: medio.
   - Motivo: transforma resposta em aprendizado verificavel.

3. Criar fluxo para multiplos fontes e selecao de alvo.
   - Beneficio: alto.
   - Esforco: medio.
   - Motivo: evita correcao errada em customizacoes reais.

4. Base/visao de solucoes validadas.
   - Beneficio: alto.
   - Esforco: medio/alto.
   - Motivo: permite aprendizado entre chamados sem depender so de similaridade textual.

5. Ficha operacional objetiva no frontend.
   - Beneficio: alto.
   - Esforco: medio.
   - Motivo: reduz leitura, retrabalho e sensacao de resposta generica.

## 18. Recomendacao tecnica final

Nao reconstruir o Motor V1.0.

A recomendacao e evoluir incrementalmente sobre os componentes existentes. O primeiro incremento deve ser o fluxo completo de fonte corrigida:

- usar a versao corrigida que o backend ja cria;
- exibir essa versao na resposta;
- permitir download;
- mostrar diff;
- preservar original;
- bloquear ambiguidade com multiplos fontes;
- registrar a correcao no dossie;
- preparar a confirmacao posterior do analista.

Essa escolha tem o melhor equilibrio entre valor e risco porque aproveita capacidades ja implementadas e ataca uma dor concreta: sair de uma sugestao textual para um artefato operacional que o analista pode comparar, baixar, aplicar e validar.

Respostas obrigatorias:

1. O IA Service consegue receber um fonte customizado, corrigir e devolver arquivo?
   - PARCIALMENTE.
   - Recebe e extrai fonte. Usa como contexto. Pode gerar `Fonte corrigido`. Quando ha exatamente um anexo de codigo, cria uma nova versao corrigida no backend sem sobrescrever o original. Falta uma experiencia completa e comprovada de frontend para evidenciar, baixar e comparar esse arquivo corrigido diretamente na resposta, alem de tratar multiplos fontes.

2. Ele aprende operacionalmente com solucoes confirmadas entre chamados?
   - PARCIALMENTE / NAO COMPROVADO como aprendizado confirmado.
   - Ha dossie, solucao aplicada, resultado de validacao, chamados semelhantes e historico. Mas falta fluxo explicito de confirmacao do analista e base curada de solucoes validadas reutilizaveis.

3. Ele tem recursos para responder de forma objetiva?
   - PARCIALMENTE.
   - Existem prompt objetivo, contexto orientado a evidencia, secoes estruturadas e quality gate contra resposta generica. Ainda pode responder de forma longa/generica porque depende do LLM, da qualidade das evidencias e de uma UI que ainda nao força ficha operacional curta.

4. Quais funcoes existentes podem ser reaproveitadas?
   - `extracao-conteudo.extrairConteudo`
   - `anexo-repository.salvarMetadadosAnexo`
   - `anexo-repository.atualizarExtracao`
   - `anexo-repository.listarVersoes`
   - `versao-fonte-service.criarVersaoCorrigida`
   - `versao-fonte-service.calcularDiff`
   - `context-engine.montarContextoInvestigacao`
   - `investigacao-service._extrairFonteCorrigido`
   - `investigacao-service.processarTurno`
   - `quality-gate-service.avaliarResposta`
   - `dossie-context-service.montarMemoriaOperacional`
   - `investigacao-dossie-atualizador-service.atualizarAposTurno`
   - `chamado-repository.listarChamadosRelacionados`
   - `technical-research-service.formatarContextoParaPrompt`
   - rotas de versoes, diff e download em `routes/index.js`

5. Quais sao as 5 melhorias de maior impacto?
   - Expor versao corrigida, diff e download no frontend.
   - Adicionar confirmacao operacional do analista: resolveu/nao resolveu.
   - Criar fluxo seguro para multiplos fontes com selecao de alvo.
   - Criar base/visao de solucoes validadas com aplicabilidade por versao/build.
   - Transformar resposta em ficha operacional curta com detalhes expandiveis.

6. Qual a primeira implementacao recomendada?
   - Escopo minimo: conectar a versao corrigida ja criada pelo backend ao frontend, exibindo botao de baixar, listar versoes e diff do arquivo original contra o corrigido. Se houver mais de um anexo de codigo, nao criar versao automaticamente; pedir selecao do alvo.
   - Riscos: escolher arquivo errado, gerar codigo incompleto, sugerir correcao insegura, truncar resposta, reutilizar solucao sem validacao.
   - Criterios de aceite: original preservado; nova versao criada para um unico fonte; botao de download visivel; diff visivel; nenhum versionamento automatico em multiplos fontes; teste automatizado cobrindo caso positivo e caso ambiguo.

7. E possivel evoluir sem reconstruir o Motor V1.0?
   - SIM.
   - A arquitetura ja tem extracao, contexto, prompt, quality gate, dossie, historico, versionamento e rotas. O maior ganho agora vem de conectar esses componentes em fluxos de produto e validacao operacional, nao de trocar o motor inteiro.
