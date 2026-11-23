'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../backend/database');
database.inicializarDB(':memory:');
const repo = require('../backend/repositories/chamado-repository');
const clientes = require('../backend/repositories/cliente-repository');
const vetores = require('../backend/services/base-conhecimento-vetores-service');
const hibrida = require('../backend/services/base-conhecimento-hibrida-service');
after(() => database.fecharDB());
const db = database.getDB();
for (const e of [1, 2]) db.prepare(`INSERT INTO fontes_historicas (id, empresa_id, connection_key, nome, sistema_origem, adapter, criado_em, atualizado_em) VALUES (?, ?, 'teste', 'Teste', 'softexpert', 'teste', '2026', '2026')`).run(`fonte-${e}`, e);
const options = { resolverConfig: () => ({ keys: { openai: 'fake' } }), embedder: async () => [1, 0, 0], modelo: 'teste', dimensoes: 3 };
function criar(e, numero, doc) {
  const cliente = clientes.upsertCliente(e, { cnpj: doc }).cliente;
  const c = repo.upsertChamado(e, { fonteId: `fonte-${e}`, oidOrigem: numero, numero, sistemaOrigem: 'softexpert', clienteId: cliente.id, descricao: 'Falha técnica específica' }).chamado;
  db.prepare(`INSERT INTO raw_import (id, empresa_id, fonte_id, sistema_origem, tabela_origem, oid_origem, dados_json, hash_conteudo, importado_em) VALUES (?, ?, ?, 'softexpert', 'DYNITSM', ?, ?, 'x', '2026')`).run(`raw-${e}-${numero}`, e, `fonte-${e}`, numero, JSON.stringify({ CNPJCPF: doc }));
  return c;
}

test('consulta vetorial mantém empresa e identidade do cliente no PA', async () => {
  const atual = criar(1, 'atual-v', '11222333000181');
  const proprio = criar(1, 'proprio-v', '11222333000181');
  const outro = criar(1, 'outro-v', '11444777000161');
  const outraEmpresa = criar(2, 'outra-v', '11222333000181');
  for (const c of [proprio, outro, outraEmpresa]) await vetores.indexarChamado(c.empresaId, c.id, options);
  assert.deepEqual((await vetores.buscar(1, atual.id, { ...options, escopo: 'cliente_pa' })).map(x => x.chamadoId), [proprio.id]);
  assert.deepEqual(new Set((await vetores.buscar(1, atual.id, options)).map(x => x.chamadoId)), new Set([proprio.id, outro.id]));
  db.prepare('DELETE FROM raw_import WHERE oid_origem = ?').run('atual-v');
  assert.deepEqual(await vetores.buscar(1, atual.id, { ...options, escopo: 'cliente_pa' }), []);
});

test('índice vazio e identidade ausente têm diagnósticos distintos', async () => {
  const c = criar(2, 'sem-indice-v', '11222333000181');
  const vazio = await vetores.buscar(2, c.id, { ...options, modelo: 'modelo-inexistente', comDiagnostico: true });
  assert.equal(vazio.estado, 'indice_sem_vetores_elegiveis');
  db.prepare('DELETE FROM raw_import WHERE oid_origem = ?').run('sem-indice-v');
  const semIdentidade = await vetores.buscar(2, c.id, { ...options, escopo: 'cliente_pa', comDiagnostico: true });
  assert.equal(semIdentidade.estado, 'identidade_nao_confirmada');
});

test('identidade PA não usa registro de outro sistema de origem', () => {
  const c = criar(2, 'origem-invalida-v', '11222333000181');
  assert.equal(repo.identidadeConfirmadaPa(2, c.id), true);
  db.prepare('UPDATE raw_import SET sistema_origem = ? WHERE oid_origem = ?').run('outro', 'origem-invalida-v');
  assert.equal(repo.identidadeConfirmadaPa(2, c.id), false);
});

test('índice é invalidado por posicionamento e não grava vetor obsoleto', async () => {
  const c = criar(1, 'alterado-v', '11444777000161');
  await vetores.indexarChamado(1, c.id, options);
  repo.upsertPosicionamento(1, { fonteId: 'fonte-1', oidOrigem: 'pos-v', chamadoId: c.id, descricao: 'nova evidência' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chamados_embeddings WHERE chamado_id = ?').get(c.id).n, 0);
  const result = await vetores.indexarChamado(1, c.id, { ...options, embedder: async () => {
    repo.upsertPosicionamento(1, { fonteId: 'fonte-1', oidOrigem: 'pos-v2', chamadoId: c.id, descricao: 'evidência alterada durante a chamada' });
    return [1, 0, 0];
  } });
  assert.equal(result.estado, 'alterado_durante_indexacao');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chamados_embeddings WHERE chamado_id = ?').get(c.id).n, 0);
});

test('combinação valida os candidatos e preserva texto quando o índice falha', async () => {
  const atual = criar(1, 'atual-h', '11222333000181');
  const proprio = criar(1, 'proprio-h', '11222333000181');
  const outro = criar(1, 'outro-h', '11444777000161');
  const textual = repo.obterCandidatosPorIds(1, atual.id, [proprio.id], { escopo: 'cliente_pa' });
  const originalBusca = vetores.buscar;
  const anterior = process.env.IA_SERVICE_VETORES_ATIVO;
  process.env.IA_SERVICE_VETORES_ATIVO = '1';
  try {
    vetores.buscar = async () => [{ chamadoId: outro.id }, { chamadoId: proprio.id }];
    const resultado = await hibrida.combinar(1, atual.id, textual, { escopo: 'cliente_pa' });
    assert.deepEqual(resultado.candidatos.map(c => c.chamado.id), [proprio.id]);
    assert.equal(resultado.estadoVetorial, 'disponivel');
    vetores.buscar = async () => { throw new Error('indisponível'); };
    const fallback = await hibrida.combinar(1, atual.id, textual, { escopo: 'cliente_pa' });
    assert.equal(fallback.estadoVetorial, 'indisponivel');
    assert.deepEqual(fallback.candidatos, textual);
  } finally {
    vetores.buscar = originalBusca;
    if (anterior === undefined) delete process.env.IA_SERVICE_VETORES_ATIVO; else process.env.IA_SERVICE_VETORES_ATIVO = anterior;
  }
});

test('lote indexa apenas a empresa solicitada e rejeita vetor inválido', async () => {
  criar(2, 'lote-v', '11222333000181');
  const resultado = await vetores.indexarLote(2, { ...options, limite: 20 });
  assert.ok(resultado.examinados > 0);
  const c = criar(2, 'invalido-v', '11222333000181');
  await assert.rejects(vetores.indexarChamado(2, c.id, { ...options, embedder: async () => [NaN, 0, 0] }), /Vetor inválido/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chamados_embeddings WHERE chamado_id = ?').get(c.id).n, 0);
});
