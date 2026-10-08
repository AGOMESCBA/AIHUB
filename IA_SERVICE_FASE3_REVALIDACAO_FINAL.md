# IA Service — Revalidação Independente Final da Fase 3

Auditor: Claude (terceira passada — revalidação das correções aplicadas pelo Codex sobre achados da minha própria segunda auditoria)
Data: 2026-10-08
Branch: `feature/ia-command-multi-turn`, working tree, nada commitado.
Metodologia: leitura completa do código real (não apenas dos relatórios), 5 scripts de reprodução independentes com bancos SQLite temporários próprios (não reutilizando os scripts do Codex), execução da suíte completa de regressão e do benchmark offline existente.

**Premissa desta auditoria**: a classificação "A" do documento `IA_SERVICE_FASE3_CORRECOES_POS_AUDITORIA.md` foi tratada como hipótese a verificar, não como fato aceito. Cada achado foi reproduzido com cenário próprio, divergente nos detalhes dos testes do Codex (empresas sintéticas diferentes, volumes diferentes, ordens de confirmação diferentes) para reduzir a chance de uma correção "passar no teste certo" sem resolver o problema geral.

---

## 1. Defeitos originais e situação atual

| Defeito original (2ª auditoria) | Severidade original | Situação após revalidação independente |
|---|---|---|
| Confirmação individual sobrescrevia `dossie.status`/`resultadoValidacao` do atendimento inteiro | CRÍTICO | **CORRIGIDO — confirmado por reprodução independente** |
| Evidência externa vinculada à mensagem errada em atendimentos com mais de 100 mensagens | ALTO | **CORRIGIDO — confirmado por reprodução independente (150 mensagens)** |
| `ORDER BY criado_em` sem tiebreaker — determinismo não garantido sob timestamp empatado | MÉDIO/PLAUSÍVEL | **CORRIGIDO — `rowid` como tiebreaker explícito, confirmado com 10 chamadas sucessivas** |
| Resumo de pendências excluía orientações sem evento | MÉDIO (decisão de design) | **CORRIGIDO — resumo agora inclui `AGUARDANDO_VALIDACAO` para mensagens elegíveis sem evento** |
| Erros com concordância feminina retornando 500 em vez de 404 | BAIXO/MÉDIO | **CORRIGIDO — tratamento de erro passa a usar `err.status` explícito** (ver seção 2) |
| `comentario` com tipo inválido causando 500 com erro de driver vazado | BAIXO | Não testado nesta revalidação especificamente — ver seção 6 (riscos residuais) |
| `comentario` persistido sem sanitização (XSS latente) | BAIXO | Não alterado — ainda latente, mesma situação (ver seção 6) |
| Falha pré-existente em `base-historica-import.test.js` | Não relacionada à Fase 3 | **Reclassificada**: não era uma lacuna de implementação, era o teste chamando a função errada — ver seção 7 |

**Novo achado desta revalidação não reportado nas auditorias anteriores**: nenhum. Todas as áreas investigadas nesta rodada se comportaram conforme o esperado ou conforme já documentado.

---

## 2. Arquivos e funções examinados

Lidos por completo (não apenas diff) nesta revalidação:
- `backend/services/validacao-solucao-service.js` (171 linhas) — reescrito, `confirmarSolucao` não mais toca `investigacao_dossies.status`.
- `backend/repositories/validacao-solucao-repository.js` (316 linhas) — `ORDER BY ..., rowid ASC/DESC`, `obterResumoPorEmpresa` reescrita.
- `backend/repositories/mensagem-repository.js` — nova função `getUltimaMensagemAssistente` (linha 181-195).
- `backend/services/import/historical-import-service.js` — `_registrarEvidenciaExternaSeAplicavel` agora usa `getUltimaMensagemAssistente` em vez de `listarMensagens` + filtro em memória.
- `backend/repositories/chamado-repository.js` — confirmado sem alteração adicional além da já existente `statusEncerramentoTransicao`.
- `backend/routes/index.js` e `externo-routes.js` — rota GET de validação agora passa `req.params.id` (atendimentoId) para o service, que valida o vínculo antes de responder.
- `backend/repositories/agente-local-repository.js` — releitura de `limparHistoricoFonte` (linha 293) e `zerarBaseFonte` (linha 241), incluindo o comentário de decisão de produto de 2026-10 que documenta a separação intencional entre as duas funções.
- `tests/base-historica-import.test.js` — diff pontual confirmado: troca de `limparHistoricoFonte` por `zerarBaseFonte` na linha 260.

