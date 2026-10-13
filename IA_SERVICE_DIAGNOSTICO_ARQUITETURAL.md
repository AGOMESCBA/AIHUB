# IA Service - Diagnostico Arquitetural da Investigacao

Data: 2026-10-10

Escopo: analise arquitetural sem alteracao de codigo, providers, banco, importacao SoftExpert ou `repomix-output.xml`.

## Veredito executivo

A causa-raiz de nao estarmos conseguindo homologar nao e uma regra isolada do Quality Gate.

O IA Service ainda permite que a resposta final seja gerada a partir de um prompt textual amplo, onde historico, anexos, pesquisa externa, quadro investigativo, dossie e instrucoes de estilo competem no mesmo espaco. O sistema pede ao modelo que diferencie fato, evidencia externa, hipotese e causa, mas nao entrega ao modelo um contrato estruturado de alegacoes permitidas nem exige que cada afirmacao tecnica da resposta seja vinculada a uma origem antes da redacao final.

Na pratica:

1. O Context Engine organiza melhor as evidencias, mas ainda entrega essa organizacao como texto heuristico.
2. O Prompt Builder instrui o modelo a nao inventar, mas tambem incentiva uma resposta consultiva e acionavel, o que empurra o modelo a preencher lacunas tecnicas.
3. O Quality Gate tenta corrigir depois, usando regex, `includes`, janelas textuais e heuristicas semanticas parciais.
4. A orquestracao agora falha fechado quando reconhece `bloqueio_objetivo`, mas respostas ruins ainda podem ser aprovadas quando o QG nao reconhece o erro.
5. A homologacao fica instavel porque o provider/modelo efetivo muda por fallback.

Portanto, o problema principal esta antes do Quality Gate: a investigacao nao possui uma etapa intermediaria estruturada que transforme evidencias em um plano de resposta rastreavel, com afirmacoes permitidas, hipoteses permitidas e lacunas obrigatorias. O QG esta sendo usado como corretor da investigacao, quando deveria ser apenas a ultima barreira de seguranca.

## Evidencias no codigo

### 1. Context Engine

Arquivo: `apps/IA Service/backend/services/context-engine.js`

O Context Engine ja evoluiu bastante. Ele monta `quadroInvestigativo` com:

- `problemaPrincipal`;
- `dominioModuloProvavel`;
- `estadoOperacional`;
- `eventosOperacionais`;
- `evidencias`;
- `relacoesCausais`;
- `lacunasInformacao`;
- `acoesParaReduzirIncerteza`;
- `pesquisaExternaConsiderada`.

Isso aparece em `_montarQuadroInvestigativo`, onde as evidencias sao classificadas como `CENTRAL`, `OPERACIONAL`, `TECNICA_RELACIONADA`, `INCIDENTAL` ou `RUIDO`, e recebem texto como:

- `Vinculo causal nao demonstrado.`
- `Possivel vinculo com o problema principal; confirmar pela resposta e demais evidencias.`
- `Evidencia operacional; nao comprova causa tecnica por si so.`

O problema e que essa classificacao nao vira um contrato operacional rigido. Ela e formatada para o prompt por `_formatarQuadroInvestigativo` como texto:

`Use este quadro como organizacao das evidencias, nao como conclusao incontestavel...`

Depois, o prompt final inclui:

- manifesto textual;
- quadro textual;
- historico selecionado;
- anexos;
- pesquisa externa;
- instrucao final em linguagem natural.

Impacto: o modelo recebe bons sinais, mas continua livre para transformar uma trilha externa ou hipotese plausivel em proximo passo tecnico concreto. O sistema so pede disciplina; ele nao limita a resposta a um conjunto estruturado de fatos e hipoteses autorizadas.

Falha demonstrada:

- No #036726, o historico apontava regressao apos atualizacao e possivel fonte faltando compilacao. A resposta aprovada trouxe `OM200PES`, `MV_PESOCAR`, `B1_PESO` e `B1_PESBRU`, sem lastro suficiente no chamado.
- No #036596, a resposta citou `D1_Rateio`, `D1_Rateio_Nota`, `PERC_RATEIO_AUTO` e documentacao de RH/GPE, apesar de os prints sustentarem apenas erro de modo de edicao/% rateio e lacuna de fonte/gatilho/PE.

Conclusao sobre o Context Engine:

Ele separa melhor as evidencias, mas nao separa ainda as afirmacoes que a IA esta autorizada a fazer. Falta uma camada estruturada entre "evidencia selecionada" e "resposta final".

