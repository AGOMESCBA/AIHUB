'use strict';

// C3 ponta a ponta no servidor real: processo filho do canal com provedor
// SIMULADO (nada de WhatsApp de verdade), despachante, API v1 com token e
// idempotência, envio de teste da tela, lista de mensagens e Socket.IO do painel.

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
const { configurarTempoReal } = require('../backend/tempo-real');
const { camposFaltando } = require('../backend/contratos');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');

cifra.definirChaveParaTeste(crypto.randomBytes(32));
const forma = (nome, obj) => assert.deepEqual(camposFaltando(nome, obj), [], `forma ${nome}`);
const esperar = async (cond, ms = 8000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('condição não atingida a tempo');
};

let db; let base; let servidor; let supervisor; let despachante; let ioServer; let pasta;
const emitidos = []; // [canalId, evento, dados, { empresaId }]

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-c3-'));
  db = abrirBanco({ arquivo: ':memory:' });
  let emitir = () => {};
  supervisor = new SupervisorCanais({ db, emitir: (...a) => emitir(...a), dirSessoes: path.join(pasta, 'sessoes'),
    envFilho: { IA_TALK_PROVEDOR_FORCADO: 'simulado' }, log: { error() {} }, esperas: [100, 100] });
  despachante = new Despachante({ db, supervisor, emitir: (...a) => emitir(...a), intervaloMinimoMs: 0, variacaoMs: 0, tickMs: 50, esperas: [50] });
  servidor = http.createServer(criarApp({ db, log: { error() {} }, supervisor, despachante, transportes: { whatsapp: async () => ({ ok: false }) } }));
  const { Server } = require('socket.io');
  ioServer = new Server(servidor, { path: '/app/ia-talk/socket.io' });
  const real = configurarTempoReal(ioServer.of('/talk'), { db, supervisor });
  emitir = (...a) => { emitidos.push(a); real(...a); };
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  despachante.iniciar();
});
test.after(async () => {
  despachante.parar();
  await supervisor.pararTodos();
  ioServer.close();
  await new Promise(r => servidor.close(r));
  fs.rmSync(pasta, { recursive: true, force: true });
});