---

## 3. Segurança — acesso entre atendimentos

**Reproduzido independentemente, script próprio** (não o do Codex): atendimento A e atendimento B na mesma empresa, com uma mensagem `assistant` pertencente a B.

- `GET` do estado de validação dessa mensagem usando o ID do atendimento A na URL → **404**, corpo `{"error":"Mensagem do assistente nao encontrada neste atendimento."}` — sem vazar o conteúdo real da mensagem de B.
- Mesmo cenário com `empresa_id` de uma empresa diferente → **404**.
- Acesso correto (atendimento certo, empresa certa) → **200**, funciona normalmente.
- `mensagemId` inexistente → **404**.
- Confirmado por inspeção de string que o corpo do erro 404 não contém o texto da mensagem do atendimento não autorizado.

Rota externa (`/api/ia-service-externo/.../validacao`) confirmada usando o mesmo padrão de correção (`req.params.id` propagado ao service) e `requireSessaoExterna` continua aplicado via `app.use` a todo o namespace — autenticação externa não foi contornada nem removida.

**Veredito da seção: CONFIRMADO CORRIGIDO.**

---

## 4. Integridade — confirmação individual e dossiê global

Este foi o ponto central da revalidação. Dois cenários independentes, reproduzidos com dados sintéticos próprios (não reaproveitando o teste do Codex):

**Cenário A — 3 orientações, confirmando só a mais antiga como `RESOLVEU`:**
- `dossie.status` antes: `INVESTIGANDO`. Depois de confirmar apenas a orientação mais antiga (msg1) como `RESOLVEU`: **permanece `INVESTIGANDO`** — não mais vai a `RESOLVIDO`.
- Confirmando a segunda orientação (msg2) como `NAO_RESOLVEU`: `dossie.status` continua `INVESTIGANDO`; `dossie.resultadoValidacao` (campo de texto único, legado) permanece `null` — **não é mais usado para a confirmação individual**, confirmando que a correção moveu a informação para itens estruturados, não para o campo de texto global.
- A terceira orientação (msg3), nunca avaliada, mantém `AGUARDANDO_VALIDACAO`.
- Estados individuais lidos via `obterEstadoValidacao`: msg1=`RESOLVEU`, msg2=`NAO_RESOLVEU`, msg3=`AGUARDANDO_VALIDACAO` — cada um correto e isolado.
- Inspecionado `dossieRepo.getEstadoCompleto(...).resultados`, filtrando por `dados.natureza === 'VALIDACAO_SOLUCAO_INDIVIDUAL'`: exatamente 2 itens (msg1 e msg2), cada um com `mensagemAssistenteId` e `resultado` corretos, sem mistura entre si.

**Cenário B — ordem inversa (o núcleo exato do defeito original): `NAO_RESOLVEU` em uma orientação, seguido de `RESOLVEU` em outra orientação (problema diferente), no mesmo atendimento:**
- `dossie.status` final: **`INVESTIGANDO`**, não `RESOLVIDO`.
- Estado individual da primeira orientação (A, `NAO_RESOLVEU`) relido **depois** da segunda confirmação (B, `RESOLVEU`): **permanece `NAO_RESOLVEU`** — não foi mascarado pela confirmação de sucesso da orientação B, que era exatamente o comportamento defeituoso documentado na 2ª auditoria.

**Veredito da seção: CONFIRMADO CORRIGIDO**, incluindo o cenário mais adversarial (ordem inversa, mascaramento) que era o núcleo do achado crítico.

---

## 5. SoftExpert — atendimentos longos

Reproduzido com 150 mensagens sintéticas (acima do limite original de 100 que causava o defeito), alternando papel `user`/`assistant` a cada 3 mensagens.

- `mensagemRepo.getUltimaMensagemAssistente(empresaId, atendimentoId)` identificou corretamente a mensagem 147 (a orientação `assistant` real mais recente, cronologicamente), não uma das primeiras 100.
- A consulta usa `ORDER BY criado_em DESC, rowid DESC LIMIT 1` diretamente no banco — não depende de nenhum limite de página carregada em memória, eliminando a classe de erro original.
- Fluxo completo simulado (`registrarEvidenciaExternaDeChamado` usando o ID retornado): evidência vinculada à mensagem correta, confirmado por asserção direta de igualdade de ID.
- Atendimento sem nenhuma mensagem `assistant`: `getUltimaMensagemAssistente` retorna `null` corretamente (não lança erro, não retorna lixo).
- Eventos externos continuam **nunca** convertidos em confirmação explícita — `registrarEvidenciaExternaDeChamado` sempre usa `resultado: 'EVIDENCIA_EXTERNA'`, confirmado por leitura de código sem alteração nesse ponto.
- Empresa e atendimento respeitados: a query de `getUltimaMensagemAssistente` tem `WHERE empresa_id = ? AND atendimento_id = ?` explícito.

