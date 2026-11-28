'use strict';

// C8 — contrato do atendimento (docs/contratos.md §8) no servidor simulado:
// formas, quem vê o quê, fila, ações com disputa, resposta pela fila da C3,
// setores, respostas rápidas, uso do número e socket da Central.
// Quando o servidor real ganhar estas rotas (C9–C11), as mesmas regras valem para ele.

const test = require('node:test');
const assert = require('node:assert/strict');
const io = require('../../../node_modules/socket.io/client-dist/socket.io.js');
const { criarServidorSimulado } = require('../backend/simulado/servidor-simulado');
const { camposFaltando, EVENTOS_SOCKET } = require('../backend/contratos');

const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);
const E = EVENTOS_SOCKET.servidor;

// Cada teste com um simulado novo: as ações mudam os dados.
async function comSimulado(t) {
  const sim = criarServidorSimulado({ intervaloLogMs: 60000, intervaloQrMs: 60000, intervaloConversaMs: 0, log: { error() {} } });
  const { port } = await sim.iniciar(0);
  t.after(() => sim.fechar());
  const base = `http://127.0.0.1:${port}`;
  const api = async (caminho, { metodo = 'GET', corpo, atendente = false } = {}) => {
    const r = await fetch(`${base}/app/ia-talk/api/admin${caminho}`, {
      method: metodo, headers: { 'Content-Type': 'application/json', ...(atendente ? { 'X-Talk-Simular': 'atendente' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, corpo: await r.json() };
  };
  return { base, api };
}

test('formas: contadores, conversas, itens, contato, setores e respostas rápidas', async (t) => {
  const { api } = await comSimulado(t);
  forma('contadoresAtendimento', (await api('/conversas/contadores')).corpo);
  const lista = (await api('/conversas?visao=todas&limite=200')).corpo;
  forma('pagina', lista);
  assert.equal(lista.itens.length, 9);
  lista.itens.forEach(c => forma('conversaResumo', c));
  const det = (await api('/conversas/cv_ex01')).corpo;
  forma('conversaDetalhe', det);
  forma('contato', det.contato);
  assert.deepEqual(Object.keys(det.envio).sort(), ['limite_caracteres', 'motivo', 'pode_responder']);
  const itens = (await api('/conversas/cv_ex01/itens')).corpo.itens;
  itens.forEach(i => forma('itemConversa', i));
  assert.ok(itens[0].em >= itens[itens.length - 1].em, 'itens do mais recente para o mais antigo');
  (await api('/setores')).corpo.itens.forEach(s => forma('setor', s));
  (await api('/respostas-rapidas')).corpo.itens.forEach(r => forma('respostaRapida', r));
  forma('contato', (await api('/contatos/ct_ex1')).corpo);
});

test('privacidade: telefone nunca sai completo nas rotas do atendimento', async (t) => {
  const { api } = await comSimulado(t);
  const respostas = await Promise.all(['/conversas?visao=todas&limite=200', '/conversas/cv_ex01', '/contatos/ct_ex1', '/conversas/contadores', '/setores']
    .map(c => api(c)));
  for (const r of respostas) assert.doesNotMatch(JSON.stringify(r.corpo), /\d{12,13}/);
});

test('fila: prioridade alta primeiro, depois quem espera há mais tempo; busca pelo final do telefone e pelo nome', async (t) => {
  const { api } = await comSimulado(t);
  const fila = (await api('/conversas?visao=fila')).corpo.itens;
  assert.deepEqual(fila.map(c => c.contato.nome), ['João Pereira', 'Patrícia Gomes', 'Fernanda Costa'], 'João é alta; depois por espera');
  assert.ok(fila.every(c => c.na_fila && !c.responsavel && c.aguardando_desde));
  assert.deepEqual((await api('/conversas?busca=0011')).corpo.itens.map(c => c.contato.nome), ['João Pereira']);
  assert.deepEqual((await api('/conversas?busca=ricardo')).corpo.itens.map(c => c.protocolo), ['2026-000104']);
  assert.equal((await api('/conversas?visao=qualquer')).status, 400);
  const c = (await api('/conversas/contadores')).corpo;
  assert.equal(c.fila, 3);
  assert.equal(c.abertas, 6);
});

test('atendente vê só os setores dela; o resto é 404 e o cadastro é 403', async (t) => {
  const { api } = await comSimulado(t);
  const minhas = (await api('/conversas', { atendente: true })).corpo.itens;
  assert.ok(minhas.length > 0 && minhas.every(c => c.setor.id === 'set_suporte' || c.responsavel?.id === 'usr_carla'));
  assert.equal((await api('/conversas/cv_ex06', { atendente: true })).status, 404, 'conversa do Financeiro');
  assert.equal((await api('/contatos/ct_ex6', { atendente: true })).status, 404, 'contato só do Financeiro');
  const cont = (await api('/conversas/contadores', { atendente: true })).corpo;
  assert.deepEqual(cont.por_setor.map(s => s.id), ['set_suporte']);
  assert.equal((await api('/setores', { atendente: true })).status, 200, 'lê setores para transferir');
  assert.equal((await api('/setores', { metodo: 'POST', corpo: { nome: 'Novo' }, atendente: true })).status, 403);
  assert.equal((await api('/canais/cn_suporte', { metodo: 'PUT', corpo: { uso: 'atendimento' }, atendente: true })).status, 403);
});

test('assumir: só uma pessoa leva; repetir não muda; devolver volta para a fila', async (t) => {
  const { api } = await comSimulado(t);
  const a = await api('/conversas/cv_ex02/assumir', { metodo: 'POST', atendente: true });
  assert.equal(a.status, 200);
  assert.equal(a.corpo.responsavel.id, 'usr_carla');
  assert.equal((await api('/conversas/cv_ex02/assumir', { metodo: 'POST', atendente: true })).status, 200, 'repetir é inofensivo');
  const outra = await api('/conversas/cv_ex02/assumir', { metodo: 'POST' });
  assert.equal(outra.status, 409);
  assert.match(outra.corpo.erro.mensagem, /Carla Souza já assumiu/);
  assert.equal((await api('/conversas/cv_ex04/devolver', { metodo: 'POST', atendente: true })).status, 403, 'conversa do Bruno');
  const dev = await api('/conversas/cv_ex02/devolver', { metodo: 'POST', atendente: true });
  assert.equal(dev.corpo.responsavel, null);
  assert.equal(dev.corpo.na_fila, true);
  const eventos = (await api('/conversas/cv_ex02/itens?categoria=evento')).corpo.itens.map(i => i.texto);
  assert.match(eventos[0], /devolveu a conversa para a fila/);
});

test('transferir: para setor (fila dele) ou para pessoa do setor; nota interna junto', async (t) => {
  const { api } = await comSimulado(t);
  assert.equal((await api('/conversas/cv_ex01/transferir', { metodo: 'POST', corpo: {} })).status, 400);
  const fora = await api('/conversas/cv_ex01/transferir', { metodo: 'POST', corpo: { setor_id: 'set_financeiro', responsavel_id: 'usr_carla' } });
  assert.equal(fora.status, 400);
  assert.ok(fora.corpo.erro.campos.responsavel_id);
  const s = await api('/conversas/cv_ex01/transferir', { metodo: 'POST', corpo: { setor_id: 'set_financeiro', nota: 'Cliente pediu boleto.' } });
  assert.equal(s.status, 200);
  assert.equal(s.corpo.setor.id, 'set_financeiro');
  assert.equal(s.corpo.responsavel, null);
  const itens = (await api('/conversas/cv_ex01/itens?limite=2')).corpo.itens;
  assert.deepEqual(itens.map(i => i.categoria), ['nota', 'evento']);
  const p = await api('/conversas/cv_ex01/transferir', { metodo: 'POST', corpo: { responsavel_id: 'usr_ana' } });
  assert.equal(p.corpo.responsavel.id, 'usr_ana');
  // Saiu do Suporte: a atendente deixa de ver.
  assert.equal((await api('/conversas/cv_ex01', { atendente: true })).status, 404);
});

test('responder: assume da fila, sai pela fila da C3 e respeita as regras do canal', async (t) => {
  const { base, api } = await comSimulado(t);
  const s = io(`${base}/talk`, { path: '/app/ia-talk/socket.io', transports: ['websocket'], forceNew: true });
  t.after(() => s.close());
  await new Promise((r) => s.on('connect', r));
  s.emit(EVENTOS_SOCKET.cliente.assinarConversa, { conversa_id: 'cv_ex02' });
  const estados = [];
  const lida = new Promise((r) => s.on(E.estadoItemConversa, (e) => { estados.push(e.estado); if (e.estado === 'lida') r(); }));
  const novoItem = new Promise((r) => s.once(E.itemConversa, r));
  await new Promise((r) => setTimeout(r, 50));

  assert.equal((await api('/conversas/cv_ex02/responder', { metodo: 'POST', corpo: { texto: '  ' } })).status, 400);
  const r = await api('/conversas/cv_ex02/responder', { metodo: 'POST', corpo: { texto: 'Olá, João! Vou reenviar o código.' } });
  assert.equal(r.status, 202);
  forma('itemConversa', r.corpo);
  assert.equal(r.corpo.estado, 'aceita');
  assert.ok(r.corpo.mensagem_id);
  assert.equal((await novoItem).conversa_id, 'cv_ex02');
  const det = (await api('/conversas/cv_ex02')).corpo;
  assert.equal(det.responsavel.id, 'usr_ana', 'responder da fila já assume');
  assert.equal(det.aguardando_desde, null);
  const msg = (await api(`/mensagens/${r.corpo.mensagem_id}`)).corpo;
  assert.equal(msg.origem, 'atendimento');
  await lida;
  assert.deepEqual(estados, ['aguardando', 'encaminhada', 'enviada', 'entregue', 'lida']);

  const foraDaLista = await api('/conversas/cv_ex03/responder', { metodo: 'POST', corpo: { texto: 'Oi' } });
  assert.equal(foraDaLista.status, 403);
  assert.equal(foraDaLista.corpo.erro.codigo, 'sem_permissao');
  assert.equal((await api('/conversas/cv_ex07/responder', { metodo: 'POST', corpo: { texto: 'Oi' } })).status, 409, 'encerrada');
  assert.equal((await api('/conversas/cv_ex04/responder', { metodo: 'POST', corpo: { texto: 'Oi' }, atendente: true })).status, 409, 'com o Bruno');
});

test('encerrar e reabrir: não reabre se o contato já tem outra aberta', async (t) => {
  const { api } = await comSimulado(t);
  const enc = await api('/conversas/cv_ex02/encerrar', { metodo: 'POST', corpo: { motivo: 'Código reenviado' } });
  assert.equal(enc.corpo.situacao, 'encerrada');
  assert.equal(enc.corpo.motivo_encerramento, 'Código reenviado');
  assert.ok(enc.corpo.encerrada_em);
  const re = await api('/conversas/cv_ex02/reabrir', { metodo: 'POST' });
  assert.equal(re.corpo.situacao, 'aberta');
  const dup = await api('/conversas/cv_ex09/reabrir', { metodo: 'POST' });
  assert.equal(dup.status, 409, 'Mariana já tem a cv_ex01 aberta');
  assert.equal(dup.corpo.erro.detalhe.conversa_id, 'cv_ex01');
});

test('notas, etiquetas, marcar lida e contato', async (t) => {
  const { api } = await comSimulado(t);
  const n = await api('/conversas/cv_ex01/notas', { metodo: 'POST', corpo: { texto: 'Ligar para o fiscal.' } });
  assert.equal(n.status, 201);
  assert.equal(n.corpo.categoria, 'nota');
  assert.equal(n.corpo.direcao, null);
  assert.equal((await api('/conversas/cv_ex01/etiquetas', { metodo: 'PUT', corpo: { etiquetas: Array(11).fill('x').map((x, i) => x + i) } })).status, 400);
  assert.deepEqual((await api('/conversas/cv_ex01/etiquetas', { metodo: 'PUT', corpo: { etiquetas: ['Urgente', 'Urgente', ' NF-e '] } })).corpo.etiquetas, ['Urgente', 'NF-e']);
  assert.equal((await api('/conversas/cv_ex01/marcar-lida', { metodo: 'POST' })).corpo.nao_lidas, 0);
  const ct = await api('/contatos/ct_ex1', { metodo: 'PUT', corpo: { nome: 'Mariana O. (Alvorada)' } });
  assert.equal(ct.corpo.nome, 'Mariana O. (Alvorada)');
  assert.equal(ct.corpo.nome_whatsapp, 'Mariana');
  assert.equal(ct.corpo.conversas_total, 2);
  const hist = (await api('/conversas?contato_id=ct_ex1&visao=todas')).corpo.itens;
  assert.equal(hist.length, 2);
});

test('setores: validação, nome único, versão e inativação protegida', async (t) => {
  const { api } = await comSimulado(t);
  const inval = await api('/setores', { metodo: 'POST', corpo: { nome: 'Fiscal', horario: { ligado: true, fuso: 'America/Cuiaba', dias: [{ dia: 1, inicio: '18:00', fim: '08:00' }] } } });
  assert.equal(inval.status, 400);
  assert.ok(inval.corpo.erro.campos.horario);
  assert.equal((await api('/setores', { metodo: 'POST', corpo: { nome: 'suporte' } })).status, 409);
  const novo = await api('/setores', { metodo: 'POST', corpo: { nome: 'Fiscal', membros: ['usr_carla'] } });
  assert.equal(novo.status, 201);
  assert.equal(novo.corpo.fora_horario.ligado, false, 'nasce desligado');
  assert.equal((await api('/setores', { metodo: 'POST', corpo: { nome: 'X', membros: ['usr_davi'] } })).status, 400, 'usuário inativo');
  assert.equal((await api(`/setores/${novo.corpo.id}`, { metodo: 'PUT', corpo: { versao: 99, nome: 'Fiscal 2' } })).status, 409);
  const ok = await api(`/setores/${novo.corpo.id}`, { metodo: 'PUT', corpo: { versao: 1, nome: 'Fiscal e tributos' } });
  assert.equal(ok.corpo.versao, 2);
  assert.equal((await api('/setores/set_comercial', { metodo: 'PUT', corpo: { versao: 1, situacao: 'inativo' } })).status, 409, 'tem conversa aberta');
  const padrao = await api('/setores/set_suporte', { metodo: 'PUT', corpo: { versao: 2, situacao: 'inativo' } });
  assert.equal(padrao.status, 409);
  const inativo = await api(`/setores/${novo.corpo.id}`, { metodo: 'PUT', corpo: { versao: 2, situacao: 'inativo' } });
  assert.equal(inativo.corpo.situacao, 'inativo');
  assert.equal((await api('/conversas/cv_ex01/transferir', { metodo: 'POST', corpo: { setor_id: novo.corpo.id } })).status, 400, 'setor inativo');
});

test('respostas rápidas: gerais + do setor, atalho válido e único', async (t) => {
  const { api } = await comSimulado(t);
  const fin = (await api('/respostas-rapidas?setor_id=set_financeiro')).corpo.itens.map(r => r.atalho);
  assert.ok(fin.includes('/boleto') && fin.includes('/saudacao') && !fin.includes('/acesso'));
  assert.equal((await api('/respostas-rapidas', { metodo: 'POST', corpo: { atalho: 'boleto', titulo: 'T', texto: 'X' } })).status, 400);
  assert.equal((await api('/respostas-rapidas', { metodo: 'POST', corpo: { atalho: '/boleto', titulo: 'T', texto: 'X' } })).status, 409);
  const nova = await api('/respostas-rapidas', { metodo: 'POST', corpo: { atalho: '/nf', titulo: 'Nota fiscal', texto: 'Segue a nota.', setor_id: 'set_suporte' } });
  assert.equal(nova.status, 201);
  assert.equal(nova.corpo.setor.id, 'set_suporte');
  const inat = await api(`/respostas-rapidas/${nova.corpo.id}`, { metodo: 'PUT', corpo: { situacao: 'inativa' } });
  assert.equal(inat.corpo.situacao, 'inativa');
});

test('uso do número: setor padrão obrigatório, empresa vinculada e volta para integração', async (t) => {
  const { api } = await comSimulado(t);
  const atual = (await api('/canais/cn_suporte')).corpo;
  assert.equal(atual.uso, 'compartilhado');
  assert.equal(atual.atendimento.setor_padrao.id, 'set_suporte');
  assert.equal((await api('/canais/cn_financeiro', { metodo: 'PUT', corpo: { uso: 'atendimento' } })).status, 400, 'sem setor padrão');
  assert.equal((await api('/canais/cn_financeiro', { metodo: 'PUT', corpo: { uso: 'outro' } })).status, 400);
  assert.equal((await api('/canais/cn_financeiro', { metodo: 'PUT', corpo: { uso: 'atendimento', setor_padrao_id: 'set_financeiro', atendimento_empresa_id: 'emp_plantivo' } })).status, 400, 'empresa não vinculada');
  const ok = await api('/canais/cn_financeiro', { metodo: 'PUT', corpo: { uso: 'atendimento', setor_padrao_id: 'set_financeiro' } });
  assert.equal(ok.status, 200);
  const { menu, ...atendimento } = ok.corpo.atendimento;
  assert.deepEqual(atendimento, { empresa: { id: 'emp_j2a', nome: 'J2A Consultoria' }, setor_padrao: { id: 'set_financeiro', nome: 'Financeiro' } });
  assert.equal(menu.ligado, false, 'menu de setores nasce desligado (§9.3)');
  const volta = await api('/canais/cn_financeiro', { metodo: 'PUT', corpo: { uso: 'integracao' } });
  assert.equal(volta.corpo.atendimento, null);
});

test('chegada: contato só com conversas encerradas abre conversa nova na fila do setor padrão (socket avisa)', async (t) => {
  const { base, api } = await comSimulado(t);
  const s = io(`${base}/talk`, { path: '/app/ia-talk/socket.io', transports: ['websocket'], forceNew: true });
  t.after(() => s.close());
  const contadores = new Promise((r) => s.once(E.contadoresAtendimento, r));
  await new Promise((r) => s.on('connect', r));
  s.emit(EVENTOS_SOCKET.cliente.assinarAtendimento, {});
  forma('contadoresAtendimento', await contadores);
  const atualizada = new Promise((r) => s.once(E.conversaAtualizada, r));
  const r = await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex7', texto: 'Voltei com outra dúvida.' } });
  assert.equal(r.status, 201);
  assert.notEqual(r.corpo.id, 'cv_ex07', 'encerrada não reabre sozinha');
  assert.equal(r.corpo.setor.id, 'set_suporte');
  assert.equal(r.corpo.na_fila, true);
  assert.equal(r.corpo.nao_lidas, 1);
  const aviso = await atualizada;
  forma('conversaResumo', aviso);
  assert.equal(aviso.id, r.corpo.id);
  // Conversa aberta: a próxima mensagem entra nela.
  const de_novo = await api('/simulado/receber', { metodo: 'POST', corpo: { contato_id: 'ct_ex7', texto: 'Alguém?' } });
  assert.equal(de_novo.corpo.id, r.corpo.id);
  assert.equal(de_novo.corpo.nao_lidas, 2);
  const erro = new Promise((res) => s.once(E.erro, res));
  s.emit(EVENTOS_SOCKET.cliente.assinarConversa, { conversa_id: 'cv_inexistente' });
  assert.equal((await erro).codigo, 'nao_encontrado');
});

// ── §8.9 API v1 do sistema de origem (ex.: SoftExpert) ────────────────────────
const v1 = (base) => async (caminho, { metodo = 'GET', corpo, token = 'tk_teste_origem' } = {}) => {
  const r = await fetch(`${base}/app/ia-talk/api/v1${caminho}`, {
    method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, cabecalhos: r.headers, corpo: await r.json() };
};
const chamado = (id, extra = {}) => ({
  canal: 'cn_suporte', contato: { telefone: '5565999982001', nome: 'Paulo Nunes' },
  referencia: { sistema: 'softexpert', id, titulo: 'Erro ao gerar boleto', link: `https://softexpert.exemplo.com.br/chamado/${id}` }, ...extra,
});

test('API v1: chamado vira conversa na fila; reenviar devolve a mesma; contato em atendimento recebe o chamado', async (t) => {
  const { base, api } = await comSimulado(t);
  const origem = v1(base);
  assert.equal((await origem('/conversas', { metodo: 'POST', corpo: chamado('037001'), token: null })).status, 401);
  const semRef = await origem('/conversas', { metodo: 'POST', corpo: { ...chamado('x'), referencia: undefined } });
  assert.equal(semRef.status, 400);
  assert.ok(semRef.corpo.erro.campos.referencia);
  assert.equal((await origem('/conversas', { metodo: 'POST', corpo: chamado('037001', { canal: 'cn_financeiro' }) })).corpo.erro.codigo, 'recurso_nao_suportado', 'número só de integração');
  assert.ok((await origem('/conversas', { metodo: 'POST', corpo: chamado('037001', { setor: 'juridico' }) })).corpo.erro.campos.setor);

  const nova = await origem('/conversas', { metodo: 'POST', corpo: chamado('037001', { setor: 'financeiro', prioridade: 'alta', contexto: 'Cliente não consegue emitir o boleto de novembro.', mensagem_inicial: 'Olá, Paulo!' }) });
  assert.equal(nova.status, 201);
  forma('v1Conversa', nova.corpo);
  assert.equal(nova.corpo.resultado, 'criada');
  assert.equal(nova.corpo.na_fila, true);
  assert.deepEqual(nova.corpo.setor, { codigo: 'financeiro', nome: 'Financeiro' });
  assert.equal(nova.corpo.prioridade, 'alta');
  assert.equal(nova.corpo.mensagem_inicial.estado, 'nao_enviada', 'fora da lista de teste: fica na fila sem mensagem');
  assert.match(nova.corpo.mensagem_inicial.motivo, /números de teste/);
  assert.doesNotMatch(JSON.stringify(nova.corpo), /\d{12,13}/, 'telefone não volta completo');

  const repetida = await origem('/conversas', { metodo: 'POST', corpo: chamado('037001') });
  assert.equal(repetida.status, 200);
  assert.equal(repetida.corpo.resultado, 'existente');
  assert.equal(repetida.corpo.id, nova.corpo.id);
  assert.equal(repetida.cabecalhos.get('idempotent-replayed'), 'true');

  // Na Central: na fila, com o chamado e o contexto como nota interna (nunca vai ao cliente).
  const det = (await api(`/conversas/${nova.corpo.id}`)).corpo;
  assert.equal(det.referencias[0].id, '037001');
  assert.equal(det.referencias[0].aplicacao.nome, 'SoftExpert (simulado)');
  assert.ok(det.aguardando_desde, 'conta tempo de espera desde a abertura');
  const nota = (await api(`/conversas/${nova.corpo.id}/itens?categoria=nota`)).corpo.itens[0];
  assert.equal(nota.autor.tipo, 'sistema');
  assert.match(nota.texto, /boleto de novembro/);

  const mariana = await origem('/conversas', { metodo: 'POST', corpo: chamado('037002', { contato: { telefone: '5565999990010' } }) });
  assert.equal(mariana.status, 200);
  assert.equal(mariana.corpo.resultado, 'vinculada');
  assert.equal(mariana.corpo.id, 'cv_ex01', 'entra na conversa que já estava aberta');
  assert.deepEqual(mariana.corpo.referencias.map(r => r.id), ['036988', '037002']);

  // Chamado reenviado depois de encerrado: conversa nova; aqui o João está na lista de teste, então a mensagem inicial sai.
  await api('/conversas/cv_ex02/encerrar', { metodo: 'POST', corpo: { motivo: 'Resolvido' } });
  const reaberta = await origem('/conversas', { metodo: 'POST', corpo: chamado('036990', { contato: { telefone: '5565999990011' }, mensagem_inicial: 'Olá, João! Seguimos com o seu chamado.' }) });
  assert.equal(reaberta.status, 201);
  assert.notEqual(reaberta.corpo.id, 'cv_ex02');
  assert.equal(reaberta.corpo.mensagem_inicial.estado, 'aceita');
  assert.equal((await origem('/conversas?referencia=softexpert:036990')).corpo.itens.length, 2);
  assert.equal((await origem('/conversas/cv_ex03')).status, 404, 'conversa sem chamado deste sistema');
});

test('API v1: retornos ficam até o sistema de origem confirmar; confirmar de novo é inofensivo', async (t) => {
  const { base, api } = await comSimulado(t);
  const origem = v1(base);
  const inicio = (await origem('/retornos')).corpo;
  assert.deepEqual(inicio.itens.map(r => r.id), ['rt_ex2', 'rt_ex3'], 'o já confirmado não volta');
  inicio.itens.forEach(r => forma('v1Retorno', r));
  assert.equal(inicio.tem_mais, false);

  await api('/conversas/cv_ex02/assumir', { metodo: 'POST', atendente: true });
  await api('/conversas/cv_ex02/encerrar', { metodo: 'POST', corpo: { motivo: 'Código reenviado' }, atendente: true });
  await api('/conversas/cv_ex03/assumir', { metodo: 'POST' }); // sem chamado: não gera retorno
  const depois = (await origem('/retornos')).corpo.itens;
  assert.deepEqual(depois.map(r => r.tipo), ['conversa.assumida', 'conversa.criada', 'conversa.assumida', 'conversa.encerrada']);
  const enc = depois[3];
  assert.equal(enc.dados.motivo, 'Código reenviado');
  assert.equal(enc.dados.responsavel.nome, 'Carla Souza');
  assert.equal(enc.conversa.situacao, 'encerrada');
  assert.equal(enc.referencias[0].id, '036990');
  assert.equal((await origem('/retornos?limite=1')).corpo.tem_mais, true);

  const conf = (await origem('/retornos/confirmar', { metodo: 'POST', corpo: { ids: ['rt_ex2', 'rt_ex3', 'rt_nao_existe'] } })).corpo;
  assert.deepEqual(conf, { confirmados: ['rt_ex2', 'rt_ex3'], desconhecidos: ['rt_nao_existe'] });
  assert.deepEqual((await origem('/retornos/confirmar', { metodo: 'POST', corpo: { ids: ['rt_ex2'] } })).corpo.confirmados, ['rt_ex2']);
  assert.equal((await origem('/retornos')).corpo.itens.length, 2);
  assert.equal((await origem('/retornos/confirmar', { metodo: 'POST', corpo: { ids: [] } })).status, 400);
});