function navegador() {
  let cookie = '';
  const ir = async (caminho, { metodo = 'GET', corpo, cabecalhos = {} } = {}) => {
    const r = await fetch(`${base}/app/ia-talk${caminho}`, { method: metodo, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...cabecalhos }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const sc = r.headers.get('set-cookie');
    if (sc && sc.startsWith('talk.sid=') && !sc.startsWith('talk.sid=;')) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  return { ir, cookie: () => cookie };
}

const v1 = (token) => (caminho, { metodo = 'GET', corpo, chave, cabecalhos = {} } = {}) => navegador().ir(`/api/v1${caminho}`, {
  metodo, corpo, cabecalhos: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(chave ? { 'Idempotency-Key': chave } : {}), ...cabecalhos },
});

test('C3: envio pela API v1 e pela tela até "lida", idempotência, falhas e ações manuais', async () => {
  const nav = navegador();
  const { link } = primeiroAcesso({ db, nome: 'Ana', telefone: '5565999990001', empresa: 'J2A', apelido: 'j2a' });
  await nav.ir(link.slice(link.indexOf('/api/publico')));

  // Canal conectado (simulado), envio ligado e lista de teste — só a plataforma liga.
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Envio', provedor: 'wweb', numero: '5565900000000' } })).corpo;
  assert.equal(c.envio_habilitado, false, 'publicado desligado');
  await nav.ir(`/api/admin/canais/${c.id}/conectar`, { metodo: 'POST' });
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'qr_pendente');
  supervisor._comandoTeste(c.id, 'simular-leitura');
  await esperar(async () => (await nav.ir(`/api/admin/canais/${c.id}`)).corpo.estado === 'conectado');

  // Aplicação com token, escopos e o canal autorizado.
  const app = (await nav.ir('/api/admin/aplicacoes', { metodo: 'POST', corpo: { nome: 'ERP', escopos: ['mensagens:enviar', 'mensagens:ler', 'canais:ler'], canais_autorizados: [c.id] } })).corpo;
  const token = (await nav.ir(`/api/admin/aplicacoes/${app.id}/tokens`, { metodo: 'POST' })).corpo.token;
  const api = v1(token);
  const corpo = { canal: c.id, para: '+55 65 99999-0010', tipo: 'texto', texto: '*Resumo:* 3 pedidos.' };

  // Desligado → 422 envio_desligado (nada entra na fila).
  let r = await api('/mensagens', { metodo: 'POST', corpo, chave: 'pedido-0001' });
  assert.equal(r.status, 422);
  assert.equal(r.corpo.erro.codigo, 'envio_desligado');
  assert.equal((await nav.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { envio_habilitado: true, numeros_teste: ['5565999990010'] } })).status, 200);

  // Autenticação, escopo, canal, chave.
  assert.equal((await v1(null)('/mensagens', { metodo: 'POST', corpo, chave: 'pedido-0001' })).status, 401);
  assert.equal((await v1('tk_live_falso')('/mensagens', { metodo: 'POST', corpo, chave: 'pedido-0001' })).status, 401);
  r = await api('/mensagens', { metodo: 'POST', corpo });
  assert.equal(r.status, 400, 'sem Idempotency-Key');
  assert.equal(r.corpo.erro.codigo, 'requisicao_invalida', 'código da tabela do contrato, não o interno da G8');
  assert.ok(r.corpo.erro.campos['Idempotency-Key']);
  r = await api('/mensagens', { metodo: 'POST', corpo, chave: 'curta' });
  assert.equal(r.corpo.erro.codigo, 'requisicao_invalida', 'chave fora do formato (8 a 128)');
  r = await api('/mensagens', { metodo: 'POST', corpo: { ...corpo, canal: 'cn_outro' }, chave: 'pedido-0002' });
  assert.equal(r.corpo.erro.codigo, 'canal_nao_autorizado');
  r = await api('/mensagens', { metodo: 'POST', corpo: { ...corpo, para: '5565988887777' }, chave: 'pedido-0003' });
  assert.equal(r.status, 403, 'modo de teste: fora da lista');
  r = await api('/mensagens', { metodo: 'POST', corpo: { ...corpo, tipo: 'imagem' }, chave: 'pedido-0004' });
  assert.equal(r.status, 400, 'P1: imagem sem arquivo');
  assert.ok(r.corpo.erro.campos.arquivo);

  // Aceita (202) com limites nos cabeçalhos; repetição devolve o mesmo id; outro corpo = 409.
  r = await api('/mensagens', { metodo: 'POST', corpo, chave: 'pedido-0001', cabecalhos: { 'X-Correlation-Id': 'chamado-1' } });
  assert.equal(r.status, 202);
  forma('v1MensagemAceita', r.corpo);
  assert.equal(r.corpo.estado, 'aceita');
  assert.equal(r.corpo.correlacao_id, 'chamado-1');
  assert.ok(r.headers.get('x-ratelimit-limit'), 'limite informado');
  const id = r.corpo.id;
  const repetido = await api('/mensagens', { metodo: 'POST', corpo, chave: 'pedido-0001' });
  assert.equal(repetido.status, 202);
  assert.equal(repetido.corpo.id, id);
  assert.equal(repetido.headers.get('idempotent-replayed'), 'true');
  assert.equal((await api('/mensagens', { metodo: 'POST', corpo: { ...corpo, texto: 'outro' }, chave: 'pedido-0001' })).corpo.erro.codigo, 'idempotencia_conflito');

  await esperar(async () => (await api(`/mensagens/${id}`)).corpo.estado === 'lida');
  const final = (await api(`/mensagens/${id}`)).corpo;
  forma('v1Mensagem', final);
  assert.equal(final.para_mascarado, '+55 65 9••••-0010');
  assert.deepEqual(final.historico_estados.map(h => h.estado), ['aceita', 'encaminhada', 'enviada', 'entregue', 'lida']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mensagens').get().n, 1, 'repetição não criou outra mensagem');
  const estadoCanal = (await api(`/canais/${c.id}/estado`)).corpo;
  forma('v1EstadoCanal', estadoCanal);
  assert.equal(estadoCanal.capacidades.imagem, true, 'P1: imagem, documento e áudio');
  assert.equal(estadoCanal.capacidades.video, false, 'vídeo fica para depois');

  // Tela: envio de teste pela posição na lista; o estado vai ao painel da empresa pelo socket.
  assert.equal((await nav.ir(`/api/admin/canais/${c.id}/enviar-teste`, { metodo: 'POST', corpo: { para_indice: 3, texto: 'x' } })).status, 403);
  assert.equal((await nav.ir(`/api/admin/canais/${c.id}/enviar-teste`, { metodo: 'POST', corpo: { para: '5565999990010', texto: 'x' } })).status, 400);
  r = await nav.ir(`/api/admin/canais/${c.id}/enviar-teste`, { metodo: 'POST', corpo: { para_indice: 0, texto: 'Teste pela tela' } });
  assert.equal(r.status, 202);
  forma('mensagemDetalhe', r.corpo);
  assert.equal(r.corpo.origem, 'teste_tela');
  assert.equal(r.corpo.aplicacao, null);
  const idTeste = r.corpo.id;
  await esperar(async () => (await nav.ir(`/api/admin/mensagens/${idTeste}`)).corpo.estado === 'lida');
  const empresaJ2a = db.prepare("SELECT id FROM empresas WHERE apelido = 'j2a'").get().id;
  const doTeste = emitidos.filter(([, ev, d]) => ev === 'mensagem:estado' && d.id === idTeste);
  assert.ok(doTeste.some(([, , d]) => d.estado === 'lida'));
  assert.ok(doTeste.every(([canal, , , extra]) => canal === c.id && extra?.empresaId === empresaJ2a), 'sala do canal + painel da empresa dona');

  // Falha permanente e resultado desconhecido (provedor simulado).
  supervisor._comandoTeste(c.id, 'simular-falha', { tipo: 'permanente' });
  await new Promise(r2 => setTimeout(r2, 50));
  const p = (await api('/mensagens', { metodo: 'POST', corpo: { ...corpo, texto: 'p' }, chave: 'pedido-perm' })).corpo.id;
  await esperar(async () => (await api(`/mensagens/${p}`)).corpo.estado === 'falhou');
  supervisor._comandoTeste(c.id, 'simular-falha', { tipo: 'desconhecido' });
  await new Promise(r2 => setTimeout(r2, 50));
  const u = (await api('/mensagens', { metodo: 'POST', corpo: { ...corpo, texto: 'u' }, chave: 'pedido-desc' })).corpo.id;
  await esperar(async () => (await api(`/mensagens/${u}`)).corpo.estado === 'desconhecida');

  // Tela Mensagens: lista com filtros, ações manuais só em falhou/desconhecida.
  const lista = (await nav.ir('/api/admin/mensagens?apenas_falhas=1')).corpo;
  forma('pagina', lista);
  lista.itens.forEach(i => forma('mensagemResumo', i));
  assert.deepEqual(lista.itens.map(i => i.id).sort(), [p, u].sort());
  assert.equal((await nav.ir('/api/admin/mensagens?limite=1')).corpo.itens.length, 1);
  assert.ok((await nav.ir('/api/admin/mensagens?limite=1')).corpo.proximo_cursor);
  assert.equal((await nav.ir('/api/admin/mensagens?correlacao_id=chamado')).corpo.itens[0].id, id);
  assert.equal((await nav.ir(`/api/admin/mensagens/${id}/reenviar`, { metodo: 'POST' })).status, 409, 'lida não reenvia');
  assert.equal((await nav.ir(`/api/admin/mensagens/${p}/dar-como-falha`, { metodo: 'POST' })).status, 409, 'já é falha');
  assert.equal((await nav.ir(`/api/admin/mensagens/${u}/dar-como-falha`, { metodo: 'POST' })).corpo.estado, 'falhou');
  assert.equal((await nav.ir(`/api/admin/mensagens/${p}/reenviar`, { metodo: 'POST' })).status, 200);
  await esperar(async () => (await nav.ir(`/api/admin/mensagens/${p}`)).corpo.estado === 'lida');
  const auditoria = (await nav.ir('/api/admin/auditoria?acao=mensagem')).corpo.itens.map(i => i.acao);
  assert.ok(auditoria.includes('mensagem.reenviada') && auditoria.includes('mensagem.dada_como_falha'));

  // Painel do dia: forma do contrato e números coerentes com o que aconteceu.
  const painel = (await nav.ir('/api/admin/painel')).corpo;
  forma('painel', painel);
  assert.equal(painel.canais.conectados, 1);
  assert.ok(painel.mensagens_hoje.enviadas >= 3);
  assert.equal(painel.fila.desconhecidas, 0, 'a desconhecida foi dada como falha');
  assert.equal(typeof painel.tempo_medio_envio_ms, 'number');

  // Terminal do canal registra os envios, sem número completo.
  const log = (await nav.ir(`/api/admin/canais/${c.id}/log?tipo=sent`)).corpo.itens;
  assert.ok(log.length >= 3);
  assert.ok(log.every(l => !l.mensagem.includes('5565999990010')));

  // Texto enviado no Terminal: vem da mensagem, só para a empresa que enviou; o log gravado não tem texto.
  const linhaTeste = log.find(l => l.mensagem_id === idTeste);
  assert.equal(linhaTeste?.texto, 'Teste pela tela');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM canal_log WHERE instr(mensagem, 'Teste pela tela') > 0").get().n, 0, 'AGENTS.md: log sem texto');
  assert.equal((await nav.ir(`/api/admin/mensagens/${idTeste}`)).corpo.texto, 'Teste pela tela', 'detalhe traz o texto completo');
  const navOutra = navegador();
  const acesso = primeiroAcesso({ db, nome: 'Vizinha', telefone: '5565999990009', empresa: 'Vizinha', apelido: 'vizinha' });
  await navOutra.ir(acesso.link.slice(acesso.link.indexOf('/api/publico')));
  const vizinha = db.prepare("SELECT id FROM empresas WHERE apelido = 'vizinha'").get().id;
  db.prepare('INSERT INTO canal_empresas (canal_id, empresa_id, padrao) VALUES (?, ?, 0)').run(c.id, vizinha); // mesmo número, outra empresa
  const logVizinha = (await navOutra.ir(`/api/admin/canais/${c.id}/log?tipo=sent`)).corpo.itens;
  assert.ok(logVizinha.length >= 3, 'a vizinha vê as linhas do canal…');
  assert.ok(logVizinha.every(l => l.texto === undefined && l.mensagem_id === undefined), '…mas nunca o texto de outra empresa');
  assert.equal((await navOutra.ir(`/api/admin/mensagens/${idTeste}`)).status, 404);
});