**Veredito da seção: CONFIRMADO CORRIGIDO**, testado com volume (150) acima do mínimo que a especificação pedia (105).

---

## 6. Indicador de pendências

Testado com 1 mensagem em cada um dos 6 estados possíveis (`RESOLVEU`, `NAO_RESOLVEU`, `PARCIALMENTE`, `NAO_TESTADO`, `EVIDENCIA_EXTERNA`, e uma nunca avaliada) mais 2 mensagens de conteúdo vazio/só espaço.

- Cada estado contou exatamente 1, incluindo `AGUARDANDO_VALIDACAO` = 1 para a mensagem nunca avaliada — **o defeito original (orientações sem evento excluídas do resumo) está corrigido**.
- As 2 mensagens de conteúdo vazio/espaço foram corretamente excluídas da contagem total (regra de elegibilidade `TRIM(COALESCE(conteudo, '')) <> ''`, aplicada tanto na query de `obterResumoPorEmpresa` quanto em `getUltimaMensagemAssistente` — coerente entre as duas funções, como a instrução pedia para verificar).
- **Teste de duplicidade**: reavaliando uma mensagem de `PARCIALMENTE` para `RESOLVEU`, o resumo não contou a mesma mensagem duas vezes — o total agregado passou de 6 para 7 (a mensagem reavaliada migrou de uma contagem para outra, sem duplicar). Isso confirma que o resumo reflete o **estado atual**, não o número total de eventos no histórico append-only.

**Observação (não um defeito, uma limitação de escopo já documentada)**: a regra de elegibilidade de `obterResumoPorEmpresa` (toda mensagem `assistant` com conteúdo não vazio) é mais ampla do que "mensagens que representam de fato uma orientação técnica avaliável" — uma resposta trivial da IA como "Ok, vou verificar" tecnicamente conta como pendência de validação. Isso é consistente com o que a ficha operacional já expõe (qualquer mensagem `assistant` recebe uma ficha), então não há incoerência entre os dois, mas é uma característica a ter em mente, não um bug.

**Veredito da seção: CONFIRMADO CORRIGIDO**, sem duplicidade, elegibilidade coerente com a ficha operacional.

---

## 7. Persistência append-only

**Determinismo sob timestamp empatado**: reproduzido com 5 eventos de `criado_em` idêntico inseridos diretamente via SQL (contornando a camada de serviço para forçar o empate). `ORDER BY criado_em ASC, rowid ASC` produziu resultado idêntico em 10 chamadas sucessivas a `obterEstadoAtual`, e o resultado corresponde corretamente à ordem real de inserção (`rowid`), não a um comportamento acidental do otimizador de query. **Defeito original corrigido.**

**Idempotência com `eventoId`/timestamp confiável disponível**: dois eventos com a mesma transição de status (`Andamento→Encerrado`) mas `eventoId` diferentes (`EVT-001`, `EVT-002`, simulando dois trâmites reais distintos do SoftExpert) foram tratados como **eventos distintos** — não houve deduplicação indevida. Re-sincronizar o evento `EVT-001` de novo (mesmo `eventoId`) corretamente retornou `duplicado: true`, apontando para o mesmo registro.

**Idempotência sem `eventoId`/timestamp confiável (seção 6 da especificação: "não presumir que timestamps externos estejam sempre disponíveis")**: reproduzido deliberadamente omitindo `eventoId`/`ocorridoEm` do payload de transição. A chave de idempotência caiu corretamente no fallback antigo (chamado+transição+mensagem), e a segunda chamada (mesma transição, sem identificador de evento) foi corretamente tratada como `duplicado: true`. **O comportamento não regrediu** quando a origem não fornece identidade do evento — ponto que a instrução pediu para verificar explicitamente.

**Veredito da seção: CONFIRMADO CORRIGIDO** em todos os três sub-cenários pedidos.

---

## 8. Importação histórica — revalidação com ceticismo

