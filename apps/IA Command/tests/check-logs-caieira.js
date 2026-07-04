'use strict';
const BASE_DIR = require('path').resolve(__dirname, '..');
process.chdir(BASE_DIR);
const { inicializarDB, getDB } = require(BASE_DIR + '/modules/database/index');
inicializarDB();
const db = getDB();

// Busca o registro do teste 1 (CAIEIRA por produto + devoluções)
const rows = db.prepare(`
  SELECT empresa_id, duracao_ms, resultado_tipo, sql_gerado, sql_ia_bruto,
         sql_validacao_erro, resposta_entregue, texto_original, criado_em
  FROM interpretation_log
  WHERE texto_original LIKE '%devoluc%' OR texto_original LIKE '%devolução%'
  ORDER BY criado_em DESC
  LIMIT 6
`).all();

console.log('Registros com devolução:', rows.length);
for (const r of rows) {
  console.log('\n' + '='.repeat(80));
  console.log(`empresa=${r.empresa_id} | ${r.criado_em} | ${r.duracao_ms}ms | tipo=${r.resultado_tipo}`);
  console.log(`TEXTO: ${r.texto_original}`);
  if (r.sql_validacao_erro) console.log(`\nERRO VALIDACAO:\n${r.sql_validacao_erro}`);
  console.log('\nSQL GERADO:');
  console.log(r.sql_gerado || '(vazio)');
  if (r.sql_ia_bruto && r.sql_ia_bruto !== r.sql_gerado) {
    console.log('\nSQL IA BRUTO (antes de validação):');
    console.log(String(r.sql_ia_bruto).slice(0, 1000));
  }
}
process.exit(0);
