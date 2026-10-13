# IA Service - Auditoria estrutural do Quality Gate

Data: 2026-10-10

Escopo: auditoria sem modificacao de codigo, providers, fallback, banco, importacao SoftExpert, `repomix-output.xml`, commit, push ou deploy.

## 1. Resumo executivo

A Etapa 1.3 nao foi homologada porque o Quality Gate atual mistura, no mesmo mecanismo de falha, tres tipos de decisao que exigem tratamentos diferentes:

1. Bloqueios objetivos: quando existe contradicao comprovada contra evidencias disponiveis.
2. Suspeitas semanticas: quando uma regex ou janela textual sugere risco, mas nao prova erro.
3. Revisao por falta de evidencia: quando o sistema nao tem base estruturada suficiente para confirmar nem negar a afirmacao.

Hoje todas essas situacoes entram como `falhas` com severidade `media` ou `alta`, geram retry, e alguns codigos viram `revisao_necessaria_quality_gate`. Isso faz o QG bloquear respostas tecnicamente boas por interpretacoes frageis e, ao mesmo tempo, deixar escapar erros factuais quando a regex nao cobre a forma linguistica usada.

O problema estrutural mais importante e este:

- O provider multimodal ve imagens.
- O manifesto do Context Engine registra que imagens foram enviadas.
- Mas o Quality Gate nao recebe uma observacao visual independente e estruturada do que foi visto nas imagens.

Assim, quando a resposta cita `CALLAPP`, `FINA050`, `INCLUIR`, `FWWHEN` ou percentuais vistos em tela, o QG tenta decidir rastreabilidade usando apenas:

- texto da resposta;
- nomes/metadados dos anexos;
- historico textual;
- pesquisa externa;
- quadro investigativo gerado antes da visao.

Isso forca o QG a escolher entre dois erros ruins:

- bloquear conclusoes legitimas sobre prints porque nao ha prova estruturada;
- ou aceitar o proprio texto final do modelo como prova do que havia no print.

A segunda opcao e insegura. A primeira foi o que ocorreu na Etapa 1.3.

## 2. Mecanismo atual auditado

### 2.1 Context Engine

Arquivo: `apps/IA Service/backend/services/context-engine.js`

Responsabilidades relevantes:

- Seleciona mensagens, anexos textuais, PDFs e imagens.
- Para imagem, cria candidato com:
  - `tipo: 'imagem'`;
  - `texto: "[Imagem: nome]"`;
  - `enviarImagem: true/false`;
  - `imagemEnviada` no manifesto.
- Monta `quadroInvestigativo` antes da resposta do provider.
- Registra no manifesto apenas metadados da imagem selecionada.

Achado:

- Imagens reais dos casos #036475 e #036596 aparecem no manifesto como `ENVIADA_COMO_IMAGEM`, mas sem `trecho`, `resumo`, `conteudo`, `textoObservado` ou `observacaoVisual`.
- O quadro investigativo classifica essas imagens com resumo generico como `[Imagem: arquivo]`.
- Logo, o QG sabe que a imagem foi enviada, mas nao sabe de forma rastreavel o que a imagem continha.

Evidencia preservada na Etapa 1.3:

- #036475: 3 imagens com `imagemEnviada=true`, todos os campos textuais nulos.
- #036596: 3 imagens com `imagemEnviada=true`, todos os campos textuais nulos.

### 2.2 Prompt Builder

Arquivo: `apps/IA Service/backend/services/prompt-builder.js`

Responsabilidades relevantes:

- Instrui o modelo a diferenciar fato, hipotese, causa provavel e conclusao confirmada.
- Instrui a rastreabilidade de rotina, parametro, modulo, erro, tabela, campo, fonte oficial e documento externo.
- Proibe expor IDs internos.
- Proibe afirmar quantidades operacionais sem evidencia explicita.
- Instrui respeitar o estado operacional do quadro.

Achado:

- O prompt melhorou a disciplina do modelo, especialmente no #035988.
- Mas instrucao nao e prova. Quando o modelo afirma "o print mostra X", o QG precisa verificar X por fonte independente. Hoje ele nao tem essa fonte para imagens.

### 2.3 Quality Gate

