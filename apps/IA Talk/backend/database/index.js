'use strict';

// Banco próprio do IA Talk (SQLite em WAL, mesmo padrão do IA Command e do IA
// Service). O arquivo fica em apps/IA Talk/data/ia-talk.db (fora do git).

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const MIGRACOES = require('./migrations');
const config = require('../config');

function aplicarMigracoes(db, migracoes = MIGRACOES) {
  db.exec(`CREATE TABLE IF NOT EXISTS talk_migracoes (
    versao      INTEGER PRIMARY KEY,
    descricao   TEXT NOT NULL,
    aplicada_em TEXT NOT NULL
  )`);
  const aplicadas = new Set(db.prepare('SELECT versao FROM talk_migracoes').all().map(r => r.versao));
  const pendentes = [...migracoes].sort((a, b) => a.versao - b.versao).filter(m => !aplicadas.has(m.versao));
  const registrar = db.prepare('INSERT INTO talk_migracoes (versao, descricao, aplicada_em) VALUES (?, ?, ?)');
  for (const m of pendentes) {
    db.transaction(() => {
      db.exec(m.sql);
      registrar.run(m.versao, m.descricao, new Date().toISOString());
    })();
  }
  return pendentes.map(m => m.versao);
}

// arquivo ':memory:' nos testes.
function abrirBanco({ arquivo = path.join(config.DIR_DADOS, 'ia-talk.db'), migracoes = MIGRACOES } = {}) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new Database(arquivo);
  if (arquivo !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  aplicarMigracoes(db, migracoes);
  return db;
}

module.exports = { abrirBanco, aplicarMigracoes };
