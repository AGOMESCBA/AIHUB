'use strict';

const path = require('path');

const BASE = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE);

const { inicializarDB, getDB } = require(path.join(BASE, 'modules/database/index'));

inicializarDB();
const db = getDB();

const since = process.argv[2] || '2026-07-28T15:33:13.846Z';
const pergunta = process.argv[3] || 'Compare o faturamento de junho do ano passado com julho do ano passado';

const rows = db.prepare(`
  SELECT id, criado_em, empresa_id, modulo, resultado_tipo, rows_count,
         pipeline_origem, origem, sql_canonico_origem, dataset_nome,
         sql_validacao_erro, sql_gerado, resposta_entregue, intent_json
    FROM interpretation_log
   WHERE criado_em >= ?
     AND texto_original = ?
   ORDER BY criado_em
`).all(since, pergunta);

for (const r of rows) {
  console.log(`--- ${r.id} empresa=${r.empresa_id} rows=${r.rows_count} tipo=${r.resultado_tipo} pipeline=${r.pipeline_origem}`);
  console.log('validacao=', r.sql_validacao_erro || '-');
  console.log('sql=', r.sql_gerado || '-');
  console.log('resposta=', String(r.resposta_entregue || '').split('\n').slice(0, 16).join(' | '));
  console.log('intent=', r.intent_json || '-');
}
