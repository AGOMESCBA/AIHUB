# IA Service — correção após a homologação real ADVPL

Correções e regressão **locais**, concluídas em 18/10/2026. Nenhuma nova chamada paga. Não constitui aprovação de nova homologação real nem autorização para habilitar a geração no servidor.

## Causa raiz comprovada — teste A

O pedido efetivamente gravado alegava que `ZCHVldUsr` executava `MsSeek` com `cUser` vazio por ausência de proteção. O fonte real contradiz a alegação: `If !Empty(cUser)` envolve a seleção da área e a busca; vazio não entra nesse bloco.

A resposta real afirmou que a verificação “realmente não está sendo feita antes da chamada”, embora seu próprio ORIGINAL contivesse a guarda. A evidência observável é uma interpretação incompatível com o fluxo externo do código. Não há acesso ao raciocínio interno do modelo para explicar psicologicamente por que ele ignorou a condição; não atribuímos a falha a um mecanismo interno não observado.

O manifesto da tentativa vencedora registra **100% do fonte**. Portanto, não há evidência de que a falha se explique por falta desse trecho no contexto do modelo que respondeu. Os pedidos exatos, respostas, manifesto e metadados estão em `tmp/fontes-advpl-real-1792352606794/resultado.json`; o log confirma o fallback efetivamente utilizado. O harness não gravou os corpos completos serializados de system/user prompt: preservou hashes dos módulos e tamanhos dos prompts (42.447 caracteres em A; 42.648 em B). Foram examinadas as instruções de geração e de verificação disponíveis e os pedidos originais, mas não é possível afirmar uma reconstrução byte a byte do payload completo enviado naquela execução.

O Quality Gate aprovou A sem falhas porque suas avaliações existentes verificavam integridade, proveniência e organização da resposta, mas não recebiam o código original integral para confrontar essa alegação com a guarda que controla a chamada. Reforçar somente o prompt não garantia essa relação no backend.

A primeira linha da âncora da IA era `        If !Empty(cUser)` — oito espaços. No original era `    If !Empty(cUser)` — quatro espaços. O restante também foi reindentado. A âncora exigida era exata, logo `ANCORA_AUSENTE` foi uma rejeição técnica correta. O substituto ainda omitia um EndIf, mas não foi essa a decisão que bloqueou a geração.

O verificador causal era chamado **depois** da aplicação ancorada. Assim, o erro de âncora impediu a análise semântica. Antes desta correção, nenhuma etapa local reconheceu a alegação falsa antes desse ponto. `ANCORA_AUSENTE` não foi uma validação causal bem-sucedida.

## Causa raiz comprovada — teste B

A regra anterior impedia a busca vazia, mas inicializava `lRet := .T.` e não atribuía falso ao caminho vazio. O pedido solicitava explicitamente uma **nova regra de retorno**, mantendo a proteção e os demais comportamentos.

As únicas linhas adicionadas foram:

```advpl
    Else
        lRet := .F. // Adicionando a nova regra
```

O verificador respondeu `status: contradicao` e `novaRegraSolicitada: false`. Sua demonstração alegou que a proposta não atendia à nova regra porque a lógica anterior já impedia MsSeek e não alterava lRet para vazio. Essa conclusão é incorreta: a ausência dessa atribuição no caminho vazio é justamente a diferença solicitada, e o novo Else a implementa. Proteger uma chamada e determinar o resultado booleano são efeitos diferentes.

O serviço anterior retornou inconclusiva porque a citação vinha com escapes literais e a afirmação não correspondia literalmente ao diagnóstico. Isso apenas impediu um bloqueio falso; não demonstrou a consistência da correção. O arquivo foi tecnicamente correto, mas a conclusão causal continuou sem sustentação.

## Correções implementadas

