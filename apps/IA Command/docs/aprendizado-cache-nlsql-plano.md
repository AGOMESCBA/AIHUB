# Plano - Aprendizado da IA / Cache de Perguntas Rotineiras (NL->SQL)

Objetivo: reduzir custo e latencia em perguntas ERP repetidas, sem enfraquecer contexto conversacional, validacao SQL ou seguranca multi-tenant.

Regras gerais:
- Nenhuma etapa altera o comportamento de producao ate estar ativada por flag.
- Nenhuma etapa remove guards existentes (`entity-sql-guard.js`, `empresa-scope-sql-guard.js`, `_sqlBaseSeguro`).
- Escopo de seguranca (`empresa_id`, `numero_wa`, `erp_tipo`, `erp_id`, `cod_aprov_erp`) faz parte da chave ou do filtro obrigatorio de lookup.
- SQL servido por cache deve passar novamente pelos mesmos validadores antes de executar.

## Etapa 0 - Fundacao

Status: parcialmente implementada.

Entregue:
- Pasta dedicada `modules/erp/nlsql-cache/` para manter organizados os fontes do aprendizado/cache NL-SQL.
- Modulo `modules/erp/nlsql-cache/canonical-intent.js` para gerar Intent Canonico e chave estrutural.
- Contrato versionado com `schema_version`, `spec_version`, `prompt_version`, `model`, modulo, metrica, `date_basis`, `group_by`, periodo, filtros, entidades e `security_scope`.
- Validacao inicial por catalogo de filtros, agrupamentos e bases temporais por modulo.
- Hash completo (`intent_canonico_hash`) e hash estrutural para cache (`chave_cache`).
- Migration v53 em `execution_log` com colunas de intent, chave, SQL final/template e status de confiabilidade.
- Compatibilidade em `database/index.js` para bases ja existentes.
- Gravacao das novas colunas no resumo `execution_log`.
- Gravacao do Intent Canonico e do template SQL tambem em `interpretation_log`.
- Exibicao dos campos de cache/template nas telas de auditoria.
- Quarentena temporal conservadora: sucesso entra como `pendente`; depois de 30 min pode virar `confiavel`; feedback negativo recente bloqueia o cache.
- Janela de promocao configuravel por ambiente:
  - `IAC_NLSQL_CACHE_QUARANTINE_MINUTES`: minutos antes de promover cache `pendente` para `confiavel` (default: `30`; em teste pode ser `0`).
  - `IAC_NLSQL_CACHE_FEEDBACK_WINDOW_MINUTES`: janela para bloquear execucoes recentes quando o usuario reporta erro (default: `30`; em producao recomenda-se manter conservador).
- Teste unitario `canonical-intent.test.js`.

Pendente:
- Refinar catalogos por modulo com enums mais especificos de metricas e filtros.
- Refinar apresentacao visual do Intent Canonico, se a auditoria JSON ficar pesada para uso diario.

## Etapa A - Reaproveitamento deterministico

Status: parcialmente iniciada.

Entregue:
- Helper `modules/erp/nlsql-cache/sql-template.js` para gerar template SQL com placeholders de periodo/filtros.
- Funcao reversa para aplicar valores atuais ao template.
- Persistencia de `sql_template` e `sql_template_parametros_json`.
- Lookup deterministico antes da LLM atras da flag `IAC_NLSQL_DETERMINISTIC_CACHE=1`.
- Reexecucao pelo caminho seguro `executarSqlDireto`, mantendo validadores existentes.
- Teste unitario `sql-template.test.js`.

Passos:
- Cobrir testes de seguranca por usuario/perfil e versionamento.
- Rodar em staging com a flag ligada e medir hit rate/latencia.
- Para teste ponta a ponta imediato, usar `IAC_NLSQL_DETERMINISTIC_CACHE=1` e `IAC_NLSQL_CACHE_QUARANTINE_MINUTES=0`; em producao, manter a quarentena padrao de 30 minutos.
- Validacao local: com `IAC_NLSQL_CACHE_QUARANTINE_MINUTES=0`, uma pergunta repetida de compras foi servida com `sql_canonico_origem=cache_deterministico`, reaplicando 2 parametros do template.

## Etapa B - Backfill + few-shot semantico

Status: primeiros passos implementados.

Entregue:
- Migration v56 e compatibilidade em `database/index.js` para a tabela `nlsql_semantic_examples`.
- Modulo `modules/erp/nlsql-cache/nlsql-semantic-examples.js` para backfill oportunista de execucoes confiaveis.
- Rotina administrativa `admin-nlsql-backfill.html` para consultar status e processar historico confiavel em lotes.
- Worker administrativo `admin-nlsql-embeddings.html` para gerar embeddings reais dos exemplos pendentes.
- Busca estrutural inicial por modulo/intencao/metrica/filtros/agrupamentos/escopo, ainda sem autoexecucao.
- Ranking hibrido opcional usando embedding real + pre-filtro estrutural obrigatorio de modulo/intencao/metrica/agrupamento/entidade.
- Injecao opcional de few-shot consultivo no prompt via flag `IAC_NLSQL_SEMANTIC_FEWSHOT=1`.
- Exemplos entram no prompt apenas para orientar padrao de SQL; a LLM continua gerando e validando a consulta normalmente.

