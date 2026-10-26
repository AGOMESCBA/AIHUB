// Regressao 2026-10-26 (producao): a fila do tecnico 957 mostrava 5 chamados e
// o Radar 7. A fila exigia aguardando_retorno = 1 no ultimo posicionamento; a
// decisao do usuario e a fila trazer o MESMO universo do Radar (todos os
// abertos do tecnico) e o analista filtrar por "Aguardando" na tela.
// Executar: node --test "apps/IA Service/tests/fila-igual-radar.test.js"
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-fila-radar-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);
const radarRepo = require('../backend/repositories/radar-repository');

after(() => {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
});

const EMPRESA = 98703;
const db = database.getDB();
const agora = new Date().toISOString();
db.prepare(`INSERT INTO fontes_historicas (id, empresa_id, connection_key, nome, sistema_origem, adapter, criado_em, atualizado_em)
  VALUES ('f1', ?, 'k', 'SoftExpert', 'softexpert', 'sqlserver', ?, ?)`).run(EMPRESA, agora, agora);
for (const [id, origem] of [['t957', '957'], ['t12', '12']]) {
  db.prepare(`INSERT INTO tecnicos (id, empresa_id, sistema_origem, id_origem, nome, ativo, criado_em, atualizado_em)
    VALUES (?, ?, 'softexpert', ?, ?, 1, ?, ?)`).run(id, EMPRESA, origem, 'Tecnico ' + origem, agora, agora);
}

// Chamados do 957: 3 com a bola no atendente, 2 aguardando cliente, 1 fornecedor,
// 1 encerrado (nunca entra). Mais 1 aberto de outro tecnico.
const casos = [
  ['c1', '000001', 't957', null, 'RETORNO - ATENDENTE', 1],
  ['c2', '000002', 't957', null, 'RETORNO - ATENDENTE', 1],
  ['c3', '000003', 't957', null, 'RETORNO - ATENDENTE', 0], // posicionamento local defasado
  ['c4', '000004', 't957', null, 'RETORNO - CLIENTE', 0],
  ['c5', '000005', 't957', null, 'RETORNO - CLIENTE', 0],
  ['c6', '000006', 't957', null, 'RETORNO - FORNECEDOR', 0],
  ['c7', '000007', 't957', 'Encerrado', 'RETORNO - CLIENTE', 0],
  ['c8', '000008', 't12', null, 'RETORNO - ATENDENTE', 1],
];
for (const [id, numero, tecnico, status, aguardando, retorno] of casos) {
  db.prepare(`INSERT INTO chamados (id, empresa_id, fonte_id, sistema_origem, oid_origem, numero, tecnico_responsavel_id,
      status_encerramento, aguardando_consolidado, criado_em, atualizado_em)
    VALUES (?, ?, 'f1', 'softexpert', ?, ?, ?, ?, ?, ?, ?)`).run(id, EMPRESA, 'oid-' + id, numero, tecnico, status, aguardando, agora, agora);
  db.prepare(`INSERT INTO posicionamentos (id, empresa_id, fonte_id, oid_origem, chamado_id, data_posicionamento, aguardando_retorno, criado_em, atualizado_em)
    VALUES (?, ?, 'f1', ?, ?, ?, ?, ?, ?)`).run('p-' + id, EMPRESA, 'pos-' + id, id, '2026-10-20T10:00:00', retorno, agora, agora);
}

const numeros = lista => lista.map(c => c.numero).sort();

test('fila do técnico traz os mesmos chamados abertos do Radar/Risco SLA', () => {
  const fila = radarRepo.listarFila(EMPRESA, { tecnicoId: 't957' });
  const risco = radarRepo.listarRiscoSla(EMPRESA, { tecnicoId: 't957' });
  const chamadosRisco = Array.isArray(risco) ? risco : risco.chamados;
  assert.deepEqual(numeros(fila), ['000001', '000002', '000003', '000004', '000005', '000006']);
  assert.deepEqual(numeros(fila), numeros(chamadosRisco));
});

test('encerrados e chamados de outro técnico continuam fora; filtro de SLA segue funcionando', () => {
  const fila = radarRepo.listarFila(EMPRESA, { tecnicoId: 't957' });
  assert.ok(!numeros(fila).includes('000007'));
  assert.ok(!numeros(fila).includes('000008'));
  db.prepare("UPDATE chamados SET sla_prazo = 'Em atraso' WHERE id IN ('c4', 'c1')").run();
  assert.deepEqual(numeros(radarRepo.listarFila(EMPRESA, { tecnicoId: 't957', filtroSla: 'em_atraso' })), ['000001', '000004']);
  assert.equal(radarRepo.listarFila(EMPRESA, { tecnicoId: 't957', filtroSla: 'em_dia' }).length, 4);
});

test('cada chamado traz o "Aguardando" do SoftExpert para o filtro da tela', () => {
  const porNumero = Object.fromEntries(radarRepo.listarFila(EMPRESA, { tecnicoId: 't957' }).map(c => [c.numero, c.aguardandoConsolidado]));
  assert.equal(porNumero['000003'], 'RETORNO - ATENDENTE');
  assert.equal(porNumero['000005'], 'RETORNO - CLIENTE');
  assert.equal(porNumero['000006'], 'RETORNO - FORNECEDOR');
});