- Uma checagem local compartilhada extrai fluxo explícito do fonte, sem nomes fixos de rotina, variável ou chamada. Para uma alegação afirmativa de busca vazia, examina o bloco `If !Empty(variavel)` que envolve a chamada, a ausência da mesma chamada fora da guarda e a ausência de mutação explícita da variável local no corpo analisado. Retorna trecho e demonstração do caminho que contradiz a alegação.
- O Quality Gate recebe apenas fontes integrais selecionados no contexto da empresa/atendimento. Uma contradição local demonstrada gera `SOURCE_BEHAVIOR_CONTRADICTION`, classificada como bloqueio objetivo e falha de integridade. As quatro avaliações já existentes do gate, inclusive retries e resposta segura, recebem essas evidências.
- A geração também consulta a prova local antes de aplicar âncoras, após conferir identidade entre fonte analisado e arquivo em disco. Um chamador que informe Quality Gate aprovado não consegue contornar essa proteção.
- A prova positiva cobre uma alteração simples de retorno no caminho vazio: variável local, condição explícita, retorno booleano inicial verdadeiro, pedido de falso vinculado ao mesmo caso vazio e inclusão exata de Else/atribuição. Compara o arquivo completo, inclusive literais, e exige que todos os demais bytes/linhas da substituição permaneçam iguais. A validação estrutural e as âncoras exatas continuam obrigatórias antes de versionar.
- Quando essa diferença é comprovada localmente, B recebe `consistente / evidencia_local`, com explicação registrada na versão, sem depender do parecer causal que errou e sem criar nova chamada de IA.
- Fora do alcance da prova local, permanece o verificador existente. O rastreio diferencia `analise_ia` de `evidencia_local`; resposta sem prova de contradição recebe `CONTRADICAO_NAO_COMPROVADA`, enquanto falha técnica do verificador possui código próprio. `ANCORA_AUSENTE` e `ANCORA_DUPLICADA` continuam sendo falhas de aplicação, sem reclassificação semântica.
- As instruções de geração passam a exigir condição, efeito atual, efeito solicitado e diferença introduzida, incluindo blocos externos. Mantêm a orientação de não gerar alterações quando a regra já existe.
- Localização tolerante a espaços é usada apenas para encontrar o escopo da evidência; **não** flexibiliza ou corrige a âncora aplicada ao arquivo.

## Arquivos e funções modificados nesta etapa

Base: `apps/IA Service/`.

| Arquivo | Funções/alteração |
| --- | --- |
| `backend/services/evidencia-comportamento-fonte-service.js` — novo | `avaliarEvidencias`, `localizarRotina`, `guardasDaRotina`, `provaDeProtecao`, `provaDeNovaRegra` |
| `backend/services/validacao-estrutura-fonte-service.js` | Exporta `rotinasDeCodigo`, reutilizando o lexer existente |
| `backend/services/quality-gate-service.js` | `avaliarResposta`, `_classificarFalha`, conjunto `FALHAS_DE_INTEGRIDADE` |
| `backend/services/investigacao-service.js` | `_fontesIntegraisDoContexto`, `_gerarFontesCorrigidosDetalhado` e passagem de evidências nas avaliações de `processarTurno` |
| `backend/services/verificacao-consistencia-fonte-service.js` | `verificar`: prova local prioritária e códigos de rastreio |
| `backend/services/prompt-builder.js` | Instruções de evidência no `SYSTEM_PROMPT` |
| `tests/fixtures/homologacao-advpl-20261018.json` — novo | Fonte e respostas reais A/B preservados para replay sem rede |
| `tests/evidencia-comportamento-fonte.test.js` — novo | Provas locais e controles contra falsos positivos |
| `tests/fontes-integrais-alteracoes-ancoradas.test.js` | Replay integrado A/B, gate, geração direta e downloads |
| `tests/verificacao-consistencia-fonte.test.js` | Mantém os testes do contrato IA explicitamente fora da prova local ADVPL |

Os diffs anteriores de providers e humanização já estavam presentes no workspace; não foram modificados nesta etapa. Não houve alteração em SoftExpert, credenciais, modelos, fallback ou dados permanentes. O IACadUsr.prw original manteve o SHA-256 `e2bac0b8f374293632ebc331f913a2cb473f24c803c4ef26cd7f91118ce82978`. `SVC_ALLOW_FONTE_CORRIGIDO` continua desabilitada por padrão, com ativação somente no ambiente dos testes locais.

## Evidências antes/depois e regressão

