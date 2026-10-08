# IA Service — Fase 3: Confirmação das Soluções, Validação Operacional e Integração com o Ciclo de Vida dos Chamados

Responsável pela implementação: Claude
Data: 2026-10-08
Modalidade: implementação incremental, testada, não commitada (conforme restrição da seção 14).

## 1. Arquivos criados e alterados

**Criados:**
- `apps/IA Service/backend/repositories/validacao-solucao-repository.js` — único ponto de acesso SQL à tabela `validacoes_solucao`.
- `apps/IA Service/backend/services/validacao-solucao-service.js` — orquestra confirmação do analista, evidência externa e continuidade investigativa.
- `apps/IA Service/tests/fase3-confirmacao-solucoes.test.js` — 20 cenários obrigatórios da seção 11, no nível de serviço/repositório.
- `apps/IA Service/tests/fase3-rotas-http.test.js` — autorização, isolamento multiempresa e persistência observados via API HTTP real.

**Alterados:**
- `apps/IA Service/backend/database/migrations.js` — migration v41 (tabela `validacoes_solucao` + coluna `chamados.status_encerramento_anterior`).
- `apps/IA Service/backend/repositories/chamado-repository.js` — `upsertChamado` agora captura e expõe a transição de `status_encerramento` (sem SELECT extra).
- `apps/IA Service/backend/services/import/historical-import-service.js` — novo hook best-effort `_registrarEvidenciaExternaSeAplicavel`, no mesmo padrão dos hooks existentes (`_sincronizarAnexosSeAtendimentoExistente`, `_dispararPreAnaliseSePrimeiroContato`).
- `apps/IA Service/backend/routes/index.js` e `externo-routes.js` — rotas de confirmação/leitura de validação e resumo de pendências; `GET /mensagens` agora embute o estado de validação na ficha operacional.
- `apps/IA Service/backend/services/resposta-operacional-service.js` — `construirFichaOperacional`/`anexarFichaOperacional` aceitam e expõem `validacaoSolucao` (compatível, parâmetro novo opcional).
- `apps/IA Service/backend/repositories/mensagem-repository.js` — nenhuma alteração funcional nesta fase (já tinha `atualizarAvisosFonteCorrigido` da correção pós-auditoria da Fase 1/2).
- `apps/IA Service/frontend/atendimento.html` e `radar.html` — widget de confirmação discreta na ficha operacional + indicador de pendências no cabeçalho da fila (Radar).

Nenhuma alteração em `database/index.js`, autenticação, OTP, ou qualquer rota do SoftExpert em si.

## 2. Estrutura de persistência

Tabela `validacoes_solucao` (migration v41), **append-only por decisão explícita** (confirmada com o usuário antes da implementação): cada confirmação ou evidência externa é uma linha nova, nunca um UPDATE/DELETE de evento anterior.

Campos: `id`, `empresa_id`, `atendimento_id`, `mensagem_assistente_id` (FK, a orientação específica avaliada — nunca o atendimento como um todo), `anexo_versao_id` (FK opcional, quando a orientação envolveu fonte corrigido), `dossie_id`, `origem` (`confirmacao_analista` | `evidencia_externa`), `resultado`, `comentario`, `evidencia_fonte`/`evidencia_detalhe_json` (só para evidência externa), `chave_idempotencia` (único parcial por empresa, só para evidência externa), `usuario_id`, `criado_em`.

Coluna adicional `chamados.status_encerramento_anterior`: captura o valor de `status_encerramento` imediatamente antes do UPDATE em `upsertChamado`, sem SELECT extra (a row completa já está em memória nesse ponto) — base para detectar reabertura na sincronização seguinte.

## 3. Estados e regras de confirmação

Estados de confirmação explícita: `RESOLVEU`, `NAO_RESOLVEU`, `PARCIALMENTE`, `NAO_TESTADO`. Estado de evidência externa: `EVIDENCIA_EXTERNA` (nunca interpretado como sucesso/falha). Estado implícito quando não há nenhum evento: `AGUARDANDO_VALIDACAO`.

**Regra de precedência (orientação explícita do usuário durante a implementação, antes do código ser escrito):** o estado atual de uma orientação é o último evento de `confirmacao_analista`, se existir algum — nunca sobrescrito por um evento de `evidencia_externa` posterior, mesmo que mais recente no tempo. Só cai para `EVIDENCIA_EXTERNA` quando nenhuma confirmação explícita jamais existiu. Implementada e testada em `validacao-solucao-repository.obterEstadoAtual`/`obterEstadoAtualPorMensagens` (resolvida em JS, documentada inline, não em SQL).