Arquivo: `apps/IA Service/backend/services/quality-gate-service.js`

O QG combina diversas familias de regra:

#### Regras de estilo e utilidade

- `_temRespostaGenerica`
- `_usaTemplateFormalRobotico`
- `_correcaoPoucoAcionavel`
- `_acaoIgnoraErroMaisEspecifico`
- `VISUAL_EVIDENCE_TOO_GENERIC`

Risco:

- Algumas sao preferencias de apresentacao ou utilidade, mas podem participar da mesma trilha de retry/revisao que erros factuais.
- `ROBOTIC_TEMPLATE_RESPONSE`, por exemplo, apareceu junto com falhas criticas e contribuiu para bloqueios, embora nao prove erro tecnico.

#### Regras de rastreabilidade tecnica

- `_extrairIdentificadoresTecnicos`
- `_corpusInterno`
- `_corpusPesquisa`
- `_temRotuloHipoteseOuOrigem`
- `_temReferenciaVisualRastreavel`
- `_temImagemSemTextoEstruturado`
- `_usoVisualComoObservacaoSemCausa`
- `_usoTecnicoComoHipoteseCondicional`
- `_avaliarRastreabilidadeTecnica`

Riscos:

- `_extrairIdentificadoresTecnicos` captura termos em maiusculas amplos demais. Exemplo: `INCLUIR` virou identificador tecnico.
- A classificacao de fonte externa versus evidencia interna depende de janela textual e regex de atribuicao.
- A janela textual pode conter ao mesmo tempo "historico" e "nao ha no historico", mas a regra nao trata negacao com robustez suficiente.
- A rastreabilidade visual so funciona se houver campos estruturados que hoje nao existem nos manifestos reais de imagem.

#### Regras operacionais

- `_avaliarContagemOperacionalFalsa`
- `_avaliarAcaoOperacionalRedundante`
- `_avaliarEncaminhamentoComoResolucao`
- `_avaliarEstadoOperacionalDoQuadro`

Riscos:

- `_avaliarContagemOperacionalFalsa` cobre numero arabico e alguns verbos, mas nao cobre numero por extenso nem formulacoes como "Fabrica ja foi acionada tres vezes".
- Acoes solicitadas, planejadas, em andamento e executadas dependem de regex e do historico textual; o Context Engine melhorou isso, mas o QG ainda nao usa uma representacao normalizada de contagem/eventos operacionais.

#### Regras de regressao e memoria

- `_avaliarRegressaoInvestigativa`
- `_avaliarRepeticaoDeRespostaAnterior`
- `_extrairAncorasTecnicas`
- `_similaridadeShingles`

Risco:

- Util para repeticao, mas nao resolve contradicao factual quando a afirmacao nova usa forma linguistica nao coberta.

#### Camada semantica complementar

Arquivo: `apps/IA Service/backend/services/investigative-discipline-service.js`

Achado:

- A camada tem muitas heuristicas especificas para sinais tecnicos conhecidos.
- Ela ajuda em casos com logs/fontes/texto.
- Nao resolve o gap visual porque tambem depende de texto de entrada (`artifacts.content`, `conteudoExtraido`) e nao de observacoes visuais independentes.

### 2.4 Investigacao Service

Arquivo: `apps/IA Service/backend/services/investigacao-service.js`

Fluxo relevante:

1. Chama provider com prompt e imagens.
2. Executa `qualityGateService.avaliarResposta`.
3. Se `deveRetry`, adiciona instrucao corretiva e chama provider novamente.
4. Depois do retry, certos codigos causam `revisao_necessaria_quality_gate`.
5. A resposta rejeitada e preservada em `qualityGate.revisaoNecessaria.respostaRejeitada`.

Codigos que causam revisao necessaria apos retry:

- `REDUNDANT_OPERATIONAL_ESCALATION`
- `REDUNDANT_OPERATIONAL_MEETING`
- `INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE`
- `INVESTIGATIVE_FRAME_OPERATIONAL_STAGE_IGNORED`
- `UNTRACEABLE_TECHNICAL_REFERENCE`
- `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`
- `UNSUPPORTED_OPERATIONAL_COUNT`
- `INTERNAL_IDS_USED_AS_EVIDENCE`

