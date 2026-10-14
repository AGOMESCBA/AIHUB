'use strict';

// Executar --dry-run para prévia; sem flags aplica somente a migração do titular.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { preencherLegados } = require('../modules/database/interpretation-owner');
const migration = require('../modules/database/migrations').find(item => item.version === 95);

async function main() {
  const dbPath = path.resolve(__dirname, '../data/ia-command.db');
  const dryRun = process.argv.includes('--dry-run');
  const db = new Database(dbPath, { readonly: dryRun, fileMustExist: true });
  db.pragma('busy_timeout = 10000');
  try {
    if (dryRun) {
      console.log(JSON.stringify({ modo: 'previa', ...preencherLegados(db, { dryRun: true }) }));
      return;
    }
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `ia-command-before-owner-${stamp}.db`);
    await db.backup(backupPath);
    const summary = db.transaction(() => {
      const result = migration.run(db);
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version, descricao, aplicado_em) VALUES (?, ?, ?)')
        .run(migration.version, migration.descricao, new Date().toISOString());
      return result;
    })();
    const persisted = db.prepare("SELECT count(*) AS total FROM interpretation_log WHERE numero_wa_nome IS NOT NULL AND trim(numero_wa_nome) <> ''").get();
    console.log(JSON.stringify({ modo: 'aplicado', ...summary, totalComNome: persisted.total, backup: backupPath }));
  } finally { db.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