Flags iniciais:
- `IAC_NLSQL_SEMANTIC_FEWSHOT`: ativa o backfill oportunista e o few-shot semantico (`1` para ligar).
- `IAC_NLSQL_SEMANTIC_BACKFILL_LIMIT`: maximo de execucoes confiaveis indexadas por chamada (default: `50`).
- `IAC_NLSQL_SEMANTIC_FEWSHOT_LIMIT`: maximo de exemplos enviados ao prompt (default: `3`, maximo: `5`).
- `IAC_NLSQL_SEMANTIC_FEWSHOT_THRESHOLD`: limiar estrutural inicial (default: `0.45`).
- `IAC_NLSQL_EMBEDDING_PROVIDER`: provider de embeddings (default: `openai`).
- `IAC_NLSQL_EMBEDDING_MODEL`: modelo de embeddings (default: `text-embedding-3-small`).
- `IAC_NLSQL_SEMANTIC_EMBEDDING_RANKING`: ativa ordenacao por embeddings (`1` para ligar); falhas retornam ao ranking estrutural.

Proximos passos:
- Medir qualidade dos candidatos antes de qualquer promocao para auto-reuse.

## Etapa C - Auto-reuse semantico

Status: shadow mode inicial implementado, sem autoexecucao.

Entregue:
- Migration v57 e compatibilidade em `database/index.js` para `nlsql_semantic_shadow_log`.
- Flag `IAC_NLSQL_SEMANTIC_SHADOW=1` para ativar medicao em misses do cache deterministico.
- O candidato semantico e buscado antes da LLM, mas nunca e executado.
- Quando `IAC_NLSQL_SEMANTIC_EMBEDDING_RANKING=1`, o shadow usa o mesmo candidato ranqueado por embedding hibrido e grava a fonte do score em `detalhes_json`.
- Apos uma execucao real bem-sucedida da LLM, o sistema compara o template candidato contra o template real gerado.
- O log classifica o resultado como `sem_candidato`, `template_invalido`, `match_template_exato`, `match_sql_aplicado_exato` ou `mismatch`.
- `auto_reuse_elegivel` e apenas uma marcacao estatistica de shadow mode; nao existe rota de producao usando isso.
- Auditoria administrativa `admin-nlsql-shadow.html` para consultar indicadores, grid e detalhe candidato x SQL real.
- Calibracao administrativa `admin-nlsql-calibracao.html` para medir precisao por faixa de score, modulo e fonte do ranking.
- Recomendacao conservadora de limiar apenas quando ha amostra minima e precisao template >= 99,50%.
- Classificacao automatica dos candidatos em `aprovado_automatico`, `reprovado_automatico`, `inconclusivo` ou `bloqueado_por_risco`.
- Override opcional por excecao (`aprovado_usuario`, `reprovado_usuario`, `ignorado_usuario`, `bloqueado_usuario`) sem tornar review manual obrigatorio.
- Decisoes automaticas `admin-nlsql-politicas.html` por modulo/fonte/faixa de score, com status calculado `observacao`, `elegivel`, `liberado` ou `bloqueado`; ajuste manual fica como excecao.
- Configuracao operacional por empresa para ligar/desligar Shadow Mode, auto-reuse semantico e auto-liberacao por precisao, mantendo Shadow Mode independente da execucao automatica.
- Auto-reuse semantico controlado pela configuracao da empresa, com override opcional via `IAC_NLSQL_SEMANTIC_AUTO_REUSE`, usando apenas candidato em politica persistida como `liberado`, template parametrizado aplicado ao Intent atual e revalidacao completa pelo executor seguro.

Flags de shadow:
- `IAC_NLSQL_SEMANTIC_SHADOW`: override de ambiente para shadow mode (`0` desliga; `1` forca ligado; vazio usa a configuracao da tela por empresa).
- `IAC_NLSQL_SEMANTIC_SHADOW_THRESHOLD`: limiar minimo para escolher candidato de shadow (default: `0.7`).
- `IAC_NLSQL_SEMANTIC_SHADOW_LIMIT`: maximo de candidatos considerados para shadow (default: `1`, maximo: `5`).
- `IAC_NLSQL_SEMANTIC_AUTO_REUSE_THRESHOLD`: limiar estatistico para marcar candidato como elegivel no log (default: `0.98`). Nao executa reuso automatico.
- `IAC_NLSQL_SEMANTIC_AUTO_REUSE`: override de ambiente para execucao semantica controlada (`0` desliga tudo; `1` forca ligado; vazio usa a configuracao da tela por empresa).
- `IAC_NLSQL_SEMANTIC_AUTO_REUSE_EXEC_THRESHOLD`: limiar minimo de score para servir auto-reuse semantico (default: `0.995`).

Proximos passos:
- Rodar shadow por volume suficiente em staging/producao controlada.
- Acompanhar a tela de calibracao por precisao minima, nao por F1.
- Exigir pre-filtro estrutural obrigatorio e evidencia de precisao antes de qualquer flag real de auto-reuse.
