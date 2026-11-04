'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const Database = require('better-sqlite3');
const { localizarErros } = require('../backend/services/analise-log-service');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'iahub-log-historico-'));
const arquivoDb = path.join(pasta, 'historico.db');
let db = new Database(arquivoDb);
db.pragma('foreign_keys = ON');
db.exec('CREATE TABLE chamados (id TEXT PRIMARY KEY, empresa_id INTEGER NOT NULL)');
const migrations = require('../backend/database/migrations');
assert.equal(migrations.filter(m => m.version === 58).length, 1);
db.exec(migrations.find(m => m.version === 58).sql);
db.exec(migrations.find(m => m.version === 59).sql);
db.prepare('INSERT INTO chamados VALUES (?, ?)').run('chamado-A', 1);
const repoPath = require.resolve('../backend/repositories/analise-log-repository');
const old = Module._load;
let repo;
try {
  Module._load = function(request, parent, ...args) {
    if (parent?.filename === repoPath && request === '../database') return { getDB: () => db };
    return old.call(this, request, parent, ...args);
  };
  repo = require(repoPath);
} finally { Module._load = old; }
after(() => {
  db.close();
  assert.equal(path.dirname(path.resolve(pasta)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(pasta).startsWith('iahub-log-historico-'));
  fs.rmSync(pasta, { recursive: true, force: true });
});
function dados(origem = { tipo: 'avulso' }) {
  const b = Buffer.from('informação normal\n'.repeat(60000) + 'THREAD ERROR\nVariable does not exist CTEST on U_TESTE(TESTE.PRW)\n');
  return { resultado: { ...localizarErros(b, 'error.log'), origem }, hashArquivo: crypto.createHash('sha256').update(b).digest('hex') };
}
let id;
test('salva apenas relatório comprimido e mantém resultado após reabrir banco', () => {
  const d = dados(); const r = repo.salvar(1, d); id = r.id;
  assert.ok(r.bytesHistorico < d.resultado.arquivo.tamanho / 50);
  db.close(); db = new Database(arquivoDb); db.pragma('foreign_keys = ON');
  const salvo = repo.obter(1, id);
  assert.equal(salvo.resultado.grupos[0].titulo, d.resultado.grupos[0].titulo);
  assert.equal(salvo.resultado.arquivo.conteudo, undefined);
  assert.equal(salvo.hashArquivo, d.hashArquivo);
  assert.equal(repo.obter(2, id), null);
  assert.equal(repo.listar(2).length, 0);
});
test('adiciona diagnóstico de grupo na mesma análise sem perder os anteriores', () => {
  const d = dados(); d.resultado.grupos[0].analise = { explicacao: 'Hipótese a confirmar.' };
  repo.salvar(1, { ...d, historicoId: id });
  const semNovidade = dados(); repo.salvar(1, { ...semNovidade, historicoId: id });
  assert.equal(repo.obter(1, id).resultado.grupos[0].analise.explicacao, 'Hipótese a confirmar.');
  assert.equal(repo.listar(1).length, 1);
});
test('isola por empresa, valida hash e filtra análises do chamado', () => {
  assert.throws(() => repo.salvar(2, { ...dados(), historicoId: id }), /não encontrada/);
  assert.throws(() => repo.salvar(1, { ...dados(), hashArquivo: 'diferente', historicoId: id }), /diferente/);
  assert.throws(() => repo.salvar(1, { ...dados({ tipo: 'softexpert', arquivoId: 'outro' }), historicoId: id }), /origem difere/);
  const chamado = dados({ tipo: 'chat', chamadoId: 'chamado-A', numero: '123', arquivoId: 'anexo-A' });
  repo.salvar(1, chamado);
  assert.equal(repo.listar(1, { chamadoId: 'chamado-A' }).length, 1);
  assert.equal(repo.listar(1, { avulsos: true }).length, 1);
  assert.throws(() => repo.salvar(2, chamado), /Chamado não encontrado/);
});

test('preserva o criador e identifica o editor sem confundir identidades internas e externas', () => {
  const d = dados();
  const criador = { tipo: 'usuario_iahub', id: '7' };
  const editor = { tipo: 'consultor_externo', id: '7' };
  const salvo = repo.salvar(1, { ...d, autor: criador });
  repo.salvar(1, { ...dados(), historicoId: salvo.id, autor: editor });
  const reaberto = repo.obter(1, salvo.id);
  assert.deepEqual(reaberto.autor, criador);
  assert.deepEqual(reaberto.atualizadoPor, editor);
  assert.deepEqual(repo.listar(1).find(a => a.id === salvo.id).autor, criador);
  assert.equal(repo.obter(2, salvo.id), null);
});

test('migração do histórico aplica pelo inicializador completo e pode ser reaberta', () => {
  const database = require('../backend/database');
  const completo = path.join(pasta, 'completo.db');
  try {
    database.inicializarDB(completo);
    assert.equal(database.getDB().prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 58').get().total, 1);
    assert.equal(database.getDB().prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 59').get().total, 1);
    database.fecharDB(); database.inicializarDB(completo);
    assert.equal(database.getDB().prepare('SELECT COUNT(*) AS total FROM analises_logs').get().total, 0);
  } finally { database.fecharDB(); }
});