Achado:

- A escolha de revisao necessaria por codigo e correta em principio.
- O problema e que alguns codigos sao disparados por evidencias frageis, especialmente `UNTRACEABLE_TECHNICAL_REFERENCE` e `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`.
- Falta um campo intermediario do tipo "nao consigo verificar" versus "verifiquei e esta errado".

## 3. Casos reais da Etapa 1.3

### 3.1 #036475 - `CALLAPP` bloqueado sem rastreabilidade visual independente

Resultado 1.3:

- Status: `revisao_necessaria_quality_gate`.
- Provider/modelo: `claude / claude-haiku-4-5-20251001`.
- Falhas: `ROBOTIC_TEMPLATE_RESPONSE`, `UNTRACEABLE_TECHNICAL_REFERENCE`.
- Termo bloqueado: `CALLAPP`.

Dados efetivamente disponiveis para o QG:

- Historico textual do chamado.
- Pesquisa externa.
- Manifesto com 3 imagens enviadas.
- Nenhum OCR/observacao visual estruturada dessas imagens.
- Quadro investigativo com imagens resumidas como `[Imagem: nome]`.

Resposta rejeitada:

- Afirma que os prints mostram "Central de Diagnostico do Protheus" com `CALLAPP`, `PGCA010`, `_EXECUTE`, `MDIEXECUTE`, `PGCA010.PRW`, `APLIB090.PRW`, `APLIB260.PRW`.
- Separa `FINA050` como incidental.
- Prioriza validacao do sintoma original apos correcao aplicada.

Regra responsavel:

- `_avaliarRastreabilidadeTecnica`
- `_extrairIdentificadoresTecnicos`
- `_temReferenciaVisualRastreavel`
- `_temImagemSemTextoEstruturado`

Causa demonstravel:

- `CALLAPP` nao aparece em historico textual, pesquisa ou manifesto estruturado.
- Como a imagem nao tem texto observado estruturado, o QG nao pode confirmar `CALLAPP`.
- O bloqueio e defensavel do ponto de vista de rastreabilidade, mas a causa raiz e a falta de observacao visual independente, nao necessariamente erro da resposta.

Classificacao correta:

- Nao deveria ser "erro comprovado".
- Deveria ser "revisao necessaria por evidencia visual nao verificavel pelo QG" ou "alerta de rastreabilidade visual ausente".

### 3.2 #036726 - `OM200PES` bloqueado apesar de pesquisa externa explicitada

Resultado 1.3:

- Status: `revisao_necessaria_quality_gate`.
- Provider/modelo: `deepseek / deepseek-chat`.
- Falha: `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`.
- Termo bloqueado: `OM200PES`.

Dados efetivamente disponiveis:

- Historico textual com relato de acerto de carga e pendencia de compilacao de fonte.
- Pesquisa externa com referencia a `MV_PESOCAR` e `OM200PES`.
- Nenhum anexo.

Resposta rejeitada:

- Diz explicitamente que os artigos TOTVS sao "referencia de contexto do modulo, nao evidencia do que esta acontecendo no ambiente do cliente".
- Diz que nao ha no historico mencao ao parametro nem ao ponto de entrada.
- Diz que `OM200PES` seria hipotese a validar, nao causa.

Regra responsavel:

- `_avaliarRastreabilidadeTecnica`, ramo `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`.

Causa demonstravel:

- A regra procura, numa janela textual em torno do termo, palavras como `historico`, `mensagens`, `prints`, `log`, junto de verbos como `mostra`, `aparece`, `informa`, `registra`, `cita`.
- A resposta continha termos como "historico" perto de uma negacao: "nao ha no historico nenhuma mencao a esse parametro nem a esse ponto de entrada".
- A regra nao distingue suficientemente atribuicao positiva de negacao/limitacao explicita.

Classificacao correta:

- Falso positivo.
- A resposta, nesse ponto, estava alinhada ao objetivo da Etapa 1.2/1.3: separar pesquisa externa de fato interno.

### 3.3 #036596 - `INCLUIR` confundido com identificador tecnico e contagem falsa nao detectada