test('C3: envio_habilitado só pela administração da plataforma; outra empresa não vê a mensagem', async () => {
  const navA = navegador();
  const { link } = primeiroAcesso({ db, nome: 'Bia', telefone: '5565999990002', empresa: 'Outra', apelido: 'outra' });
  await navA.ir(link.slice(link.indexOf('/api/publico')));
  db.prepare("UPDATE usuarios SET administrador_plataforma = 0 WHERE telefone = '5565999990002'").run();
  const c = (await navA.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Dela', provedor: 'wweb', numero: '5565911110000' } })).corpo;
  const r = await navA.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo: { envio_habilitado: true } });
  assert.equal(r.status, 403);
  const alheia = db.prepare("SELECT id FROM mensagens LIMIT 1").get().id;
  assert.equal((await navA.ir(`/api/admin/mensagens/${alheia}`)).status, 404);
  assert.equal((await navA.ir('/api/admin/mensagens')).corpo.itens.length, 0);
});

test('C3: sala do painel é por empresa — só entra quem tem Mensagens ou Painel, na própria empresa', () => {
  let aoConectar = null;
  const emitidosSala = [];
  const ns = {
    use() {}, on(ev, fn) { if (ev === 'connection') aoConectar = fn; }, fetchSockets: async () => [],
    to: (sala) => ({ emit: (ev) => emitidosSala.push({ sala, ev }) }),
  };
  const emitir = configurarTempoReal(ns, { db, supervisor });
  const socket = (rotinas, empresaId) => {
    const salas = []; const handlers = {};
    const s = { data: { rotinas, empresaId }, on: (ev, fn) => { handlers[ev] = fn; }, join: (x) => salas.push(x), emit() {} };
    aoConectar(s);
    handlers['painel:assinar']();
    return salas;
  };
  assert.deepEqual(socket(['talk-mensagens'], 'emp_a'), ['painel:emp_a']);
  assert.deepEqual(socket(['talk-canais'], 'emp_b'), [], 'sem Mensagens/Painel não entra');
  emitir('cn_x', 'mensagem:estado', { id: 'msg_1', estado: 'lida' }, { empresaId: 'emp_a' });
  assert.deepEqual(emitidosSala.map(e => e.sala), ['canal:cn_x', 'painel:emp_a']);
});

