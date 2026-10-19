# IA Service — resposta segura e cadeia positiva de fontes

Etapa concluída localmente em 18/10/2026. **Zero chamadas reais de IA, nenhuma repetição da homologação real A/B, nenhuma publicação ou ativação permanente.** Os replays existentes executados nos testes usam respostas fixas e provider simulado.

O bloqueador da R3 foi corrigido: proposta de fonte não aprovada deixa de ser apresentada como instrução aplicável. O caminho positivo também foi comprovado localmente, incluindo versionamento e download autenticado com bytes exatos. Isso não equivale a compilação ou homologação funcional no Protheus.

## Causa e mudança

Antes, `processarTurno` salvava/humanizava a resposta e atualizava o dossiê antes de validar a alteração de fonte. Ao reprovar fluxo, estrutura ou causalidade, o mecanismo acrescentava avisos, mas mantinha o conteúdo prescritivo na mensagem e nas seções técnicas. Assim, o arquivo podia estar bloqueado e o texto ainda recomendar a cópia manual do mesmo código.

Agora:

1. Uma proposta de fonte reserva o ID da mensagem com texto neutro, sem código ou instrução de aplicação. Isso mantém o vínculo exigido pela nova versão sem expor conteúdo ainda não aprovado em consultas concorrentes.
2. A alteração passa pelos controles existentes antes de definir a resposta final.
3. Qualquer avaliação diferente de `aprovado` produz uma resposta determinística do sistema com estado, código, motivo controlado e evidências de fluxo disponíveis. Não copia as recomendações ou alegações de segurança da IA.
4. O bloqueio substitui conteúdo e seções operacionais. O texto rejeitado não é colocado em `humanizacao.respostaOriginal`, campo usado pelos Detalhes Técnicos e pelo histórico da investigação. Não há chamada editorial para reescrever o bloqueio.
5. A proposta original rejeitada continua na auditoria existente da execução, em `qualityGate.validacaoFontes.respostaRejeitada`, acompanhada das avaliações. O resultado do Quality Gate continua separado da aprovação do arquivo.
6. O dossiê recebe a resposta final segura. Respostas sem proposta e propostas integralmente aprovadas continuam utilizando a humanização atual, sem alteração de suas instruções, estilos ou implementação.

Em uma resposta com vários arquivos e aprovação parcial, o texto prescritivo conjunto é suprimido; os arquivos que passaram pelas validações continuam disponíveis separadamente como propostas. A mensagem identifica os bloqueios por arquivo, sem afirmar que nenhuma versão dos outros arquivos foi gerada.

## Exemplo efetivamente verificado

```text
A proposta de alteração de fonte foi bloqueada pelo IA Service e precisa ser revista.
Não aplique a proposta rejeitada.

Arquivo: ControleLocal.prw. Estado: reprovado. Código: FINALIZACAO_DESVIADA.
A alteração introduz um caminho que deixa de executar uma finalização existente.
Operação/finalização afetada: fwrestarea(aarea). Saída na linha 7.
Trilha de execução (linhas): 2 → 3 → 4 → 7.
Condições do caminho: empty(ccodigo) = true.
Nenhum arquivo corrigido foi gerado ou disponibilizado para esta proposta bloqueada.
```

O exemplo vem da fixture sintética de regressão, não de uma nova resposta de IA. A proposta bruta continha retorno antecipado e a instrução “Aplique exatamente o código acima; essa correção é segura.” Os testes confirmam que esses trechos não estão na mensagem final, no histórico interno/externo ou na ficha operacional. A resposta bruta permanece idêntica na auditoria.

## Arquivos e funções desta etapa

