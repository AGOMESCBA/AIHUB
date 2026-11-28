'use strict';

// C10 — contrato da Onda 1 (docs/contratos.md §9) no servidor simulado: configuração do setor,
// menu de setores (triagem), rodízio (oferta), pesquisa de satisfação, status do atendente,
// alertas, painel ao vivo e relatório. O servidor real segue nas etapas C11–C16.

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServidorSimulado } = require('../backend/simulado/servidor-simulado');
const { camposFaltando } = require('../backend/contratos');

const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);

async function comSimulado(t) {
  const sim = criarServidorSimulado({ intervaloLogMs: 60000, intervaloQrMs: 60000, intervaloConversaMs: 0, log: { error() {} } });
  const { port } = await sim.iniciar(0);
  t.after(() => sim.fechar());
  const api = async (caminho, { metodo = 'GET', corpo, atendente = false } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/app/ia-talk/api/admin${caminho}`, {
      method: metodo, headers: { 'Content-Type': 'application/json', ...(atendente ? { 'X-Talk-Simular': 'atendente' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, corpo: await r.json() };
  };
  return { api, sim };
}

// A pesquisa nasce desligada: liga no Suporte antes de testá-la.
async function ligarPesquisa(api) {
  const s = (await api('/setores/set_suporte')).corpo;
  assert.equal((await api('/setores/set_suporte', { metodo: 'PUT', corpo: { versao: s.versao, pesquisa: { ligada: true } } })).status, 200);
}

test('formas: setor e conversa com os blocos novos, atendente, alerta e painel', async (t) => {
  const { api } = await comSimulado(t);
  const setores = (await api('/setores')).corpo.itens;
  setores.forEach(s => { forma('setor', s); forma('setorOnda1', s); });
  const suporte = setores.find(s => s.codigo === 'suporte');
  assert.equal(suporte.distribuicao.modo, 'rodizio');
  assert.equal(setores.find(s => s.codigo === 'financeiro').pesquisa.ligada, false, 'pesquisa nasce desligada');
  (await api('/conversas?visao=todas&limite=200')).corpo.itens.forEach(c => { forma('conversaResumo', c); forma('conversaOnda1', c); });
  forma('atendente', (await api('/atendentes/eu')).corpo);
  const alerta = (await api('/simulado/alerta', { metodo: 'POST', corpo: {} })).corpo;
  forma('alerta', alerta);
  assert.doesNotMatch(JSON.stringify(alerta), /\d{12,13}/, 'alerta sem telefone');
  const lista = (await api('/alertas')).corpo.itens;
  assert.equal(lista[0].id, alerta.id);
  assert.equal((await api('/alertas/lidos', { metodo: 'POST', corpo: { todos: true } })).corpo.marcados, 1);
  forma('painelAtendimento', (await api('/atendimento/painel')).corpo);
});

test('configuração do setor: validação de cada bloco e campos parciais', async (t) => {
  const { api } = await comSimulado(t);
  const s = (await api('/setores')).corpo.itens.find(x => x.codigo === 'comercial');
  const erro = await api(`/setores/${s.id}`, { metodo: 'PUT', corpo: { versao: s.versao, distribuicao: { modo: 'sorteio' }, menu: { texto: 'x'.repeat(61) } } });
  assert.equal(erro.status, 400);
  assert.ok(erro.corpo.erro.campos.distribuicao && erro.corpo.erro.campos.menu);
  const ok = await api(`/setores/${s.id}`, { metodo: 'PUT', corpo: { versao: s.versao, distribuicao: { modo: 'rodizio' }, pesquisa: { ligada: true } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.corpo.distribuicao, { modo: 'rodizio', limite_por_atendente: 5, tempo_aceite_min: 3 }, 'parcial mantém o resto');
  assert.equal(ok.corpo.pesquisa.ligada, true);
  const novo = await api('/setores', { metodo: 'POST', corpo: { nome: 'Fiscal', sla: { primeira_resposta_min: 30 } } });
  assert.equal(novo.status, 201);
  assert.equal(novo.corpo.sla.primeira_resposta_min, 30);
  assert.equal(novo.corpo.alertas.whatsapp_ligado, false, 'alertas no WhatsApp nascem desligados');
});

test('menu de setores: conversa nova em triagem, escolha pelo número e setor padrão após tentativas', async (t) => {
  const { api } = await comSimulado(t);
  assert.equal((await api('/canais/cn_suporte', { metodo: 'PUT', corpo: { menu_tempo_min: 0 } })).status, 400);
  const canal = (await api('/canais/cn_suporte', { metodo: 'PUT', corpo: { menu_ligado: true, menu_tentativas: 2 } })).corpo;
  assert.equal(canal.atendimento.menu.ligado, true);

  // Juliana (só conversas encerradas): conversa nova em triagem, fora da fila.
  const c1 = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex7', texto: 'Oi' } })).corpo;
  assert.ok(c1.triagem);
  assert.equal(c1.na_fila, false, 'em triagem não está na fila de nenhum setor');
  assert.ok(!(await api('/conversas?visao=fila')).corpo.itens.some(c => c.id === c1.id), 'triagem não aparece na fila');
  assert.ok((await api('/conversas?visao=triagem')).corpo.itens.some(c => c.id === c1.id));
  assert.equal((await api('/conversas/contadores')).corpo.triagem, 1);
  const menu = (await api(`/conversas/${c1.id}/itens?limite=5`)).corpo.itens.find(i => i.autor.tipo === 'sistema');
  assert.match(menu.texto, /1 – Suporte\n2 – Financeiro\n3 – Comercial/);
  const escolha = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex7', texto: '2' } })).corpo;
  assert.equal(escolha.triagem, null);
  assert.equal(escolha.setor.nome, 'Financeiro');

  // Marcos: duas respostas inválidas → setor padrão (Suporte).
  await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: 'Bom dia' } });
  await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: 'quero falar com alguém' } });
  const padrao = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: 'hein?' } })).corpo;
  assert.equal(padrao.triagem, null);
  assert.equal(padrao.setor.nome, 'Suporte');
  assert.equal((await api(`/conversas/${padrao.id}/assumir`, { metodo: 'POST' })).status, 200);
});

test('rodízio: conversa oferecida a uma pessoa; outra pessoa não assume (supervisão pode)', async (t) => {
  const { api, sim } = await comSimulado(t);
  const joao = (await api('/conversas/cv_ex02', { atendente: true })).corpo;
  assert.equal(joao.oferta.para.nome, 'Carla Souza');
  // Oferecida ao Bruno: a Carla (atendente) não pode assumir.
  sim.dados.atendimento.conversas.find(c => c.id === 'cv_ex02').oferta = { para: { id: 'usr_bruno', nome: 'Bruno Lima' }, ate: new Date(Date.now() + 60000).toISOString() };
  const negado = await api('/conversas/cv_ex02/assumir', { metodo: 'POST', atendente: true });
  assert.equal(negado.status, 409);
  assert.match(negado.corpo.erro.mensagem, /oferecida a Bruno Lima/);
  const sup = await api('/conversas/cv_ex02/assumir', { metodo: 'POST' }); // supervisão
  assert.equal(sup.status, 200);
  assert.equal(sup.corpo.oferta, null, 'assumir encerra a oferta');
});

test('pesquisa de satisfação: enviada ao encerrar; a nota é registrada e não abre conversa nova', async (t) => {
  const { api } = await comSimulado(t);
  await ligarPesquisa(api);
  const enc = (await api('/conversas/cv_ex01/encerrar', { metodo: 'POST', corpo: {} })).corpo;
  assert.ok(enc.pesquisa?.enviada_em);
  assert.equal(enc.pesquisa.nota, null);
  const antes = (await api('/conversas?visao=todas&limite=200')).corpo.itens.length;
  const r = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex1', texto: '4' } })).corpo;
  assert.equal(r.id, 'cv_ex01');
  assert.equal(r.pesquisa.nota, 4);
  assert.equal((await api('/conversas?visao=todas&limite=200')).corpo.itens.length, antes, 'nenhuma conversa nova');
  const rel = (await api('/atendimento/relatorio?agrupar=setor')).corpo;
  assert.equal(rel.satisfacao.respostas, 2);
  assert.ok(rel.grupos.length >= 2);
  assert.equal((await api('/atendimento/relatorio?agrupar=cliente')).status, 400);
});

test('status do atendente: troca, validação e quem vê a equipe', async (t) => {
  const { api } = await comSimulado(t);
  assert.equal((await api('/atendentes/eu', { metodo: 'PUT', corpo: { status: 'almoço' } })).status, 400);
  const eu = (await api('/atendentes/eu', { metodo: 'PUT', corpo: { status: 'ocupado', alertas_whatsapp: true }, atendente: true })).corpo;
  assert.equal(eu.status, 'ocupado');
  assert.equal(eu.alertas_whatsapp, true);
  assert.equal(eu.usuario.nome, 'Carla Souza');
  assert.equal((await api('/atendentes', { atendente: true })).status, 403, 'atendente não vê a equipe');
  assert.equal((await api('/atendimento/painel', { atendente: true })).status, 403);
  const equipe = (await api('/atendentes?setor_id=set_suporte')).corpo.itens;
  assert.deepEqual(equipe.map(a => a.usuario.nome).sort(), ['Bruno Lima', 'Carla Souza']);
});

// ── Auditoria da C10 ──────────────────────────────────────────────────────────
test('recusar: só quem recebeu a oferta; passa ao próximo disponível ou volta à fila', async (t) => {
  const { api } = await comSimulado(t);
  assert.equal((await api('/conversas/cv_ex02/recusar', { metodo: 'POST' })).status, 403, 'a oferta é da Carla');
  const r = await api('/conversas/cv_ex02/recusar', { metodo: 'POST', atendente: true });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.oferta.para.nome, 'Bruno Lima', 'próximo disponível e online do setor');
  const eventos = (await api('/conversas/cv_ex02/itens?categoria=evento&limite=2')).corpo.itens.map(i => i.texto);
  assert.deepEqual(eventos, ['Oferecida a Bruno Lima.', 'Carla Souza recusou.']);
  assert.equal((await api('/conversas/cv_ex04/recusar', { metodo: 'POST', atendente: true })).status, 409, 'sem oferta');
});

test('pesquisa: "4" dentro de uma conversa aberta é mensagem, não nota', async (t) => {
  const { api } = await comSimulado(t);
  await ligarPesquisa(api);
  await api('/conversas/cv_ex01/encerrar', { metodo: 'POST', corpo: {} }); // Mariana: pesquisa enviada
  await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex1', texto: 'Esqueci de perguntar uma coisa' } }); // abre conversa nova
  const r = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex1', texto: '4' } })).corpo;
  assert.notEqual(r.id, 'cv_ex01', 'entrou na conversa aberta');
  assert.equal((await api('/conversas/cv_ex01')).corpo.pesquisa.nota, null, 'não virou nota');
});

test('vencimentos: menu sem resposta vai ao setor padrão; oferta sem aceite volta à fila', async (t) => {
  const { api, sim } = await comSimulado(t);
  await api('/canais/cn_suporte', { metodo: 'PUT', corpo: { menu_ligado: true } });
  const c = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex7', texto: 'Oi' } })).corpo;
  const cv = sim.dados.atendimento.conversas.find(x => x.id === c.id);
  cv.triagem.desde = new Date(Date.now() - 11 * 60 * 1000).toISOString(); // passou o tempo do menu (10 min)
  sim.dados.atendimento.conversas.find(x => x.id === 'cv_ex02').oferta.ate = new Date(Date.now() - 1000).toISOString();
  const fila = (await api('/conversas?visao=fila')).corpo.itens;
  const depois = fila.find(x => x.id === c.id);
  assert.equal(depois.triagem, null);
  assert.equal(depois.setor.nome, 'Suporte');
  assert.equal(fila.find(x => x.id === 'cv_ex02').oferta, null, 'oferta vencida');
});

test('menu pela biblioteca X1: "quero o 2 e o 3" é ambíguo (pede de novo), "2." escolhe, "menu" mostra de novo', async (t) => {
  const { api } = await comSimulado(t);
  await api('/canais/cn_suporte', { metodo: 'PUT', corpo: { menu_ligado: true, menu_tentativas: 3 } });
  const c = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: 'Oi' } })).corpo;
  const amb = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: 'quero o 2 e o 3' } })).corpo;
  assert.ok(amb.triagem, 'continua escolhendo (nunca adivinha)');
  assert.equal((await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: 'menu' } })).corpo.triagem.tentativas, 1, 'pedir o menu não gasta tentativa');
  const ok = (await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex8', texto: '2.' } })).corpo;
  assert.equal(ok.id, c.id);
  assert.equal(ok.setor.nome, 'Financeiro');
});
