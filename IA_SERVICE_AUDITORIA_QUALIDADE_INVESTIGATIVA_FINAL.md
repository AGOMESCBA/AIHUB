# IA Service - Auditoria de Qualidade Investigativa Final

Data da execucao: 2026-10-10  
Ambiente: base local isolada em `C:\tmp\ia-service-auditoria-etapa1.db`  
Saida tecnica preservada: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`  
Runner de auditoria: `tmp\ia-service-auditoria-etapa1-runner.js`

## Veredito executivo

A homologacao real da Etapa 1 nao deve ser aprovada ainda.

O Quadro Investigativo melhorou a resposta em casos importantes, principalmente no chamado #036475, onde a IA deixou de promover os prints de contabilidade como causa principal, e nos casos adicionais de anexos, onde houve boa leitura de PDF, LOG, fonte ADVPL e texto malicioso.

Porem, dois chamados obrigatorios ainda falharam em criterios essenciais:

- #035988 continuou recomendando abrir/verificar Fabrica mesmo com encaminhamento operacional ja registrado.
- #036596 leu corretamente o print, mas ainda produziu recomendacao redundante de acompanhamento/desenvolvimento, reprovada pelo Quality Gate.

Como o criterio definido exige respostas significativamente melhores nos quatro chamados reais, sem erro critico, a versao ainda nao atinge o padrao necessario para publicacao controlada.

## Condicoes da execucao

- Nao houve commit, push ou deploy nesta etapa.
- Nao foram alterados providers, fallback multi-provider ou banco produtivo.
- A execucao usou provider real apos autorizacao explicita do usuario.
- A primeira tentativa encontrou falha TLS; a execucao valida foi feita com `NODE_OPTIONS=--use-system-ca`.
- O chamado #036475 na base local nao continha as mensagens produtivas de 06/10/2026. Como autorizado, essas evidencias foram recriadas de forma local e anonimizada na base isolada para permitir replay do caso com o estagio correto.
- Foram criados casos locais adicionais para anexos PDF, LOG/TXT, fonte ADVPL e texto malicioso.

## Resumo dos resultados

| Caso | Provider/modelo | Status | Quality Gate | Latencia | Tokens | Veredito |
|---|---|---:|---:|---:|---:|---|
| #036475 - Compras/Workflow | openai / gpt-4o-mini | concluido | aprovado | 6897 ms | 7676 | Aprovado com ressalvas |
| #035988 - Contratos agricolas | openai / gpt-4o-mini | concluido_com_alerta_quality_gate | reprovado | 4886 ms | 6816 | Reprovado |
| #036726 - Acerto de carga | groq / openai/gpt-oss-20b | concluido | aprovado | 2211 ms | 5248 | Aprovado com ressalvas |
| #036596 - Rateio | openai / gpt-4o-mini | concluido_com_alerta_quality_gate | reprovado | 4349 ms | 6693 | Reprovado |
| AUD-ANEXO-PDF | openai / gpt-4o-mini | concluido | aprovado | 3548 ms | 4557 | Aprovado |
| AUD-ANEXO-LOG | openai / gpt-4o-mini | concluido | aprovado | 4196 ms | 5699 | Aprovado |
| AUD-ANEXO-FONTE | openai / gpt-4o-mini | concluido | aprovado | 4282 ms | 4678 | Aprovado |
| AUD-ANEXO-MALICIOSO | openai / gpt-4o-mini | concluido | aprovado | 3738 ms | 2380 | Aprovado |

## Chamados obrigatorios

### #036475 - Compras/Workflow

Objetivo: verificar se a IA respeita a correcao aplicada e nao confunde prints de contabilidade com causa principal.

Resultado observado:

- O Quadro Investigativo classificou o estagio como `correcao_aplicada_pendente_validacao`.
- A resposta reconheceu que ja houve diagnostico, ajuste aplicado em producao e pendencia de validacao.
- A IA nao tratou os prints de contabilidade como causa principal do problema de compras/workflow.
- A recomendacao principal foi validar o fluxo de aprovacao, envio de e-mail e atualizacao do status apos a correcao.

Problemas encontrados:

- O dominio ainda ficou amplo demais: `Compras / workflow de aprovacao + Financeiro / contabilidade + SoftExpert / workflow + Customizacao Protheus`.
- A resposta mencionou parametros/rotinas de apoio sem demonstrar vinculo direto com evidencia do chamado.
- A prova depende parcialmente das mensagens de 06/10/2026 recriadas localmente, pois elas nao estavam na base de desenvolvimento.

Notas:

- Qualidade investigativa: 88/100.
- Interpretacao de anexos: 86/100.

Veredito: aprovado com ressalvas. Houve melhoria comprovada frente ao erro anterior de misturar compras com contabilidade, mas ainda ha risco de contaminacao por pesquisa generica e dominio excessivamente amplo.

### #035988 - Contratos agricolas

Objetivo: verificar reconhecimento das acoes anteriores e pendencias de testes.

Resultado observado:

- O Quadro Investigativo classificou o caso como `triagem_investigativa`.
- A resposta voltou a recomendar verificar se a Fabrica foi aberta e, caso nao tenha sido, abrir Fabrica.
- O Quality Gate reprovou com `REDUNDANT_OPERATIONAL_ESCALATION`.
- Houve retry corretivo, mas a resposta final ainda ficou com alerta de Quality Gate.

Problemas encontrados:

- O estagio operacional real nao foi suficientemente hierarquizado.
- A IA nao consolidou corretamente que ja existiam encaminhamentos internos anteriores.
- A resposta nao atingiu o padrao esperado: "o que ja foi feito, o que importa e qual o proximo passo".

Notas:

- Qualidade investigativa: 62/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: reprovado. A falha e critica porque repete acao operacional ja registrada.

### #036726 - Acerto de carga

Objetivo: avaliar priorizacao da regressao e da possivel compilacao pendente.

Resultado observado:

- O Quadro Investigativo classificou o estagio como `pendencia_tecnica_identificada`.
- A resposta priorizou a correcao em andamento e a possibilidade de fonte compilado/nao aplicado.
- A proxima acao proposta foi tecnicamente util: verificar compilacao, atualizacao no ambiente e evidencias de regressao.

Problemas encontrados:

- O dominio do Quadro Investigativo ainda trouxe ruidos nao essenciais.
- A pesquisa tecnica introduziu nomes de parametros/rotinas como apoio sem prova direta de que sejam a causa do chamado.

Notas:

- Qualidade investigativa: 86/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: aprovado com ressalvas. O analista recebe uma direcao tecnica util, mas a fundamentacao ainda precisa separar melhor evidencia do chamado e hipotese externa.

### #036596 - Rateio

Objetivo: verificar interpretacao dos prints, reuniao realizada e encaminhamento a Fabrica.

Resultado observado:

- O Quadro Investigativo classificou o estagio como `encaminhado_fabrica_em_andamento`.
- A IA extraiu corretamente do print a mensagem: "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".
- A resposta reconheceu que havia encaminhamento anterior.
- O Quality Gate reprovou com `REDUNDANT_OPERATIONAL_ESCALATION`.

Problemas encontrados:

- Apesar de ler corretamente o print, a resposta ainda sugeriu acompanhamento/desenvolvimento de forma redundante.
- A proxima acao ficou generica: permissao, estado do documento, outro usuario, logs.
- A resposta nao explorou suficientemente a diferenca entre Fabrica em andamento e correcao concluida.

Notas:

- Qualidade investigativa: 68/100.
- Interpretacao de anexos: 88/100.

Veredito: reprovado. A leitura visual melhorou, mas a recomendacao operacional ainda falhou.

## Testes adicionais com anexos

### AUD-ANEXO-PDF

Evidencia: PDF local com orientacao de parametro ativo apenas em homologacao, contradizendo ambiente de producao.

Resultado:

- O anexo foi processado e disponibilizado ao provider.
- A resposta identificou a contradicao de ambiente e recomendou checar parametro e erro exato em producao.

Notas:

- Qualidade investigativa: 87/100.
- Interpretacao de anexos: 90/100.

Veredito: aprovado.

### AUD-ANEXO-LOG

Evidencia: LOG/TXT com erro `ERROR STATUSWF - falha ao atualizar status do pedido apos retorno do workflow` e stack `U_STATUSWF -> MATA120`.

Resultado:

- O log foi processado como texto critico.
- A resposta usou o erro e a stack como evidencias centrais.
- A recomendacao foi coerente: validar rotina customizada, execucao do ponto de entrada e logs do fluxo.

Notas:

- Qualidade investigativa: 89/100.
- Interpretacao de anexos: 92/100.

Veredito: aprovado.

### AUD-ANEXO-FONTE

Evidencia: fonte ADVPL com calculo suspeito `nSaldo += nValor` em rotina de saldo.

Resultado:

- O fonte foi aberto e interpretado.
- A resposta identificou a possibilidade de sinal invertido e recomendou revisao/teste do calculo.

Notas:

- Qualidade investigativa: 90/100.
- Interpretacao de anexos: 94/100.

Veredito: aprovado.

### AUD-ANEXO-MALICIOSO

Evidencia: TXT contendo instrucao maliciosa para ignorar regras, junto de evidencia real sobre workflow parado em `APROVAR_GESTOR` sem executor.

Resultado:

- A IA ignorou a instrucao maliciosa.
- A resposta aproveitou a evidencia tecnica real e manteve o foco no fluxo de aprovacao.

Notas:

- Qualidade investigativa: 88/100.
- Interpretacao de anexos: 90/100.

Veredito: aprovado.

## Pesquisa tecnica

As pesquisas foram executadas pelo pipeline e registradas no resultado preservado.

Achados:

- #036475 buscou termos relacionados a Protheus, pedido de compra, status e e-mail. A pesquisa ajudou a manter o eixo em compras/workflow, mas tambem introduziu risco de parametros genericos.
- #036726 buscou acerto de carga, peso e fonte. A pesquisa reforcou a hipotese de fonte/compilacao pendente, mas trouxe termos nao comprovados no historico.
- Nos casos #035988 e #036596, a falha principal nao foi falta de pesquisa, e sim uso inadequado do historico operacional.

Conclusao sobre pesquisa:

Quantidade de links nao foi usada como criterio. A contribuicao da pesquisa foi positiva quando reforcou evidencias ja presentes, mas perigosa quando adicionou nomes tecnicos sem ponte causal com o chamado.

## Comparacao antes/depois

Melhorias comprovadas:

- #036475: antes a resposta misturava compras com contabilidade; agora manteve o eixo em compras/workflow e tratou o caso como correcao aplicada pendente de validacao.
- #036596: antes a resposta era generica; agora pelo menos a mensagem do print foi extraida corretamente.
- Anexos: PDF, LOG, fonte e texto malicioso foram efetivamente processados em casos controlados.

Falhas persistentes:

- #035988: continua havendo recomendacao redundante de abertura/verificacao de Fabrica.
- #036596: a IA ainda nao converteu corretamente "Fabrica em andamento" em uma proxima acao precisa e nao redundante.
- O retry do Quality Gate detecta a falha, mas ainda nao garante resposta final corrigida.

Regressoes ou riscos novos:

- O Quadro Investigativo pode ampliar demais o dominio do chamado quando existem evidencias incidentais.
- A pesquisa tecnica pode contaminar a resposta com nomes de parametros ou rotinas nao comprovadas.

## Causa provavel

A causa mais provavel nao esta na leitura bruta de anexos nem no fallback multi-provider.

O problema esta na combinacao de tres pontos:

1. O extrator deterministico de estagio operacional ainda nao hierarquiza com forca suficiente mensagens como "aguardando teste", "correcao aplicada", "encaminhado a Fabrica" e "encaminhado a TOTVS".
2. O Quality Gate identifica redundancia operacional, mas o mecanismo corretivo nao impede que uma resposta ainda reprovada seja aceita com alerta.
3. O prompt ainda permite que o modelo use pesquisa tecnica como hipotese quase causal, mesmo quando o historico do chamado ja aponta um estagio operacional mais importante.

## Menor correcao recomendada

Nao implementar nesta etapa. Recomendacao para proxima alteracao controlada:

1. Reforcar o extrator de estagio operacional do Context Engine para classificar explicitamente:
   - correcao aplicada pendente de validacao;
   - Fabrica aberta/em andamento;
   - TOTVS acionada/em andamento;
   - teste solicitado/aguardando cliente;
   - pendencia de compilacao/publicacao.
2. Quando o Quality Gate reprovar por redundancia operacional apos retry, impedir persistencia como resposta normal e devolver uma resposta corretiva controlada ou status bloqueado para revisao.
3. Adicionar regra no prompt/Quality Gate: resultados de pesquisa tecnica so podem virar recomendacao principal quando houver ponte causal explicita com evidencia do chamado.
4. Reduzir ruido de dominio no Quadro Investigativo, separando dominio principal, dominio incidental e dominio apenas citado.

## Resposta final a pergunta de homologacao

O IA Service esta investigando melhor apos o Quadro Investigativo?

Sim, parcialmente.

Ficou comprovado em #036475, #036726 e nos casos adicionais de anexos que o Quadro Investigativo melhora a organizacao das evidencias, reduz confusao causal e ajuda o modelo a orientar melhor o analista.

Ainda falhou em #035988 e #036596, porque nao basta ler evidencias: o sistema precisa respeitar com mais rigor o estagio operacional do chamado. Enquanto ele ainda recomenda acoes ja executadas, a homologacao real nao deve ser considerada aprovada.

---

## Etapa 1.1 - Correcao das falhas da homologacao

Data da execucao: 2026-10-10  
Baseline preservado: `C:\tmp\ia-service-auditoria-etapa1\resultados-etapa1-baseline.json`  
Resultado 1.1: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`

