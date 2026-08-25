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
      criado_em TEXT
    );

    CREATE TABLE protheus_chat_favorites (
      id TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL,
      celular TEXT NOT NULL,
      titulo TEXT,
      pergunta_texto TEXT,
      pergunta TEXT,
      resposta_resumo TEXT,
      tags TEXT,
      resposta_mensagem_id TEXT,
      interpretation_log_id TEXT,
      modulo TEXT,
      sessao_origem_id TEXT,
      sql_final_executado TEXT,
      sql_template TEXT,
      intent_json TEXT,
      grid_config_json TEXT,
      rows_preview_json TEXT,
      ativo INTEGER DEFAULT 1,
      criado_em TEXT,
      atualizado_em TEXT,
      ultimo_uso_em TEXT,
      uso_count INTEGER DEFAULT 0
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

function seed() {
  const agora = new Date('2026-08-25T12:00:00.000Z').toISOString();
  db.prepare(`
    INSERT INTO protheus_chat_sessions (id, empresa_id, celular, titulo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('sessao-1', 5, '5592999999999', 'Nome antigo', agora, agora);

  db.prepare(`
    INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, criado_em)
    VALUES (?, ?, ?, ?, ?)
  `).run('msg-pergunta-1', 'sessao-1', 'out', 'Pergunta', agora);

  db.prepare(`
    INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, criado_em)
    VALUES (?, ?, ?, ?, ?)
  `).run('msg-resposta-1', 'sessao-1', 'in', 'Resposta', agora);

  db.prepare(`
    INSERT INTO protheus_chat_favorites (
      id, empresa_id, celular, pergunta_texto, pergunta, resposta_resumo, titulo,
      resposta_mensagem_id, sessao_origem_id, sql_final_executado,
      ativo, criado_em, atualizado_em
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'fav-1',
    5,
    '5592999999999',
    'Favorito antigo',
    'Pergunta',
    'Resposta',
    'Favorito antigo',
    'msg-resposta-1',
    'sessao-1',
    'SELECT 1',
    1,
    agora,
    agora
  );
}

setupSchema();
const store = loadStoreWithMemoryDB();
seed();

const alterou = store.renomearSessao({
  sessaoId: 'sessao-1',
  empresaId: 5,
  celular: '5592999999999',
  titulo: 'Faturamento da semana por cliente',
});

assert.strictEqual(alterou, true);

const sessao = db.prepare('SELECT titulo FROM protheus_chat_sessions WHERE id = ?').get('sessao-1');
assert.strictEqual(sessao.titulo, 'Faturamento da semana por cliente');

const favorito = db.prepare('SELECT titulo FROM protheus_chat_favorites WHERE id = ?').get('fav-1');
assert.strictEqual(favorito.titulo, 'Faturamento da semana por cliente');

const favoritoRenomeado = store.renomearFavorito({
  favoritoId: 'fav-1',
  empresaId: 5,
  celular: '5592999999999',
  titulo: 'Novo nome visivel no IA Command',
});

assert.ok(favoritoRenomeado);
assert.strictEqual(favoritoRenomeado.titulo, 'Novo nome visivel no IA Command');
assert.strictEqual(favoritoRenomeado.pergunta_texto, 'Novo nome visivel no IA Command');

const favoritoNoBanco = db.prepare('SELECT titulo, pergunta_texto FROM protheus_chat_favorites WHERE id = ?').get('fav-1');
assert.strictEqual(favoritoNoBanco.titulo, 'Novo nome visivel no IA Command');
assert.strictEqual(favoritoNoBanco.pergunta_texto, 'Novo nome visivel no IA Command');

console.log('protheus-chat-rename-favorite-title ok');
