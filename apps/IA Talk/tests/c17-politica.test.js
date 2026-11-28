'use strict';

// C17 — política de atendimento da empresa (docs/contratos.md §9.10): padrão para todos os setores,
// personalização por bloco e volta ao padrão; SLA completo e inatividade configuráveis (§9.6, §9.9).
// Servidor real (serviço) e simulado (HTTP) seguem a mesma regra (atendimento/config-onda1.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { Atendimento } = require('../backend/atendimento/servico');
const repo = require('../backend/atendimento/repositorio');
const cfg = require('../backend/atendimento/config-onda1');
const { criarServidorSimulado } = require('../backend/simulado/servidor-simulado');
const { camposFaltando } = require('../backend/contratos');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);

function montar() {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  const emp = novoId('empresa');
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, 'J2A', 'j2a', 'ativa', ?, ?)").run(emp, t, t);
  const setor = (codigo) => {
    const id = novoId('setor');
    db.prepare('INSERT INTO setores (id, empresa_id, codigo, nome, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)').run(id, emp, codigo, codigo, t, t);
    return id;
  };
  const suporte = setor('suporte');
  const financeiro = setor('financeiro');
  const acesso = { empresaId: emp, usuarioId: 'usr_x', veTudo: true };
  const atendimento = new Atendimento({ db });
  const publico = (id) => repo.paraSetor(db, repo.buscarSetor(db, emp, id));
  return { db, emp, suporte, financeiro, acesso, atendimento, publico };
}

test('política nasce com os padrões (tudo desligado) e versão 0', () => {
  const m = montar();
  const p = m.atendimento.politica(m.acesso);
  forma('politicaAtendimento', p);
  assert.equal(p.versao, 0);
  assert.equal(p.inatividade.ligada, false);
  assert.equal(p.pesquisa.ligada, false);
  assert.deepEqual(p.sla.prioridade_alta, { primeira_resposta_min: null, proxima_resposta_min: null, resolucao_horas: null });
  assert.deepEqual(p.uso.sla, { seguem: 2, personalizados: 0 });
  forma('setorOnda1', m.publico(m.suporte));
});

test('setores seguem a política; personalizado não muda com ela; null volta a seguir', () => {
  const m = montar();
  m.atendimento.atualizarPolitica(m.acesso, { versao: 0, sla: { primeira_resposta_min: 30, proxima_resposta_min: 15 }, inatividade: { ligada: true } });
  assert.equal(m.publico(m.suporte).sla.primeira_resposta_min, 30, 'segue a política');
  assert.equal(m.publico(m.suporte).inatividade.ligada, true);

  const s = repo.buscarSetor(m.db, m.emp, m.financeiro);
  m.atendimento.atualizarSetor(m.acesso, s.id, { versao: s.versao, sla: { primeira_resposta_min: 5 } });
  const fin = m.publico(m.financeiro);
  assert.equal(fin.sla.primeira_resposta_min, 5);
  assert.equal(fin.sla.proxima_resposta_min, 15, 'personalizar copia o efetivo do momento');
  assert.deepEqual(fin.personalizados, ['sla']);

  m.atendimento.atualizarPolitica(m.acesso, { versao: 1, sla: { primeira_resposta_min: 60 } });
  assert.equal(m.publico(m.suporte).sla.primeira_resposta_min, 60);
  assert.equal(m.publico(m.financeiro).sla.primeira_resposta_min, 5, 'personalizado não muda com a política');
  assert.deepEqual(m.atendimento.politica(m.acesso).uso.sla, { seguem: 1, personalizados: 1 });

  const s2 = repo.buscarSetor(m.db, m.emp, m.financeiro);
  m.atendimento.atualizarSetor(m.acesso, s2.id, { versao: s2.versao, sla: null });
  assert.equal(m.publico(m.financeiro).sla.primeira_resposta_min, 60, 'voltou a seguir');
  assert.deepEqual(m.publico(m.financeiro).personalizados, []);
});

test('validação: conflito de versão, lembrete antes do encerramento, prioridade alta parcial', () => {
  const m = montar();
  assert.throws(() => m.atendimento.atualizarPolitica(m.acesso, { versao: 3, sla: { primeira_resposta_min: 20 } }), (e) => e.status === 409);
  assert.throws(() => m.atendimento.atualizarPolitica(m.acesso, { versao: 0, inatividade: { lembrete_min: 300, encerrar_min: 240 } }),
    (e) => e.status === 400 && /antes do encerramento/.test(e.campos.inatividade));
  assert.deepEqual(cfg.configDaPolitica({ menu: { aparece: false } }), {}, 'o menu é sempre do setor: a política ignora');
  const r = cfg.configDaPolitica({ sla: { prioridade_alta: { primeira_resposta_min: 3 } } });
  assert.deepEqual(r.sla.prioridade_alta, { primeira_resposta_min: 3, proxima_resposta_min: null, resolucao_horas: null }, 'parcial dentro do SLA');
  assert.throws(() => cfg.configDaPolitica({ sla: { prioridade_alta: 5 } }), (e) => e.status === 400 && !!e.campos.sla);
  assert.throws(() => cfg.configDoSetor({ menu: null }), (e) => e.status === 400 && !!e.campos.menu, 'menu não herda: null é inválido');
});

test('simulado: mesma política por HTTP, com herança e volta ao padrão', async (t) => {
  const sim = criarServidorSimulado({ intervaloLogMs: 60000, intervaloQrMs: 60000, intervaloConversaMs: 0, log: { error() {} } });
  const { port } = await sim.iniciar(0);
  t.after(() => sim.fechar());
  const api = async (caminho, metodo = 'GET', corpo) => {
    const r = await fetch(`http://127.0.0.1:${port}/app/ia-talk/api/admin${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
    return { status: r.status, corpo: await r.json() };
  };
  const p0 = (await api('/atendimento/politica')).corpo;
  forma('politicaAtendimento', p0);
  assert.deepEqual(p0.uso.distribuicao, { seguem: 2, personalizados: 1 }, 'o Suporte personalizou a distribuição');
  const p1 = await api('/atendimento/politica', 'PUT', { versao: 0, pesquisa: { ligada: true } });
  assert.equal(p1.status, 200);
  const fin = (await api('/setores/set_financeiro')).corpo;
  assert.equal(fin.pesquisa.ligada, true, 'segue a política');
  forma('setorOnda1', fin);
  const sup = (await api('/setores/set_suporte')).corpo;
  assert.deepEqual(sup.personalizados.sort(), ['alertas', 'distribuicao']);
  const volta = await api('/setores/set_suporte', 'PUT', { versao: sup.versao, distribuicao: null });
  assert.equal(volta.corpo.distribuicao.modo, 'fila_livre');
  assert.equal((await api('/atendimento/politica', 'PUT', { versao: 0, sla: { primeira_resposta_min: 20 } })).status, 409);
});