| Arquivo | Alteração |
| --- | --- |
| `apps/IA Service/backend/services/resposta-validacao-fonte-service.js` — novo | `construirRespostaBloqueada`: formatação determinística de estados não aprovados, evidência de operação/linha/trilha/condição, deduplicação de evidências e tratamento de aprovação parcial. |
| `apps/IA Service/backend/services/investigacao-service.js` | `processarTurno`: reserva neutra, validação anterior à resposta final, auditoria da proposta rejeitada e desvio determinístico para casos bloqueados. Ajusta o aviso de geração desabilitada para não prometer proposta aplicável no texto. |
| `apps/IA Service/backend/repositories/mensagem-repository.js` | `atualizarResposta`: finalização da mensagem reservada, com leitura e atualização por `empresa_id`/ID. Preserva metadados existentes de avisos/origem; sem migração de schema. |
| `apps/IA Service/tests/fontes-integrais-alteracoes-ancoradas.test.js` | Regressões de resposta segura, auditoria, isolamento, não versionamento e cadeia positiva em quatro formatos; adapta expectativas antigas que permitiam código rejeitado no texto. |
| `apps/IA Service/tests/resposta-validacao-fonte.test.js` — novo | Preservação do caminho aprovado, evidências sem prosa da IA, aprovação parcial e distinção de falha técnica. |

O diff incremental da orquestração em relação ao início desta etapa tem 43 linhas adicionadas e 21 removidas; o repositório de mensagens tem 15 adicionadas e uma removida. As alterações preexistentes do workspace foram preservadas.

## Regressões negativas: motivo e efeito comprovados

| Caso local | Resultado e evidência |
| --- | --- |
| Retorno que pula FWRestArea | `reprovado / FINALIZACAO_DESVIADA`; âncoras e estrutura aprovadas, trilha do desvio registrada; zero chamadas ao verificador causal e ao versionamento. |
| Causalidade inconclusiva | `inconclusivo / CONTRADICAO_NAO_COMPROVADA`; fluxo aprovado e uma verificação simulada inconclusiva; nenhuma recomendação de aplicação ou versão. |
| Falha do verificador | `falha_tecnica / FALHA_TECNICA_VERIFICADOR`; nenhum defeito causal inventado; nenhuma recomendação ou versão. |
| Âncora ausente | `falha_tecnica / ANCORA_AUSENTE`; erro técnico exposto como tal; nenhuma recomendação ou versão. |
| Estrutura inválida | `reprovado / ESTRUTURA_ADVPL_INVALIDA`; falha local anterior à causalidade; nenhuma recomendação ou versão. |
| Geração desabilitada | `inconclusivo / GERACAO_DESATIVADA`; não expõe código como solução aprovada, não chama verificador ou versionamento. |
| Atualização por outra empresa | `atualizarResposta` rejeita ID de mensagem pertencente à outra empresa e mantém conteúdo intacto. |

Nos cinco primeiros casos foram comprovados: zero chamadas editoriais para redigir o bloqueio, zero chamadas de `criarVersaoCorrigida`, zero novas versões/IDs de correção, somente o original no cadastro de anexos e download original intacto. O histórico retornado pelos endpoints interno e externo também usa o conteúdo seguro. A auditoria preserva a resposta rejeitada integral.

## Cadeia positiva LOCAL/SIMULADA

Fixture sintética `ControleLocal`, sem regra especial de nome, inicializa área, código e retorno; protege o ramo não vazio com If e restaura a área no epílogo. A resposta simulada introduz exclusivamente:

```diff
     If !Empty(cCodigo)
         lRet := .T.
+    Else
+        lRet := .F.
     EndIf
     FWRestArea(aArea)
 Return lRet
```

Em todas as quatro variantes, a cadeia comprovada foi:

`Quality Gate aprovado → âncoras exatas → estrutura aprovada → FLUXO_PRESERVADO → causalidade consistente por evidência local → uma chamada criarVersaoCorrigida → ID novo vinculado à mensagem → download HTTP 200 interno e externo → buffer esperado idêntico → original intacto`.

| Variante | Bytes original → corrigido | BOM | CRLF original → corrigido | LF isolado original → corrigido |
| --- | ---: | --- | ---: | ---: |
| PRW Latin1 | 256 → 287 | Ausente, preservado | 10 → 12 | 0 → 0 |
| PRW UTF-8 | 261 → 292 | Presente, preservado | 10 → 12 | 0 → 0 |
| TLPP UTF-8 | 258 → 289 | Ausente, preservado | 10 → 12 | 0 → 0 |
| TLPP UTF-8 | 251 → 280 | Presente, preservado | 0 → 0 | 10 → 12 |