test('C3: regras do canal — envio e recebimento separados, lista por posição, auditoria', async () => {
  const nav = navegador();
  const { link } = primeiroAcesso({ db, nome: 'Caio', telefone: '5565999990003', empresa: 'Regras', apelido: 'regras' });
  await nav.ir(link.slice(link.indexOf('/api/publico')));
  const c = (await nav.ir('/api/admin/canais', { metodo: 'POST', corpo: { nome: 'Regras', provedor: 'wweb', numero: '5565922220000' } })).corpo;
  assert.equal(c.envio_modo, 'desligado');
  assert.equal(c.recebimento_modo, 'teste');
  const put = (corpo) => nav.ir(`/api/admin/canais/${c.id}`, { metodo: 'PUT', corpo });
  assert.equal((await put({ envio_modo: 'talvez' })).status, 400);
  let r = (await put({ numeros_teste_adicionar: ['5565999990020', '5565999990021', '556599990020'] })).corpo;
  assert.deepEqual(r.numeros_teste_mascarados, ['+55 65 9••••-0020', '+55 65 9••••-0021'], 'sem duplicar (com e sem o nono dígito)');
  r = (await put({ numeros_teste_remover: [0], envio_modo: 'qualquer' })).corpo;
  assert.deepEqual(r.numeros_teste_mascarados, ['+55 65 9••••-0021']);
  assert.equal(r.envio_modo, 'qualquer');
  assert.equal(r.recebimento_modo, 'teste', 'envio liberado não libera o recebimento');
  assert.equal(r.envio_habilitado, true);
  const linha = db.prepare('SELECT envio_modo, recebimento_modo FROM canais WHERE id = ?').get(c.id);
  assert.deepEqual({ ...linha }, { envio_modo: 'qualquer', recebimento_modo: 'teste' });
  const acoes = (await nav.ir('/api/admin/auditoria?acao=canal.')).corpo.itens.map(i => `${i.acao}|${i.resumo}`);
  assert.ok(acoes.some(a => a.startsWith('canal.regra_envio|') && a.includes('desligado → qualquer número')));
  assert.ok(acoes.some(a => a.startsWith('canal.numeros_teste|') && !/5565999990021/.test(a)), 'auditoria com número mascarado');
});