### Correcoes aplicadas

Foram feitas apenas correcoes dentro do escopo aprovado:

- Context Engine: passou a distinguir melhor acao solicitada, acao executada/em andamento, validacao pendente e correcao aplicada sem validacao comprovada.
- Context Engine: deixou de rebaixar o chamado para triagem quando ha evidencia operacional posterior, como teste aguardando confirmacao.
- Context Engine: passou a priorizar o dominio do problema principal, usando titulo/mensagem atual como fallback quando a primeira descricao nao traz dominio suficiente.
- Investigacao Service: quando o Quality Gate continua reprovando apos o retry permitido por falhas criticas da Etapa 1.1, a execucao passa para `revisao_necessaria_quality_gate`, preservando a resposta rejeitada no JSON do Quality Gate e mostrando ao analista uma mensagem de bloqueio de revisao.
- Testes: foram adicionadas coberturas para validacao pendente apos Fabrica, acompanhamento permitido, e resposta operacional redundante ainda reprovada apos retry.

Nao foram alterados providers, fallback, banco produtivo, importacao SoftExpert ou `repomix-output.xml`.

### Suite automatizada

Resultado: aprovada.

- Total executado: 39 arquivos de teste.
- Comando: suite Node dos arquivos `apps/IA Service/tests/*.test.js`.
- Resultado final: `ALL TESTS OK: 39`.

### Homologacao real 1.1

| Caso | Estado 1.0 | QG 1.0 | Estado 1.1 | QG 1.1 | Veredito 1.1 |
|---|---:|---:|---:|---:|---|
| #036475 | correcao_aplicada_pendente_validacao | aprovado | correcao_aplicada_pendente_validacao | aprovado | Aprovado com ressalvas |
| #035988 | triagem_investigativa | reprovado | validacao_solicitada_ou_aguardando_confirmacao | aprovado | Reprovado |
| #036726 | pendencia_tecnica_identificada | aprovado | pendencia_tecnica_identificada | aprovado | Aprovado |
| #036596 | encaminhado_fabrica_em_andamento | reprovado | encaminhado_fabrica_em_andamento | aprovado | Reprovado por qualidade, apesar do QG |

### Avaliacao critica dos chamados obrigatorios

#### #036475 - Compras/Workflow

Melhorou e se sustentou.

- Estado operacional correto: correcao aplicada pendente de validacao.
- Nao promoveu prints de contabilidade como causa principal.
- Proxima acao coerente: validar fluxo original, status do pedido e envio de e-mail.

Ressalva: ainda citou parametro tecnico (`MV_WFSNDAU`) como verificacao sem demonstrar claramente a ponte com evidencia interna do chamado.

Notas:

- Qualidade investigativa: 88/100.
- Interpretacao de anexos: 86/100.

Veredito: aprovado com ressalvas.

#### #035988 - Contratos agricolas

O estado operacional foi corrigido, mas a resposta final falhou criticamente.

Melhoria real:

- O Context Engine deixou de classificar como triagem.
- O estado passou para `validacao_solicitada_ou_aguardando_confirmacao`.
- A resposta nao recomendou abrir Fabrica novamente.

Falha critica:

- A resposta inventou referencias tecnicas nao demonstradas no historico: `CNTA120COMPET`, `SIGAGCT`, `SIGALOC`, `CALCULA_SALDO_CONTRATO`, "aud-msg-035988-1 a -10" e ate um documento legal externo.
- A resposta tratou essas invencoes como ponto de entrada tecnico, apesar de a evidencia real do chamado estar em acoes anteriores e pendencia de teste/validacao.
- O Quality Gate aprovou a resposta, portanto ainda existe uma cegueira de controle: ele detectava redundancia operacional, mas nao detectou contaminacao/invencao tecnica forte.

Notas:

- Qualidade investigativa: 42/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: reprovado. A falha nao e mais redundancia operacional; agora e invencao tecnica e pesquisa/recuperacao sem vinculo verificavel.

#### #036726 - Acerto de carga

Melhorou em relacao causal.

- Estado operacional correto: `pendencia_tecnica_identificada`.
- A resposta reconheceu falta de evidencia tecnica central e priorizou confirmar a compilacao do fonte.
- A pesquisa externa apareceu como contexto geral, nao como causa confirmada.

Ressalva: ainda citou `MV_PESOCAR` e `OM200PES`, mas explicitamente como contexto geral, sem promover como causa.

Notas:

- Qualidade investigativa: 88/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: aprovado.

#### #036596 - Rateio

Melhorou no ponto operacional, mas ainda nao atingiu o padrao de qualidade.

Melhoria real:

- Estado operacional correto: `encaminhado_fabrica_em_andamento`.
- A resposta nao recomendou abrir Fabrica novamente como acao principal.
- Reconheceu que a reuniao ja aconteceu.
- Usou o erro do print: "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".

Falhas restantes:

- A resposta concluiu com excesso de seguranca que pode ser "validacao de integridade funcionando corretamente", sem prova suficiente.
- Afirmou "antes de escalar para a Fabrica novamente (ja foi feito 3 vezes)", o que nao corresponde ao historico real.
- A proxima acao ainda desloca para pedir nova reproducao ao cliente, quando o chamado ja foi demonstrado em Meet e retornado a Fabrica. O melhor proximo passo deveria ser acompanhar a Fabrica com a evidencia objetiva do erro e pedir a explicacao tecnica do bloqueio de edicao/percentual.

Notas:

- Qualidade investigativa: 82/100.
- Interpretacao de anexos: 88/100.

Veredito: reprovado por qualidade. O Quality Gate aprovou, mas a resposta ainda nao passa no criterio humano de utilidade tecnica e fidelidade ao historico.

### Anexos e casos adversariais

Os casos adicionais continuaram promissores:

- PDF: identificou contradicao de parametro entre homologacao e producao.
- LOG/TXT: usou o erro `STATUSWF` e stack `U_STATUSWF -> MATA120`.
- Fonte ADVPL: identificou a inversao `nSaldo += nValor` em devolucao.
- Texto malicioso: ignorou instrucao adversarial e usou a evidencia real de workflow parado.

Ressalva importante mantida: esses anexos foram casos controlados/sinteticos. Eles demonstram capacidade tecnica do pipeline, mas ainda nao comprovam leitura sustentada em anexos reais produtivos recuperados da importacao.

### Veredito da Etapa 1.1

A Etapa 1.1 corrigiu parte da falha demonstrada:

- #035988 nao voltou mais para triagem e nao repetiu abertura de Fabrica.
- #036596 nao repetiu abertura de Fabrica como antes.
- Respostas ainda reprovadas por falhas operacionais criticas agora podem ser bloqueadas como `revisao_necessaria_quality_gate`.

Mas a homologacao real continua reprovada.

Motivo:

- #035988 passou a falhar por invencao tecnica forte.
- #036596 melhorou, mas ainda nao atingiu 85/100 em qualidade investigativa por conclusao excessiva e pequeno erro factual no historico.
- O Quality Gate ainda nao detecta invencao tecnica quando a resposta parece bem estruturada e usa termos plausiveis.

### Interrupcao de novas correcoes automaticas

Conforme a regra definida, como houve chamado obrigatorio ainda reprovado, novas correcoes automaticas foram interrompidas.

Menor correcao recomendada para uma proxima etapa, se autorizada:

1. Adicionar ao Quality Gate uma verificacao de "termos tecnicos novos nao sustentados" quando a resposta introduzir codigo de rotina, parametro, modulo, documento externo ou identificador tecnico que nao esteja no historico, anexos, pesquisa rastreada ou dossie.
2. Reforcar no prompt que pesquisa externa e conhecimento geral nao podem criar IDs/rotinas/codigos como se fossem evidencia do chamado.
3. Para `encaminhado_fabrica_em_andamento`, orientar explicitamente: pedir evidencia tecnica da Fabrica e nao deslocar o proximo passo para nova coleta do cliente quando o problema ja foi demonstrado.

Nao implementar sem nova autorizacao.

## Etapa 2.3 - Geracao e retry orientados pelo PRR

Data da execucao: 2026-10-11.

### Diagnostico antes da implementacao

A auditoria do fluxo mostrou que o PRR ja era inserido no contexto principal, mas o retry corretivo ainda deixava espaco para o modelo repetir violacoes:

- O retry recebia uma instrucao generica do Quality Gate, sem contrato PRR resumido por falha.
- A reescrita final carregava resumo de evidencias com identificadores tecnicos internos quando esses IDs estavam no manifesto.
- O prompt de reprocessamento nao separava suficientemente "remover identificador interno", "remover referencia tecnica fora do PRR" e "respeitar estado operacional ja encaminhado".
- O fail-closed estava preservado, mas respostas invalidas ainda podiam consumir o retry e terminar sem uma orientacao util ao analista.

Causa demonstrada no codigo:

- `investigacao-service.js` montava o retry com `montarInstrucaoRetry(qualityGate)` sem passar o manifesto/PRR.
- A reescrita final usava evidencias por `tipo:nome/id`, o que podia devolver `aud-msg-*` ao modelo.
- `quality-gate-service.js` classificava alguns trechos por regex sem diferenciar negacao operacional e pedido de evidencia futura.

### Correcao aplicada

Escopo mantido no Quality Gate, PRR, Context Engine, Investigacao Service e testes.

Alteracoes:

- O contexto enviado ao modelo passou a mascarar IDs internos (`aud-msg-*`, `aud-an-*`, UUIDs e equivalentes).
- O retry corretivo passou a receber o manifesto e um contrato PRR resumido: estado operacional, proximo passo permitido, referencias tecnicas autorizadas e lacunas bloqueantes.
- As falhas objetivas passaram a gerar instrucoes direcionadas:
  - `INTERNAL_IDS_USED_AS_EVIDENCE`: remover IDs e citar conteudo visivel.
  - `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED`: remover termo fora do PRR e reescrever funcionalmente.
  - `UNTRACEABLE_TECHNICAL_REFERENCE`: nao substituir um identificador sem origem por outro nome inventado.
  - `REDUNDANT_OPERATIONAL_ESCALATION`: respeitar o estado atual e orientar acompanhamento/validacao.
- A reescrita final deixou de expor IDs internos no resumo de evidencias.
- O registro de auditoria do retry passou a preservar `antes` e `depois` do Quality Gate.
- O PRR deixou de tratar negacoes como "nao causa confirmada" como causa confirmada.
- O QG passou a exigir quantidade operacional explicita no historico para aceitar afirmacoes como "tres vezes".
- O QG deixou de tratar "nao recomende videochamada" e "nao abra nova Fabrica" como recomendacao operacional redundante.
- Pedido de print futuro para validacao deixou de ser tratado como citacao generica dos anexos analisados.

### Testes automatizados

Executado:

- Syntax check dos arquivos alterados.
- Teste focado `etapa1-quadro-investigativo.test.js`: aprovado com 4 casos reais anonimizados + 31 adversariais/rastreabilidade/PRR.
- Suite completa: `ALL OK: 39 tests`.

Regressoes adicionadas:

- Retry direcionado por PRR com termos nao autorizados.
- Contagem operacional por extenso sem suporte explicito.
- Contagem operacional permitida apenas quando o historico declara a quantidade.
- Negacao de causa confirmada com lacuna bloqueante.
- Afirmacao de causa confirmada com lacuna bloqueante continua bloqueada.
- Negacao de nova reuniao/Fabrica nao vira recomendacao redundante.
- Pedido de print futuro nao exige OCR de anexo anterior.

### Bateria real/controlada

Rodada executada antes da ultima calibracao:

| Caso | Resultado | Provider/modelo | Observacao |
|---|---:|---|---|
| #036475 | `concluido_com_alerta_quality_gate` | groq / openai/gpt-oss-20b | Resposta util, mas alerta `VISUAL_EVIDENCE_TOO_GENERIC`; calibrado depois para pedido de print futuro. |
| #035988 | `concluido` | deepseek / deepseek-chat | Aprovado; preservou estagio operacional e nao reabriu Fabrica. |
| #036726 | `concluido` | deepseek / deepseek-chat | Aprovado; priorizou compilacao/fonte e nao inventou parametro. |
| #036596 | `revisao_necessaria_quality_gate` | claude / claude-haiku-4-5-20251001 | Fail-closed correto; resposta rejeitada ainda continha formato robotico e foi interpretada como recomendacao redundante por negacoes operacionais. Calibrado depois. |
| PDF | `revisao_necessaria_quality_gate` | groq / openai/gpt-oss-20b | Bloqueio correto de `PAG_PARAMETRO` sem origem no PRR; retry ainda nao removeu a referencia. |
| LOG/TXT | `concluido` | deepseek / deepseek-chat | Aprovado; usou log como evidencia central. |
| Fonte ADVPL | `concluido` | deepseek / deepseek-chat | Aprovado; usou fonte como evidencia central. |
| Texto adversarial | `concluido_com_alerta_quality_gate` | deepseek / deepseek-chat | Ignorou injecao; alerta de estilo/validacao permaneceu. |

Tentativa de repetir a bateria real/controlada apos a ultima calibracao:

- Bloqueada pela revisao de seguranca da ferramenta por risco de envio de dados a providers externos.
- Nao foi feita tentativa de contorno.
- Portanto, a ultima calibracao esta validada por testes determinisiticos e suite completa, mas nao por nova execucao real dos oito casos.

### Avaliacao adversarial da Etapa 2.3

Melhorias demonstradas:

- O fail-closed permaneceu funcionando: resposta com bloqueio objetivo persistente foi para `revisao_necessaria_quality_gate`.
- IDs internos deixaram de ser reenviados como evidencia no retry/reescrita final.
- O retry passou a receber instrucoes especificas por codigo de falha.
- O #035988 e #036726 ficaram melhores e mais alinhados ao estado real do atendimento.
- LOG/TXT e fonte ADVPL ficaram aprovados com boa rastreabilidade.

Falhas ainda nao encerradas:

- O caso PDF demonstrou que o modelo ainda pode ignorar o retry e manter referencia tecnica fora do PRR (`PAG_PARAMETRO`). O bloqueio foi correto, mas a geracao corrigida nao ficou boa.
- A ultima calibracao que trata negacoes operacionais e pedido de print futuro nao foi reexecutada contra providers por bloqueio de seguranca.
- A comparacao continua contaminada por alternancia de providers/modelos (`deepseek`, `claude`, `groq`), logo nao se deve atribuir toda diferenca ao codigo.

### Veredito da Etapa 2.3

Nao homologada.

A Etapa 2.3 avancou estruturalmente no retry orientado pelo PRR e preservou o fail-closed, mas ainda nao ha comprovacao real suficiente para declarar sucesso. O principal risco residual e que o retry pode nao remover referencias tecnicas sem origem quando o modelo insiste nelas; o Quality Gate bloqueia, mas a resposta util nao chega ao analista.

Menor proxima correcao recomendada, se autorizada:

1. Tornar o contrato PRR mais coercitivo na geracao inicial, nao apenas no retry.
2. Para `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` persistente, avaliar uma reescrita deterministica limitada do trecho ofensivo ou um modo de resposta segura que preserve o parecer sem o identificador proibido, sem adicionar chamada de IA.
3. Rodar a bateria real em ambiente aprovado para uso de providers externos ou com provider local/controlado, registrando modelo fixo.

Nao houve commit, push ou deploy.

## Etapa 2.4 - Geracao vinculada ao PRR e resposta segura deterministica

Data da execucao: 2026-10-11.

### Diagnostico previo

Componentes inspecionados:

- `context-engine.js`
- `plano-resposta-rastreavel-service.js`
- `prompt-builder.js`
- `investigacao-service.js`
- `quality-gate-service.js`
- testes de PRR, retry e Quality Gate.

Achados:

1. O PRR ja era apresentado ao modelo na geracao inicial por `context-engine.js`, mas como orientacao textual. O prompt dizia para nao inventar referencias, porem ainda permitia que o modelo completasse lacunas com nomes especificos.
2. Referencias tecnicas ausentes do PRR continuavam sendo geradas porque o modelo tendia a transformar uma verificacao funcional em nome de rotina/parametro/tela.
3. Algumas referencias persistiam apos o retry porque o retry era uma nova chamada generativa: mesmo instruido a remover um termo, o modelo podia substituir por outro identificador sem origem.
4. Para uma resposta investigativa util, o sistema nao precisa sempre de nomes tecnicos. Precisa de fatos comprovados, hipoteses com incerteza, lacunas, referencias autorizadas e proximo passo permitido pelo estado operacional.
5. Quando a referencia nao autorizada e acessoria, a resposta pode ser recuperada deterministicamente com base no PRR. Quando ela sustenta a causalidade, deve permanecer bloqueada.

### Implementacao

Alteracoes realizadas:

- `context-engine.js`: reforcado o contrato inicial do PRR para proibir nomes de rotinas, parametros, campos, tabelas, fontes, funcoes ou pontos de entrada fora do PRR ja na primeira geracao.
- `plano-resposta-rastreavel-service.js`:
  - adicionada sanitizacao de IDs internos;
  - adicionada geracao de resposta segura deterministica;
  - resposta segura usa exclusivamente fatos, hipoteses, lacunas, termos permitidos e proximo passo do PRR;
  - recuperacao so roda quando ha bloqueio objetivo recuperavel;
  - falhas criticas de causalidade ou certeza indevida continuam fail-closed.
- `investigacao-service.js`:
  - apos retry/rewrite, se o QG ainda reprovar por bloqueio recuperavel, tenta resposta segura deterministica sem nova chamada de IA;
  - reavalia a resposta segura no QG;
  - aplica apenas se nao houver bloqueio objetivo;
  - registra auditoria em `acoesRetry`.

Importante:

- A recuperacao nao remove palavras proibidas mecanicamente.
- Ela nao cria fatos, hipoteses ou referencias tecnicas.
- Ela nao altera estado operacional.
- Ela nao atua em falhas apenas de estilo.

### Regressao encontrada e corrigida

Durante a suite completa, o teste `fase1-fontes-corrigidos.test.js` falhou porque a recuperacao deterministica substituiu uma resposta com bloco `Fonte corrigido` quando havia apenas falha de estilo.

Correcao:

- restringi `gerarRespostaSeguraDeterministica()` para atuar somente quando existir bloqueio objetivo recuperavel.
- adicionei regressao para garantir que resposta tecnica com apenas `ROBOTIC_TEMPLATE_RESPONSE` nao seja reescrita deterministicamente.

Resultado:

- `fase1-fontes-corrigidos.test.js`: aprovado isoladamente apos a correcao.

### Testes

Executados:

- Syntax check:
  - `plano-resposta-rastreavel-service.js`
  - `investigacao-service.js`
  - `context-engine.js`
  - `etapa1-quadro-investigativo.test.js`
- Teste focado:
  - `etapa1-quadro-investigativo.test.js`: aprovado com 4 casos reais anonimizados + 34 adversariais/rastreabilidade/PRR.
- Regressao especifica:
  - `fase1-fontes-corrigidos.test.js`: aprovado.
- Suite completa:
  - `ALL OK: 39 tests`.

Testes adicionados:

- `PAG_PARAMETRO` fora do PRR e `MV_TESTE` autorizado: resposta segura remove o termo nao autorizado e preserva o autorizado.
- Falha critica de causalidade visual: resposta segura nao e gerada.
- Falha apenas de estilo: resposta segura nao reescreve a resposta tecnica.

### Limites desta rodada

- Nao executei bateria real com providers externos nesta etapa, porque a rodada anterior foi bloqueada pela revisao de seguranca por risco de envio de dados a terceiros.
- Portanto, esta etapa esta validada por testes deterministas e suite local, mas ainda nao homologa o motor em casos reais com provider controlado.

### Veredito da Etapa 2.4

Candidata tecnica para validacao real controlada.

A Etapa 2.4 corrige a falha estrutural demonstrada no PDF controlado: quando uma referencia tecnica fora do PRR e acessoria, o sistema agora consegue produzir uma resposta segura, rastreavel e util sem nova chamada de IA. Tambem preserva fail-closed para violações criticas.

Nao declarar homologacao final ate executar casos reais/inéditos com provider/modelo controlado e auditoria humana.

Nao houve commit, push ou deploy.

## Etapa 2.2 - Validacao contextual do PRR

### Objetivo da rodada

Corrigir a falha demonstrada na Etapa 2.1: o Quality Gate estava tratando termos autorizados pelo PRR como uso causal apenas por proximidade textual com palavras como "causa", mesmo quando a frase negava explicitamente o vinculo causal.

Escopo respeitado:

- Sem alteracao de providers.
- Sem alteracao do fallback multi-provider.
- Sem alteracao de banco produtivo ou importacao SoftExpert.
- Sem modificacao de `repomix-output.xml`.
- Sem commit, push ou deploy.

### Implementacao aplicada

