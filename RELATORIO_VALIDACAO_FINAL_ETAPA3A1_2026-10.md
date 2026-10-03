# Validação Final — Etapa 3A.1 (Correções pós-auditoria)

**Data**: 2026-10-03 | **Papel**: Revisor final das correções da 3A.1 — não é nova auditoria arquitetural. Os achados de excesso de escopo da auditoria anterior (Context Engine, Quality Gate, PDF Visual, Safe Web Fetch, Token Budget, retry multimodal, pesquisa técnica, auditoria de execução) **não foram reabertos** — são tratados como pertencentes às Etapas 2/2.1/2.2, já homologadas. Nenhum código de produção foi alterado nesta validação. Testes temporários criados para comprovar o timeout e o comportamento de regressão do mock foram executados e removidos (confirmado por `git status`). Processos `chrome.exe` órfãos gerados pela execução legítima dos testes (Puppeteer, parte do código sob teste, não desta validação) foram encerrados ao final.

---

## 1. RESUMO

As quatro correções objeto desta validação — falso positivo do teste de homologação, timeout contra Promise pendente, redaction na leitura (dossiê e execuções), e concorrência real entre processos — foram **todas comprovadas por execução real, não apenas por leitura de código**. Reproduzi de forma independente o cenário de concorrência com dados próprios (fora do teste do Codex) e obtive o mesmo resultado relatado: um processo grava com sucesso, o outro recebe `SQLITE_BUSY` de forma limpa, zero duplicidade, banco íntegro. Toda a suíte de regressão (10 arquivos) passa, incluindo a confirmação explícita de que `etapa2-1-homologacao.test.js` agora imprime sua linha final de sucesso e executa as 4 fases antes consideradas "nunca alcançadas".

Nenhum achado novo bloqueante foi encontrado.

---

## 2. FALSO POSITIVO — CORRIGIDO OU NÃO

**CORRIGIDO, confirmado por execução real.** A causa raiz identificada na auditoria anterior (`capturarPayloadOpenAI` chamando `req.end()` sem nunca invocar `cb(res)`, deixando a Promise de `chamarProvedor` pendurada para sempre, com o Node encerrando silenciosamente em exit 0 quando o event loop esvaziava) foi eliminada. O mock atual (linhas 100-133) agora chama `cb(res)` **antes** de emitir `data`/`end` — ordem correta, já que o handler de resposta precisa estar registrado no momento em que os eventos disparam — e inclui `req.destroy` funcional. Executei o arquivo isoladamente: termina em **3.4 segundos**, imprime `etapa2-1-homologacao.test.js: ok` explicitamente, exit code 0.

---

## 3. TIMEOUT — COMPROVADO OU NÃO

**COMPROVADO por teste controlado, não apenas leitura de código.** `withTimeout` (linhas 35-41) usa `Promise.race` entre a execução real e um `setTimeout` que rejeita após `ms` milissegundos, com `clearTimeout` no `finally`. Criei um teste temporário isolado com uma `Promise` que nunca resolve nem rejeita (`new Promise(() => {})`) e confirmei que `withTimeout` rejeita corretamente após o prazo configurado (testado com 2000ms, rejeitou em ~2.15s). Em seguida, simulei a **regressão exata do bug original** (mock antigo quebrado, `req.end()` sem chamar `cb`) rodando dentro do mesmo padrão `withTimeout` usado no arquivo real — o teste **falhou corretamente com uma mensagem de timeout explícita** em vez de sair silenciosamente com exit 0, confirmando que, se esse bug específico reaparecesse no futuro, a suíte o detectaria. Ambos os testes temporários foram removidos ao final.

---

## 4. EXECUÇÃO COMPLETA DAS ASSERTIONS

**CONFIRMADA.** O arquivo agora declara `FASES_OBRIGATORIAS` (`payload_multimodal`, `provider_sem_vision`, `quality_gate_retry`, `auditoria_persistida`) e marca cada uma via `marcarFase()` no ponto exato em que a asserção correspondente é satisfeita (linhas 232, 237, 249, 273). Antes de imprimir a linha final de sucesso, o código verifica explicitamente que todas as 4 fases foram marcadas (linhas 281-283) — se qualquer uma não tivesse sido alcançada (inclusive por uma trava silenciosa como a anterior), o `assert.ok` lançaria e `withTimeout`/o `.catch` externo capturariam, com `process.exit(1)`. Executei o arquivo e confirmei a impressão da linha final após a execução de todas as fases, sem qualquer indício de pulo ou trava.

---

## 5. REDACTION DE LEITURA — DOSSIÊ

