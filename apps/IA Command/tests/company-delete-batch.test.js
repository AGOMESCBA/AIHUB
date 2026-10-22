'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const excluir = require('../modules/erp/totvs_protheus/SX/company-delete-batch');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE protheus_company_tree (id TEXT PRIMARY KEY, empresa_id INTEGER, origem TEXT);
    INSERT INTO protheus_company_tree VALUES
    ('a',1,'sys_company'),('b',1,'sys_company_cfg'),('c',2,'sys_company_cfg');`);
  return db;
}

test('exclui IDs explícitos, deduplica e preserva outra empresa', () => {
  const db = fixture();
  try {
    assert.equal(excluir(db, 1, ['a', 'a', 'b']), 2);
    assert.deepEqual(db.prepare('SELECT id FROM protheus_company_tree').all(), [{ id: 'c' }]);
  } finally { db.close(); }
});

test('lista inválida nunca significa zerar a tabela', () => {
  const db = fixture();
  try {
    for (const ids of [undefined, [], 'todos', [1], [''], [null], ['a', {}]]) {
      assert.throws(() => excluir(db, 1, ids), { status: 400 });
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM protheus_company_tree').get().n, 3);
  } finally { db.close(); }
});

test('rejeita lote inteiro com ID de outra empresa, origem errada ou ID obsoleto', () => {
  const db = fixture();
  try {
    for (const [ids, origem] of [[['a', 'c']], [['a', 'ausente']], [['b', 'a'], 'sys_company_cfg']]) {
      assert.throws(() => excluir(db, 1, ids, origem), { status: 409 });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM protheus_company_tree').get().n, 3);
    }
    assert.equal(excluir(db, 1, ['b'], 'sys_company_cfg'), 1);
  } finally { db.close(); }
});

test('falha durante escrita reverte exclusões anteriores', () => {
  const db = fixture();
  try {
    db.exec("CREATE TRIGGER falhar BEFORE DELETE ON protheus_company_tree WHEN OLD.id = 'b' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;");
    assert.throws(() => excluir(db, 1, ['a', 'b']), /falha simulada/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM protheus_company_tree').get().n, 3);
  } finally { db.close(); }
});
