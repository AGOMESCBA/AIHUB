'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../backend/database');
database.inicializarDB(':memory:');
const repo = require('../backend/repositories/chamado-repository');
after(() => database.fecharDB());
for (const empresa of [1, 2]) database.getDB().prepare(`INSERT INTO fontes_historicas
  (id, empresa_id, connection_key, nome, sistema_origem, adapter, criado_em, atualizado_em)
  VALUES (?, ?, 'fixture', 'Teste', 'teste', 'fixture', '2026-10-30', '2026-10-30')`).run(`fonte-${empresa}`, empresa);
function chamado(empresa, numero, descricao) {
  return repo.upsertChamado(empresa, { fonteId: `fonte-${empresa}`, oidOrigem: numero, numero,
    sistemaOrigem: 'teste', produto: 'Protheus', descricao }).chamado;
}

test('erro novo do print recupera chamado que a descrição genérica não encontrava e mantém isolamento', () => {
  const atual = chamado(1, '1', 'Falha na operação solicitada');
  const anterior = chamado(1, '2', 'M185GRV APLIB190 EXISTBLOCK');
  chamado(2, '3', 'M185GRV APLIB190 EXISTBLOCK');
  assert.equal(repo.listarChamadosRelacionados(1, atual.id).length, 0);
  const encontrados = repo.listarChamadosRelacionados(1, atual.id, { textoContexto: 'M185GRV APLIB190 EXISTBLOCK', limite: 5 });
  assert.deepEqual(encontrados.map(c => c.chamado.id), [anterior.id]);
  assert.throws(() => repo.listarChamadosRelacionados(2, atual.id), /não encontrado/i);
});