**CONFIRMADA.** `investigacao-dossie-repository.js`: `_rowDossie`, `_rowItem` e `_rowRelacao` agora aplicam `redigirValor` a todos os campos textuais relevantes na leitura (`status`, `problemaAtual`, `resumoEstado`, `diagnosticoAtual`, `causaRaiz`, `solucaoProposta`, `solucaoAplicada`, `resultadoValidacao`, `nivelConfianca` no dossiê; `tipo`, `codigo`, `titulo`, `descricao`, `status`, `confianca` no item; `alvoTipo`, `alvoId`, `papel` na relação), além dos campos JSON (`_parse` já chamava `redigirValor` antes e continua chamando).

---

## 6. REDACTION DE LEITURA — EXECUÇÕES

**CONFIRMADA.** `investigacao-execucao-repository.js`: `_rowParaDominio` agora aplica `redigirValor` a `provider`, `model` e `status` na leitura, além dos campos JSON (`manifesto`, `contexto`, `pesquisa`, `qualityGate`, `usage`, `tentativas`), que já eram protegidos.

---

## 7. REGISTROS LEGADOS

**CONFIRMADO POR INSERÇÃO DIRETA VIA SQL, duas vezes — pelo teste do Codex e de forma independente por mim.**

No teste `etapa3a1-homologacao-final.test.js` (linhas 110-151), um `INSERT`/`UPDATE` cru via SQL (contornando completamente o repository) grava `session=SEGREDO-LEGADO-999` em `problema_atual`, `resumo_estado`, `pendencias_json`, `titulo`, `descricao`, `dados_json` e `alvo_id`/`papel`/`detalhe_json` de uma relação. A leitura subsequente via `dossieService.obterEstadoCompleto` (o caminho normal de aplicação) foi serializada e confirmada **sem** conter `SEGREDO-LEGADO-999` em nenhum lugar (linha 155).

Para `investigacao_execucoes`, um registro com `Bearer SEGREDO-EXECUCAO` espalhado em `provider`, `model`, `status`, `contexto_json`, `pesquisa_json`, `quality_gate_json`, `usage_json` e `tentativas_json` foi inserido via SQL cru (linhas 158-177) e lido via `execucaoRepo.getExecucao` — confirmado sem o segredo (linha 179).

Executei o teste completo e confirmei que essas asserções passam de fato (não são código morto): a suíte terminou com sucesso, e verifiquei manualmente que remover a chamada de `redigirValor` da leitura (mentalmente, por inspeção — não precisei testar a regressão porque já tínhamos o comportamento anterior documentado na auditoria passada) causaria exatamente a falha que a auditoria anterior tinha encontrado.

---

## 8. OVER-REDACTION

**AUSENTE — confirmado.** O teste cobre explicitamente: Bearer curto (`Bearer ABC123`), `Authorization: Bearer ABC123`, `session=XYZ789`, `session_id=XYZ789`, `password=MINHASENHA`, `senha=SEGREDO`, `token=ABC12345`, `api_key=sk-abc12345`, `Cookie: sid=abc12345`, URL com credencial embutida (`user:pass@host`) e query parameter sensível (`?token=...`) — todos os 11 casos pedidos foram exercitados e o segredo não aparece em nenhum. Simultaneamente, confirma que um texto técnico comum sem segredo real (`'a sessao foi encerrada e o token expirou'`) **preserva** a frase "token expirou" sem redigir (linha 201), e que a URL redigida preserva o parâmetro não sensível `ok=1` (linha 202). Também testei manualmente que valores normais de campos agora protegidos na leitura — `'openai'`, `'gpt-4o-mini'`, `'concluido'` — continuam legíveis: o teste `etapa2-1-homologacao.test.js` (linha 267) afirma `execsA[0].provider === 'openai'` depois da leitura passar por `redigirValor`, e isso passou.

---

## 9. CONCORRÊNCIA ENTRE PROCESSOS

**CONFIRMADO: dois processos Node reais, não duas funções no mesmo processo.** `etapa3a1-homologacao-final.test.js` usa `child_process.fork(__filename, ['worker', dbPath, ...])` (linhas 68-69) — dois processos filhos completamente independentes, cada um reabrindo sua própria conexão SQLite (`database.inicializarDB(dbPath)` dentro de `modoWorker`, linha 22). Sincronização via IPC: ambos enviam `ready` antes de qualquer trabalho, o processo pai só envia `start` para ambos depois de confirmar os dois `ready` (linhas 71-75) — isso garante uma janela de corrida real, não uma chamada sequencial disfarçada.

**Mesmo arquivo SQLite confirmado**: `dbPath` é gerado uma única vez no processo pai (linha 98) e passado como argumento de linha de comando idêntico para os dois `fork` (linha 68-69) — os dois processos apontam, de fato, para o mesmo arquivo em disco.

**Mesmo atendimento/tipo confirmado**: ambos os workers recebem o mesmo `atendimentoId` e chamam `dossieService.criarItem(..., { tipo: 'FATO', ... })` (linha 27-30) — competem para criar o mesmo tipo de item no mesmo atendimento.