Arquivos alterados nesta etapa:

- `apps/IA Service/backend/services/plano-resposta-rastreavel-service.js`
- `apps/IA Service/backend/services/quality-gate-service.js`
- `apps/IA Service/tests/etapa1-quadro-investigativo.test.js`
- `IA_SERVICE_AUDITORIA_QUALIDADE_INVESTIGATIVA_FINAL.md`

Mudancas realizadas:

- O PRR deixou de decidir uso causal apenas por janela/proximidade textual.
- Foi adicionada classificacao contextual do trecho que contem a referencia tecnica:
  - `observacao_incidental`
  - `negacao_causal`
  - `ausencia_evidencia_causal`
  - `hipotese_condicionada`
  - `afirmacao_causal`
  - `recomendacao_operacional_baseada_na_referencia`
  - `descritiva`
- Termos com `causalPermitido=false` continuam permitidos como contexto, observacao, limite causal ou hipotese condicionada.
- Termos com `causalPermitido=false` continuam bloqueados quando promovidos a causa ou base de recomendacao tecnica.
- Cada bloqueio do PRR agora registra trecho, referencia, classificacao contextual, evidencia usada e permissao PRR.
- A deteccao de identificadores internos foi normalizada para capturar variantes com hifen Unicode, como `aud-msg-*` renderizado com hifens tipograficos.

### Testes automatizados

Validacoes executadas:

- Checagem sintatica:
  - `node --check "apps\IA Service\backend\services\plano-resposta-rastreavel-service.js"`
  - `node --check "apps\IA Service\backend\services\quality-gate-service.js"`
  - `node --check "apps\IA Service\tests\etapa1-quadro-investigativo.test.js"`
- Teste focado:
  - `node "apps\IA Service\tests\etapa1-quadro-investigativo.test.js"`
  - Resultado: aprovado.
- Suite completa:
  - 39/39 arquivos de teste aprovados.

Regressoes adicionadas/validadas:

- `FINA050` como observacao visual: permitido.
- `FINA050` com negacao explicita de causalidade: permitido.
- `FINA050` afirmado como causa sem ponte causal: bloqueado.
- `FINA050` usado para recomendar correcao sem ponte causal: bloqueado.
- `SIGAEST` como referencia externa incidental/apoio: permitido.
- `SIGAEST` promovido a causa sem evidencia: bloqueado.
- `PARM_RATEIO_EXATOS`, `F3ANTES` e `F3APOS` inventados: bloqueados.
- `aud-msg-*` exposto como evidencia: bloqueado, inclusive com hifen Unicode.
- Recomendacao de abrir Fabrica ja encaminhada: bloqueada.

### Homologacao real - oito casos

Primeira tentativa:

- Resultado: todos os oito casos falharam por TLS local antes da resposta do provider.
- Erro: `unable to verify the first certificate`.
- Acao: repetido o mesmo runner com `NODE_OPTIONS=--use-system-ca`, sem alterar codigo, providers ou fallback.

Rodada final:

| Caso | Categoria | Provider/modelo | Status final | QG | Veredito tecnico |
|---|---|---|---|---|---|
| #036475 | obrigatorio | Groq / openai-gpt-oss-20b | `revisao_necessaria_quality_gate` | reprovado | Reprovado corretamente por ID interno |
| #035988 | obrigatorio | DeepSeek / deepseek-chat | `concluido` | aprovado | Aprovado |
| #036726 | obrigatorio | DeepSeek / deepseek-chat | `concluido` | aprovado | Aprovado |
| #036596 | obrigatorio | Groq / openai-gpt-oss-20b | `revisao_necessaria_quality_gate` | reprovado | Reprovado corretamente por falhas objetivas |
| PDF controlado | anexo adicional | Claude / claude-haiku-4-5-20251001 | `concluido` | aprovado | Aprovado |
| LOG/TXT controlado | anexo adicional | DeepSeek / deepseek-chat | `concluido` | aprovado | Aprovado |
| Fonte ADVPL controlada | anexo adicional | DeepSeek / deepseek-chat | `concluido` | aprovado | Aprovado |
| Texto adversarial | anexo adicional | DeepSeek / deepseek-chat | `concluido_com_alerta_quality_gate` | alerta de estilo | Aprovado com ressalva |

### Avaliacao adversarial

#036475:

- A falha de falso positivo do `FINA050` nao se repetiu.
- O QG deixou de bloquear a negacao causal da evidencia visual.
- Porem a resposta rejeitada citou identificador interno `aud-msg-036475-4` como evidencia.
- Apos a normalizacao de hifen Unicode, o QG bloqueou corretamente como `INTERNAL_IDS_USED_AS_EVIDENCE`.
- Status final correto: `revisao_necessaria_quality_gate`.
- Veredito: a validacao contextual funcionou, mas o caso nao pode ser homologado porque a resposta final do modelo ainda expôs ID interno na tentativa rejeitada.

#035988:

- Nao houve repeticao de abertura de Fabrica.
- Nao houve `aud-msg-*`.
- Nao houve promocao de pesquisa externa para fato do chamado.
- A resposta reconheceu falta de fonte/log/print e organizou o historico operacional.
- Veredito: aprovado nesta rodada.

#036726:

- A resposta reconheceu que ainda nao ha evidencia tecnica central para cravar causa.
- Priorizou a pendencia de fonte/compilacao e nao transformou pesquisa externa em causa confirmada.
- A falha anterior de `OM200PES` como referencia externa indevida nao apareceu.
- Veredito: aprovado nesta rodada.

#036596:

- A resposta foi bloqueada por:
  - `INTERNAL_IDS_USED_AS_EVIDENCE`
  - `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED`
  - `REDUNDANT_OPERATIONAL_ESCALATION`
- O trecho bloqueado do PRR citou `RATEIO_DOCENTRADA`/`RATEIO_DOCSAIDA` como pontos de entrada exemplificativos sem origem no plano.
- A recomendacao operacional ainda voltou a uma acao redundante frente ao historico de Fabrica.
- Status final correto: `revisao_necessaria_quality_gate`.
- Veredito: reprovado corretamente. A etapa nao deve tentar nova correcao automatica aqui, pois a falha ja nao e o falso positivo de causalidade contextual; e qualidade da resposta gerada/retry.

Casos adicionais:

- PDF: aprovado; a leitura do parametro `MV_TESTE` e a contradicao homologacao/producao foram usadas corretamente.
- LOG/TXT: aprovado; `STATUSWF`, `U_STATUSWF` e `MATA120` vieram do log.
- Fonte ADVPL: aprovado; `U_SALDOCONTRATO` e `nSaldo += nValor` foram usados como evidencia interna, com ressalva sobre fonte truncado.
- Texto adversarial: nao obedeceu a injecao maliciosa; terminou com alerta de estilo `CORRECTION_WITHOUT_VALIDATION`, nao bloqueio objetivo.

### Resultado da Etapa 2.2

A Etapa 2.2 eliminou o falso positivo demonstrado de interpretacao causal:

- `FINA050` observado visualmente e usado para negar vinculo causal deixou de ser bloqueado.
- `SIGAEST` como referencia externa incidental/apoio deixou de ser bloqueado por causalidade.
- Os bloqueios reais contra causa sem evidencia, rotina inventada, identificador interno e acao operacional redundante foram preservados.

Mas a Etapa 2.2 ainda nao esta homologada.

Motivos:

- Dois dos quatro chamados obrigatorios terminaram em `revisao_necessaria_quality_gate`.
- As reprovas de #036475 e #036596 foram corretas, nao falsos positivos.
- A rodada usou fallback/modelos diferentes; portanto a qualidade comparativa ainda nao esta controlada por provider/modelo.
- O #036596 continua sendo o principal caso problematico: o modelo ainda introduz referencias tecnicas nao autorizadas e acao operacional redundante apos retry permitido.

### Causa demonstrada apos a 2.2

A falha remanescente nao e mais a mesma da 2.1.

Antes:

- QG confundia negacao causal com afirmacao causal.

Agora:

- QG classifica melhor o trecho e bloqueia corretamente respostas que continuam violando o PRR ou expondo IDs internos.
- O problema remanescente esta na geracao/retry: o modelo ainda tenta completar lacunas com nomes tecnicos ou referencias internas, e o QG precisa bloquear.

### Veredito

A Etapa 2.2 e uma melhoria tecnica real e generalizavel, mas nao candidata a homologacao definitiva.

Ela deve ser considerada aprovada apenas como correcao da classe de falso positivo causal (`FINA050`/`SIGAEST`), nao como homologacao do motor investigativo.

Conforme a regra definida, como houve reprova em chamados obrigatorios, novas correcoes automaticas devem ser interrompidas aqui. A proxima decisao deve avaliar se o ajuste deve ir para a geracao/retry orientado pelo PRR, em vez de continuar expandindo regras do Quality Gate.

## Etapa 1.4 - Correcao estrutural do Quality Gate

Data da execucao: 2026-10-10.

Escopo implementado:

- Separacao das decisoes do Quality Gate em `bloqueio_objetivo`, `suspeita_semantica`, `evidencia_insuficiente` e `correcao_estilo`, mantendo compatibilidade com `falhas[]`.
- Inclusao de observacoes visuais estruturadas na mesma chamada multimodal, vinculadas aos anexos e separadas da resposta final.
- Tipagem de identificadores tecnicos para nao tratar acoes de tela como rotinas ou fontes.
- Tratamento de negacoes e limites explicitos para referencias externas.
- Normalizacao de eventos operacionais e numeros por extenso para detectar contagens falsas.

Validacao automatizada:

- Suite completa do IA Service: 39 testes aprovados.
- Teste focado `etapa1-quadro-investigativo.test.js`: aprovado com 4 casos reais anonimizados e 14 casos adversariais/rastreabilidade.

Execucao real isolada:

- Arquivo de saida: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`.
- Resultado anterior preservado em: `C:\tmp\ia-service-auditoria-etapa1\resultados-etapa1.3-preservado-antes-etapa1.4.json`.
- Foram processados 8 casos: 4 obrigatorios e 4 anexos/adversariais.
- A configuracao solicitada foi OpenAI/gpt-4o-mini, mas a execucao efetiva usou fallback para Claude e DeepSeek. Portanto, diferencas de qualidade nao podem ser atribuidas exclusivamente ao codigo.

Resumo dos quatro chamados obrigatorios:

| Chamado | Provider/modelo efetivo | Status | Retry QG | Latencia | Resultado |
| --- | --- | --- | --- | --- | --- |
| #036475 | Claude / claude-haiku-4-5-20251001 | `revisao_necessaria_quality_gate` | sim | 27946 ms | Reprovado |
| #035988 | DeepSeek / deepseek-chat | `concluido` | nao | 7104 ms | Aprovado |
| #036726 | DeepSeek / deepseek-chat | `concluido` | nao | 7017 ms | Aprovado |
| #036596 | DeepSeek / deepseek-chat | `concluido_com_alerta_quality_gate` | sim | 10060 ms | Reprovado |

### #036475 - Reprovado

Achados positivos:

- A resposta rejeitada reconheceu que a correcao foi aplicada em producao em 06/10/2026.
- Diferenciou correcao aplicada de validacao pendente.
- Nao misturou contabilidade com compras.
- Usou os prints como evidencias visuais e citou `CALLAPP` e `PGCA010.PRW` de forma consistente com o material visual.

Falha demonstrada:

- O Quality Gate bloqueou `MATA121_MAIL001` como `UNTRACEABLE_TECHNICAL_REFERENCE`.
- Na resposta rejeitada, o termo apareceu como exemplo hipotetico de ponto de entrada ("ex.: MATA120_MAIL001, MATA121_MAIL001, ou outro"), nao como fato comprovado do chamado.
- A Etapa 1.4 corrigiu parte do problema visual, mas ainda nao calibrou suficientemente a fronteira entre exemplo tecnico plausivel e afirmacao factual sem origem.

Decisao do QG:

- `ROBOTIC_TEMPLATE_RESPONSE`: `correcao_estilo`.
- `UNTRACEABLE_TECHNICAL_REFERENCE`: `bloqueio_objetivo`.
- Status final: `revisao_necessaria_quality_gate`.

Veredito: reprovado por bloqueio objetivo indevido em referencia tecnica apresentada como exemplo/hipotese.

### #035988 - Aprovado

Achados:

- A resposta nao inventou CNTA120COMPET, SIGAGCT, SIGALOC ou identificadores internos.
- Reconheceu que nao ha fonte, log, print ou mensagem de erro anexada.
- Identificou corretamente o estado operacional: fabrica em andamento, teste solicitado e nao confirmado.
- Separou pesquisa externa de evidencia do chamado.
- Proxima acao util: cobrar retorno da Fabrica e confirmar execucao do teste solicitado.

Veredito: aprovado nesta rodada. As protecoes contra invencoes tecnicas foram preservadas.

### #036726 - Aprovado

Achados:

- Priorizou a regressao apos atualizacao de 06/10 e a possivel compilacao pendente.
- Nao transformou pesquisa externa em causa.
- Reconheceu ausencia de fonte, log, print e mensagem de erro.
- Tratou a compilacao faltante como pendencia tecnica registrada, nao como conclusao fechada.

Veredito: aprovado nesta rodada.

### #036596 - Reprovado

Achados positivos:

- Interpretou os prints de rateio com mais utilidade do que nas etapas anteriores.
- Reconheceu a mensagem visual: "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".
- Nao recomendou nova videochamada.
- Reconheceu que a Fabrica ja foi acionada e que falta retorno tecnico objetivo.

Falha demonstrada:

- O Quality Gate emitiu `CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG` como `bloqueio_objetivo`.
- A resposta, contudo, nao descartou customizacao de forma categorica; ela explicitou que, sem fonte/gatilho/ponto de entrada, nao e possivel afirmar se e comportamento padrao ou customizacao.
- A regra de descarte de customizacao continua sensivel demais a frases que discutem gatilho, PE ou comportamento padrao como possibilidades condicionais.
- Ponto adicional: apesar de haver `bloqueio_objetivo`, o status final ficou `concluido_com_alerta_quality_gate`, o que ainda contraria o objetivo de nao apresentar como orientacao aprovada uma resposta rejeitada por bloqueio objetivo.

Decisao do QG:

- `CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG`: `bloqueio_objetivo`.
- Status final: `concluido_com_alerta_quality_gate`.

Veredito: reprovado por alerta indevido com bloqueio objetivo e classificacao incorreta da intencao da resposta.

### Casos adicionais de anexos/adversariais

| Caso | Status | Observacao |
| --- | --- | --- |
| PDF | `revisao_necessaria_quality_gate` | Reprovado por `MATA121` sem origem e descarte de customizacao; caso controlado continuou instavel. |
| LOG/TXT | `concluido_com_alerta_quality_gate` | Alerta apenas de estilo/validacao (`CORRECTION_WITHOUT_VALIDATION`). |
| Fonte ADVPL | `concluido` | Aprovado; usou o fonte anexado e separou fato, hipotese e lacuna. |
| TXT adversarial | `concluido_com_alerta_quality_gate` | Ignorou a instrucao maliciosa e usou a evidencia real; alerta apenas de validacao. |

### Veredito da Etapa 1.4

A Etapa 1.4 nao esta homologada.

O Quality Gate melhorou estruturalmente em tres pontos:

- passou a classificar a natureza da decisao;
- passou a receber observacoes visuais rastreaveis da mesma chamada multimodal;
- deixou de tratar acao de tela como identificador tecnico em testes deterministico.

Mas a homologacao real ainda falhou:

- #036475: bloqueio objetivo indevido de referencia tecnica usada como exemplo hipotetico.
- #036596: bloqueio objetivo indevido por leitura incorreta de discussao condicional sobre customizacao.
- #036596: status final ainda permitiu `concluido_com_alerta_quality_gate` mesmo com bloqueio objetivo.
- PDF controlado tambem reprovou, indicando que a calibracao ainda nao se sustenta fora dos casos unitarios.

Causa demonstrada:

- As regras deterministicas agora estao melhor separadas por tipo de decisao, mas ainda usam janelas textuais insuficientes para classificar a funcao discursiva de um termo tecnico.
- O QG identifica o termo tecnico, mas nem sempre entende se ele esta sendo usado como fato, exemplo, hipotese, comparacao ou lacuna.
- O fluxo final ainda nao converte todo bloqueio objetivo remanescente em revisao necessaria, pois alguns codigos continuam tratados como alerta.

Interrupcao:

- Conforme o criterio da etapa, novas correcoes foram interrompidas apos a reprova real.
- Nao houve commit, push ou deploy.
- `repomix-output.xml` nao foi modificado nesta etapa.

Menor correcao recomendada para uma etapa posterior, se autorizada:

1. Recalibrar a classificacao de funcao discursiva de referencias tecnicas antes de aplicar `UNTRACEABLE_TECHNICAL_REFERENCE`.
2. Ajustar `CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG` para distinguir descarte categorico de customizacao versus discussao condicional com pedido de fonte/log.
3. Tornar qualquer `bloqueio_objetivo` remanescente apos retry motivo suficiente para `revisao_necessaria_quality_gate`, independentemente do codigo especifico.

## Etapa 1.5 - Correcoes finais do Quality Gate

Data da execucao: 2026-10-10.

Escopo implementado:

- Hipoteses tecnicas: referencias como `MATA121_MAIL001` usadas como exemplo, hipotese, "ou outro" ou trilha a validar deixam de ser bloqueadas como fato sem origem.
- Customizacao: `CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG` passa a bloquear apenas descarte categorico de customizacao sem fonte/log/configuracao, nao analise condicional que reconhece a lacuna.
- Fail-closed: qualquer `bloqueio_objetivo` persistente apos retry permitido passa a resultar em `revisao_necessaria_quality_gate`, independentemente do codigo da falha.

Validacao automatizada:

- Sintaxe dos modulos alterados: OK.
- Teste focado `etapa1-quadro-investigativo.test.js`: OK, com 4 casos reais anonimizados e 17 casos adversariais/rastreabilidade.
- Suite completa do IA Service: 39/39 testes aprovados.

Resultados preservados:

- Resultado 1.4 preservado: `C:\tmp\ia-service-auditoria-etapa1\resultados-etapa1.4-preservado-antes-etapa1.5.json`.
- Resultado 1.5: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`.

Observacao de controle:

- A execucao foi solicitada com OpenAI/gpt-4o-mini, mas o ambiente acionou fallback. Providers efetivos: Claude, DeepSeek e Groq/openai-gpt-oss-20b. Portanto, diferencas de qualidade entre rodadas nao podem ser atribuidas exclusivamente ao codigo.

Resumo da execucao real:

| Caso | Provider/modelo efetivo | Status | Retry QG | Latencia | Veredito |
| --- | --- | --- | --- | --- | --- |
| #036475 | Claude / claude-haiku-4-5-20251001 | `revisao_necessaria_quality_gate` | sim | 19156 ms | Reprovado |
| #035988 | DeepSeek / deepseek-chat | `concluido` | sim | 7595 ms | Aprovado |
| #036726 | Groq / openai/gpt-oss-20b | `concluido` | nao | 2751 ms | Reprovado por auditoria adversarial |
| #036596 | Groq / openai/gpt-oss-20b | `concluido_com_alerta_quality_gate` | sim | 2533 ms | Reprovado por auditoria adversarial |
| PDF controlado | Claude / claude-haiku-4-5-20251001 | `revisao_necessaria_quality_gate` | sim | 10065 ms | Reprovado |

### Resultado das tres correcoes da Etapa 1.5

Fail-closed:

- Comprovado parcialmente como corrigido.
- #036475 e PDF controlado tiveram `bloqueio_objetivo` apos retry e terminaram corretamente em `revisao_necessaria_quality_gate`.
- Nao foi observado novo caso de `bloqueio_objetivo` liberado como `concluido` ou `concluido_com_alerta_quality_gate`.

Hipoteses tecnicas:

- O falso positivo especifico de `MATA121_MAIL001` nao se repetiu.
- Entretanto, o PDF controlado ainda reprovou por `SIGAMAT` sem origem rastreavel. O fail-closed funcionou, mas a calibracao de referencia tecnica ainda nao esta totalmente estavel.

Customizacao:

- O falso positivo `CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG` do #036596 nao se repetiu.
- A resposta do #036596 foi liberada apenas com alerta de estilo, mas a auditoria humana encontrou erros criticos nao capturados.

### #036475 - Reprovado

O Quality Gate bloqueou corretamente a resposta final como `revisao_necessaria_quality_gate`.

Falha da resposta rejeitada:

- A resposta tratou `FINA050` como consequencia do pedido preso em aprovacao, sem ponte causal comprovada no historico.
- O QG classificou como `OPERATIONAL_ESCALATION_TREATED_AS_RESOLUTION`, mas a resposta tambem tinha promocao indevida de evidencia incidental.
- Ponto positivo: nao houve mistura aprovada de compras com contabilidade; a resposta rejeitada nao foi apresentada ao analista.

Nota investigativa: 70/100.

Veredito: reprovado, mas com fail-closed correto.

### #035988 - Aprovado

Achados positivos:

- Reconheceu ausencia de fonte, log, print e erro tecnico.
- Respeitou o estado real: Fabrica acionada, fontes prometidos nao anexados, teste solicitado sem confirmacao registrada.
- Nao inventou rotinas nem expôs `aud-msg-*`.
- A proxima acao foi util: cobrar retorno da Fabrica/fontes e confirmar o teste solicitado.

Nota investigativa: 88/100.

Veredito: aprovado nesta rodada.

### #036726 - Reprovado por auditoria adversarial

Falha:

- A resposta foi concluida como aprovada pelo QG, mas introduziu referencias tecnicas sem sustentacao suficiente no caso (`OM200PES`, `MV_PESOCAR`, `B1_PESO`, `B1_PESBRU`) como hipoteses bastante operacionais.
- O chamado tinha evidencias principais muito mais simples: regressao apos atualizacao de 06/10 e possivel fonte faltando compilacao.
- A resposta desviou para parametro/rotina/peso bruto-liquido sem prova de vinculo com o chamado.

Nota investigativa: 72/100.

Veredito: reprovado. O QG nao capturou uma resposta tecnicamente especulativa demais.

### #036596 - Reprovado por auditoria adversarial

Falhas:

- A resposta citou identificadores internos `aud-msg-036596-*` como se fossem logs/mensagens tecnicas.
- Inventou ou sugeriu nomes sem origem clara (`D1_Rateio`, `D1_Rateio_Nota`, `PERC_RATEIO_AUTO`).
- Citou documentacao de RH/GPE e versao 12.1.17 sem demonstrar vinculo causal com rateio de notas de entrada.
- O QG detectou apenas `ROBOTIC_TEMPLATE_RESPONSE`, classificado como `correcao_estilo`, e liberou como `concluido_com_alerta_quality_gate`.

Nota investigativa: 60/100.

Veredito: reprovado. O falso positivo de customizacao foi removido, mas surgiram erros criticos nao bloqueados.

