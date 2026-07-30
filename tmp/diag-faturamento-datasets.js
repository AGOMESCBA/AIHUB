'use strict';

const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..', 'apps', 'IA Command');
process.chdir(BASE_DIR);

const { inicializarDB, getDB } = require(path.join(BASE_DIR, 'modules/database/index'));
inicializarDB();

const db = getDB();
const tables = db.prepare(`
  SELECT name
    FROM sqlite_master
   WHERE type = 'table'
     AND name IN ('datasets', 'intentions', 'intencoes', 'interpretation_log')
   ORDER BY name
`).all();

console.log('tables:', JSON.stringify(tables, null, 2));

const cols = db.prepare('PRAGMA table_info(datasets)').all();
console.log('dataset cols:', cols.map(c => c.name).join(', '));

const rows = db.prepare(`
  SELECT id,
         empresa_id,
         nome,
         modulo,
         spec,
         view_nome,
         campo_data,
         ativo_ia_owner,
         substr(exemplos_perguntas, 1, 180) AS exemplos,
         substr(regras_semanticas, 1, 180) AS regras,
         substr(campos_semanticos_json, 1, 260) AS campos
    FROM datasets
   WHERE lower(coalesce(modulo, '')) LIKE '%fatur%'
      OR lower(coalesce(spec, '')) LIKE '%fatur%'
      OR lower(coalesce(nome, '')) LIKE '%fatur%'
      OR lower(coalesce(view_nome, '')) LIKE '%fatur%'
   ORDER BY empresa_id, id
   LIMIT 30
`).all();

console.log('datasets faturamento:', JSON.stringify(rows, null, 2));
