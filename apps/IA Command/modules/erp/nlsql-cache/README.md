# NL-SQL Cache

Fontes do mecanismo de aprendizado/cache para consultas em linguagem natural que geram SQL.

- `canonical-intent.js`: monta o Intent Canonico versionado e suas chaves.
- `sql-template.js`: parametriza e reaplica templates SQL determinísticos.
- `nlsql-semantic-examples.js`: prepara exemplos confiaveis para backfill e few-shot consultivo.
- `nlsql-embeddings.js`: worker administrativo para gerar embeddings reais dos exemplos e do Intent atual quando o ranking vetorial estiver ativo.
- `nlsql-calibracao.js`: calcula precisao por faixa, modulo e fonte do ranking a partir do shadow mode.
- `nlsql-classificacao.js`: classifica automaticamente candidatos do shadow e permite override opcional por excecao.
- `nlsql-politicas.js`: calcula decisoes automaticas de promocao por modulo/fonte/faixa de score e guarda apenas excecoes operacionais.

Esta pasta nao executa reuso semantico automatico. A Etapa B usa exemplos apenas para orientar o prompt quando `IAC_NLSQL_SEMANTIC_FEWSHOT=1`.
A Etapa C registra shadow mode com `IAC_NLSQL_SEMANTIC_SHADOW=1`, comparando candidato semantico contra o SQL real da LLM sem servir esse candidato ao usuario.
A ordenacao por embeddings e opcional via `IAC_NLSQL_SEMANTIC_EMBEDDING_RANKING=1`; se falhar por chave, API ou vetor ausente, o fluxo volta ao ranking estrutural.
A rotina administrativa `admin-nlsql-backfill.html` processa historico confiavel em lotes controlados, sem executar SQL no ERP.
A rotina administrativa `admin-nlsql-embeddings.html` processa embeddings pendentes em lotes controlados.
A rotina administrativa `admin-nlsql-calibracao.html` mede limiares candidatos para futura decisao, sem ativar auto-reuse.
Cada registro de shadow recebe `classificacao_auto` e `classificacao_efetiva`. O usuario pode sobrescrever a classificacao, mas o fluxo normal nao depende de aprovacao manual.
A rotina `admin-nlsql-politicas.html` mostra decisoes automaticas do sistema (`observacao`, `elegivel`, `liberado`, `bloqueado`) e a configuracao operacional por empresa.
O Shadow Mode e o auto-reuse semantico tem chaves separadas por empresa. O Shadow Mode continua gravando mesmo com auto-reuse desligado. O auto-reuse semantico so executa quando a configuracao da empresa permite, ha politica persistida como `liberado`, o template aplica sem pendencias e o executor seguro aprova novamente o SQL.
`IAC_NLSQL_SEMANTIC_SHADOW=0` desliga a gravacao shadow por ambiente; `=1` forca ligado; sem a variavel, vale a configuracao da tela.
`IAC_NLSQL_SEMANTIC_AUTO_REUSE=0` funciona como kill switch de ambiente; `=1` forca ligado; sem a variavel, vale a configuracao da tela.
