'use strict';

const Database = require('better-sqlite3');
const dbPath = process.argv[2];
if (!dbPath) throw new Error('Informe o caminho do banco.');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const integrity = db.prepare('PRAGMA integrity_check').get();
const quick = db.prepare('PRAGMA quick_check').get();
console.log(JSON.stringify({ dbPath, integrity, quick }, null, 2));
db.close();