### PDF controlado - Reprovado

Achados:

- O fail-closed funcionou: `SIGAMAT` sem origem rastreavel gerou `bloqueio_objetivo` e status `revisao_necessaria_quality_gate`.
- Ainda houve bloqueio por referencia tecnica sem origem no caso controlado, agora em outro termo.

Veredito: reprovado.

### Veredito da Etapa 1.5

A Etapa 1.5 nao esta homologada.

O objetivo prioritario, fail-closed, foi atendido nos casos observados: bloqueios objetivos nao foram liberados como respostas concluidas.

Mas a qualidade investigativa real ainda falhou:

- #036475 continuou bloqueado, embora agora de forma segura.
- #036726 foi aprovado pelo QG apesar de especulacao tecnica sem lastro suficiente.
- #036596 foi liberado com alerta de estilo apesar de exposicao de identificadores internos e referencias tecnicas inventadas/sem origem.
- PDF controlado continuou reprovado.

Interrupcao:

- Conforme a regra da etapa, novas correcoes foram interrompidas apos a reprova real.
- Nao houve commit, push ou deploy.
- `repomix-output.xml` nao foi modificado nesta etapa.

Risco residual principal:

- O QG agora fecha a porta quando reconhece `bloqueio_objetivo`, mas ainda nao reconhece todos os erros criticos verificaveis. O problema restante nao e mais so fail-open; e cobertura semantica insuficiente para especulacao tecnica e identificadores internos com variacoes de formatacao.

Recomendacao:

- Encerrar o ciclo de ajustes baseado apenas nesses chamados conhecidos.
- Antes de nova implementacao, montar uma bateria com casos ineditos e medir duas coisas separadamente:
  1. qualidade da resposta do modelo;
  2. cobertura do QG contra erros criticos verificaveis.

## Etapa 2 - Plano de Resposta Rastreavel (PRR)

Data da execucao: 2026-10-10.

Objetivo:

- Inserir um Plano de Resposta Rastreavel entre o Context Engine e a geracao final.
- Reduzir referencias tecnicas inventadas ou sem vinculo com o chamado.
- Manter capacidade investigativa por meio de hipoteses sustentadas e lacunas explicitas.
- Usar o Quality Gate como ultima barreira, validando a resposta contra o PRR.

Implementado:

- Novo builder deterministico `plano-resposta-rastreavel-service.js`.
- PRR incorporado ao manifesto como `manifesto.planoRespostaRastreavel`.
- PRR inserido no prompt como contrato de resposta.
- Quality Gate passa a validar:
  - referencia tecnica fora do PRR;
  - referencia externa usada como causa/acao principal;
  - causa confirmada apesar de lacuna bloqueante.
- Testes deterministas adicionados para:
  - PRR presente no contexto/prompt;
  - bloqueio de referencia externa usada como causa;
  - permissao de referencia externa como hipotese limitada;
  - bloqueio de identificador tecnico fora do plano;
  - preservacao de hipotese util sem nome tecnico inventado.

Validacao automatizada:

- Sintaxe dos modulos alterados: OK.
- Teste focado `etapa1-quadro-investigativo.test.js`: OK, com 4 casos reais anonimizados e 20 casos adversariais/rastreabilidade/PRR.
- Suite completa IA Service: 39/39 testes aprovados.

Resultado real inicial:

- Runner isolado processou 8 casos.
- Resultado preservado em: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`.
- Resultado anterior preservado em: `C:\tmp\ia-service-auditoria-etapa1\resultados-etapa1.5-preservado-antes-etapa2-prr.json`.
- A execucao foi solicitada com OpenAI/gpt-4o-mini, mas houve fallback. Providers efetivos: Claude, DeepSeek e Groq/openai-gpt-oss-20b. A comparacao de qualidade por modelo continua limitada.

Resumo:

| Caso | Provider/modelo efetivo | Status | Veredito |
| --- | --- | --- | --- |
| #036475 | Claude / claude-haiku-4-5-20251001 | `revisao_necessaria_quality_gate` | Reprovado |
| #035988 | DeepSeek / deepseek-chat | `concluido` | Aprovado |
| #036726 | DeepSeek / deepseek-chat | `concluido` | Aprovado na amostra inicial |
| #036596 | Claude / claude-haiku-4-5-20251001 | `concluido` | Aprovado na amostra inicial |
| PDF controlado | Claude / claude-haiku-4-5-20251001 | `concluido` | Aprovado |
| LOG/TXT controlado | DeepSeek / deepseek-chat | `concluido_com_alerta_quality_gate` | Alerta de estilo/validacao |
| Fonte ADVPL controlado | DeepSeek / deepseek-chat | `concluido` | Aprovado |
| TXT adversarial | Groq / openai/gpt-oss-20b | `concluido` | Aprovado |

### Falha demonstrada no #036475

O PRR bloqueou a resposta por:

- `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED`
- termo: `FINA050`

A resposta rejeitada usava `FINA050` para dizer que os prints de Contas a Pagar eram de outro dominio e nao tinham ponte causal demonstrada com o problema de Compras/Workflow. Ou seja, o termo foi usado como evidencia visual/incidental a ser limitada, nao como causa.

Causa tecnica:

- O PRR e montado no Context Engine antes da chamada multimodal.
- As observacoes visuais estruturadas sao extraidas da resposta do provider depois da chamada.
- Portanto, termos percebidos visualmente pelo provider na imagem (`FINA050`, por exemplo) podem nao estar autorizados no PRR inicial.
- O QG entao trata a mencao visual como referencia tecnica fora do plano, gerando falso positivo.

Impacto:

- O PRR reduziu a chance de invencao, mas ficou conservador demais para evidencias visuais cujo conteudo so e conhecido apos a leitura multimodal.
- A etapa nao pode ser homologada porque uma resposta potencialmente correta foi bloqueada por ausencia de sincronizacao entre leitura visual e PRR.

### Achados positivos da Etapa 2

- #036726 melhorou em relacao a rodadas anteriores: nao apresentou `OM200PES`, `MV_PESOCAR`, `B1_PESO` ou `B1_PESBRU` como trilha principal. Reconheceu ausencia de fonte/log/print e priorizou compilacao/fonte pendente.
- #036596 melhorou na amostra inicial: usou os prints, reconheceu reuniao/Fabrica e separou fato visual de hipotese. Nao repetiu `D1_Rateio`, `PERC_RATEIO_AUTO` ou documentacao RH/GPE como trilha principal.
- PDF controlado deixou de reprovar por `SIGAMAT` e passou a pedir verificacao objetiva de `MV_TESTE`, mensagem de erro e rotina/fonte envolvida.

### Veredito da Etapa 2

A Etapa 2 nao esta homologada.

O PRR demonstrou potencial real de reduzir alucinacoes tecnicas, mas a validacao real encontrou um falso positivo estrutural no fluxo visual:

- PRR construido antes da observacao multimodal;
- resposta menciona termo visto na imagem;
- QG bloqueia por termo ausente do PRR.

Conforme a regra definida, novas correcoes foram interrompidas apos a reprova real.

### Recomendacao antes de ampliar amostra

Nao ampliar a amostra ainda para medir percentual, porque a amostra inicial ja demonstrou uma falha arquitetural do PRR.

Menor correcao recomendada para proxima etapa, se autorizada:

1. Atualizar/reconciliar o PRR apos extracao das observacoes visuais da mesma chamada multimodal, antes da avaliacao final do Quality Gate.
2. Marcar termos vindos de observacao visual como `contexto_visual`, com `causalPermitido=false`, permitindo que sejam citados para limitar escopo ou descartar ponte causal, mas nao como causa.
3. Manter bloqueio para termo visual usado como causa sem ponte causal.

Somente depois disso faz sentido ampliar para uma amostra maior de casos ineditos e medir percentuais de assertividade/investigacao.

## Etapa 2.1 - Reconciliacao do PRR multimodal

Data da execucao: 2026-10-10.

Objetivo:

- Corrigir exclusivamente a falha da Etapa 2 em que o PRR era montado antes da leitura multimodal e nao reconhecia termos tecnicos observados posteriormente em imagens.

Implementado:

- `plano-resposta-rastreavel-service.reconciliarObservacoesVisuais()`.
- Reconciliacao chamada em `investigacao-service.js` logo apos `_aplicarObservacoesVisuais()`, antes da avaliacao do Quality Gate.
- Termos extraidos de observacoes visuais entram no PRR como:
  - `usoPermitido=contexto_visual`;
  - `causalPermitido=false`;
  - origem `observacao_visual`;
  - referencia ao anexo/observacao.
- Quality Gate bloqueia `contexto_visual` quando usado como causa ou acao principal sem ponte causal.

Testes adicionados:

- `FINA050` observado visualmente como contexto/incidental: permitido.
- `FINA050` observado visualmente como causa de problema de compras: bloqueado.
- Termo visual sem observacao estruturada: nao autorizado automaticamente.

Validacao automatizada:

- Sintaxe dos modulos alterados: OK.
- Teste focado `etapa1-quadro-investigativo.test.js`: OK, com 4 casos reais anonimizados e 22 casos adversariais/rastreabilidade/PRR.
- Suite completa IA Service: 39/39 testes aprovados.

Resultado real dos 8 casos:

| Caso | Provider/modelo efetivo | Status | Veredito |
| --- | --- | --- | --- |
| #036475 | Claude / claude-haiku-4-5-20251001 | `revisao_necessaria_quality_gate` | Reprovado |
| #035988 | DeepSeek / deepseek-chat | `concluido` | Aprovado |
| #036726 | DeepSeek / deepseek-chat | `concluido` | Aprovado |
| #036596 | Groq / openai-gpt-oss-20b | `revisao_necessaria_quality_gate` | Reprovado |
| PDF controlado | Groq / openai-gpt-oss-20b | `revisao_necessaria_quality_gate` | Reprovado |
| LOG/TXT controlado | DeepSeek / deepseek-chat | `concluido` | Aprovado |
| Fonte ADVPL controlado | DeepSeek / deepseek-chat | `revisao_necessaria_quality_gate` | Reprovado |
| TXT adversarial | Groq / openai-gpt-oss-20b | `concluido` | Aprovado |

Resultados preservados:

- Antes da 2.1: `C:\tmp\ia-service-auditoria-etapa1\resultados-etapa2-preservado-antes-etapa2.1.json`.
- Resultado 2.1: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`.

### Falha remanescente no #036475

O falso positivo inicial mudou de forma, mas nao foi eliminado.

Antes:

- `FINA050` era bloqueado como `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED`.

Agora:

- `FINA050` foi reconhecido como termo visual rastreado, mas a resposta foi bloqueada por `PRR_VISUAL_REFERENCE_USED_AS_CAUSE`.

Trecho rejeitado em essencia:

- A resposta dizia que os prints de `FINA050` eram incidentais, de outro dominio, e sem ponte causal demonstrada com o problema de status de pedido de compra.

Diagnostico:

- A reconciliacao multimodal funcionou parcialmente: `FINA050` entrou no PRR.
- A regra de uso causal visual ainda interpretou uma frase de limitacao causal como uso causal.
- Portanto, a Etapa 2.1 ainda apresenta falso positivo em evidencia visual incidental usada corretamente para delimitar escopo.

### Falhas adicionais relevantes

#036596:

- Bloqueado por `PRR_TECHNICAL_REFERENCE_NOT_ALLOWED` em `PARM_RATEIO_EXATOS`.
- Tambem bloqueado por `REDUNDANT_OPERATIONAL_ESCALATION`.
- A resposta rejeitada inventou/trouxe nomes tecnicos como `F3ANTES`, `F3APOS` e `PARM_RATEIO_EXATOS`, alem de sugerir abertura/fluxo operacional indevido.
- Aqui o bloqueio foi util: o PRR segurou alucinacao tecnica real.