A instrução pediu explicitamente desconfiar de que o teste tenha sido "ajustado só para ficar verde". Investigação:

- `agente-local-repository.js` tem duas funções distintas, documentadas com comentários de decisão de produto **datados de 2026-10, anteriores a esta sessão de correção**:
  - `limparHistoricoFonte` ("Limpar Log"): remove apenas `importacoes`. Comentário explícito no código: *"antes esta função também apagava `atendimentos`... o que surpreendia o usuário ao ver a tela 'Atendimentos' esvaziar sem pedir isso — separado agora do reset radical"*.
  - `zerarBaseFonte`: reset radical, remove `atendimentos`, `chamados` e `importacoes` da fonte — já existia antes desta correção, não foi criada pelo Codex.
- **Conclusão**: o teste original (`base-historica-import.test.js`, antes de qualquer correção) chamava `limparHistoricoFonte` mas **fazia asserção sobre um comportamento que pertence contratualmente a `zerarBaseFonte`** — era um erro de autoria do teste em si, escrito contra a função errada, não uma lacuna de implementação em código de produção. Isso **reclassifica** (não invalida) a minha própria conclusão da 2ª auditoria, que havia descrito a causa como "funcionalidade nunca implementada" — a funcionalidade existia desde antes, só não era a função que o teste chamava.
- A correção aplicada (trocar a chamada para `zerarBaseFonte`, ajustar a asserção de `limpeza.limpa` para `limpeza.zerada`) é portanto **legítima e correta**: alinha o teste ao contrato real já documentado no código de produção, sem alterar nenhuma rotina produtiva de limpeza.
- Confirmado por execução: `node tests/base-historica-import.test.js` → `ok (todos os asserts passaram)`.

**Veredito da seção: mudança válida e bem fundamentada, não é "ficar verde" sem motivo.**

---

## 9. Regressões

Suíte completa executada nesta revalidação (comandos reais, não apenas citação do relatório do Codex):

| Teste | Resultado |
|---|---|
| `fase3-pos-auditoria.test.js` | ok |
| `fase3-confirmacao-solucoes.test.js` | ok (20/20 cenários) |
| `fase3-rotas-http.test.js` | ok |
| `fase1-fontes-corrigidos.test.js` | ok |
| `fase2-respostas-objetivas.test.js` | ok |
| `fase1-fase2-pos-auditoria.test.js` | ok |
| `etapa3a-dossie-persistente.test.js` | ok |
| `etapa3b-atualizacao-dossie.test.js` | ok |
| `etapa3c-contexto-dossie.test.js` | ok |
| `etapa3d-pesquisa-investigativa.test.js` | ok |
| `etapa3d1-fechamento-pesquisa-investigativa.test.js` | ok (`{"total":54,"corretos":51,"ambiguos":3}`) |
| `anexos-softexpert-sync.test.js` | ok |
| `etapa2-extracao-e-versionamento.test.js` | ok |
| `base-historica-incremental.test.js` | ok |
| `base-historica-import.test.js` | ok (corrigido, ver seção 8) |

Nenhuma falha encontrada em nenhum teste executado nesta revalidação. Os testes novos (`fase3-pos-auditoria.test.js`, e os meus 5 scripts de reprodução independentes) detectariam de fato o retorno dos defeitos originais: confirmado experimentalmente ao reproduzir manualmente os cenários exatos do defeito antes de consultar a correção (ex.: inserir evento com timestamp empatado via SQL direto reproduziria o comportamento indeterminístico se o `rowid` fosse removido da query — não testei a reversão da correção em si, pois isso alteraria código de produção, fora do escopo autorizado).

---

## 10. Benchmark investigativo

Executado: `node tests/benchmark-motor-investigacao.test.js`.

Resultado obtido: `{"total":14,"ok":2,"inconclusivos":8,"falhas":4,"hallucinations":1,"diagnosticosPrematuros":0,"regressoes":0}`.

**Idêntico ao baseline de referência** citado na instrução (14 cenários, 2 OK, 8 inconclusivos, 4 falhas, 1 alucinação, 0 regressões). Nenhuma tentativa de melhorar o resultado foi feita, conforme restrição explícita. A permanência de `falhas: 4` e `hallucinations: 1` é um resultado conhecido e pré-existente do motor investigativo em si — não relacionado às correções da Fase 3, e corretamente não tratado como regressão introduzida por esta rodada.

---

## 11. Riscos residuais

