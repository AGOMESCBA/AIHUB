'use strict';

const assert = require('assert');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const db = new Database(':memory:');

function setupSchema() {
  db.exec(`
    CREATE TABLE protheus_chat_sessions (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      celular TEXT NOT NULL,
      titulo TEXT,
      criado_em TEXT,
      atualizado_em TEXT
    );

    CREATE TABLE protheus_chat_messages (
      id TEXT PRIMARY KEY,
      sessao_id TEXT NOT NULL,
      direcao TEXT NOT NULL,
      texto TEXT,
      rows_json TEXT,
      tipo_resultado TEXT,
      intent_json TEXT,
      grid_config_json TEXT,
      interpretation_log_id TEXT,
      criado_em TEXT
    );

    CREATE TABLE interpretation_log (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      numero_wa TEXT,
      texto_original TEXT,
      modulo TEXT,
      sql_final_executado TEXT,
      sql_gerado TEXT,
      sql_template TEXT,
      intent_json TEXT,
      intent_canonico_json TEXT,
      intent_canonico_estrutural_json,
      criado_em TEXT
    );

    CREATE TABLE protheus_chat_favorites (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      celular TEXT NOT NULL,
      titulo TEXT,
      pergunta_texto TEXT,
      resposta_mensagem_id TEXT,
      interpretation_log_id TEXT,
      modulo TEXT,
      sql_final_executado TEXT,
      sql_template TEXT,
      intent_json TEXT,
      grid_config_json TEXT,
      rows_preview_json TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TEXT,
      atualizado_em TEXT,
      ultimo_uso_em TEXT
    );
  `);
}

function loadStoreWithMemoryDB() {
  const databasePath = require.resolve(path.join(ROOT, 'modules/database'));
  const databaseIndexPath = require.resolve(path.join(ROOT, 'modules/database/index.js'));
  const mockDatabase = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: { getDB: () => db },
  };
  require.cache[databasePath] = mockDatabase;
  require.cache[databaseIndexPath] = { ...mockDatabase, id: databaseIndexPath, filename: databaseIndexPath };

  const storePath = path.join(ROOT, 'modules/protheus_whatsapp/session-store.js');
  delete require.cache[require.resolve(storePath)];
  return require(storePath);
}

setupSchema();
const store = loadStoreWithMemoryDB();

const agora = new Date('2026-08-25T12:00:00.000Z').toISOString();
const perguntaTexto = 'Faturamento por dia e grupo de produto';
const sqlFinal = `
SET ROWCOUNT 10000;
WITH faturamento AS (
  SELECT COALESCE(SUM(SD2.D2_TOTAL), 0) AS valor_total,
         SUBSTRING(SF2.F2_EMISSAO, 1, 8) AS dia,
         SBM.BM_DESC AS grupo_produto
  FROM SD2010 SD2
  JOIN SF2010 SF2 ON SD2.D2_FILIAL = SF2.F2_FILIAL
  WHERE SF2.F2_EMISSAO BETWEEN '20260801' AND '20260831'
  GROUP BY SUBSTRING(SF2.F2_EMISSAO, 1, 8), SBM.BM_DESC
)
SELECT dia, grupo_produto, SUM(valor_total) AS total_faturamento
FROM faturamento
GROUP BY dia, grupo_produto
ORDER BY dia, grupo_produto;
`;

db.prepare(`
  INSERT INTO protheus_chat_sessions (id, empresa_id, celular, titulo, criado_em, atualizado_em)
  VALUES (?, ?, ?, ?, ?, ?)
`).run('sessao-1', 5, '5592999999999', 'Faturamento', agora, agora);

db.prepare(`
  INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, criado_em)
  VALUES (?, ?, ?, ?, ?)
`).run('msg-pergunta-1', 'sessao-1', 'out', perguntaTexto, agora);

db.prepare(`
  INSERT INTO protheus_chat_messages (
    id, sessao_id, direcao, texto, rows_json, tipo_resultado,
    intent_json, interpretation_log_id, criado_em
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'msg-resposta-1',
  'sessao-1',
  'in',
  'Resposta',
  JSON.stringify([{ dia: '20260801', grupo_produto: 'A', total_faturamento: 1 }]),
  'sucesso_ai_sql',
  JSON.stringify({ periodo: { tipo: 'mes_atual', dataInicio: '20260801', dataFim: '20260831' } }),
  'log-1',
  agora,
);

db.prepare(`
  INSERT INTO interpretation_log (
    id, empresa_id, numero_wa, texto_original, modulo,
    sql_final_executado, intent_canonico_json, criado_em
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'log-1',
  5,
  '5592999999999',
  perguntaTexto,
  'faturamento',
  sqlFinal,
  JSON.stringify({ periodo: { tipo: 'mes_atual', dataInicio: '20260801', dataFim: '20260831' } }),
  agora,
);

const favorito = store.favoritarMensagem({
  sessaoId: 'sessao-1',
  empresaId: 5,
  celular: '5592999999999',
  mensagemId: 'msg-resposta-1',
});

assert.ok(favorito);
const salvo = db.prepare('SELECT sql_final_executado FROM protheus_chat_favorites LIMIT 1').get();
assert.ok(salvo.sql_final_executado.includes("BETWEEN '{{INICIO_MES}}' AND '{{FIM_MES}}'"));
assert.ok(!salvo.sql_final_executado.includes('20260801'));
assert.ok(!salvo.sql_final_executado.includes('20260831'));

console.log('protheus-chat-favorite-macro-period-hint ok');
