# IA Service — geração de fontes corrigidos

Validação local em 18/10/2026. Alterações implementadas no workspace, sem commit, push, deploy, chamadas pagas ou ativação de `SVC_ALLOW_FONTE_CORRIGIDO` no servidor.

## 1. Causas identificadas

- A aplicação ancorada já preservava os bytes fora das alterações, mas não verificava a estrutura do código resultante. Uma âncora exata podia, portanto, substituir uma função por outra sem declarações, fechamentos ou restauração de contexto.
- O verificador bloqueava uma proposta quando a IA afirmava contradição e sua citação existia no original. Essa conferência demonstrava a origem da citação, mas não a contradição semântica. A proteção de uma busca contra vazio podia ser confundida com uma regra de rejeição de vazio.
- O contexto do verificador limitava-se a 30 linhas em torno da alteração, podendo excluir declarações e condições relevantes da mesma rotina.
- O prompt já orientava a conferir premissas, mas precisava explicitar a leitura da rotina completa, a preservação do contexto ampliado da âncora e a diferença entre proteção existente e nova regra solicitada.
- O cliente acrescentava providers padrão após a ordem recebida. O resolvedor também substituía fallback vazio por uma lista padrão. Isso permitia tentativas fora da ordem cadastrada.

## 2. Correções implementadas

- Instruções de geração reforçadas para verificar o comportamento atual, demonstrar o caminho afetado, produzir alteração mínima e preservar declarações, condições, retornos e restauração de contexto.
- Validação local do resultado ADVPL/TLPP antes da verificação por IA e do versionamento: aninhamento de If/EndIf, For/Next, Do Case/EndCase, While/EndDo, Begin Sequence/End Sequence e Try/EndTry; preservação de declarações, rotinas e quantidade de chamadas FWRestArea por rotina.
- Comentários, literais, continuações e corpos SQL/TEXT são tratados para evitar contagens superficiais. Funções auxiliares novas não são recusadas automaticamente. Diretivas condicionais e ambiguidades preexistentes produzem ressalvas em vez de presumir erro de compilação.
- Blocos ancorados sem fechamento, com marcadores duplicados ou conteúdo após o marcador final são identificados. Entradas CRLF são normalizadas antes da correspondência e reconstruídas com as quebras do original.
- O verificador recebe a rotina afetada completa quando seus limites são reconhecidos. Para bloquear, exige conclusão explícita de contradição, afirmação rastreável, trecho do contexto original, demonstração causal e ausência de nova regra legítima solicitada. Citação isolada, dúvida e resposta incompleta ficam inconclusivas.
- Motivos estruturais e demonstração da contradição aparecem nos avisos. A versão gerada registra ressalvas e é apresentada como correção proposta para validação, sem garantia de compilação.
- O cliente usa somente o primário e os fallbacks recebidos. Fallback vazio permanece vazio; ausência de configuração não cria automaticamente uma ordem de providers. Nenhum modelo ou credencial cadastrado foi alterado.
- Mantidos o fluxo de upload, análise integral, Quality Gate, humanização, versionamento e downloads internos/externos. A integração SoftExpert e os demais produtos não foram modificados.

## 3. Arquivos modificados

Todos os caminhos abaixo, exceto este relatório, são relativos a `apps/IA Service/`.

| Arquivo | Finalidade |
| --- | --- |
| `backend/services/prompt-builder.js` | Instruções de investigação e geração mínima |
| `backend/services/alteracao-ancorada-service.js` | Parsing, CRLF e integração da validação local |
| `backend/services/validacao-estrutura-fonte-service.js` (novo) | Verificação conservadora ADVPL/TLPP |
| `backend/services/verificacao-consistencia-fonte-service.js` | Contexto de rotina e prova causal de contradição |
| `backend/services/investigacao-service.js` | Integração, avisos e rastreabilidade da proposta |
| `backend/services/ai-provider-client.js` | Exclusão de providers acrescentados automaticamente |
| `backend/services/ai-config-service.js` | Preservação da ordem cadastrada, inclusive vazia |
| `tests/fontes-integrais-alteracoes-ancoradas.test.js` | Regressão integrada com o IACadUsr.prw real |
| `tests/validacao-estrutura-fonte.test.js` (novo) | Estrutura, declarações, restauração, outras linguagens e parsing |
| `tests/verificacao-consistencia-fonte.test.js` (novo) | Contradição, inconclusão, contexto e configuração |
| `tests/ai-provider-retry.test.js` | Providers com chaves fora da ordem não são chamados |

