'use strict';

// C9 no servidor real (docs/contratos.md §8): número em atendimento recebe mensagem do
// provedor SIMULADO (nada de WhatsApp de verdade) e vira conversa; quem vê o quê; disputa
// do assumir; resposta pela fila da C3 até "lida"; transferência; setores; sistema de
// origem (API v1) com retornos e confirmação; avisos do tempo real só para quem vê.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { criarApp } = require('../backend/servidor');
const { SupervisorCanais } = require('../backend/canais/supervisor');
const { Despachante } = require('../backend/mensagens/despachante');
const { Atendimento } = require('../backend/atendimento/servico');
const { avisosDoAtendimento } = require('../backend/tempo-real');
const sessoes = require('../backend/acesso/sessoes');
const { novoId, agora } = require('../backend/ids');
const { camposFaltando } = require('../backend/contratos');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');

cifra.definirChaveParaTeste(crypto.randomBytes(32));
const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);
const esperar = async (cond, ms = 8000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('condição não atingida a tempo');
};

let db; let base; let servidor; let supervisor; let despachante; let atendimento; let pasta;
const avisos = []; // [tipo, conversaId, dados]

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-c9-'));
  db = abrirBanco({ arquivo: ':memory:' });
  supervisor = new SupervisorCanais({ db, emitir: () => {}, dirSessoes: path.join(pasta, 'sessoes'),
    envFilho: { IA_TALK_PROVEDOR_FORCADO: 'simulado' }, log: { error() {} }, esperas: [100, 100] });
  despachante = new Despachante({ db, supervisor, emitir: () => {}, intervaloMinimoMs: 0, variacaoMs: 0, tickMs: 50, esperas: [50] });
  atendimento = new Atendimento({ db, despachante,
    aoMudar: (id, d) => avisos.push(['mudou', id, d]), aoItem: (id, it) => avisos.push(['item', id, it]), aoEstadoItem: (id, d) => avisos.push(['estado', id, d]) });
  supervisor.aoReceber = (canalId, m) => atendimento.receber(canalId, m);
  despachante.aoAvisar = (m) => atendimento.aoEstadoMensagem(m);
  servidor = http.createServer(criarApp({ db, log: { error() {} }, supervisor, despachante, atendimento, transportes: { whatsapp: async () => ({ ok: false }) } }));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  despachante.iniciar();
});
test.after(async () => {
  despachante.parar();
  await supervisor.pararTodos();
  await new Promise(r => servidor.close(r));
  fs.rmSync(pasta, { recursive: true, force: true });
});