Idempotência de eventos sincronizados: `evidenciaFonte` + chamadoId + transição de status formam uma chave SHA-256 determinística, protegida por índice único parcial `(empresa_id, chave_idempotencia)`. Uma re-sincronização do mesmo evento retorna o registro já existente (`duplicado: true`), nunca cria uma segunda linha — testado inclusive sob corrida de escrita concorrente (catch de violação de UNIQUE no repositório).

## 4. Integração efetivamente disponível com SoftExpert

Conforme a análise prévia (seção 2 da especificação), confirmei no código real:
- **Sincronização é sempre pull/polling** — não há webhook do SoftExpert. O gatilho real é a abertura da tela do Radar (`radarRefreshService.sincronizarAntesDaFila`, debounce mínimo de 60s por empresa).
- **Não existe campo de "chamado reaberto" nem "data de encerramento"** no SoftExpert/schema atual — ambos são inferidos a partir da transição de `status_encerramento` (`'Encerrado'` → outro valor = reabertura), nunca de um evento explícito da origem.
- **A associação atendimento↔chamado não é uma FK**, é um par `(origem, referencia_externa)` sem garantia de unicidade (`atendimentoRepo.getAtendimentoPorReferencia`) — por isso o hook de evidência externa só age quando esse atendimento já existe e já tem pelo menos uma orientação da IA (mensagem `assistant`); sem isso, não há "ação avaliada" para anotar, e a especificação exige vínculo a uma resposta específica, nunca ao atendimento como um todo.
- Nenhuma chamada nova foi feita ao SoftExpert nem ao Agente Local — o hook consome exclusivamente o resultado já existente de `upsertChamado` (mesmo fluxo de importação/sincronização incremental já em produção).

## 5. Comportamento em encerramento e reabertura

- **Cenário A (encerrado sem evidência de solução aplicada):** registra evidência externa (`evidencia_fonte: 'softexpert_status_encerramento'`), nunca confirma. Testado (cenário 10).
- **Cenário B (encerrado com evidência):** mesmo caminho do cenário A — o payload de evidência (`evidenciaDetalhe`) guarda os status antes/depois para auditoria futura, mas o vocabulário de confirmação explícita nunca é usado. Testado (cenário 11).
- **Cenário C (reaberto):** `evidencia_fonte: 'softexpert_reabertura'`; histórico anterior preservado; se já havia confirmação explícita, ela **não é sobrescrita** (regra de precedência) — testado explicitamente (cenário 12), incluindo a leitura do histórico completo com os dois eventos.
- **Cenário D (continua aberto):** não gera nenhum evento (sem transição) — estado de validação é inteiramente independente do status do chamado.
- **Cenário E (sem informação suficiente):** `statusEncerramentoTransicao` chega `null` ao serviço, que retorna `{ registro: null, motivo: 'sem_transicao' }` sem inventar resultado — testado (cenário 14).

## 6. Interface de confirmação

Widget integrado à ficha operacional (não um formulário separado), em `atendimento.html` e `radar.html` (ambos, incluindo o namespace de sessão externa — ver seção 12). Quatro botões (`Sim, resolveu` / `Não resolveu` / `Resolveu parcialmente` / `Ainda não testei`); comentário via `window.prompt` só solicitado para falha/parcial (opcional, nunca bloqueia); nenhum controle exige preenchimento para registrar sucesso. Após confirmação explícita, o card colapsa para um badge de estado + link "reavaliar", evitando múltiplos controles ativos simultâneos para a mesma orientação. Estado é recarregado a partir do backend a cada vez que a listagem de mensagens é buscada — sobrevive a reload (testado via rota HTTP, cenário 3 de `fase3-rotas-http.test.js`).

## 7. Indicadores no Radar

Rota `GET /radar/validacoes-pendentes` (interna e externa) retorna um resumo agregado por empresa (`{ AGUARDANDO_VALIDACAO, RESOLVEU, NAO_RESOLVEU, PARCIALMENTE, NAO_TESTADO, EVIDENCIA_EXTERNA }`). Exibido como uma linha discreta de texto no cabeçalho da fila (`#validacoes-pendentes-resumo`), carregada uma vez na inicialização da tela (não a cada refresh da fila, que é mais frequente) e nunca bloqueia nem interrompe o carregamento da fila (best-effort, erro silenciado).