Resultado 1.3:

- Status: `revisao_necessaria_quality_gate`.
- Provider/modelo: `claude / claude-haiku-4-5-20251001`.
- Falhas: `ROBOTIC_TEMPLATE_RESPONSE`, `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`.
- Termo bloqueado: `INCLUIR`.

Dados efetivamente disponiveis:

- Historico textual:
  - Fábrica solicitada/encaminhada.
  - Meet/reuniao realizada em 28/09.
  - Retorno para Fabrica em 30/09.
- 3 imagens enviadas, sem observacao visual estruturada.

Resposta rejeitada:

- Afirma: "a Fabrica ja foi acionada tres vezes desde 25/09".
- Descreve prints e tela "Nf Rateio - Especifico - INCLUIR".
- Cita erro "Modo edicao nao respeitado. Valor nao pode ser atribuido. (% Rateio)".
- Recomenda abrir chamado direto na TOTVS se a Fabrica nao retornar.

Regras responsaveis:

- `_extrairIdentificadoresTecnicos` capturou `INCLUIR`.
- `_avaliarRastreabilidadeTecnica` classificou como referencia externa apresentada como evidencia interna.
- `_avaliarContagemOperacionalFalsa` nao capturou "tres vezes".

Causa demonstravel do falso positivo:

- `INCLUIR` e uma acao/titulo de tela, nao rotina, parametro, tabela, fonte ou ponto de entrada.
- A regex de identificadores captura maiusculas genericas com 5+ caracteres.
- Falta taxonomia de identificadores: rotina, parametro, tabela, campo, arquivo, tela/acao, palavra comum.

Causa demonstravel do falso negativo:

- A regra de contagem procura numerais arabicos (`3 vezes`) e padroes como `feito/realizado/encaminhado`.
- A resposta usou numero por extenso e verbo diferente: "Fabrica ja foi acionada tres vezes".
- A regra tambem depende de contagem heuristica no historico, nao de eventos operacionais normalizados.

Classificacao correta:

- `INCLUIR`: falso positivo.
- "tres vezes": erro factual operacional nao detectado.

### 3.4 #035988 - protecoes preservadas

Resultado 1.3:

- Status: `concluido`.
- Provider/modelo: `deepseek / deepseek-chat`.
- Falhas: nenhuma.

Comportamento positivo:

- Nao inventou `CNTA120COMPET`, `SIGAGCT`, `SIGALOC` ou `CALCULA_SALDO_CONTRATO` como fatos do chamado.
- Nao expôs `aud-msg-*`.
- Reconheceu ausencia de fonte/log/print/erro.
- Tratou o chamado como pedido funcional com retorno/teste pendente.
- Nao recomendou abrir Fabrica novamente.

Protecoes que devem ser preservadas:

- Bloqueio de IDs internos.
- Bloqueio de identificador tecnico sem origem quando apresentado como fato/causa.
- Separacao entre pesquisa externa e evidencia interna.
- Estado operacional vindo do historico.

## 4. Diagnostico estrutural

### 4.1 Falta uma camada de decisao do QG

Hoje o QG retorna uma lista plana:

- `falhas[]`
- `severidade`
- `deveRetry`
- `aprovado`

Mas a natureza das falhas e diferente:

- Erro objetivo: "citou aud-msg como evidencia", "historico mostra reuniao realizada e resposta pede agendar de novo".
- Suspeita: "termo tecnico parece sem origem", "resposta parece template".
- Inconclusivo: "termo apareceu em imagem enviada, mas nao existe observacao visual estruturada para verificar".

Sem separar esses tipos, o sistema bloqueia por suspeita e deixa passar erro quando a regex nao reconhece a forma.

### 4.2 O QG tenta validar conteudo visual sem fonte visual verificavel

O Context Engine nao fornece ao QG uma lista de textos/elementos observados nas imagens.

Consequencia:

- Se o modelo cita algo visto no print, o QG nao consegue confirmar.
- Se o QG aceita porque "parece Protheus" ou porque a resposta fala em print, ele estaria usando a resposta como prova.
- Se bloqueia, gera falso positivo operacionalmente frustrante.