function navegador(cookieInicial = '') {
  let cookie = cookieInicial;
  return async (caminho, { metodo = 'GET', corpo, cabecalhos = {} } = {}) => {
    const r = await fetch(`${base}/app/ia-talk${caminho}`, { method: metodo, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...cabecalhos }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const sc = r.headers.get('set-cookie');
    if (sc && sc.startsWith('talk.sid=') && !sc.startsWith('talk.sid=;')) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
}

// Pessoa da empresa com papel do Talk e sessão própria (sem passar pelo login por código).
function pessoa(empresaId, nome, tel, papel) {
  const id = novoId('usuario');
  const t = agora();
  db.prepare('INSERT INTO usuarios (id, nome, telefone, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)').run(id, nome, tel, t, t);
  db.prepare('INSERT INTO membros (id, empresa_id, usuario_id, papel, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)').run(novoId('membro'), empresaId, id, papel, t, t);
  const token = sessoes.criar(db, { usuarioId: id, empresaId, origem: 'telefone' });
  return { id, nome, ir: navegador(`talk.sid=${token}`) };
}

let ctx; // montado no primeiro teste e reaproveitado (os testes rodam em ordem)

test('C9: número em atendimento, mensagem vira conversa na fila; grupo e repetida não entram; log sem texto', async () => {
  const ana = navegador();
  const { link } = primeiroAcesso({ db, nome: 'Ana', telefone: '5565999990001', empresa: 'J2A', apelido: 'j2a' });
  await ana(link.slice(link.indexOf('/api/publico')));
  const empresaId = db.prepare("SELECT id FROM empresas WHERE apelido = 'j2a'").get().id;
  const carla = pessoa(empresaId, 'Carla Souza', '5565999990003', 'atendente');
  const bruno = pessoa(empresaId, 'Bruno Lima', '5565999990002', 'atendente');

  const suporte = await ana('/api/admin/setores', { metodo: 'POST', corpo: { nome: 'Suporte', membros: [carla.id, bruno.id] } });
  assert.equal(suporte.status, 201);
  forma('setor', suporte.corpo);
  assert.equal(suporte.corpo.codigo, 'suporte');
  const financeiro = (await ana('/api/admin/setores', { metodo: 'POST', corpo: { nome: 'Financeiro', membros: [] } })).corpo;

  const c = (await ana('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Atendimento', provedor: 'wweb', numero: '5565900000000' } })).corpo;
  assert.equal(c.uso, 'integracao', 'publicado desligado: canal novo só integração');
  assert.equal(c.atendimento, null);
  assert.equal((await ana(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { uso: 'atendimento' } })).status, 400, 'sem setor padrão');
  assert.equal((await ana(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { uso: 'outro', setor_padrao_id: suporte.corpo.id } })).status, 400);
  assert.equal((await carla.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { uso: 'atendimento' } })).status, 403);
  const ok = await ana(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { uso: 'atendimento', setor_padrao_id: suporte.corpo.id, recebimento_modo: 'todos', envio_modo: 'teste', numeros_teste: ['5565999981001'] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.corpo.atendimento.setor_padrao, { id: suporte.corpo.id, nome: 'Suporte' });
  assert.ok(db.prepare("SELECT 1 FROM auditoria WHERE acao = 'canal.uso'").get());

  await ana(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
  await esperar(async () => (await ana(`/api/admin/canais/${c.id}`)).corpo.estado === 'qr_pendente');
  supervisor._comandoTeste(c.id, 'simular-leitura');
  await esperar(async () => (await ana(`/api/admin/canais/${c.id}`)).corpo.estado === 'conectado');

  supervisor._comandoTeste(c.id, 'simular-mensagem', { de: '5565999981001', texto: 'Bom dia, o boleto não chegou.' });
  await esperar(() => db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n === 1);
  supervisor._comandoTeste(c.id, 'simular-mensagem', { de: '556599981001', texto: 'Alguém?' }); // mesmo número sem o nono dígito
  await esperar(() => db.prepare("SELECT COUNT(*) AS n FROM conversa_itens WHERE categoria = 'mensagem'").get().n === 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversas').get().n, 1, 'mesmo contato, mesma conversa');
  // Repetida (mesmo id do WhatsApp) e de grupo: não entram.
  atendimento.receber(c.id, { id_provedor: db.prepare("SELECT id_provedor FROM conversa_itens WHERE id_provedor IS NOT NULL").get().id_provedor, de: { tipo: 'telefone', valor: '5565999981001' }, tipo: 'texto', texto: 'x' });
  assert.equal(atendimento.receber(c.id, { id_provedor: 'g1', de: { tipo: 'grupo', valor: '120363' }, tipo: 'texto', texto: 'oi grupo' }), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM conversa_itens WHERE categoria = 'mensagem'").get().n, 2);
  const log = db.prepare('SELECT mensagem FROM canal_log WHERE canal_id = ?').all(c.id).map(l => l.mensagem).join('\n');
  assert.doesNotMatch(log, /boleto|Alguém/, 'texto nunca vai para o log');

  const fila = (await carla.ir('/api/admin/conversas?visao=fila')).corpo;
  assert.equal(fila.itens.length, 1);
  forma('conversaResumo', fila.itens[0]);
  assert.equal(fila.itens[0].nao_lidas, 2);
  assert.equal(fila.itens[0].na_fila, true);
  assert.match(fila.itens[0].protocolo, /^\d{4}-000001$/);
  assert.doesNotMatch(JSON.stringify(fila.itens[0]), /\d{12,13}/, 'telefone só mascarado');
  const det = (await carla.ir(`/api/admin/conversas/${fila.itens[0].id}`)).corpo;
  forma('conversaDetalhe', det);
  assert.ok(det.aguardando_desde);
  const itens = (await carla.ir(`/api/admin/conversas/${det.id}/itens`)).corpo.itens;
  itens.forEach(i => forma('itemConversa', i));
  assert.deepEqual(itens.map(i => i.categoria), ['mensagem', 'mensagem', 'evento'], 'mais recente primeiro');
  forma('contadoresAtendimento', (await carla.ir('/api/admin/conversas/contadores')).corpo);

  ctx = { ana, carla, bruno, empresaId, canal: c, suporte: suporte.corpo, financeiro, conversaId: det.id };
});

test('C9: atendente fora do setor não vê (404); disputa do assumir: só um leva', async () => {
  const { carla, bruno, empresaId, conversaId } = ctx;
  const davi = pessoa(empresaId, 'Davi Martins', '5565999990004', 'atendente'); // em nenhum setor
  assert.equal((await davi.ir(`/api/admin/conversas/${conversaId}`)).status, 404);
  assert.equal((await davi.ir('/api/admin/conversas?visao=todas')).corpo.itens.length, 0);
  assert.equal((await davi.ir('/api/admin/setores', { metodo: 'POST', corpo: { nome: 'X' } })).status, 403, 'atendente não cadastra setor');

  const [a, b] = await Promise.all([carla.ir(`/api/admin/conversas/${conversaId}/assumir`, { metodo: 'POST' }), bruno.ir(`/api/admin/conversas/${conversaId}/assumir`, { metodo: 'POST' })]);
  const status = [a.status, b.status].sort();
  assert.deepEqual(status, [200, 409], 'um leva, o outro recebe 409');
  const perdeu = a.status === 409 ? a : b;
  assert.match(perdeu.corpo.erro.mensagem, /já assumiu esta conversa/);
  const dono = a.status === 200 ? carla : bruno;
  ctx.dono = dono;
  ctx.outro = dono === carla ? bruno : carla;
  assert.equal((await dono.ir(`/api/admin/conversas/${conversaId}/assumir`, { metodo: 'POST' })).status, 200, 'repetir é inofensivo');
  assert.equal((await ctx.outro.ir(`/api/admin/conversas/${conversaId}/devolver`, { metodo: 'POST' })).status, 403);
});

test('C9: responder sai pela fila da C3 (origem atendimento) até "lida"; regras do canal valem', async () => {
  const { dono, outro, conversaId } = ctx;
  assert.equal((await outro.ir(`/api/admin/conversas/${conversaId}/responder`, { metodo: 'POST', corpo: { texto: 'Oi' } })).status, 409, 'com outra pessoa');
  const r = await dono.ir(`/api/admin/conversas/${conversaId}/responder`, { metodo: 'POST', corpo: { texto: 'Bom dia! Vou reenviar o boleto.' } });
  assert.equal(r.status, 202);
  forma('itemConversa', r.corpo);
  const m = db.prepare('SELECT origem, usuario_id, correlacao_id FROM mensagens WHERE id = ?').get(r.corpo.mensagem_id);
  assert.equal(m.origem, 'atendimento');
  assert.equal(m.usuario_id, dono.id);
  await esperar(async () => (await dono.ir(`/api/admin/conversas/${conversaId}/itens?limite=1`)).corpo.itens[0].estado === 'enviada'
    || (await dono.ir(`/api/admin/conversas/${conversaId}/itens?limite=1`)).corpo.itens[0].estado === 'lida');
  assert.ok(avisos.some(([t, id, d]) => t === 'estado' && id === conversaId && d.item_id === r.corpo.id), 'estado do item avisado');
  const det = (await dono.ir(`/api/admin/conversas/${conversaId}`)).corpo;
  assert.equal(det.nao_lidas, 0);
  assert.equal(det.aguardando_desde, null);
  assert.equal(det.envio.pode_responder, true);
});

test('C9: transferir para setor sem a pessoa tira o acesso dela; nota interna; encerrar e reabrir', async () => {
  const { ana, dono, conversaId, financeiro } = ctx;
  const t = await dono.ir(`/api/admin/conversas/${conversaId}/transferir`, { metodo: 'POST', corpo: { setor_id: financeiro.id, nota: 'Cliente pediu segunda via.' } });
  assert.equal(t.status, 200);
  assert.equal(t.corpo.setor.id, financeiro.id);
  assert.equal(t.corpo.responsavel, null);
  assert.equal((await dono.ir(`/api/admin/conversas/${conversaId}`)).status, 404, 'saiu do Suporte: atendente deixa de ver');
  const notas = (await ana(`/api/admin/conversas/${conversaId}/itens?categoria=nota`)).corpo.itens;
  assert.equal(notas[0].texto, 'Cliente pediu segunda via.');
  assert.ok(db.prepare("SELECT 1 FROM auditoria WHERE acao = 'conversa.transferida'").get());

  const enc = await ana(`/api/admin/conversas/${conversaId}/encerrar`, { metodo: 'POST', corpo: { motivo: 'Boleto reenviado' } });
  assert.equal(enc.corpo.situacao, 'encerrada');
  assert.equal(enc.corpo.motivo_encerramento, 'Boleto reenviado');
  // Nova mensagem do mesmo contato: conversa nova (encerrada não reabre sozinha).
  supervisor._comandoTeste(ctx.canal.id, 'simular-mensagem', { de: '5565999981001', texto: 'Recebi, obrigado!' });
  await esperar(() => db.prepare("SELECT COUNT(*) AS n FROM conversas WHERE situacao = 'aberta'").get().n === 1);
  const nova = db.prepare("SELECT id FROM conversas WHERE situacao = 'aberta'").get().id;
  assert.notEqual(nova, conversaId);
  const dup = await ana(`/api/admin/conversas/${conversaId}/reabrir`, { metodo: 'POST' });
  assert.equal(dup.status, 409);
  assert.equal(dup.corpo.erro.detalhe.conversa_id, nova);
  ctx.conversaAberta = nova;
});

test('C9: setores e respostas rápidas — código fixo, versão, inativação protegida', async () => {
  const { ana, suporte } = ctx;
  const atual = (await ana(`/api/admin/setores/${suporte.id}`)).corpo;
  assert.equal((await ana(`/api/admin/setores/${suporte.id}`, { metodo: 'PUT', corpo: { versao: atual.versao, codigo: 'outro' } })).status, 400, 'código não muda');
  assert.equal((await ana(`/api/admin/setores/${suporte.id}`, { metodo: 'PUT', corpo: { versao: 99, nome: 'X' } })).status, 409);
  assert.equal((await ana(`/api/admin/setores/${suporte.id}`, { metodo: 'PUT', corpo: { versao: atual.versao, situacao: 'inativo' } })).status, 409, 'tem conversa aberta / é padrão');
  assert.equal((await ana('/api/admin/setores', { metodo: 'POST', corpo: { nome: 'suporte' } })).status, 409, 'nome único sem caixa');
  const rr = await ana('/api/admin/respostas-rapidas', { metodo: 'POST', corpo: { atalho: '/boleto', titulo: 'Boleto', texto: 'Segue o boleto.', setor_id: ctx.financeiro.id } });
  assert.equal(rr.status, 201);
  forma('respostaRapida', rr.corpo);
  await ana('/api/admin/respostas-rapidas', { metodo: 'POST', corpo: { atalho: '/oi', titulo: 'Oi', texto: 'Olá!' } });
  assert.equal((await ana('/api/admin/respostas-rapidas', { metodo: 'POST', corpo: { atalho: '/oi', titulo: 'Oi', texto: 'x' } })).status, 409);
  const doSuporte = (await ctx.carla.ir(`/api/admin/respostas-rapidas?setor_id=${suporte.id}`)).corpo.itens.map(r => r.atalho);
  assert.deepEqual(doSuporte, ['/oi'], 'gerais + do setor');
});

test('C9: sistema de origem — chamado vira conversa, reenviar devolve a mesma, retornos até confirmar', async () => {
  const { ana, canal, suporte } = ctx;
  const app = (await ana('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'SoftExpert', escopos: ['conversas:criar', 'conversas:ler'], canais_autorizados: [canal.id] } })).corpo;
  const token = (await ana(`/api/admin/aplicacoes/${app.id}/tokens`, { metodo: 'POST' })).corpo.token;
  const origem = (caminho, op = {}) => navegador()(`/api/v1${caminho}`, { ...op, cabecalhos: { Authorization: `Bearer ${token}` } });
  const chamado = (id, extra = {}) => ({ canal: canal.id, contato: { telefone: '5565999982001', nome: 'Paulo Nunes' },
    referencia: { sistema: 'softexpert', id, titulo: 'Erro no boleto', link: `https://se.exemplo.com.br/${id}` }, ...extra });

  const nova = await origem('/conversas', { metodo: 'POST', corpo: chamado('037001', { setor: 'suporte', prioridade: 'alta', contexto: 'Descrição do chamado.', mensagem_inicial: 'Olá!' }) });
  assert.equal(nova.status, 201);
  forma('v1Conversa', nova.corpo);
  assert.equal(nova.corpo.resultado, 'criada');
  assert.deepEqual(nova.corpo.setor, { codigo: 'suporte', nome: 'Suporte' });
  assert.equal(nova.corpo.mensagem_inicial.estado, 'nao_enviada', 'fora da lista de teste');
  assert.doesNotMatch(JSON.stringify(nova.corpo), /\d{12,13}/);
  const rep = await origem('/conversas', { metodo: 'POST', corpo: chamado('037001') });
  assert.equal(rep.status, 200);
  assert.equal(rep.corpo.resultado, 'existente');
  assert.equal(rep.corpo.id, nova.corpo.id);
  assert.equal(rep.headers.get('idempotent-replayed'), 'true');
  // Contato já em atendimento: o chamado entra na conversa dele.
  const vinc = await origem('/conversas', { metodo: 'POST', corpo: chamado('037002', { contato: { telefone: '5565999981001' } }) });
  assert.equal(vinc.corpo.resultado, 'vinculada');
  assert.equal(vinc.corpo.id, ctx.conversaAberta);
  // Fila: prioridade alta primeiro.
  const fila = (await ana('/api/admin/conversas?visao=fila')).corpo.itens;
  assert.equal(fila[0].id, nova.corpo.id);
  assert.equal(fila[0].referencias[0].aplicacao.nome, 'SoftExpert');
  assert.equal((await origem(`/conversas/${ctx.conversaId}`)).status, 404, 'conversa sem chamado deste sistema');
  assert.equal((await origem('/conversas?referencia=softexpert:037001')).corpo.itens.length, 1);

  // Retornos: criada, vinculada; depois assumida e encerrada.
  await ana(`/api/admin/conversas/${nova.corpo.id}/assumir`, { metodo: 'POST' });
  await ana(`/api/admin/conversas/${nova.corpo.id}/encerrar`, { metodo: 'POST', corpo: { motivo: 'Resolvido' } });
  let ret = (await origem('/retornos')).corpo;
  ret.itens.forEach(r => forma('v1Retorno', r));
  assert.deepEqual(ret.itens.map(r => r.tipo), ['conversa.criada', 'conversa.vinculada', 'conversa.assumida', 'conversa.encerrada']);
  assert.equal(ret.itens[3].dados.motivo, 'Resolvido');
  assert.equal(ret.itens[3].referencias[0].id, '037001');
  const conf = (await origem('/retornos/confirmar', { metodo: 'POST', corpo: { ids: [ret.itens[0].id, ret.itens[1].id, 'rt_nao_existe'] } })).corpo;
  assert.deepEqual(conf.desconhecidos, ['rt_nao_existe']);
  assert.equal(conf.confirmados.length, 2);
  assert.equal((await origem('/retornos/confirmar', { metodo: 'POST', corpo: { ids: [ret.itens[0].id] } })).corpo.confirmados.length, 1, 'confirmar de novo é inofensivo');
  ret = (await origem('/retornos')).corpo;
  assert.equal(ret.itens.length, 2);

  // 30 dias sem confirmação: vence (fica guardado, sai da entrega) e vira pendência no Painel.
  const velho = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE retornos SET em = ? WHERE id = ?').run(velho, ret.itens[0].id);
  assert.deepEqual((await origem('/retornos')).corpo.itens.map(r => r.id), [ret.itens[1].id]);
  assert.ok(db.prepare('SELECT 1 FROM retornos WHERE id = ?').get(ret.itens[0].id), 'continua guardado para rastreio');
  const painel = (await ana('/api/admin/painel')).corpo;
  const pend = painel.pendencias.find(p => p.tipo === 'retornos_vencidos');
  assert.match(pend.mensagem, /1 retorno\(s\) para SoftExpert venceram/);

  // Escopo: token só de mensagens não abre conversa.
  const app2 = (await ana('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'ERP', escopos: ['mensagens:enviar'], canais_autorizados: [canal.id] } })).corpo;
  const token2 = (await ana(`/api/admin/aplicacoes/${app2.id}/tokens`, { metodo: 'POST' })).corpo.token;
  assert.equal((await navegador()('/api/v1/conversas', { metodo: 'POST', corpo: chamado('9'), cabecalhos: { Authorization: `Bearer ${token2}` } })).status, 403);
  assert.equal((await navegador()('/api/v1/retornos', { cabecalhos: { Authorization: `Bearer ${token2}` } })).corpo.erro.codigo, 'sem_permissao');
});

test('C9: avisos do tempo real só para quem vê a conversa (nota não vaza na transferência)', async () => {
  // Namespace falso: sockets com o acesso de cada pessoa (mesmo formato do tempo-real.js).
  const { empresaId, carla, financeiro } = ctx;
  const recebidos = new Map();
  const sk = (nome, acesso, salas) => ({ nome, data: { acesso }, salas: new Set(salas), emit(ev, corpo) { (recebidos.get(nome) || recebidos.set(nome, []).get(nome)).push([ev, corpo]); }, leave(s) { this.salas.delete(s); } });
  const cv = db.prepare("SELECT id FROM conversas WHERE situacao = 'aberta' AND setor_id = ?").get(ctx.suporte.id).id;
  const sockets = [
    sk('carla', { empresaId, usuarioId: carla.id, veTudo: false }, [`atd:${empresaId}`, `conversa:${cv}`]),
    sk('supervisao', { empresaId, usuarioId: 'x', veTudo: true }, [`atd:${empresaId}`, `conversa:${cv}`]),
  ];
  const ns = { in: (sala) => ({ fetchSockets: async () => sockets.filter(s => s.salas.has(sala)) }), to: () => ({ emit() { throw new Error('use paraQuemVe'); } }) };
  const av = avisosDoAtendimento(ns, { db, atendimento });
  const local = new Atendimento({ db, aoMudar: av.aoMudar, aoItem: av.aoItem });
  local.transferir({ empresaId, usuarioId: 'x', veTudo: true }, cv, { setor_id: financeiro.id, nota: 'Nota interna sigilosa' });
  await esperar(() => (recebidos.get('carla') || []).some(([ev]) => ev === 'conversa:saiu'));
  await new Promise(r => setTimeout(r, 50));
  const daCarla = JSON.stringify(recebidos.get('carla'));
  assert.doesNotMatch(daCarla, /sigilosa/, 'atendente que perdeu o acesso não recebe a nota');
  assert.ok(!sockets[0].salas.has(`conversa:${cv}`), 'saiu da sala da conversa');
  assert.match(JSON.stringify(recebidos.get('supervisao')), /sigilosa/, 'supervisão recebe');
  assert.ok(recebidos.get('supervisao').some(([ev, c]) => ev === 'conversa:atualizada' && c.id === cv));
});