| Caso | Decisão comprovada pelos testes locais |
| --- | --- |
| Premissa falsa — resposta real A | Antes: gate aprovado e bloqueio por âncora. Depois: gate reprovado por `SOURCE_BEHAVIOR_CONTRADICTION`, citando guarda e caminho; nenhuma versão gerada. |
| Geração direta de A com gate informado como aprovado | Mesma contradição detectada antes da âncora; não cai em `ANCORA_AUSENTE`. |
| Alteração necessária — resposta real B | Prova local consistente, gate aprovado, estrutura preservada, versão e download gerados. O verificador IA é configurado nos testes com a resposta real errada, mas não é chamado para substituir a prova local. |
| Âncora ausente sem prova local | Rejeição por `ANCORA_AUSENTE`; não recebe parecer consistente. |
| Âncora ambígua | Rejeição por `ANCORA_DUPLICADA`; não recebe parecer consistente. |
| Contradição causal real | Trecho do original demonstra que variável vazia não alcança a chamada; falha de integridade no gate. |
| Correção válida sem contradição | O novo caminho vazio muda verdadeiro para falso; demais linhas permanecem idênticas, inclusive literais. |
| Original/download | Comparação de buffers confirma original intacto e corrigido igual ao original mais âncoras. HTTP 200 autenticado, 401 sem autenticação e 404 para outra empresa. |
| Nomes diferentes | Mesmas provas com outras rotinas, variáveis, chamadas e extensão TLPP; sem regra para ZCHVldUsr. |
| Controles contra falsa prova | Chamada fora da guarda, mutação da variável, variável Private, pré-processador, alteração de outro caminho/contexto/literal e arquivo-alvo ambíguo não recebem prova positiva indevida. Pedido sobre valor não vazio não é confundido com pedido sobre vazio. |
| Diagnóstico que corrige a premissa | Citação da alegação do analista e negação explícita não são tratadas automaticamente como afirmação falsa da IA. |

Resultado final: **48 testes/entradas aprovados, zero falhas, código de saída 0**, em 15 arquivos de testes. Arquivos legados executam cenários internos e aparecem como uma entrada no runner. Log completo: `tmp/fontes-evidencias-regressao.log`.

Comando executado: `node --test` com estes arquivos de `apps/IA Service/tests/`:

```text
evidencia-comportamento-fonte.test.js
validacao-estrutura-fonte.test.js
verificacao-consistencia-fonte.test.js
fontes-integrais-alteracoes-ancoradas.test.js
fontes-upload-humanizacao.test.js
fase1-fontes-corrigidos.test.js
fase1-fase2-pos-auditoria.test.js
etapa2-extracao-e-versionamento.test.js
etapa2-contexto-pesquisa-quality.test.js
proveniencia-referencias-quality-gate.test.js
quality-gate-homologacao-investigativa.test.js
fase3-seguranca-pre-publicacao.test.js
estabilizacao-casos-reais-2026-10.test.js
etapa4b-disciplina-investigativa.test.js
etapa4b1-fechamento-release.test.js
```

## Limitações e condição para próxima homologação

- A checagem local prova classes pequenas de fluxo ADVPL/TLPP, não a semântica completa de qualquer programa. Exige identificadores e afirmações explícitas; não interpreta linguagem natural livre como prova formal. Formulações diferentes, condições compostas, macros, pré-processamento e contratos externos podem permanecer fora de seu alcance.
- A prova positiva é deliberadamente restrita à mudança simples descrita acima. Outras correções legítimas seguem o mecanismo existente, sem rejeição automática por não corresponderem a esse padrão. Não se afirma que o verificador IA deixou de poder errar nesses outros casos.
- As demais linguagens mantêm âncoras, integridade, estrutura quando existente e verificação de consistência já suportadas; não recebem um analisador ADVPL aplicado artificialmente.
- O replay demonstra que as respostas conhecidas agora recebem o motivo correto. Não demonstra que o modelo produzirá uma resposta nova correta, nem que uma nova homologação real já passou.
- O payload completo dos prompts antigos não foi preservado pelo harness. O relatório distingue o que está efetivamente gravado de qualquer reconstrução posterior.
- Compilação, tipos, includes e execução funcional permanecem sujeitos ao ambiente Protheus de homologação. Todo arquivo continua sendo correção proposta para validação.

Nenhuma chamada paga, commit, push, pacote ou deploy nesta etapa. **Aguardar autorização antes de nova homologação real.**