As duas quebras adicionais são as duas linhas introduzidas pelo diff. A comparação do arquivo inteiro usa buffer esperado construído diretamente a partir do original, não apenas resultado do aplicador de âncoras. Acentos e todos os bytes externos ao trecho permanecem idênticos. O download sem autenticação retornou 401; com outra empresa, 404. O original permaneceu byte a byte igual. A humanização aprovada continuou aplicada, com sua resposta técnica original integral preservada normalmente.

Os IDs, SHA-256, perfis de bytes, etapas e respostas seguras estão em [fontes-resposta-segura-positivo.json](../tmp/fontes-resposta-segura-positivo.json). Os IDs são de bancos/anexos temporários removidos ao término dos testes; não representam versões publicadas ou URLs permanentes.

## Execuções locais e integração com o trabalho do Claude

- Integração de fontes + formatador: **30 testes aprovados, zero falhas**, saída 0. Log: [fontes-resposta-segura-integracao.log](../tmp/fontes-resposta-segura-integracao.log).
- Regressão de outros 18 arquivos relacionados a investigação, humanização, Objetiva, dossiê, Quality Gate e validadores: **123 entradas, 120 aprovadas, zero falhas bloqueantes e três TODOs**, saída 0. Log: [fontes-resposta-segura-regressao.log](../tmp/fontes-resposta-segura-regressao.log).
- Sem contar repetições: **150 aprovados + três TODOs** em 20 arquivos. Não se afirma aprovação dos TODOs.
- Os três TODOs da suíte Objetiva registram limites já explícitos nos testes: paráfrase “não altere”/“não modifique”; preservação de ressalva em frase longa sobre help; preservação do ramo pós-gravação em SD1. Não foram alterados ou ocultados nesta etapa.
- O último ensaio direcionado também verificou o isolamento da nova atualização de mensagem; a rodada final dos 30 testes inclui essa garantia.
- Regressão ampliada e rodada final direcionada executadas com [trava de rede externa](../tmp/bloquear-rede-externa-testes-fontes.cjs) que permite apenas loopback HTTP/HTTPS/fetch. Todos os providers são fixtures; nenhuma chamada paga, token real ou custo de IA desta etapa.
- `git diff --check` passou nos arquivos rastreados desta etapa. Os diffs incrementais da orquestração e do repositório foram revisados.

Foram conferidos hashes antes/depois: `resposta-humanizada-service.js`, `validacao-preservacao-service.js`, `detalhes-tecnicos.js`, `detalhes-tecnicos.css`, `ai-config-service.js`, `ai-provider-client.js` e `IACadUsr.prw` permaneceram intactos. A base desse comparativo está em [fontes-resposta-segura-antes.json](../tmp/fontes-resposta-segura-antes.json). Não houve edição dos arquivos de humanização/Objetiva sob responsabilidade do Claude. A integração foi testada com o estado atual compartilhado, sem desfazer alterações preexistentes.

## Limites e encerramento

Esta etapa comprova a proteção de apresentação e o caminho positivo determinístico. Não testa novamente a capacidade da IA real de gerar uma alteração válida. Não há compilação Protheus ou teste funcional do fonte; arquivos aprovados continuam sendo **correções propostas para validação**.

Nenhum dado permanente, provider, modelo, fallback ou integração SoftExpert foi alterado. `SVC_ALLOW_FONTE_CORRIGIDO` continua desabilitada por padrão, habilitada apenas nos processos locais de teste. Nenhum commit, push, pacote, deploy ou ativação permanente foi realizado. As evidências cobrem os arquivos no momento da execução; alterações posteriores do trabalho compartilhado exigem nova verificação pertinente antes da publicação.

Os processos de teste terminaram. Aguardar avaliação do usuário.