**Decisão de design explícita:** o resumo só contabiliza orientações que já têm pelo menos um evento registrado — "nunca avaliada" (zero eventos) não aparece como pendência, porque é o estado mais comum e transformá-lo em alerta visual constante violaria a restrição da seção 6 ("não implementar notificações insistentes"). Testado e confirmado via script dedicado (mensagem sem nenhuma avaliação não entra no resumo).

Não foi criada nenhuma tela administrativa nova — é uma linha de texto dentro da tela já existente.

## 8. Integração com Context Engine e dossiê

Nenhuma chamada ao provider de IA foi adicionada em nenhum caminho desta fase (restrição da seção 14, verificada por leitura do código de `validacao-solucao-service.js` — zero `require` de `ai-provider-client`/`ai-config-service`). A continuidade investigativa (seção 8) usa o mecanismo **já existente** de `investigacao-dossie-atualizador-service.atualizarAposTurno`, via `opcoes.proposta` determinística (um caminho que já existia no motor, usado hoje só pelos testes — aqui passou a ter um consumidor de produção real):

- `RESOLVEU` → ação `REGISTRAR_VALIDACAO` → dossiê vai para `status: 'RESOLVIDO'`.
- `NAO_RESOLVEU` / `PARCIALMENTE` → ação `REGISTRAR_RECORRENCIA` → dossiê volta para `status: 'INVESTIGANDO'`, preservando testes/hipóteses/evidências anteriores (nada é apagado, é o mesmo mecanismo de regressão-guard já auditado nas Fases 1/2).
- `NAO_TESTADO` → nenhuma ação no dossiê (não interpreta como falha nem sucesso).

A validação já existente do motor (`_validarAlteracao`, não duplicada) exige que `REGISTRAR_VALIDACAO` tenha `solucaoAplicada` — o serviço sempre fornece esse dado a partir da própria mensagem avaliada, satisfazendo a regra sem contorná-la. Nenhuma ação nova foi adicionada à allowlist `ACOES` do motor.

A injeção no Context Engine é implícita e compacta: o dossiê atualizado (`resultadoValidacao`, `status`) já é o que `dossie-context-service.montarMemoriaOperacional` usa para montar o prompt da próxima investigação — nenhum histórico de feedback bruto é injetado diretamente, só o resumo que o dossiê já resume.

## 9. Testes executados e resultados

| Suite | Resultado |
|---|---|
| `fase3-confirmacao-solucoes.test.js` (20 cenários obrigatórios da seção 11) | ✅ 20/20 |
| `fase3-rotas-http.test.js` (autorização, isolamento, idempotência via API real) | ✅ todos os asserts |
| `fase1-fontes-corrigidos.test.js` | ✅ sem regressão |
| `fase2-respostas-objetivas.test.js` | ✅ sem regressão |
| `fase1-fase2-pos-auditoria.test.js` | ✅ sem regressão |
| `etapa2-extracao-e-versionamento.test.js` | ✅ sem regressão |
| `etapa3a-dossie-persistente.test.js` | ✅ sem regressão |
| `etapa3b-atualizacao-dossie.test.js` | ✅ sem regressão |
| `base-historica-incremental.test.js` | ✅ sem regressão |
| `base-historica-import.test.js` | ⚠️ 1 falha pré-existente (ver seção 11) — **não introduzida por esta fase**, confirmada por isolamento via `git stash` antes de qualquer edição minha em `chamado-repository.js` |

Mapeamento aos 20 cenários obrigatórios da especificação (seção 11): os 20 itens da especificação foram cobertos 1:1 pelos 20 cenários numerados em `fase3-confirmacao-solucoes.test.js`, mais 3 testes HTTP adicionais (autorização via API, resultado inválido → 400, isolamento via rota real) em `fase3-rotas-http.test.js`.

Nenhum dado real de cliente foi usado; todos os IDs de empresa são sintéticos (97xxx), bancos SQLite temporários próprios por teste, removidos ao final.

## 10. Evidências de homologação

**Backend:** homologado por teste automatizado real (não simulação) — toda a cadeia schema→repositório→serviço→rota HTTP foi exercitada com banco SQLite real e servidor Express real (`fase3-rotas-http.test.js`), incluindo verificação de que o estado de validação sobrevive ao reload da listagem de mensagens.