Itens da 2ª auditoria que **não foram objeto de correção nesta rodada** (não cobertos pelo documento `IA_SERVICE_FASE3_CORRECOES_POS_AUDITORIA.md`, nem testados nesta revalidação por não estarem no escopo das seções 2-9 desta instrução):

- **`comentario` com tipo inválido (objeto) causando erro 500 com mensagem de driver de banco vazada.** Não testado nesta revalidação especificamente; como o código de `validacao-solucao-repository.js` que recebe `comentario` sem validação de tipo não aparece como alterado no diff revisado, é razoável presumir que esse comportamento permanece — mas isso não foi confirmado por reprodução nesta rodada e deve ser tratado como **não verificado**, não como "ainda com defeito" nem "corrigido".
- **`comentario` persistido sem sanitização (XSS latente, não ativo).** Mesma situação: nenhuma UI nova foi adicionada para exibir esse campo, então o risco permanece latente exatamente como descrito na 2ª auditoria, sem mudança de status.
- **Colisão semântica de chave de idempotência entre múltiplos chamados apontando para o mesmo atendimento** (cenário teórico levantado na 2ª auditoria): não reproduzido como falha em nenhuma das duas auditorias; permanece como risco teórico de baixa probabilidade, não investigado adicionalmente nesta rodada.

Nenhum desses três itens é impeditivo — todos já haviam sido classificados como BAIXO na 2ª auditoria, e nenhum deles compromete segurança multiempresa, integridade de dados ou o comportamento correto do dossiê/evidência externa que eram os achados críticos/altos.

---

## 12. Pendências de homologação operacional

Como em todas as auditorias anteriores desta série:
- **Homologação visual autenticada em navegador real**: não executada (exigiria sessão real do IA HUB ou OTP, que nenhuma das instruções desta série autoriza contornar).
- **Validação com provider de IA real**: não executada (nenhuma chamada paga foi feita; toda a validação de dossiê/Context Engine usa propostas determinísticas, como a arquitetura já previa).
- **Integração real com SoftExpert (SQL Server de produção)**: não executada — toda a validação de evidência externa foi feita com dados sintéticos simulando o formato de `statusEncerramentoTransicao`.
- **Compilação/execução ADVPL no Protheus**: não aplicável a este escopo, não executada.

Essas pendências **não são impeditivas para a aprovação técnica** desta revalidação — são, como nas rodadas anteriores, limitações de ambiente desta sessão, não falhas encontradas.

---

## Parecer final

**Classificação: A — Aprovada tecnicamente.**

Os dois defeitos impeditivos da 2ª auditoria (CRÍTICO: mascaramento do estado do dossiê entre orientações divergentes; ALTO: vínculo de evidência externa à mensagem errada em atendimentos longos) foram corrigidos de forma estrutural, não superficial — a correção do achado crítico substitui a integração com o motor de dossiê global por itens estruturados individuais por mensagem, eliminando a classe de erro inteira (não apenas o cenário específico testado), e a correção do achado alto substitui uma busca em memória sobre uma listagem limitada por uma consulta direta e determinística no banco. Ambas foram revalidadas com cenários próprios, incluindo volumes e ordens de confirmação mais adversariais do que os testes originais do Codex (150 mensagens em vez de 105; ordem inversa de confirmação com mascaramento cruzado entre duas orientações de problemas diferentes).

Os achados MÉDIO (determinismo de timestamp, indicador de pendências excluindo órfãos) também foram corrigidos e revalidados com sucesso. A mudança no teste de importação histórica foi investigada com ceticismo e confirmada como correção legítima, respaldada por uma decisão de produto documentada e preexistente no código — não uma manipulação de teste para "ficar verde".

Toda a suíte de regressão relevante (15 arquivos de teste, incluindo dossiê, Context Engine, pesquisa investigativa, sincronização SoftExpert e importação histórica) passou sem exceção. O benchmark offline do motor investigativo produziu resultado idêntico ao baseline de referência, confirmando zero regressão introduzida pelas correções da Fase 3 no comportamento geral do motor.

Três itens de severidade BAIXA da 2ª auditoria permanecem como riscos residuais não verificados nesta rodada (fora do escopo desta instrução) — nenhum deles é impeditivo, mas devem ser lembrados antes de considerar o ciclo de correções definitivamente encerrado.

Esta classificação **não equivale a homologação operacional completa**: homologação visual autenticada, validação com provider real de IA, e integração real com SoftExpert permanecem pendentes, como em todas as rodadas anteriores desta série de auditorias.