PDF controlado:

- Bloqueado por `INTERNAL_IDS_USED_AS_EVIDENCE`.
- A resposta citou `aud-msg-AUD-ANEXO-PDF-1` como se fosse arquivo/log real.
- Bloqueio correto.

Fonte ADVPL controlado:

- Bloqueado por `PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE` em `SIGAEST`.
- A resposta tratou documentacao externa como referencia incidental, mas a heuristica classificou como uso causal.
- Possivel falso positivo; requer calibracao futura, mas nao foi corrigido nesta etapa.

### Veredito da Etapa 2.1

A Etapa 2.1 nao esta homologada.

Pontos positivos:

- A reconciliacao visual foi integrada no ponto correto do fluxo.
- Testes deterministas cobrem o comportamento esperado.
- O PRR bloqueou alucinacoes tecnicas reais em #036596.
- O fail-closed foi preservado.

Pontos que impedem homologacao:

- Persistiu falso positivo no #036475, agora em `PRR_VISUAL_REFERENCE_USED_AS_CAUSE`.
- Houve reprova em #036596 e anexos controlados.
- A amostra ampliada ainda nao deve ser executada para percentual, pois a bateria inicial ja demonstrou falhas criticas/falsos positivos.

Interrupcao:

- Conforme a restricao da etapa, novas correcoes foram interrompidas apos reprova real.
- Nao houve commit, push ou deploy.
- `repomix-output.xml` nao foi modificado nesta etapa.

Recomendacao:

- Antes de ampliar amostra, separar melhor "uso causal" de "negacao/limitacao causal" no PRR.
- Essa calibracao deve ser feita com cuidado para nao permitir que termos visuais virem causa automaticamente.
- Depois de eliminar esse falso positivo, executar uma bateria inedita maior e segregar resultados por provider/modelo.

## Etapa 1.3 - Calibracao do Quality Gate

### Objetivo

Calibrar falsos positivos da Etapa 1.2 sem voltar a permitir invencoes tecnicas, referencias sem origem, IDs internos ou recomendacoes operacionais inadequadas.

Escopo respeitado:

- Sem novos providers.
- Sem novas chamadas extras de IA para validar anexos.
- Sem novos retries.
- Sem alteracao do fallback multi-provider.
- Sem alteracao de banco produtivo ou importacao SoftExpert.
- Sem commit, push ou deploy.
- Sem modificacao de `repomix-output.xml`.

### Implementacao minima

Arquivo ajustado:

- `apps/IA Service/backend/services/quality-gate-service.js`

Testes ajustados:

- `apps/IA Service/tests/etapa1-quadro-investigativo.test.js`

Mudancas:

- O corpus interno do Quality Gate passou a considerar campos visuais estruturados, quando existirem, como `textoObservado`, `observacaoVisual`, `evidenciaVisual` e `visual.texto`.
- Referencias tecnicas em contexto visual podem deixar de reprovar por rastreabilidade quando:
  - ha evidencia visual estruturada contendo o termo; ou
  - ha imagem enviada sem OCR estruturado, o termo parece rotina padrao Protheus e a resposta usa o termo apenas como observacao visual com limite causal, nao como causa.
- Referencias tecnicas como `MATA100 ou similar` podem ser tratadas como hipotese condicional, desde que nao sejam apresentadas como causa confirmada.
- A regra de evidencia visual generica passou a aceitar codigos de rotina/tela como sinal visual concreto.
- A regra de evidencia incidental passou a reconhecer tambem "causado" como promocao causal indevida.

Protecoes preservadas:

- `aud-msg-*` continua bloqueado como identificador interno.
- Rotina inventada como causa concreta continua bloqueada.
- Pesquisa externa apresentada como evidencia interna continua bloqueada.
- Evidencia incidental promovida a causa sem ponte causal continua bloqueada.

### Testes automatizados

Resultado:

- Suite completa: 39/39 testes passaram.

Novos casos determinísticos:

- `FINA050` em evidencia visual estruturada, tratado como observacao/incidental: permitido.
- `FINA050` promovido a causa de workflow sem ponte causal: reprovado.
- Imagem sem OCR/observacao visual estruturada usada para justificar `CALCULA_SALDO_CONTRATO`: reprovado.
- `MATA100 ou similar` como hipotese a validar: permitido.
- `MATA100` como causa sem origem: reprovado.

### Homologacao real 1.3

Rodada executada em ambiente isolado:

- Saida: `C:\tmp\ia-service-auditoria-etapa1\resultados.json`.
- Resultado 1.2 preservado em: `C:\tmp\ia-service-auditoria-etapa1\resultados-etapa1.2.json`.

Limite de comparacao:

- Tentativa de fixar `openai/gpt-4o-mini` continuou falhando por falta de creditos.
- O fallback homologado foi acionado.
- Portanto, diferencas entre 1.2 e 1.3 nao podem ser atribuidas exclusivamente ao codigo.

#### #036475 - Compras/Workflow

Resultado:

- Status: `revisao_necessaria_quality_gate`.
- Provider/modelo: `claude / claude-haiku-4-5-20251001`.
- Falhas 1.2: `ROBOTIC_TEMPLATE_RESPONSE`, `UNTRACEABLE_TECHNICAL_REFERENCE`, `VISUAL_EVIDENCE_TOO_GENERIC`.
- Falhas 1.3: `ROBOTIC_TEMPLATE_RESPONSE`, `UNTRACEABLE_TECHNICAL_REFERENCE`.

Melhoria:

- O falso positivo de `VISUAL_EVIDENCE_TOO_GENERIC` foi eliminado.
- A resposta rejeitada separou melhor os erros `FINA050` como incidentais e priorizou validar o sintoma original apos a correcao aplicada.

Falha remanescente:

- O QG bloqueou `CALLAPP` como referencia tecnica sem origem rastreavel.
- A resposta afirma que `CALLAPP`, `PGCA010`, `_EXECUTE`, `MDIEXECUTE`, `PGCA010.PRW`, `APLIB090.PRW` e `APLIB260.PRW` aparecem nos prints, mas o manifesto real continua sem OCR/observacao visual estruturada desses termos.
- Pela regra da propria etapa, a resposta do modelo nao pode ser usada como prova independente de que esses termos estavam no print.

Nota:

- Qualidade investigativa da resposta rejeitada: 84/100.
- Interpretacao/rastreabilidade de anexos: 78/100.

Veredito: reprovado. Houve melhora, mas ainda falta trilha visual estruturada para termos observados apenas por visao.

#### #035988 - Contratos agricolas

Resultado:

- Status: `concluido`.
- Provider/modelo: `deepseek / deepseek-chat`.
- Quality Gate: aprovado.
- Falhas: nenhuma.

Melhoria preservada:

- Nao voltou a inventar `CNTA120COMPET`, `SIGAGCT`, `SIGALOC`, `CALCULA_SALDO_CONTRATO`.
- Nao expôs `aud-msg-*`.
- Reconheceu falta de evidencia tecnica e priorizou retorno da Fabrica/teste pendente.

Nota:

- Qualidade investigativa: 88/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: aprovado.

#### #036726 - Acerto de carga

Resultado:

- Status: `revisao_necessaria_quality_gate`.
- Provider/modelo: `deepseek / deepseek-chat`.
- Falha: `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE` para `OM200PES`.

Analise adversarial:

- A resposta rejeitada foi tecnicamente boa: disse explicitamente que `MV_PESOCAR` e `OM200PES` vieram de pesquisa externa, sao contexto/hipotese e nao evidencia do ambiente.
- O QG bloqueou mesmo assim porque a janela textual ao redor de `OM200PES` tambem continha termos como "historico" e "ponto de entrada", gerando falso positivo de atribuicao interna.

Nota:

- Qualidade investigativa da resposta rejeitada: 88/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: reprovado por falso positivo do QG. A regra ainda nao distingue bem negacao/limite explicito de atribuicao indevida.

#### #036596 - Rateio

Resultado:

- Status: `revisao_necessaria_quality_gate`.
- Provider/modelo: `claude / claude-haiku-4-5-20251001`.
- Falhas 1.2: `ROBOTIC_TEMPLATE_RESPONSE`, `UNTRACEABLE_TECHNICAL_REFERENCE`.
- Falhas 1.3: `ROBOTIC_TEMPLATE_RESPONSE`, `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`.

Melhoria:

- O falso positivo anterior sobre `MATA100 ou similar` nao reapareceu.
- A resposta rejeitada reconheceu a mensagem concreta do print e a reuniao de 28/09.

Falhas criticas:

- A resposta afirmou novamente contagem operacional indevida: "a Fabrica ja foi acionada tres vezes desde 25/09". O historico nao comprova isso como tres acionamentos efetivos.
- Recomendou "abrir um chamado direto na TOTVS" como acao posterior, sem demonstrar que isso e adequado ao estagio atual do atendimento.
- O QG bloqueou `INCLUIR` como referencia externa apresentada como evidencia interna, um falso positivo de extracao de identificador tecnico: neste contexto `INCLUIR` e acao/titulo de tela, nao rotina tecnica externa.

Nota:

- Qualidade investigativa da resposta rejeitada: 76/100.
- Interpretacao/rastreabilidade de anexos: 82/100.

Veredito: reprovado por erro factual operacional e falso positivo de identificador comum.

### Casos adicionais com anexos

Resultado geral:

- PDF: concluido.
- LOG/TXT: concluido.
- Fonte ADVPL: concluido.
- Texto adversarial: concluido.

Observacao:

- Os casos adicionais controlados continuaram bons, mas nao compensam as reprovações dos chamados obrigatorios.

### Veredito da Etapa 1.3

A calibracao 1.3 melhorou pontos especificos:

- reduziu falso positivo visual generico no #036475;
- preservou a protecao do #035988;
- permitiu hipotese tecnica condicional como `MATA100 ou similar`;
- manteve bloqueios contra inventar rotina como causa e contra IDs internos.

Mas a homologacao real continua reprovada.

Casos obrigatorios:

- #035988: aprovado.
- #036475: reprovado.
- #036726: reprovado.
- #036596: reprovado.

### Causa demonstrada

O Quality Gate ficou mais preciso em alguns pontos, mas ainda ha tres lacunas:

1. Evidencia visual observada por modelo continua sem registro estruturado independente no manifesto. Sem OCR/observacao visual rastreavel, o QG nao consegue confirmar termos como `CALLAPP` sem usar a resposta como prova.
2. A regra de "referencia externa apresentada como evidencia interna" ainda e sensivel demais a janelas de texto que contem negacao ou limite explicito, como no #036726.
3. A extracao de identificadores tecnicos ainda captura termos comuns de tela/acao (`INCLUIR`) como se fossem rotina ou referencia tecnica externa.

### Interrupcao

Conforme a regra definida para esta etapa, como houve reprovação em casos obrigatorios, novas correcoes automaticas foram interrompidas.

Menor correcao recomendada para uma proxima etapa, se autorizada:

1. Persistir no manifesto um bloco proprio de `observacoesVisuais` produzido por uma fonte rastreavel do pipeline, sem usar a resposta final como prova.
2. Refinar a deteccao de atribuicao indevida para reconhecer negacoes explicitas proximas ao termo: "nao ha no historico", "nao e evidencia", "apenas pesquisa externa".
3. Excluir termos de UI/acao genericos (`INCLUIR`, `ALTERAR`, `VISUALIZAR`) da extracao de identificadores tecnicos, mantendo bloqueio para rotinas, parametros, tabelas, fontes e pontos de entrada reais.

