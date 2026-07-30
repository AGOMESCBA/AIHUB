'use strict';

const path = require('path');
const BASE = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE);

const { inicializarDB, getDB } = require(path.join(BASE, 'modules/database/index'));
inicializarDB();
const db = getDB();

const since = process.argv[2] || '2026-07-28T12:31:56.689Z';

const rows = db.prepare(
  "SELECT criado_em,empresa_id,modulo,texto_original,resultado_tipo,rows_count,duracao_ms,pipeline_origem,origem,sql_canonico_origem,dataset_nome,sql_validacao_erro,intent_canonico_hash,chave_cache,resposta_entregue FROM interpretation_log WHERE criado_em>=? ORDER BY criado_em"
).all(since);

console.log('INTERPRETATION_LOG', rows.length);
for (const r of rows) console.log(JSON.stringify(r));

const sh = db.prepare(
  "SELECT criado_em,empresa_id,module,candidate_score,comparacao_resultado,classificacao_auto,classificacao_efetiva FROM nlsql_semantic_shadow_log WHERE criado_em>=? ORDER BY criado_em"
).all(since);

console.log('SHADOW_LOG', sh.length);
for (const r of sh) console.log(JSON.stringify(r));
