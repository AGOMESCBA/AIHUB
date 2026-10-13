# IA Service - Etapa 3: Homologacao Controlada de Assertividade Tecnica

Data da execucao: 2026-10-11  
Escopo: homologacao controlada, sem desenvolvimento de novas correcoes.

## 1. Resumo executivo

A Etapa 3 foi iniciada com foco em comprovar qualidade investigativa, nao em alterar o motor.

Nesta execucao foram realizados:

- congelamento tecnico da versao atual;
- registro do estado da worktree;
- captura de hashes SHA-256 dos arquivos criticos do IA Service;
- execucao da suite automatizada local;
- avaliacao das limitacoes para a bateria real de assertividade.

Resultado desta etapa parcial:

- Suite local: **39/39 testes aprovados**.
- Alteracoes no motor durante a Etapa 3: **nenhuma**.
- Chamadas reais a providers de IA: **nao executadas nesta etapa**.
- Publicacao, commit, push ou deploy: **nao realizados**.
- Homologacao de assertividade tecnica: **nao concluida**.

Veredito: **necessita validacao real controlada antes de piloto ou publicacao**.

## 2. Versao congelada para auditoria

Commit base:

- SHA: `6ada54602783db27e7373f5e89256ee43490e897`
- Curto: `6ada546`
- Data: `2026-10-10T11:28:43-04:00`
- Assunto: `fix: refresh external IA Service pre-analysis`

Observacao importante: a worktree esta suja e contem arquivos modificados e nao rastreados de etapas anteriores. Portanto, a versao efetivamente avaliada nesta Etapa 3 e o conjunto **commit base + worktree atual**, nao apenas o commit `6ada546`.

## 3. Estado da worktree

Arquivos modificados:

- `apps/IA Service/backend/routes/externo-routes.js`
- `apps/IA Service/backend/routes/index.js`
- `apps/IA Service/backend/services/context-engine.js`
- `apps/IA Service/backend/services/investigacao-service.js`
- `apps/IA Service/backend/services/prompt-builder.js`
- `apps/IA Service/backend/services/quality-gate-service.js`
- `apps/IA Service/frontend/j2a/assets/radar.css`
- `apps/IA Service/frontend/j2a/assets/radar.js`
- `apps/IA Service/frontend/j2a/index.html`
- `apps/IA Service/tests/etapa2-2-fechamento.test.js`
- `repomix-output.xml`

Arquivos nao rastreados:

- `IA_SERVICE_AUDITORIA_ESTRUTURAL_QUALITY_GATE.md`
- `IA_SERVICE_AUDITORIA_QUALIDADE_INVESTIGATIVA_FINAL.md`
- `IA_SERVICE_DIAGNOSTICO_ARQUITETURAL.md`
- `apps/IA Service/backend/services/plano-resposta-rastreavel-service.js`
- `apps/IA Service/backend/services/trilha-investigacao-service.js`
- `apps/IA Service/frontend/j2a/assets/entrar-teste-local.html`
- `apps/IA Service/tests/etapa1-quadro-investigativo.test.js`
- `tmp/ia-service-auditoria-etapa1-runner.js`

Nota: `repomix-output.xml` permanece alterado e nao foi modificado nesta etapa.

## 4. Hashes SHA-256 dos arquivos criticos

```text
D934AC435F7E4601A3BE94E623D4928A85DCFAE886D9372B43F5E0F607B2B4BF  C:\Apps\iahub\apps\IA Service\backend\services\context-engine.js
1F7B8BAA50FC0D76364FC2203154F98101D169FE6C65AE5AF9776371FB837E24  C:\Apps\iahub\apps\IA Service\backend\services\plano-resposta-rastreavel-service.js
DE95CAB4C7319FBFF033B143CDBFD4C33DD9F516E757F0866355F9F0302C1715  C:\Apps\iahub\apps\IA Service\backend\services\prompt-builder.js
F9F30326E54044A785B91A9C7EA20D0FD8A5E7C0F73613F65B773C45D0D3C2D8  C:\Apps\iahub\apps\IA Service\backend\services\quality-gate-service.js
C20EB6F0730A591B57973FB1C6FBC25DA0C17B9781288F208244D13CE7927ECE  C:\Apps\iahub\apps\IA Service\backend\services\investigacao-service.js
33BD2F5C46192673B5A452BBB53085AF8EB7E1BCFD2303E4FFD73B0D24F8785A  C:\Apps\iahub\apps\IA Service\backend\services\ai-provider-client.js
```