### 2. Prompt Builder

Arquivo: `apps/IA Service/backend/services/prompt-builder.js`

O Prompt Builder tem instrucoes corretas:

- regra de ouro contra invencao;
- diferenca entre fato, hipotese, causa provavel e conclusao confirmada;
- rastreabilidade tecnica;
- proibicao de expor IDs internos;
- cuidado com pesquisa externa;
- respeito ao estado operacional.

Exemplos de instrucoes existentes:

- "Nunca preencha lacunas de informacao com suposicoes apresentadas como fato."
- "Quando citar nomes especificos de rotina, parametro, modulo, erro, tabela, campo, fonte oficial ou documento externo, deixe claro de onde veio a referencia."
- "Referencia encontrada em pesquisa externa pode enriquecer a investigacao, mas nao vira fato do atendimento nem causa comprovada sem ponte causal."

O problema e que o mesmo prompt tambem exige:

- resposta consultiva;
- primeiro ajuste/teste concreto;
- nao terminar em "analisar melhor";
- atacar a evidencia mais especifica;
- propor acao acionavel.

Essas instrucoes fazem sentido para uma IA consultiva, mas quando a evidencia e insuficiente elas aumentam a pressao para o modelo "achar" uma trilha tecnica plausivel.

Impacto:

- O modelo tenta ser util em vez de ser estritamente rastreavel.
- Quando nao existe fonte/log/stack, ele usa conhecimento geral de Protheus/TOTVS para preencher o vazio.
- O texto do prompt diz para rotular como hipotese, mas nao exige uma saida intermediaria com origem obrigatoria por afirmacao.

Conclusao sobre o Prompt Builder:

O prompt esta bom como orientacao humana, mas insuficiente como mecanismo de controle. Ele depende de obediencia do modelo, nao de estrutura verificavel.

### 3. Quality Gate

Arquivo: `apps/IA Service/backend/services/quality-gate-service.js`

O Quality Gate melhorou no fail-closed e na classificacao de decisoes:

- `bloqueio_objetivo`;
- `suspeita_semantica`;
- `evidencia_insuficiente`;
- `correcao_estilo`.

Mas a validacao continua predominantemente textual. Exemplos no codigo:

- `_extrairIdentificadoresTecnicosDetalhados` usa regex para encontrar tokens como `MV_`, `SIGA`, `MATA`, `FINA`, codigos maiusculos etc.
- `_avaliarRastreabilidadeTecnica` usa `internoNorm.includes(idNorm)`, `pesquisaNorm.includes(idNorm)`, janelas ao redor do termo e heuristicas de hipotese.
- `_citaIdsInternosComoEvidencia`, `_descartaCustomizacaoSemBase`, `_avaliarContagemOperacionalFalsa`, `_respostaPromoveEvidenciaIncidental` e outras regras trabalham com padroes de texto.
- `investigative-discipline-service.js` tambem opera por sinais textuais e fast paths, nao por uma AST de afirmacoes da resposta.

Isso explica os falsos negativos:

- `aud-msg-036596-*` passou em uma resposta real porque a variacao com caracteres especiais/formatacao nao foi capturada como ID interno.
- `OM200PES`, `MV_PESOCAR`, `B1_PESO`, `B1_PESBRU` passaram no #036726 porque apareceram como hipoteses/acoes tecnicas plausiveis, nao como uma afirmacao factual simples que a regex conseguiu bloquear.

E explica os falsos positivos:

- referencias hipoteticas como `MATA121_MAIL001` precisaram de calibracao manual;
- `SIGAMAT` no PDF controlado ainda gerou bloqueio;
- termos visuais exigiram tratamento especial por observacao visual estruturada.

Conclusao sobre o Quality Gate:

O QG esta tentando inferir a funcao discursiva de termos tecnicos depois que a resposta ja foi escrita. Esse e o ponto estrutural fraco. Ele nao valida contra uma lista de afirmacoes declaradas pelo proprio pipeline; ele tenta reconstruir a intencao do texto por heuristica.

### 4. Orquestracao

Arquivo: `apps/IA Service/backend/services/investigacao-service.js`

A orquestracao atual:

1. monta contexto;
2. carrega imagens;
3. chama provider;
4. extrai observacoes visuais;
5. avalia QG;
6. se `deveRetry`, reconstrui contexto ou reprocessa com instrucao corretiva;
7. se ainda houver falha, calcula status final.

A Etapa 1.5 corrigiu o fail-closed:

