'use strict';
// Testa ultimaMensagemTabular/mensagemTabular retornando perguntaTexto (a pergunta
// 'out' imediatamente anterior aquela resposta), corrigindo o bug de nome de arquivo
// exportado usar o titulo da SESSAO (sempre a primeira pergunta da conversa) em vez
// da pergunta real daquela resposta especifica, quando ha multiplas perguntas na
// mesma sessao.

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
      grid_config_json TEXT,
      intent_json TEXT,
      criado_em TEXT
    );
  `);
}

function loadStoreWithMemoryDB() {
  const databasePath = path.join(ROOT, 'modules/database/index.js');
  require.cache[require.resolve(databasePath)] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: { getDB: () => db },
  };

  const storePath = path.join(ROOT, 'modules/protheus_whatsapp/session-store.js');
  delete require.cache[require.resolve(storePath)];
  return require(storePath);
}

function seed() {
  const t = (min) => new Date(Date.UTC(2026, 7, 25, 12, min, 0)).toISOString();
  db.prepare(`
    INSERT INTO protheus_chat_sessions (id, empresa_id, celular, titulo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('sessao-1', 5, '5592999999999', 'Faturamento do mes por grupo de produto', t(0), t(0));

  const rowsJson = JSON.stringify([{ grupo_produto: 'AEREM', produto: 'AEREM GRANEL', dia: '01/08/2026', valor_total: 100, quantidade_faturada: 10 }]);

  // Turno 1: primeira pergunta da sessao (define o titulo da sessao) + resposta tabular
  db.prepare(`INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, criado_em) VALUES (?, ?, 'out', ?, ?)`)
    .run('msg-pergunta-1', 'sessao-1', 'Faturamento do mes por grupo de produto', t(0));
  db.prepare(`INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, rows_json, tipo_resultado, criado_em) VALUES (?, ?, 'in', ?, ?, ?, ?)`)
    .run('msg-resposta-1', 'sessao-1', 'Resposta 1', rowsJson, 'sucesso_ai_sql', t(1));

  // Turno 2: SEGUNDA pergunta (diferente), tambem tabular
  db.prepare(`INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, criado_em) VALUES (?, ?, 'out', ?, ?)`)
    .run('msg-pergunta-2', 'sessao-1', 'Faturamento do dia por cliente, nota fiscal e produto', t(2));
  db.prepare(`INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, rows_json, tipo_resultado, criado_em) VALUES (?, ?, 'in', ?, ?, ?, ?)`)
    .run('msg-resposta-2', 'sessao-1', 'Resposta 2', rowsJson, 'sucesso_ai_sql', t(3));
}

setupSchema();
seed();
const store = loadStoreWithMemoryDB();

// 1. ultimaMensagemTabular deve retornar a pergunta do SEGUNDO turno (a mais recente),
// NAO o titulo da sessao (que e sempre a primeira pergunta)
{
  const relatorio = store.ultimaMensagemTabular({ sessaoId: 'sessao-1' });
  assert(relatorio, 'deve encontrar a ultima mensagem tabular');
  assert.strictEqual(relatorio.id, 'msg-resposta-2', 'deve ser a resposta mais recente');
  assert.strictEqual(
    relatorio.perguntaTexto,
    'Faturamento do dia por cliente, nota fiscal e produto',
    'perguntaTexto deve ser a pergunta do turno 2 (a mais recente), nao o titulo da sessao (turno 1)'
  );
}

// 2. mensagemTabular (mensagem especifica) do turno 1 deve retornar a pergunta do
// turno 1, mesmo havendo um turno 2 mais recente na mesma sessao
{
  const relatorio = store.mensagemTabular({ sessaoId: 'sessao-1', mensagemId: 'msg-resposta-1' });
  assert(relatorio, 'deve encontrar a mensagem tabular especifica');
  assert.strictEqual(
    relatorio.perguntaTexto,
    'Faturamento do mes por grupo de produto',
    'perguntaTexto do turno 1 deve ser a pergunta do turno 1, nao vazar a do turno 2'
  );
}

// 3. mensagemTabular do turno 2 deve retornar a pergunta do turno 2
{
  const relatorio = store.mensagemTabular({ sessaoId: 'sessao-1', mensagemId: 'msg-resposta-2' });
  assert.strictEqual(relatorio.perguntaTexto, 'Faturamento do dia por cliente, nota fiscal e produto');
}

console.log('protheus-chat-relatorio-pergunta.test.js: ok');