## 4. Testes executados

Resultado final: **código de saída 0, 76 testes/entradas aprovados, zero falhas, cancelamentos ou testes ignorados**. O total do runner inclui arquivos legados que executam vários cenários internamente. Log completo: `tmp/fontes-correcao-regressao.log`.

Comando: `node --test`, com os seguintes 16 arquivos de `apps/IA Service/tests/`:

```text
validacao-estrutura-fonte.test.js
verificacao-consistencia-fonte.test.js
fontes-integrais-alteracoes-ancoradas.test.js
fontes-upload-humanizacao.test.js
fase1-fontes-corrigidos.test.js
fase1-fase2-pos-auditoria.test.js
ai-provider-retry.test.js
humanizacao-respostas.test.js
humanizacao-preservacao-editorial.test.js
etapa2-extracao-e-versionamento.test.js
etapa2-contexto-pesquisa-quality.test.js
proveniencia-referencias-quality-gate.test.js
quality-gate-homologacao-investigativa.test.js
fase3-seguranca-pre-publicacao.test.js
sincronizacao-preferencia-platform.test.js
softexpert-contrato.test.js
```

Os cenários direcionados foram construídos sobre a função `ZCHVldUsr` do arquivo real `apps/IA Command/modules/protheus_whatsapp/advpl/IACadUsr.prw`, lido como fixture, sem alteração desse produto:

- **A — premissa falsa:** alegação de MsSeek sem proteção contra usuário vazio. A proposta desnecessária é bloqueada pelo verificador com a condição e seu caminho de execução como evidência; não por erro de âncora ou Quality Gate.
- **B — nova regra legítima:** manter a proteção da busca e retornar falso para usuário vazio. O arquivo completo é gerado e baixado com bytes exatamente iguais ao original mais a substituição esperada. Declarações, EndIf e FWRestArea permanecem.
- Variantes inválidas de B removendo EndIf, declaração ou FWRestArea são bloqueadas localmente pelo código de falha correspondente, sem chamar o verificador de IA.
- Downloads interno e externo autenticados retornam os bytes esperados; acesso sem autenticação e acesso por outra empresa são recusados. O download do original permanece byte a byte intacto após A e B.
- Também cobertos fonte grande integral, latin1/UTF-8, CRLF/LF, âncoras ausentes/duplicadas/conflitantes, resposta parcial/truncada, Quality Gate, humanização, outra linguagem (C#), indisponibilidade do verificador e flag de geração desativada.

Providers e autenticação são simulados nos testes de geração; upload, extração, SQLite temporário, contexto, Quality Gate, humanização, versionamento e rotas de download são exercitados localmente. Testes de transporte/fallback usam HTTP simulado. Não houve chamada paga nem operação contra SoftExpert real.

## 5. Limitações restantes

- Não houve homologação com respostas de providers reais. Os testes demonstram o contrato e as proteções locais; não medem a qualidade semântica dos modelos em produção.
- A demonstração causal continua sendo uma análise da IA. Os campos exigidos e a rastreabilidade reduzem falsos bloqueios, mas não constituem prova formal do comportamento de qualquer programa.
- A validação ADVPL/TLPP é conservadora e não resolve macros, includes, configuração de pré-processamento, tipos ou contratos externos. Trechos com diretivas condicionais ou ambiguidades estruturais preexistentes são sinalizados como inconclusivos. A preservação de FWRestArea verifica sua presença por rotina; não comprova todos os caminhos possíveis de execução.
- A remoção/renomeação/reordenação de rotinas existentes e a remoção de declarações são recusadas por preservação. Refatorações intencionais desse tipo exigem revisão específica.
- As demais linguagens mantêm as garantias genéricas de âncoras, integridade dos bytes e consistência; não recebem um compilador ou analisador estrutural específico nesta mudança.
- Compilação e testes funcionais no ambiente Protheus continuam obrigatórios para aceitar a proposta. A flag de geração permanece sob controle do servidor, desativada por padrão.