- `_temBloqueioObjetivoQualityGate`;
- `_calcularRevisaoNecessariaQualityGate`;
- `_statusFinalQualityGate`.

Agora, quando o QG reconhece `bloqueio_objetivo` apos retry, o status final vira `revisao_necessaria_quality_gate`.

O problema remanescente nao e mais somente fail-open. E cobertura: se o QG nao reconhecer a resposta como bloqueio objetivo, a resposta ainda pode sair como `concluido` ou `concluido_com_alerta_quality_gate`.

Falha demonstrada:

- #036726 saiu `concluido`, embora a auditoria humana tenha encontrado especulacao tecnica.
- #036596 saiu `concluido_com_alerta_quality_gate`, com apenas `ROBOTIC_TEMPLATE_RESPONSE`, embora houvesse IDs internos e referencias tecnicas sem origem.

Conclusao sobre a orquestracao:

O fail-closed esta melhor. O problema e que a decisao depende do QG conseguir enxergar o erro. Quando o erro nao e detectado, a orquestracao nao tem outra camada estruturada para impedir a saida.

### 5. Providers e homologacao

Arquivo: `apps/IA Service/backend/services/ai-provider-client.js`

O client normaliza ordem de providers e usa fallback por configuracao:

- `_normalizarOrdem`;
- `cfg.modelos[provedor] || opts.model || PROVIDER_CONFIGS[provedor].model`;
- pula providers sem suporte a imagem quando ha imagens;
- registra `tentativas` com provider/model/status.

Isso e correto operacionalmente, mas atrapalha homologacao de qualidade quando nao controlado.

Nas execucoes reais recentes, a configuracao solicitada foi OpenAI/gpt-4o-mini, mas as respostas efetivas vieram de Claude, DeepSeek e Groq/openai-gpt-oss-20b. Assim, nao e possivel afirmar que diferencas entre rodadas vieram apenas das alteracoes no codigo.

Conclusao sobre homologacao:

Enquanto provider/modelo variar, a homologacao mede uma mistura de codigo, prompt, comportamento de fallback e capacidade do modelo. Para validar arquitetura investigativa, precisamos de rodada com modelo fixo ou, no minimo, resultados separados por provider.

## Causa-raiz demonstrada

A causa-raiz e:

O IA Service nao possui uma etapa estruturada de planejamento/rastreabilidade da resposta antes da geracao final. Ele possui evidencias estruturadas no manifesto e no Quadro Investigativo, mas a resposta ainda e produzida diretamente por um LLM a partir de um prompt textual amplo. Depois, o Quality Gate tenta verificar a resposta ja escrita usando heuristicas textuais. Isso permite que o modelo introduza referencias tecnicas plausiveis sem vinculo comprovado com o chamado e faz o QG alternar entre falsos positivos e falsos negativos.

Em outras palavras:

- O Context Engine organiza evidencias.
- O Prompt Builder pede disciplina.
- O modelo redige livremente.
- O Quality Gate tenta descobrir se a redacao foi disciplinada.

O que falta:

- Uma representacao estruturada das alegacoes que podem aparecer na resposta.
- Um vinculo obrigatorio entre cada termo tecnico especifico e sua origem.
- Uma regra de geracao que limite a resposta ao que foi declarado como fato, hipotese permitida ou lacuna.

## Falhas por componente e impacto

### Context Engine

Falha:

- Classifica evidencias, mas nao produz uma lista estruturada de afirmacoes autorizadas.
- Pesquisa externa entra como apoio textual, nao como objeto com "pode citar como externo, nao como causa".
- Lacunas existem no quadro, mas nao impedem o modelo de propor trilhas tecnicas nao sustentadas.

Impacto:

- O modelo interpreta relacoes provaveis demais.
- Evidencia incidental pode virar causa se o texto parecer convincente.
- Hipoteses tecnicas surgem sem origem rastreavel.

### Prompt Builder

Falha:

- Usa instrucoes normativas em linguagem natural para controlar comportamento.
- Mistura "nao invente" com "seja acionavel e consultivo".
- Nao exige formato intermediario verificavel.

Impacto:

- Em caso sem evidencia suficiente, o modelo tende a completar lacunas com conhecimento geral.
- Referencias externas e conhecimento do modelo entram como trilhas principais.

### Quality Gate

Falha:

- Valida o texto final por regex, `includes`, janelas e heuristicas.
- Nao possui uma tabela confiavel de `termo -> origem -> permissao de uso`.
- Tenta inferir se algo e fato, hipotese, exemplo ou causa pelo entorno textual.