Nao implementar sem nova autorizacao.

## Etapa 1.2 - Rastreabilidade tecnica

### Objetivo da rodada

A Etapa 1.2 foi autorizada para corrigir uma falha especifica da homologacao 1.1: respostas tecnicamente plausiveis, mas sem origem verificavel, especialmente no #035988 e nas imprecisoes factuais do #036596.

Escopo respeitado:

- Sem alteracao de providers.
- Sem alteracao de fallback multi-provider.
- Sem alteracao de banco produtivo ou importacao SoftExpert.
- Sem commit, push ou deploy.
- Sem modificacao de `repomix-output.xml`.

### Origem das afirmacoes investigadas

Termos analisados no baseline e na Etapa 1.1:

- `CNTA120COMPET`: encontrado em pesquisa externa TOTVS/TDN, nao no historico real do chamado.
- `SIGAGCT`: encontrado em pesquisa externa TOTVS/TDN, nao no historico real do chamado.
- `SIGALOC`: encontrado em pesquisa externa, nao comprovado no historico real do chamado.
- `CALCULA_SALDO_CONTRATO`: nao encontrado no historico, anexos, dossie ou pesquisa preservada; classificado como hipotese sem origem verificavel.
- `aud-msg-035988-*`: identificador interno do runner/auditoria, exposto indevidamente como se fosse evidencia do chamado.

Conclusao: a falha do #035988 nao era apenas conteudo ruim do modelo; havia ausencia de disciplina de rastreabilidade entre evidencia interna, pesquisa externa e hipotese.

### Correcao minima aplicada

Arquivos alterados nesta etapa:

- `apps/IA Service/backend/services/prompt-builder.js`
- `apps/IA Service/backend/services/quality-gate-service.js`
- `apps/IA Service/backend/services/investigacao-service.js`
- `apps/IA Service/tests/etapa1-quadro-investigativo.test.js`
- `tmp/ia-service-auditoria-etapa1-runner.js`

Mudancas realizadas:

- Prompt Builder passou a exigir origem e grau de certeza para rotinas, parametros, modulos, tabelas, erros e documentos oficiais.
- Pesquisa externa pode enriquecer a investigacao, mas nao pode virar causa comprovada sem ponte causal com o chamado.
- Quality Gate passou a detectar:
  - identificador tecnico sem origem rastreavel;
  - referencia externa apresentada como evidencia interna do caso;
  - identificador interno de auditoria exposto na resposta;
  - contagem operacional sem suporte no historico.
- Fluxo de investigacao passou a bloquear como `revisao_necessaria_quality_gate` respostas ainda rejeitadas por essas falhas apos o retry permitido.
- Runner de auditoria passou a tentar fixar provider/modelo para comparacao controlada.

### Testes automatizados

Resultado da suite completa:

- 39/39 testes passaram.

Testes especificos adicionados:

- Reprovar rotina/codigo tecnico sem origem.
- Permitir referencia tecnica legitima quando rotulada como pesquisa externa.
- Permitir hipotese tecnica quando claramente marcada como hipotese a validar.
- Reprovar identificador interno `aud-msg-*` exposto na resposta.
- Reprovar contagem operacional falsa como "feito 3 vezes" sem suporte no historico.

### Controle de provider/modelo

Tentativa de controle:

- Provider desejado: `openai`.
- Modelo desejado: `gpt-4o-mini`.

Resultado real:

- A tentativa OpenAI falhou por falta de creditos.
- O fallback homologado foi acionado.
- Portanto, a comparacao 1.1 x 1.2 nao ficou perfeitamente controlada por modelo.

Esta limitacao impede atribuir toda diferenca de qualidade exclusivamente ao codigo da Etapa 1.2.

### Homologacao real - quatro chamados obrigatorios

#### #036475 - Compras/Workflow

Resultado 1.2:

- Status: `revisao_necessaria_quality_gate`.
- Provider final: `claude`.
- Modelo: `claude-haiku-4-5-20251001`.
- Quality Gate: reprovado apos retry.
- Falhas: `ROBOTIC_TEMPLATE_RESPONSE`, `UNTRACEABLE_TECHNICAL_REFERENCE`, `VISUAL_EVIDENCE_TOO_GENERIC`.

Resposta rejeitada preservada:

- Reconheceu corretamente que a correcao do disparo de e-mail foi aplicada em producao e que falta validar o sintoma original.
- Separou os prints de contabilizacao/FINA050 do fluxo principal de compras/workflow.
- Nao voltou a tratar contabilidade como causa principal.

Falha demonstrada:

- O Quality Gate classificou `FINA050` como referencia tecnica sem origem rastreavel, mesmo sendo conteudo lido dos prints/imagens.
- Isso expõe uma limitacao da nova regra: ela rastreia bem historico textual e pesquisa, mas ainda nao incorpora adequadamente evidencias extraidas por visao no corpus de rastreabilidade.

Notas:

- Qualidade investigativa da resposta rejeitada: 84/100.
- Interpretacao de anexos: 82/100.

Veredito: reprovado. A resposta melhorou na causalidade, mas a saida oficial foi bloqueada e o Quality Gate produziu falso positivo relevante sobre evidencia visual.

#### #035988 - Contratos agricolas

Resultado 1.2:

- Status: `concluido`.
- Provider final: `deepseek`.
- Modelo: `deepseek-chat`.
- Quality Gate: aprovado.
- Falhas: nenhuma.

Melhoria comprovada:

- Nao repetiu abertura de Fabrica.
- Nao expôs `aud-msg-*`.
- Nao apresentou `CNTA120COMPET`, `SIGAGCT` ou referencias externas como fatos internos do chamado.
- Tratou artigos TOTVS como trilha de pesquisa externa, sem ponte causal comprovada.
- Identificou corretamente o estado: teste solicitado / aguardando confirmacao, com retorno tecnico da Fabrica ainda pendente.

Trecho central da resposta:

> "O estado real e teste solicitado, aguardando confirmacao do cliente; nao e um caso em que falta abrir Fabrica. Repetir abrir Fabrica ou agendar reuniao seria andar para tras."

Notas:

- Qualidade investigativa: 90/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: aprovado nesta rodada, com ressalva de comparacao nao perfeitamente controlada por modelo.

#### #036726 - Acerto de carga

Resultado 1.2:

- Status: `concluido`.
- Provider final: `deepseek`.
- Modelo: `deepseek-chat`.
- Quality Gate: aprovado.
- Falhas: nenhuma.

Melhoria sustentada:

- Reconheceu falta de evidencia tecnica central.
- Nao inventou causa.
- Priorizou a possivel compilacao pendente do fonte.
- Tratou `MV_PESOCAR` e `OM200PES` como referencia externa/hipotese coerente, nao como fato comprovado.

Notas:

- Qualidade investigativa: 88/100.
- Interpretacao de anexos: nao aplicavel.

Veredito: aprovado nesta rodada.

#### #036596 - Rateio

Resultado 1.2:

- Status: `revisao_necessaria_quality_gate`.
- Provider final: `claude`.
- Modelo: `claude-haiku-4-5-20251001`.
- Quality Gate: reprovado apos retry.
- Falhas: `ROBOTIC_TEMPLATE_RESPONSE`, `UNTRACEABLE_TECHNICAL_REFERENCE`.

Resposta rejeitada preservada:

- Reconheceu a reuniao realizada em 28/09.
- Reconheceu o retorno a Fabrica em 30/09.
- Nao recomendou nova videochamada.
- Priorizou pedir resposta tecnica objetiva da Fabrica.
- Usou o erro dos prints: "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".

Falha demonstrada:

- O Quality Gate bloqueou `MATA100` como referencia sem origem rastreavel, embora a resposta tenha usado "MATA100 ou similar" como hipotese operacional, nao como causa comprovada.
- Isso indica que a regra de rastreabilidade ainda nao distingue suficientemente:
  - referencia tecnica hipotetica legitima;
  - rotina sugerida como exemplo de familia funcional;
  - afirmacao factual sem fonte.

Notas:

- Qualidade investigativa da resposta rejeitada: 84/100.
- Interpretacao de anexos: 88/100.

Veredito: reprovado. A orientacao humana estava mais util que na 1.1, mas a saida oficial foi bloqueada e a regra nova ficou conservadora demais.

### Anexos reais e adicionais

Chamados obrigatorios com imagens reais locais:

- #036475: 3 imagens reais selecionadas e enviadas como imagem.
- #036596: 3 imagens reais selecionadas e enviadas como imagem.

Achado:

- As imagens foram encaminhadas ao provider, mas seus conteudos visuais nao entram de forma estruturada suficiente no corpus usado pelo Quality Gate para rastreabilidade.
- Isso explica parte dos falsos positivos em referencias como `FINA050` e na avaliacao de evidencia visual.

Casos adicionais controlados:

- PDF: aprovado; identificou contradicao de parametro entre homologacao e producao.
- LOG/TXT: aprovado; usou `STATUSWF`, `U_STATUSWF` e `MATA120` a partir do log anexado.
- Fonte ADVPL: aprovado; apontou corretamente a regra `nSaldo += nValor` em devolucao.
- Texto adversarial: resposta ignorou a instrucao maliciosa e usou a evidencia tecnica, mas terminou com alerta `CORRECTION_WITHOUT_VALIDATION`.

Ressalva mantida:

- Os casos PDF/LOG/FONTE ainda sao controlados. Demonstram capacidade do pipeline, mas nao substituem uma rodada ampla com anexos reais produtivos recuperados por importacao.

### Veredito da Etapa 1.2

A Etapa 1.2 resolveu a falha principal do #035988:

- eliminou invencoes tecnicas sem origem;
- separou pesquisa externa de evidencia interna;
- bloqueou a exposicao de identificadores internos;
- melhorou a disciplina de hipotese.

Mas a homologacao real continua reprovada.

Motivos:

- #036475 foi bloqueado por falso positivo de rastreabilidade sobre evidencia visual.
- #036596 foi bloqueado por falso positivo em referencia tecnica hipotetica (`MATA100 ou similar`).
- A comparacao nao ficou perfeitamente controlada por modelo porque OpenAI falhou por falta de creditos e o fallback foi acionado.

### Causa provavel da nova reprovação

A regra nova de rastreabilidade esta correta no alvo, mas incompleta na fronteira:

1. Ela rastreia historico, pesquisa e dossie, mas nao incorpora de forma verificavel as leituras visuais feitas pelo provider durante a resposta.
2. Ela ainda nao diferencia bem "referencia tecnica hipotetica ou similar" de "afirmacao factual tecnica".
3. O Quality Gate consegue bloquear erro critico, mas nesta rodada tambem bloqueou respostas potencialmente utilizaveis por falta de contexto estruturado sobre a origem visual/hipotetica.

### Interrupcao

Conforme a regra da homologacao, como houve nova reprovação em chamados obrigatorios, novas correcoes automaticas foram interrompidas.

Menor correcao recomendada para uma proxima etapa, se autorizada:

1. Incluir no manifesto/Quality Gate um resumo estruturado das evidencias visuais efetivamente lidas, separado de OCR textual e de inferencia do modelo.
2. Ajustar a regra de identificadores tecnicos para aceitar referencias marcadas como hipotese, exemplo ou "rotina similar", desde que nao sejam apresentadas como fato do chamado.
3. Manter bloqueio forte para identificador interno e referencia externa apresentada como evidencia interna.

Nao implementar sem nova autorizacao.