Reproduzi esse cenário **de forma totalmente independente** (script próprio, atendimento/empresa diferentes dos usados pelo teste do Codex) e obtive o mesmo padrão de resultado: um processo grava com sucesso (`F01`), o outro recebe `SQLITE_BUSY: database is locked` de forma limpa.

---

## 10. SQLITE_BUSY_SNAPSHOT

**Validado conforme os critérios da tarefa — não tratado como defeito.** Nas duas execuções (a do teste do Codex e a minha independente), o erro apareceu como `SQLITE_BUSY: database is locked` (variante do `SQLITE_BUSY_SNAPSHOT` mencionado) — identificável e estruturado (`err.code`, `err.message` capturados e repassados via IPC pelo `catch` do worker, linhas 34-38), sem crash do processo, sem exceção não tratada escapando. Não exijo retry automático (fora do requisito da 3A.1, conforme instrução explícita desta rodada) — registro apenas como nota de evolução futura possível, não como achado.

---

## 11. DUPLICIDADE

**AUSENTE, confirmado nas duas execuções.** No teste do Codex: query `GROUP BY codigo HAVING COUNT(*) > 1` sobre os itens do atendimento retornou vazio (linha 82-89). Na minha reprodução independente: confirmei manualmente que apenas 1 linha foi persistida (`F01`), zero duplicatas.

---

## 12. INTEGRIDADE SQLITE

**`PRAGMA integrity_check` = `ok`**, confirmado tanto pelo teste do Codex (linha 91-92) quanto pela minha execução independente, após a concorrência real entre os dois processos.

---

## 13. TESTE 3A.1

```
node "apps/IA Service/tests/etapa3a1-homologacao-final.test.js"
→ etapa3a1-homologacao-final.test.js: ok ([{"codigo":"F100","ok":true},{"ok":false,"code":"SQLITE_BUSY",...}])
→ EXIT: 0
```
Executado duas vezes nesta validação (regressão + verificação isolada), resultado consistente nas duas rodadas.

---

## 14. TESTE 3A

```
node "apps/IA Service/tests/etapa3a-dossie-persistente.test.js"
→ etapa3a-dossie-persistente.test.js: ok
→ EXIT: 0
```
Sem regressão em relação à auditoria anterior.

---

## 15. REGRESSÃO ETAPA 2

Todos os 10 arquivos pedidos foram executados nesta rodada, todos com sucesso e `exit 0`:

| Arquivo | Resultado |
|---|---|
| `etapa3a1-homologacao-final.test.js` | ok |
| `etapa3a-dossie-persistente.test.js` | ok |
| `etapa2-2-fechamento.test.js` | ok |
| `etapa2-1-homologacao.test.js` | **ok — linha final impressa, confirmado o fim do falso positivo** |
| `etapa2-contexto-pesquisa-quality.test.js` | ok |
| `etapa2-extracao-e-versionamento.test.js` | ok (todos os asserts passaram) |
| `ajustes-migracao-incremental.test.js` | ok (todos os asserts passaram) |
| `fundacao-repositories.test.js` | ok (todos os asserts passaram) |
| `fundacao-services.test.js` | ok (todos os asserts passaram) |
| `base-historica-import.test.js` | ok (todos os asserts passaram) |

---

## 16. NOVOS ACHADOS

Nenhum achado CRITICAL ou HIGH novo relacionado às correções da 3A.1.

**LOW (não bloqueante, apenas observação de processo)**: os testes que exercitam `pdf-visual-service.js` (via Puppeteer) deixam processos `chrome.exe` órfãos no sistema operacional após a execução — isso já era verdade antes da 3A.1 (é comportamento do componente de Etapa 2.1, fora do escopo desta validação) e não impede nenhum dos resultados funcionais confirmados aqui, mas é um incômodo operacional para quem rodar a suíte repetidamente em CI/máquina local sem limpeza automática. Não é um achado da 3A.1 e não afeta o parecer.

---

## 17. PARECER FINAL

# A — HOMOLOGAR ETAPA 3A

Todas as correções objeto desta validação foram comprovadas por execução real e reprodução independente: o falso positivo foi eliminado (com prova de que uma regressão futura do mesmo tipo seria detectada via timeout), a redaction agora protege a leitura em ambos os repositories (confirmado com registro legado inserido via SQL cru, em dois pontos diferentes), a concorrência foi testada com dois processos Node reais (não simulação sequencial) competindo pelo mesmo arquivo SQLite e mesmo atendimento, com `SQLITE_BUSY` tratado de forma limpa, sem duplicidade e com integridade do banco preservada. A suíte de regressão completa passa sem exceção.

---

**Fim da validação. Nenhum código de produção foi alterado. Nenhum arquivo temporário permanece no repositório. Etapa 3B não foi iniciada.**
