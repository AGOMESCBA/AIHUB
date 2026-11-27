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
    // Migração que recria tabela (procedimento oficial do SQLite, "Making Other Kinds Of Table
    // Schema Changes"): cópia do banco antes, chaves estrangeiras desligadas só durante a troca
    // (senão o DROP apagaria em cascata as tabelas filhas) e conferência antes de gravar.
    if (m.copiaAntes) copiarAntes(db, m.versao);
    if (m.semChavesEstrangeiras) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        if (typeof m.executar === 'function') m.executar(db);
        else db.exec(m.sql);
        if (m.semChavesEstrangeiras) {
          const quebradas = db.pragma('foreign_key_check');
          if (quebradas.length) throw new Error(`Migração ${m.versao}: ${quebradas.length} referência(s) quebrada(s); nada foi gravado.`);
        }
        registrar.run(m.versao, m.descricao, new Date().toISOString());
      })();
    } finally {
      if (m.semChavesEstrangeiras) db.pragma('foreign_keys = ON');
    }
  }
  return pendentes.map(m => m.versao);
}

// Cópia completa e consistente do banco (VACUUM INTO) ao lado dele, antes de uma migração
// que recria tabela: o pacote de atualização não copia a pasta data/.
function copiarAntes(db, versao) {
  if (!db.name || db.name === ':memory:') return null;
  const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const destino = db.name.replace(/\.db$/i, '') + `.antes-v${versao}-${carimbo}.db`;
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  return destino;
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

module.exports = { abrirBanco, aplicarMigracoes, copiarAntes };
