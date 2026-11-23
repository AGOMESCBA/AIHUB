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

test('a justificativa mostra termos completos e não aceita coincidência dentro de outra palavra', () => {
  const atual = chamado(1, '101', 'ALFABETICA');
  const anterior = chamado(1, '102', 'ALFABETICA');
  chamado(1, '103', 'SUPERALFABETICA');
  const encontrados = repo.listarChamadosRelacionados(1, atual.id);
  assert.ok(encontrados.some(r => r.chamado.id === anterior.id && r.motivos.some(m => m.includes('alfabetica'))));
  assert.ok(!encontrados.some(r => r.chamado.numero === '103'));
});

test('código técnico alfanumérico curto é recuperado sem casar parte de outra palavra', () => {
  const atual = chamado(1, 'codigo-curto-atual', 'Erro A12');
  const anterior = chamado(1, 'codigo-curto-exato', 'Erro A12');
  const outro = chamado(1, 'codigo-curto-parcial', 'Falha XA12');
  const encontrados = repo.listarChamadosRelacionados(1, atual.id);
  assert.ok(encontrados.some(r => r.chamado.id === anterior.id));
  assert.ok(!encontrados.some(r => r.chamado.id === outro.id));
});

test('PA exige identidade da origem e limita candidatos ao mesmo cliente e empresa', () => {
  const clienteRepo = require('../backend/repositories/cliente-repository');
  const db = database.getDB();
  const a = clienteRepo.upsertCliente(1, { cnpj: '11222333000181' }).cliente;
  const b = clienteRepo.upsertCliente(1, { cnpj: '11444777000161' }).cliente;
  const outroTenant = clienteRepo.upsertCliente(2, { cnpj: '11222333000181' }).cliente;
  function criar(empresa, numero, cliente, documento, incluirRaw = true) {
    const c = repo.upsertChamado(empresa, { fonteId: `fonte-${empresa}`, oidOrigem: numero, numero,
      sistemaOrigem: 'softexpert', clienteId: cliente?.id, descricao: 'EXISTBLOCK' }).chamado;
    if (incluirRaw) db.prepare(`INSERT INTO raw_import
      (id, empresa_id, fonte_id, sistema_origem, tabela_origem, oid_origem, dados_json, hash_conteudo, importado_em)
      VALUES (?, ?, ?, 'softexpert', 'DYNITSM', ?, ?, 'fixture', '2026-01-01')`)
      .run(`raw-${empresa}-${numero}`, empresa, `fonte-${empresa}`, numero, JSON.stringify({ CNPJCPF: documento }));
    return c;
  }
  const atual = criar(1, '201', a, a.cnpj);
  const proprio = criar(1, '202', a, a.cnpj);
  criar(1, '203', b, b.cnpj);
  criar(1, '204', a, b.cnpj);
  criar(2, '205', outroTenant, outroTenant.cnpj);
  const semRaw = criar(1, '206', a, a.cnpj, false);
  const resultado = repo.listarChamadosRelacionados(1, atual.id, { escopo: 'cliente_pa' });
  assert.deepEqual(resultado.map(r => r.chamado.id), [proprio.id]);
  assert.equal(repo.identidadeConfirmadaPa(1, atual.id), true);
  assert.equal(repo.identidadeConfirmadaPa(1, semRaw.id), false);
  assert.deepEqual(repo.listarChamadosRelacionados(1, semRaw.id, { escopo: 'cliente_pa' }), []);
  db.prepare('UPDATE clientes SET cnpj = ? WHERE id = ?').run('11222333000180', a.id);
  db.prepare('UPDATE raw_import SET dados_json = ? WHERE id = ?').run(JSON.stringify({ CNPJCPF: '11222333000180' }), 'raw-1-201');
  assert.equal(repo.identidadeConfirmadaPa(1, atual.id), false);
  assert.deepEqual(repo.listarChamadosRelacionados(1, atual.id, { escopo: 'cliente_pa' }), []);
});

test('recupera chamado antigo mesmo com mais de 1.200 registros novos', () => {
  const atual = chamado(1, 'antigo-atual', 'ROTINAX963 FALHAY742');
  const antigo = repo.upsertChamado(1, { fonteId: 'fonte-1', oidOrigem: 'antigo-candidato', numero: 'antigo-candidato', sistemaOrigem: 'teste', dataAbertura: '2001-01-01', descricao: 'ROTINAX963 FALHAY742' }).chamado;
  const pos = repo.upsertPosicionamento(1, { fonteId: 'fonte-1', oidOrigem: 'resultado-antigo', chamadoId: antigo.id, resultado: 'Teste aguardando confirmação.' }).posicionamento;
  const insert = database.getDB().transaction(() => {
    for (let i = 0; i < 1205; i++) repo.upsertChamado(1, { fonteId: 'fonte-1', oidOrigem: `novo-${i}`, numero: `novo-${i}`, sistemaOrigem: 'teste', dataAbertura: '2026-01-01', descricao: 'texto sem relação' });
  });
  insert();
  const encontrados = repo.listarChamadosRelacionados(1, atual.id);
  assert.ok(encontrados.some(r => r.chamado.id === antigo.id));
  assert.equal(encontrados.find(r => r.chamado.id === antigo.id).avaliacao.funcionamento, 'nao_confirmado');
  assert.deepEqual(encontrados.find(r => r.chamado.id === antigo.id).registrosResultado.map(r => r.posicionamentoId), [pos.id]);
});