Impacto:

- Falsos positivos: bloqueia hipotese legitima ou termo observado.
- Falsos negativos: deixa passar especulacao tecnicamente sofisticada.
- Crescimento de regras pontuais reduz previsibilidade.

### Orquestracao

Falha:

- Fail-closed agora esta melhor, mas so atua se o QG detectar bloqueio.
- Retry tenta corrigir a resposta, mas ainda pede ao modelo que reescreva em texto livre.
- Reescrita final pode melhorar estilo e piorar rastreabilidade, porque nao ha plano estruturado congelado.

Impacto:

- Respostas ruins podem sair aprovadas se a heuristica nao capturar a falha.
- A auditoria humana continua encontrando erros apos QG aprovado.

### Homologacao

Falha:

- Provider/modelo variam por fallback.
- Chamados conhecidos passaram a dirigir ajuste fino.
- Testes automatizados provam regressao de regras, mas nao qualidade consultiva geral.

Impacto:

- Nao se isola causa entre codigo, modelo e prompt.
- Risco de overfitting nos quatro chamados.

## Proposta de solucao estrutural minima

Nao recomendo reconstruir a arquitetura. A correcao minima e inserir uma etapa estruturada entre Context Engine/Prompt Builder e resposta final, reutilizando o manifesto e o Quadro Investigativo.

Nome sugerido: Plano de Resposta Rastreavel.

### 1. Gerar um plano estruturado a partir do manifesto

Antes da resposta final, o sistema deve montar um objeto deterministico, sem chamada adicional de IA, com:

```json
{
  "fatosPermitidos": [
    {
      "id": "fact-1",
      "texto": "Cliente relata que apos aprovacao via workflow o pedido continua em aprovacao.",
      "origem": "historico",
      "referencia": "mensagem visivel/data",
      "confianca": "observado"
    }
  ],
  "hipotesesPermitidas": [
    {
      "id": "hyp-1",
      "texto": "Pode haver regressao relacionada a fonte pendente de compilacao.",
      "origem": "historico",
      "evidenciaBase": ["mensagem sobre compilacao faltante"],
      "grau": "hipotese_a_validar"
    }
  ],
  "referenciasExternasPermitidas": [
    {
      "termo": "OM200PES",
      "origem": "pesquisa_externa",
      "usoPermitido": "contexto_externo_apenas",
      "naoPodeSer": ["fato_do_chamado", "causa", "primeiro_passo"]
    }
  ],
  "lacunasObrigatorias": [
    "Fonte/gatilho/PE que atua no campo de % Rateio nao foi anexado."
  ],
  "proximoPassoPermitido": {
    "tipo": "coletar_evidencia",
    "descricao": "Solicitar fonte/gatilho/ponto de entrada ou log/stack do erro de atribuicao.",
    "base": ["erro visual de modo edicao", "ausencia de fonte/log"]
  },
  "termosTecnicosPermitidos": [
    {
      "termo": "PGCA010.PRW",
      "origem": "observacao_visual",
      "usoPermitido": "contexto_de_execucao",
      "causal": false
    }
  ]
}
```

Esse objeto pode ser construido por regras existentes:

- `quadroInvestigativo.evidencias`;
- `manifesto.selecionados`;
- `manifesto.observacoesVisuais`;
- `pesquisaExterna`;
- `eventosOperacionais`;
- `lacunasInformacao`.

Nao exige nova chamada de IA.

### 2. Mudar o prompt final para responder a partir do plano

O prompt deve dizer:

- Use apenas `fatosPermitidos` como fato.
- Use apenas `hipotesesPermitidas` como hipotese.
- Referencia externa so pode aparecer no papel marcado.
- Se um termo tecnico nao estiver em `termosTecnicosPermitidos`, nao cite; peca a evidencia que permitiria investigar.
- A proxima acao deve vir de `proximoPassoPermitido`.

Isso reduz a liberdade do modelo sem matar a utilidade consultiva.

### 3. Quality Gate passa a validar contra o plano

Em vez de tentar inferir tudo do manifesto bruto, o QG deve validar:

- todo termo tecnico citado esta em `termosTecnicosPermitidos`, `fatosPermitidos`, `hipotesesPermitidas` ou `referenciasExternasPermitidas`;
- se termo externo foi usado como causa, reprova;
- se termo permitido apenas como contexto virou proximo passo, reprova;
- se lacuna obrigatoria foi omitida e a resposta concluiu causa, reprova;
- se ha `bloqueio_objetivo`, fail-closed.