A solucao nao deve ser adicionar excecoes para `CALLAPP`, `FINA050`, `INCLUIR` ou `FWWHEN`.

A solucao deve ser uma fonte visual rastreavel no manifesto.

### 4.3 Regex de identificadores e ampla demais

O padrao atual captura:

- rotinas reais: `MATA120`, `FINA050`, `OM200PES`;
- parametros reais: `MV_PESOCAR`;
- arquivos/funcoes: `PGCA010.PRW`, `CALLAPP`;
- mas tambem termos comuns de tela: `INCLUIR`, possivelmente `ALTERAR`, `VISUALIZAR`, `CONSULTAR`.

Sem classificar o tipo de identificador, todo termo vira risco tecnico equivalente.

### 4.4 Janelas textuais nao entendem negacao

O caso #036726 mostra a fragilidade:

- A resposta dizia "nao ha no historico mencao a OM200PES".
- A janela ao redor de `OM200PES` tinha "historico" e "ponto de entrada".
- A regra interpretou como atribuicao indevida ao historico.

Janelas textuais simples nao diferenciam bem:

- "o historico mostra X";
- "o historico nao mostra X";
- "X veio da pesquisa, nao do historico".

### 4.5 Contagem operacional depende de superficie linguistica

A regra pega parte dos casos:

- "foi feito 3 vezes";
- "encaminhado 3 vezes".

Mas nao pega:

- "acionada tres vezes";
- "vista pela Fabrica tres vezes";
- "a Fabrica ja analisou tres vezes";
- "retornou para desenvolvimento por tres ocasioes".

Tambem nao ha contagem normalizada dos eventos operacionais ja extraidos pelo Context Engine.

### 4.6 Severidade media demais causa comportamento binario

Varias regras usam severidade `media`.

Na pratica, qualquer falha media:

- gera retry se ainda nao houve retry;
- pode levar a revisao necessaria se o codigo estiver no set critico;
- pode bloquear uma resposta por estilo quando combinada com outro falso positivo.

O QG precisa diferenciar:

- `block`: nao apresentar resposta;
- `retry`: tentar corrigir linguagem/rastreabilidade;
- `warn`: apresentar com alerta/auditoria;
- `review`: apresentar mensagem de revisao por evidencia insuficiente, nao por erro comprovado.

## 5. Proposta minima

### 5.1 Separar decisao em categorias

Manter `falhas`, mas adicionar classificacao de decisao por item:

- `BLOCK_OBJECTIVE`: erro comprovado contra evidencia estruturada.
- `RETRYABLE_STYLE_OR_COMPLETENESS`: formato, genericidade, falta de acao, evidencia visual generica.
- `REVIEW_INSUFFICIENT_EVIDENCE`: o QG nao tem fonte suficiente para confirmar a afirmacao.
- `WARN_SEMANTIC_SUSPICION`: suspeita baseada em janela textual/regex, sem contradicao objetiva.

Exemplos:

- `INTERNAL_IDS_USED_AS_EVIDENCE`: `BLOCK_OBJECTIVE`.
- `UNSUPPORTED_OPERATIONAL_COUNT` quando numero e historico estruturado contradizem: `BLOCK_OBJECTIVE`.
- `UNTRACEABLE_TECHNICAL_REFERENCE` para termo citado como causa sem origem em texto/pesquisa/dossie: `BLOCK_OBJECTIVE`.
- `UNTRACEABLE_TECHNICAL_REFERENCE` para termo dito como "print mostra", mas sem observacao visual no manifesto: `REVIEW_INSUFFICIENT_EVIDENCE`.
- `ROBOTIC_TEMPLATE_RESPONSE`: `RETRYABLE_STYLE_OR_COMPLETENESS`, nunca bloqueio final sozinho.
- `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE` quando ha negacao clara: `WARN_SEMANTIC_SUSPICION` ou sem falha.

### 5.2 Disponibilizar observacoes visuais rastreaveis sem nova chamada de IA

Restricao: nao adicionar chamadas de IA.

Proposta:

1. Durante a primeira resposta multimodal, exigir do provider um bloco estruturado curto de observacoes visuais antes/fora da resposta final, por exemplo:

```json
{
  "observacoesVisuais": [
    {
      "anexoId": "id",
      "nome": "imagem.png",
      "textoVisivel": ["Modo edicao nao respeitado", "% Rateio", "INCLUIR"],
      "campos": ["Perc Rateio"],
      "valores": ["105.6"],
      "limite": "observacao visual feita pelo provider na mesma chamada"
    }
  ],
  "resposta": "texto final ao analista"
}
```

2. Se for arriscado mudar o formato final de chat, incluir no prompt um delimitador interno:

```text
<<<OBSERVACOES_VISUAIS_AUDITORIA>>>
...
<<<FIM_OBSERVACOES_VISUAIS_AUDITORIA>>>
```

3. O `investigacao-service` extrai esse bloco antes de salvar a resposta final ao usuario.

4. O manifesto da execucao passa a incluir `observacoesVisuais`.

5. O QG usa apenas esse bloco estruturado, nao a resposta final, como fonte visual rastreavel.

Isso nao adiciona chamada de IA; apenas reaproveita a chamada multimodal ja existente e torna auditavel parte do que o modelo viu.

Risco:

- A observacao visual ainda e produzida pelo modelo, portanto nao e OCR deterministico.
- Mas e independente da resposta final e fica preservada para auditoria.
- Deve ser tratada como "observacao visual do provider", nao como verdade absoluta.

Mitigacao:

- Campos do tipo `confiancaVisual`: `alta`, `media`, `baixa`.
- QG so usa como base para permitir rastreabilidade, nao para confirmar causa.
- Causa continua exigindo ponte com historico/log/fonte/pesquisa.

### 5.3 Normalizar eventos operacionais

O Context Engine ja coleta acoes operacionais em `quadroInvestigativo`:

- reuniao solicitada/realizada;
- encaminhamento Fabrica/terceiro;
- correcao aplicada;
- validacao pendente;
- pendencia tecnica.

Proposta minima:

- Expor tambem uma lista normalizada `eventosOperacionais` com:
  - `tipo`;
  - `status`;
  - `data`;
  - `origem`;
  - `evidencia`;
  - `contadorPorTipo`.

O QG deve validar contagens contra essa lista, nao contra regex do historico inteiro.

Tambem deve normalizar numeros por extenso basicos:

- uma/um, duas/dois, tres, quatro, cinco.

### 5.4 Tipar identificadores tecnicos

Substituir uma unica extracao ampla por tipos:

- `PARAMETRO`: `MV_*`.
- `ROTINA_PROTHEUS`: prefixos conhecidos com numero ou padrao de rotina (`MATA120`, `FINA050`, `OM200PES`, `PGCA010`).
- `ARQUIVO_FONTE`: `.PRW`, `.TLPP`, `.CH`, `.INI`.
- `FUNCAO_CUSTOM`: `U_*` ou nomes com underscore tecnico.
- `MODULO`: `SIGA*`.
- `TABELA_CAMPO`: `SX3`, `SF1`, `SD1`, `B1_PESO`.
- `UI_ACAO`: `INCLUIR`, `ALTERAR`, `VISUALIZAR`, `CONSULTAR`, `EXCLUIR`.
- `TERMO_COMUM`: demais maiusculas sem assinatura tecnica.

Regras:

- `UI_ACAO` nao deve disparar rastreabilidade tecnica critica.
- Pode ser usado como evidencia visual se vier de observacao visual estruturada.
- `ROTINA_PROTHEUS`, `PARAMETRO`, `FUNCAO_CUSTOM` e `ARQUIVO_FONTE` continuam protegidos.

### 5.5 Melhorar negacao em referencias externas

Antes de disparar `EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE`, detectar padroes de negacao/limite na mesma janela:

- "nao aparece no historico";
- "nao ha no historico";
- "isso veio da pesquisa";
- "apenas como contexto";
- "nao e evidencia do ambiente";
- "nao comprova";
- "nao da para dizer que".

Se houver negacao clara, nao bloquear.

### 5.6 Separar bloqueio de alerta

Proposta de decisao final:

- Se houver `BLOCK_OBJECTIVE`: retry uma vez; se persistir, `revisao_necessaria_quality_gate`.
- Se houver apenas `RETRYABLE_STYLE_OR_COMPLETENESS`: retry; se persistir, permitir com `concluido_com_alerta_quality_gate`, exceto se a resposta ficar inutil.
- Se houver `REVIEW_INSUFFICIENT_EVIDENCE`: nao chamar a resposta de "rejeitada por erro"; apresentar revisao necessaria por falta de rastreabilidade, preservando resposta em auditoria.
- Se houver apenas `WARN_SEMANTIC_SUSPICION`: concluir com alerta auditavel, nao bloquear.

## 6. Riscos da proposta

### Risco 1 - Observacao visual ainda pode errar

Mitigacao:

- Nao usar observacao visual como causa confirmada.
- Usar apenas para rastrear que determinado texto/campo foi observado.
- Manter necessidade de ponte causal.

### Risco 2 - Estrutura no prompt pode piorar fluidez da resposta

Mitigacao:

- Extrair bloco interno e remover da resposta final.
- Testar com respostas reais e rejeitadas.

### Risco 3 - Tipagem de identificadores pode deixar passar termo real raro

Mitigacao:

- Termos nao tipados viram `WARN_SEMANTIC_SUSPICION`, nao aprovacao silenciosa.
- Bloqueio objetivo permanece para termos apresentados como causa sem fonte.

### Risco 4 - Mais estados aumentam complexidade

Mitigacao:

- Nao reconstruir arquitetura.
- Manter interface atual, adicionando `decisionKind`/`categoriaDecisao` por falha.
- Preservar compatibilidade com `falhas[]`.

## 7. Plano de validacao

### Testes determinísticos

1. #035988 - preservacao:
   - referencia externa como fato interno reprova;
   - `aud-msg-*` reprova;
   - hipotese sem origem como causa reprova;
   - referencia externa rotulada corretamente passa.

2. #036475 - visual:
   - imagem enviada sem observacao visual + resposta cita `CALLAPP` como "print mostra": revisao por evidencia visual nao verificavel, nao erro comprovado;
   - observacao visual estruturada contendo `CALLAPP`: passa rastreabilidade, mas nao permite causa sem ponte;
   - `FINA050` incidental com limite causal passa;
   - `FINA050` promovido a causa sem ponte reprova.

3. #036726 - pesquisa externa:
   - "OM200PES veio da pesquisa externa, nao aparece no historico": passa;
   - "historico mostra OM200PES": reprova.

4. #036596 - UI e contagem:
   - `INCLUIR` como titulo/botao de tela nao vira identificador tecnico critico;
   - `MATA100 ou similar` como hipotese passa;
   - `MATA100` como causa sem origem reprova;
   - "Fabrica acionada tres vezes" com apenas um evento executado reprova;
   - "Fabrica solicitada, em andamento" passa.

### Homologacao real

Reexecutar os quatro chamados:

- #036475
- #035988
- #036726
- #036596

Critérios:

- minimo 85/100 em qualidade investigativa;
- sem bloqueio indevido;
- sem erro critico factual;
- #035988 nao pode regredir;
- respostas rejeitadas devem ser preservadas quando houver revisao.

### Metricas a registrar

- status final;
- provider/modelo efetivo;
- falhas QG com `decisionKind`;
- tokens/latencia/retries;
- observacoes visuais extraidas;
- diferenca entre resposta final e resposta rejeitada quando houver.

## 8. Conclusao

O QG evoluiu e ja protege pontos importantes, especialmente no #035988. O problema atual nao e falta de mais regex; e falta de separacao entre prova, suspeita e impossibilidade de verificacao.

A menor evolucao estrutural recomendada e:

1. adicionar decisao por categoria nas falhas do QG;
2. tornar observacoes visuais rastreaveis no manifesto usando a mesma chamada multimodal ja existente;
3. tipar identificadores tecnicos;
4. validar contagens contra eventos operacionais normalizados;
5. tratar negacao/limite explicito antes de bloquear referencia externa.

Sem isso, o IA Service continuara oscilando entre dois extremos: inventar porque a IA viu algo que o QG nao consegue auditar, ou bloquear conclusoes legitimas porque o QG so enxerga texto e regex.