**Frontend:** sintaxe JS validada estaticamente (parse via `new Function` dos 4 blocos de script inline, sem erro). **Homologação visual em navegador real NÃO foi executada** — ver seção 11.

## 11. Pendências e limitações

- **Homologação visual bloqueada.** Rodar o Atendimento V1/Radar reais exige o processo principal do IAHub com sessão autenticada (login do IA HUB) ou OTP real por WhatsApp — a especificação proíbe explicitamente contornar OTP/autenticação (seção 10/12), e não há ambiente de homologação com essas credenciais disponível nesta sessão. Reporto isso como bloqueio explícito, não como "funciona", conforme pedido na seção 12: *"Se o WhatsApp de atendimento continuar indisponível, registrar a homologação visual como bloqueada."*
- **`base-historica-import.test.js` tem 1 falha pré-existente**, não relacionada a esta fase (`reset deve remover atendimentos do Radar vinculados aos chamados da fonte`) — confirmada por reprodução isolada (stash temporário do meu `chamado-repository.js`, falha persiste sem minha alteração). Fora do escopo desta implementação; recomendo investigação separada.
- **Resumo de pendências do Radar é O(atendimentos com evento) em JS**, não uma query agregada única — aceitável no volume atual (reaproveita a mesma lógica já testada de precedência, evitando duplicar a regra em SQL), mas deve ser revisitado se o volume de eventos crescer muito antes da Fase 4.
- **Rotas externas (`externo-routes.js`) tiveram a superfície mínima original ampliada** deliberadamente (2 rotas novas) — documentado inline no código, decisão necessária porque a especificação exige confirmação tanto no Atendimento V1 quanto no Radar, e o Radar roda nesse namespace quando acessado via login externo.

## 12. Compatibilidade com as Fases 1 e 2

Confirmada por execução real dos testes das duas fases após toda a implementação (seção 9) — zero regressão. Pontos de atenção verificados especificamente:
- `respostaOperacionalService.construirFichaOperacional` ganhou um parâmetro novo (`validacaoSolucao`) com default seguro (`null` → fallback para `AGUARDANDO_VALIDACAO`), mantendo a assinatura anterior 100% compatível — testado com `fase2-respostas-objetivas.test.js` sem qualquer alteração no próprio teste.
- O hook de evidência externa em `historical-import-service.js` segue estritamente o padrão best-effort dos dois hooks já existentes (nunca propaga erro, nunca bloqueia a importação).
- `upsertChamado` manteve a mesma assinatura e contrato de retorno, só adicionando um campo novo (`statusEncerramentoTransicao`) — nenhum chamador existente foi afetado além do novo hook.

## 13. Preparação dos dados para a Fase 4

A tabela `validacoes_solucao` já distingue, de forma estruturada e consultável, exatamente os cinco estados que a especificação pede como pré-requisito da Fase 4 (seção 9): confirmada pelo analista (`RESOLVEU`), parcialmente efetiva (`PARCIALMENTE`), rejeitada (`NAO_RESOLVEU`), ainda não testada (`NAO_TESTADO`), e evidência externa sem confirmação (`EVIDENCIA_EXTERNA`). Nenhuma base global de aprendizado, recuperação automática entre chamados, ranking ou promoção automática foi implementada — todas essas funcionalidades permanecem inteiramente fora de escopo desta fase, conforme restrição da seção 9/14.

## 14. Parecer final

**Classificação: B — Implementada com ressalvas.**

Todos os critérios de aceitação da seção 13 que dependem de teste automatizado foram atendidos e verificados por execução real (não apenas leitura de código): confirmação sem formulário extenso, persistência através de reload, associação correta à orientação, distinção entre confirmação explícita e evidência externa, encerramento nunca gerando confirmação automática, Radar exibindo pendências relevantes, motor considerando resultados negativos/parciais em investigações posteriores, isolamento multiempresa, e nenhuma regressão nas Fases 1/2.

A homologação operacional completa depende dos testes visuais autenticados (seção 13, último parágrafo da especificação) e da integração real com SoftExpert em ambiente controlado — ambos pendentes, não por falha da implementação, mas por ausência de ambiente/credenciais disponíveis nesta sessão, conforme as restrições explícitas da própria especificação (não contornar OTP/autenticação).