O QG continua existindo, mas deixa de ser o corretor principal da investigacao.

### 4. Separar avaliacao consultiva de seguranca

Manter dois resultados:

- `qualityGateSeguranca`: bloqueios objetivos verificaveis.
- `notaConsultiva`: avaliacao humana ou harness controlado com criterios de utilidade.

Assim nao declaramos homologacao porque "passou QG".

## Plano de implementacao por prioridade

### Prioridade 0 - Congelar ciclo de ajustes pontuais

Nao criar novas regex para chamados conhecidos enquanto nao houver o plano rastreavel.

Objetivo: evitar overfitting.

### Prioridade 1 - Plano de Resposta Rastreavel

Implementar builder deterministico usando manifesto/quadro:

- `fatosPermitidos`;
- `hipotesesPermitidas`;
- `termosTecnicosPermitidos`;
- `referenciasExternasPermitidas`;
- `lacunasObrigatorias`;
- `proximoPassoPermitido`.

Sem provider novo, sem IA adicional.

### Prioridade 2 - Prompt orientado ao plano

Alterar o prompt final para exigir resposta baseada no plano.

Regra principal:

- "Se nao esta no plano, nao cite como termo tecnico especifico; peca evidencia."

### Prioridade 3 - Quality Gate orientado ao plano

Adaptar o QG para comparar resposta contra o plano:

- termo tecnico citado sem permissao;
- uso acima do permitido;
- omissao de lacuna obrigatoria;
- conclusao sem fato suficiente;
- fail-closed por bloqueio objetivo.

### Prioridade 4 - Homologacao com modelo controlado

Rodar uma bateria inedita:

- 8 a 12 chamados nao usados no ajuste;
- pelo menos 2 com imagens;
- 2 com PDF/log/fonte;
- 2 com historico operacional complexo;
- 2 com evidencia insuficiente.

Separar resultados por provider/modelo. Se fallback ocorrer, marcar a rodada como nao comparavel para qualidade do modelo.

## Criterios objetivos de homologacao

### Criterios de seguranca

- 100% dos bloqueios objetivos persistentes apos retry terminam em `revisao_necessaria_quality_gate`.
- 0 exposicoes de IDs internos (`aud-msg`, UUID interno, id de anexo/execucao).
- 0 referencias externas apresentadas como fato interno do chamado.
- 0 evidencias incidentais promovidas a causa sem ponte causal.
- 0 recomendacoes para repetir acao operacional ja executada, salvo justificativa tecnica nova.

### Criterios de rastreabilidade

Para cada resposta homologada:

- todo termo tecnico especifico citado tem origem declarada;
- toda causa provavel tem evidencia interna associada;
- toda hipotese tem lacuna/proximo teste associado;
- pesquisa externa aparece como apoio, nao como causa, exceto quando houver ponte causal com evidencia interna.

### Criterios consultivos

Nota minima 85/100 em casos ineditos, com avaliacao humana:

- compreensao do problema;
- respeito ao estado atual;
- priorizacao das evidencias;
- controle de especulacao;
- utilidade do proximo passo;
- clareza sobre lacunas.

Erro critico reprova automaticamente:

- invencao tecnica apresentada como fato;
- mistura de dominio sem ponte causal;
- orientacao redundante frente ao historico;
- conclusao de resolucao sem validacao;
- omissao de evidencia central.

### Criterios de comparabilidade

- Rodadas de homologacao devem fixar provider/modelo.
- Se fallback ocorrer, registrar como rodada operacional valida, mas nao comparavel para medir melhoria de qualidade.
- Tokens, latencia e retries devem ser preservados por caso.

## Conclusao

A dificuldade de homologacao vem de uma arquitetura ainda centrada em prompt livre e correcao posterior. O sistema ja tem bons blocos: manifesto, Quadro Investigativo, observacoes visuais, pesquisa auditavel e fail-closed. O passo que falta e transformar esses blocos em um plano rastreavel de resposta antes da geracao final.

Enquanto a resposta nascer livre e o QG tentar inferir disciplina depois, continuaremos alternando entre:

- bloquear respostas boas por falsos positivos;
- liberar respostas ruins por falsos negativos;
- ajustar regras para chamados conhecidos sem ganhar robustez geral.

A solucao minima nao e mais uma regra no QG. E prevenir a invencao na origem: limitar a resposta a fatos, hipoteses, referencias externas e lacunas ja estruturadas pelo pipeline.