## 5. Testes automatizados locais

Comando executado:

```powershell
$tests = rg --files "apps\IA Service\tests" | Where-Object { $_ -like '*.test.js' }
foreach ($t in $tests) { node $t }
```

Resultado:

```text
ALL OK: 39 tests
```

Interpretacao:

- Os testes automatizados locais continuam aprovados.
- Isso confirma regressao deterministica, fail-closed e regras locais cobertas pelos testes existentes.
- Isso **nao comprova**, por si so, 90% de assertividade tecnica em casos reais.

## 6. Execucao real com providers

Nao foram executadas novas chamadas reais de IA nesta etapa.

Motivo:

- A Etapa 3 exige controle de provider/modelo, registro de tokens, latencia, retries e avaliacao humana sobre respostas reais.
- O runner historico de auditoria pode acionar providers externos.
- Nesta etapa nao houve autorizacao operacional especifica para envio de novos dados aos providers nem definicao fechada da bateria inedita com avaliacao independente.

Conclusao:

- A validacao real de assertividade permanece pendente.
- Nao e correto atribuir melhoria percentual ao PRR ou ao Quality Gate apenas com base nos testes locais.

## 7. Criterios de homologacao propostos para a proxima rodada

Para medir a meta de 90% de assertividade de forma minimamente defensavel, a proxima execucao deve conter:

- provider/modelo fixo ou resultados segregados por modelo;
- casos ineditos nao usados para ajuste do motor;
- historico e anexos reais recuperados da base local ou importados para ambiente isolado;
- avaliacao humana independente por criterio tecnico;
- registro de resposta integral, PRR, Quality Gate, tokens, latencia e retries;
- separacao entre casos com evidencia suficiente e casos com evidencia insuficiente.

Metricas recomendadas:

- assertividade tecnica em casos com evidencia suficiente;
- qualidade investigativa em casos sem conclusao confirmavel;
- transparencia obrigatoria: fatos, hipoteses, lacunas e proximo passo;
- taxa de erro critico;
- falsos positivos e falsos negativos do Quality Gate.

## 8. Riscos residuais

- A worktree contem alteracoes acumuladas de multiplas etapas, inclusive frontend e documentacao.
- `repomix-output.xml` permanece sujo e nao deve entrar em pacote sem revisao explicita.
- A aprovacao dos 39 testes nao substitui homologacao real com casos ineditos.
- A alternancia de providers continua sendo um fator de confusao experimental se a proxima bateria nao controlar modelo.
- Sem execucao real, nao ha dados novos de tokens, latencia, retries ou qualidade final das respostas.

## 9. Veredito da Etapa 3

A base esta **apta para iniciar uma bateria controlada de homologacao real**, mas ainda **nao esta homologada para publicacao por assertividade tecnica**.

Classificacao:

**Necessita nova validacao controlada.**

Justificativa:

- os testes locais passaram;
- nenhuma nova regressao deterministica foi observada;
- a Etapa 3 ainda nao executou casos ineditos com provider/modelo controlado;
- nao ha evidencia estatistica ou avaliacao tecnica independente suficiente para declarar 90% de assertividade.

Proximo passo recomendado:

executar a bateria inedita autorizada, com provider/modelo controlado, em ambiente isolado, preservando respostas integrais e avaliacao humana antes de qualquer commit, pacote, push ou deploy.

---

## 10. Rodada de homologacao investigativa - 10 casos ineditos

Data da execucao: 2026-10-12  
Diretorio de evidencias: `C:/tmp/ia-service-etapa3-2-homologacao-10`  
Banco isolado: `C:/tmp/ia-service-etapa3-2-homologacao-10.db`

### Ajustes direcionados antes da rerodada

Foram aplicadas correcoes minimas motivadas pela bateria anterior:

- resposta segura deterministica deixou de expor bastidores como retry, PRR ou Quality Gate;
- fail-closed passou a exigir `revisao_necessaria_quality_gate` para qualquer falha remanescente apos retry;
- Groq recebeu limite operacional menor de contexto para reduzir erro de request acima do limite;
- PRR passou a consumir evidencias selecionadas completas como termos rastreaveis, sem promover causalidade automaticamente;
- Context Engine preserva resumos maiores para anexos tecnicos criticos;
- Quality Gate passou a diferenciar referencia externa contextual de uso causal indevido.

### Testes automatizados

Suite completa executada apos os ajustes:

```text
ALL TEST FILES OK: 40
```

Regressoes adicionadas/validadas:

- fail-closed apos retry com falha remanescente;
- ausencia de vazamento de retry/Quality Gate na resposta segura;
- pesquisa externa contextual permitida quando nao usada como causa;
- pesquisa externa promovida a causa sem ponte causal bloqueada;
- log tecnico critico preservando identificadores rastreaveis no PRR;
- anexo omitido como lacuna bloqueante, sem falsa leitura.

### Resultado da bateria de 10 casos

Provider/modelo efetivo em todos os casos concluidos ou bloqueados:

- `claude / claude-haiku-4-5-20251001`

Resultado por caso:

| Caso | Status final | Quality Gate | Latencia | Observacao |
|---|---:|---:|---:|---|
| CH-01 | concluido | aprovado | 24502 ms | Reconheceu pendencia externa TOTVS e nao promoveu causa sem retorno. |
| CH-02 | concluido | aprovado | 13978 ms | Eliminado vazamento interno; respeitou correcao aplicada e validacao pendente. |
| CH-03 | concluido | aprovado | 15244 ms | Tratou divergencia SD1/SC6 como trilha tecnica e pediu confirmacao do ajuste. |
| CH-04 | concluido | aprovado | 15037 ms | Separou comportamento observado do Kardex/SmartView e proximo teste. |
| CH-05 | concluido | aprovado | 17354 ms | Falso positivo anterior sobre `SIGACTB` corrigido; pesquisa externa ficou contextual. |
| CH-06 | concluido | aprovado | 17841 ms | Manteve hipotese investigativa sobre bloqueio por calculos anteriores. |
| CH-07 | concluido | aprovado | 21022 ms | Log tecnico passou a preservar `TC_Seek`/semaforo/customizacao como evidencia rastreavel. |
| CH-08 | concluido | aprovado | 14327 ms | Respeitou pendencia de retorno do cliente e nao inventou causa fiscal. |
| CH-09 | revisao_necessaria_quality_gate | reprovado | 10383 ms | Fail-closed correto; resposta rejeitada por vazamento de retry, referencia nao rastreavel e repeticao investigativa. |
| CH-10 | concluido | aprovado | 10100 ms | Reconheceu falta de evidencia tecnica na reabertura e orientou coleta objetiva. |

Resumo:

- 10 casos executados.
- 9/10 entregues como `concluido` com Quality Gate aprovado.
- 1/10 bloqueado como `revisao_necessaria_quality_gate`.
- Nenhuma resposta reprovada foi apresentada como orientação tecnica aprovada.
- A metrica ainda nao deve ser usada para declarar 90% de assertividade definitiva, pois exige avaliacao humana independente das respostas completas.

### Caso bloqueado

CH-09 foi bloqueado com:

- `RETRY_CONTEXT_LEAKED`;
- `UNTRACEABLE_TECHNICAL_REFERENCE`;
- `REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA`.

Interpretacao: o bloqueio e desejavel para seguranca. O motor ainda precisa melhorar a geracao/retry nesse tipo de caso, mas o fail-closed impediu que uma resposta rejeitada fosse homologada como parecer tecnico.

### Limitacoes da rodada

- Groq continua nao compondo a metrica principal por limite operacional de request/TPM no ambiente atual.
- OpenAI nao entrou por indisponibilidade de creditos.
- Tokens vieram redigidos no artefato de execucao; latencia e provider/modelo foram registrados.
- A avaliacao tecnica humana ainda e obrigatoria antes de declarar assertividade real.

Veredito da rodada: **candidata a avaliacao humana**, nao homologacao final automatica.