test('candidatos não expõem credenciais em descrições, resultados ou motivos', () => {
  const atual = chamado(1, 'sigilo-atual', 'INTEGRACAOTESTE123 senha: segredo-atual');
  const anterior = chamado(1, 'sigilo-anterior', 'INTEGRACAOTESTE123 senha: segredo-historico\nAuthorization: Basic ZmFrZXRlc3QxMjM=');
  repo.upsertPosicionamento(1, { fonteId: 'fonte-1', oidOrigem: 'sigilo-resultado', chamadoId: anterior.id, resultado: 'senha: segredo-resultado' });
  const encontrado = repo.listarChamadosRelacionados(1, atual.id).find(r => r.chamado.id === anterior.id);
  assert.ok(encontrado);
  assert.doesNotMatch(JSON.stringify(encontrado), /segredo-(atual|historico|resultado)/);
  assert.doesNotMatch(JSON.stringify(encontrado), /ZmFrZXRlc3QxMjM/);
  assert.ok(encontrado.registrosResultado[0].texto.includes('[REDACTED]'));
});

test('ano e conectores comuns não bastam para relacionar problemas', () => {
  const atual = chamado(1, 'ruido-atual', 'durante 2026 desde quanto');
  chamado(1, 'ruido-anterior', 'durante 2026 desde quanto');
  assert.deepEqual(repo.listarChamadosRelacionados(1, atual.id), []);
});

test('nomes cadastrados do cliente e solicitante não são evidência de similaridade técnica', () => {
  const clientes = require('../backend/repositories/cliente-repository');
  const cliente = clientes.upsertCliente(1, { cnpj: '12345678000199', nome: 'Empresa Abacate' }).cliente;
  const usuario = clientes.upsertUsuarioCliente(1, { clienteId: cliente.id, sistemaOrigem: 'teste', idOrigem: 'pessoa-1', nome: 'Brunella Ribeiro' }).usuario;
  const atual = repo.upsertChamado(1, { fonteId: 'fonte-1', oidOrigem: 'nome-atual', numero: 'nome-atual', sistemaOrigem: 'teste', clienteId: cliente.id, solicitanteId: usuario.id, descricao: 'Brunella Ribeiro Empresa Abacate' }).chamado;
  chamado(1, 'nome-candidato', 'Brunella Ribeiro Empresa Abacate');
  assert.deepEqual(repo.listarChamadosRelacionados(1, atual.id), []);
});

test('módulo e serviço isolados não tornam problemas distintos elegíveis', () => {
  function criar(numero, descricao) {
    return repo.upsertChamado(1, { fonteId: 'fonte-1', oidOrigem: numero, numero, sistemaOrigem: 'teste', modulo: 'Compras', servico: 'Suporte', descricao }).chamado;
  }
  const atual = criar('categoria-atual', 'ROTINA745 VERIFICACAO123');
  const distinto = criar('categoria-outro', 'OUTRA495 SINTOMA678');
  assert.ok(!repo.listarChamadosRelacionados(1, atual.id).some(r => r.chamado.id === distinto.id));
});

test('expansão por IA recupera termo alternativo e informa sua origem', () => {
  const atual = chamado(1, 'expansao-atual', 'RateioAusente123');
  const anterior = chamado(1, 'expansao-candidato', 'APROPRIACAO404 sem configuração');
  assert.ok(!repo.listarChamadosRelacionados(1, atual.id).some(r => r.chamado.id === anterior.id));
  const r = repo.listarChamadosRelacionados(1, atual.id, { termosExpandidos: ['APROPRIACAO404'] }).find(r => r.chamado.id === anterior.id);
  assert.ok(r);
  assert.ok(r.motivos.some(m => /sugeridos pela IA/.test(m) && m.includes('apropriacao404')));
});

test('PA envia à IA apenas candidatos do cliente confirmado', async () => {
  const clientes = require('../backend/repositories/cliente-repository');
  const avaliador = require('../backend/services/base-conhecimento-avaliacao-service');
  const cliente = clientes.upsertCliente(1, { cnpj: '11222333000181' }).cliente;
  const outro = clientes.upsertCliente(1, { cnpj: '11444777000161' }).cliente;
  const db = database.getDB();
  function inserir(numero, c, texto) {
    const chamado = repo.upsertChamado(1, { fonteId: 'fonte-1', oidOrigem: numero, numero, sistemaOrigem: 'softexpert', clienteId: c.id, descricao: texto }).chamado;
    db.prepare(`INSERT INTO raw_import (id, empresa_id, fonte_id, sistema_origem, tabela_origem, oid_origem, dados_json, hash_conteudo, importado_em)
      VALUES (?, 1, 'fonte-1', 'softexpert', 'DYNITSM', ?, ?, 'teste', '2026-01-01')`).run(`raw-${numero}`, numero, JSON.stringify({ CNPJCPF: c.cnpj }));
    return chamado;
  }
  const atual = inserir('ia-pa-atual', cliente, 'ERROTEC999 no processo de compras');
  inserir('ia-pa-proprio', cliente, 'ERROTEC999 no processo de compras');
  inserir('ia-pa-outro', outro, 'ERROTEC999 MARCADORCONFIDENCIAL de outro cliente');
  const candidatos = repo.listarChamadosRelacionados(1, atual.id, { escopo: 'cliente_pa' });
  let entrada = '';
  await avaliador.avaliar(1, atual, candidatos, { resolverConfig: () => ({ keys: {}, cfg: {} }), chamarIA: async (_k, _c, _s, texto) => { entrada = texto; throw new Error('indisponível'); } });
  assert.match(entrada, /ERROTEC999/);
  assert.doesNotMatch(entrada, /MARCADORCONFIDENCIAL/);
});
