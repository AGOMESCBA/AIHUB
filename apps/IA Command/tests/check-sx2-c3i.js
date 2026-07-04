'use strict';
const BASE_DIR = require('path').resolve(__dirname, '..');
process.chdir(BASE_DIR);
const { inicializarDB, getDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();
const db = getDB();

// Busca o registro do teste 4 (J2A e C3I)
const rows = db.prepare(`
  SELECT empresa_id, duracao_ms, resultado_tipo, sql_gerado, sql_validacao_erro,
         intent_json, texto_original, criado_em
  FROM interpretation_log
  WHERE texto_original LIKE '%J2A%C3I%' OR texto_original LIKE '%C3I%J2A%'
  ORDER BY criado_em DESC
  LIMIT 4
`).all();

for (const r of rows) {
  console.log('\n' + '='.repeat(80));
  console.log(`empresa=${r.empresa_id} | ${r.duracao_ms}ms | tipo=${r.resultado_tipo}`);
  console.log('TEXTO:', r.texto_original);
  if (r.sql_validacao_erro) console.log('ERRO:', r.sql_validacao_erro);
  const intent = r.intent_json ? JSON.parse(r.intent_json) : null;
  if (intent) {
    console.log('FILTROS INTENT:', JSON.stringify(intent.filtros || {}));
    console.log('_empresaMencionadaTexto:', intent._empresaMencionadaTexto || '(nao set)');
    console.log('_empresasMencionadasTextos:', JSON.stringify(intent._empresasMencionadasTextos || []));
  }
  const sql = String(r.sql_gerado || '').slice(0, 600);
  console.log('SQL (600 chars):\n', sql);
}
process.exit(0);
