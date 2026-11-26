'use strict';

// C3 — regras da fila de saída sem processo filho: supervisor falso controla o
// resultado de cada envio e os recibos do WhatsApp.

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco } = require('../backend/database');
const { Despachante } = require('../backend/mensagens/despachante');
const repo = require('../backend/mensagens/repositorio');
const { aceitarEnvio } = require('../backend/mensagens/servico');

const agoraIso = () => new Date().toISOString();

function montar({ respostas = [], estadoCanal = 'conectado', envio = 1, modoTeste = 1, lista = ['5565999990010'] } = {}) {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = agoraIso();
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES ('emp_a', 'A', 'emp-a', 'ativa', ?, ?)").run(t, t);
  db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado, estado_desde, ligado, sessao_id, numeros_teste, envio_modo, recebimento_modo, criado_em, atualizado_em)
    VALUES ('cn_a', 'emp_a', 'Canal A', '5565900000000', 'wweb', ?, ?, 1, 's1', ?, ?, 'teste', ?, ?)`).run(estadoCanal, t, JSON.stringify(lista), envio ? (modoTeste ? 'teste' : 'qualquer') : 'desligado', t, t);
  const enviados = [];
  const logs = [];
  const emitidos = [];
  const supervisor = {
    filhos: new Map([['cn_a', {}]]),
    async enviar(canalId, env) { enviados.push(env); return respostas.shift() || { ok: true, id_provedor: `wa_${enviados.length}` }; },
    log(canalId, tipo, msg) { logs.push({ tipo, msg }); },
  };
  const d = new Despachante({ db, supervisor, emitir: (canal, ev, dados, extra) => emitidos.push({ ev, dados, extra }), intervaloMinimoMs: 0, variacaoMs: 0, esperas: [10, 10] });
  const nova = (para = '5565999990010', texto = 'Olá') => aceitarEnvio(db, { empresaId: 'emp_a', canalId: 'cn_a', para, texto, origem: 'api' });
  return { db, d, supervisor, enviados, logs, emitidos, nova };
}

const rodada = async (d) => { d.acordar(); await new Promise(r => setTimeout(r, 30)); };
const estado = (db, id) => repo.buscar(db, id).estado;
const linha = (db, id) => repo.historico(db, id).map(h => h.estado).join('>');

test('caminho feliz: aceita → encaminhada → enviada → entregue → lida; recibo atrasado não volta o estado', async () => {
  const { db, d, enviados, emitidos, logs, nova } = montar();
  const m = nova();
  await rodada(d);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].destinatario.valor, '5565999990010');
  assert.equal(estado(db, m.id), 'encaminhada');
  d.aoRecibo('cn_a', { id_provedor: 'wa_1', estado: 'enviada' });
  d.aoRecibo('cn_a', { id_provedor: 'wa_1', estado: 'lida' });
  d.aoRecibo('cn_a', { id_provedor: 'wa_1', estado: 'entregue' }); // chegou atrasado
  assert.equal(estado(db, m.id), 'lida');
  assert.equal(linha(db, m.id), 'aceita>encaminhada>enviada>lida');
  assert.ok(emitidos.every(e => e.ev === 'mensagem:estado' && e.extra.empresaId === 'emp_a'), 'aviso vai ao painel da empresa dona');
  assert.ok(logs.some(l => l.tipo === 'sent' && /\+55 65 9••••-0010/.test(l.msg)), 'Terminal mostra o envio mascarado');
});

test('recibo de mensagem que não é do Talk (IA Command no mesmo número) é ignorado; recibo adiantado vale quando o id chega', async () => {
  const { db, d, nova } = montar({ respostas: [{ ok: true, id_provedor: 'wa_cedo' }] });
  d.aoRecibo('cn_a', { id_provedor: 'wa_do_ia_command', estado: 'lida' });
  d.aoRecibo('cn_a', { id_provedor: 'wa_cedo', estado: 'enviada' }); // antes de o envio responder
  const m = nova();
  await rodada(d);
  assert.equal(estado(db, m.id), 'enviada');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mensagens WHERE estado = 'lida'").get().n, 0);
});

test('erro temporário: nova tentativa com espera; esgotadas, falhou', async () => {
  const temp = { ok: false, tipo: 'temporario', mensagem: 'Canal não está conectado.' };
  const { db, d, nova } = montar({ respostas: [temp, temp, temp] });
  const m = nova();
  await rodada(d);
  assert.equal(estado(db, m.id), 'aguardando');
  assert.ok(repo.buscar(db, m.id).proxima_tentativa_em);
  await new Promise(r => setTimeout(r, 20)); await rodada(d);
  assert.equal(estado(db, m.id), 'aguardando');
  await new Promise(r => setTimeout(r, 20)); await rodada(d);
  assert.equal(estado(db, m.id), 'falhou');
  assert.match(repo.historico(db, m.id).at(-1).detalhe, /Esgotou 3 tentativa/);
  assert.equal(repo.buscar(db, m.id).tentativas, 3);
});

test('erro permanente: falhou na hora; desconhecido: nunca reenvia sozinho, mas recibo do WhatsApp corrige', async () => {
  const { db, d, enviados, nova } = montar({ respostas: [
    { ok: false, tipo: 'permanente', mensagem: 'Número não encontrado no WhatsApp.' },
    { ok: false, tipo: 'desconhecido', mensagem: 'O canal não respondeu a tempo.' },
  ] });
  const a = nova();
  await rodada(d);
  assert.equal(estado(db, a.id), 'falhou');
  const b = nova('5565999990010', 'segunda');
  await rodada(d); await rodada(d); await rodada(d);
  assert.equal(estado(db, b.id), 'desconhecida');
  assert.equal(enviados.length, 2, 'desconhecida não volta para a fila');
  db.prepare("UPDATE mensagens SET id_provedor = 'wa_x' WHERE id = ?").run(b.id);
  d.aoRecibo('cn_a', { id_provedor: 'wa_x', estado: 'entregue' });
  assert.equal(estado(db, b.id), 'entregue', 'prova de envio vence o desconhecido');
});

test('Talk caiu no meio do envio: encaminhada sem id vira desconhecida ao voltar', () => {
  const { db, d, nova } = montar();
  const m = nova();
  repo.mudarEstado(db, m.id, 'encaminhada');
  d.iniciar(); d.parar();
  assert.equal(estado(db, m.id), 'desconhecida');
  assert.match(repo.historico(db, m.id).at(-1).detalhe, /reiniciou durante o envio/);
});

test('canal fora do ar ou envio desligado: espera em "aguardando"; mais de 24 h, falhou', async () => {
  const { db, d, enviados, nova } = montar();
  const m = nova();
  db.prepare("UPDATE canais SET estado = 'reconectando'").run();
  await rodada(d);
  assert.equal(estado(db, m.id), 'aguardando');
  assert.equal(enviados.length, 0);
  db.prepare("UPDATE mensagens SET criada_em = '2020-01-01T00:00:00.000Z'").run();
  await rodada(d);
  assert.equal(estado(db, m.id), 'falhou');
  assert.match(repo.historico(db, m.id).at(-1).detalhe, /24 h/);
});

test('modo de teste conferido na saída: número tirado da lista depois de aceito → falhou sem enviar', async () => {
  const { db, d, enviados, nova } = montar();
  const m = nova();
  db.prepare("UPDATE canais SET numeros_teste = '[]'").run();
  await rodada(d);
  assert.equal(enviados.length, 0);
  assert.equal(estado(db, m.id), 'falhou');
});

test('ritmo por canal: uma por vez e intervalo mínimo entre envios', async () => {
  const { db, d, enviados, nova } = montar();
  d.intervaloMinimoMs = 10_000;
  nova(); nova();
  await rodada(d); await rodada(d);
  assert.equal(enviados.length, 1, 'a segunda espera o intervalo');
  d.liberadoEm.set('cn_a', 0);
  await rodada(d);
  assert.equal(enviados.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mensagens WHERE estado = 'encaminhada'").get().n, 2);
});

test('aceitar envio: regras (desligado, parado, modo de teste, só texto, limites)', () => {
  const { db, nova } = montar({ envio: 0 });
  const tentar = (extra = {}) => { try { aceitarEnvio(db, { empresaId: 'emp_a', canalId: 'cn_a', para: '5565999990010', texto: 'x', origem: 'api', ...extra }); return 'ok'; } catch (e) { return e.codigo; } };
  assert.equal(tentar(), 'envio_desligado');
  db.prepare("UPDATE canais SET envio_modo = 'teste', ligado = 0").run();
  assert.equal(tentar(), 'canal_desconectado');
  db.prepare('UPDATE canais SET ligado = 1').run();
  assert.equal(tentar({ para: '5565988887777' }), 'sem_permissao', 'fora da lista de teste');
  assert.equal(tentar({ para: '556599990010' }), 'ok', 'lista aceita o número sem o nono dígito');
  assert.equal(tentar({ tipo: 'imagem' }), 'recurso_nao_suportado');
  assert.equal(tentar({ texto: ' ' }), 'requisicao_invalida');
  assert.equal(tentar({ texto: 'x'.repeat(4097) }), 'requisicao_invalida');
  assert.equal(tentar({ empresaId: 'emp_outra' }), 'canal_nao_autorizado');
  assert.ok(nova);
});

test('linha de comando: regras do canal (nomes novos e antigos), auditadas', () => {
  const { db } = montar({ envio: 0 });
  const { executar } = require('../backend/cli/canal-teste');
  assert.equal(executar(db, { canal: 'Canal A', envio: 'ligado' }).envio_modo, 'teste', 'antigo: ligado em teste = só a lista');
  // O comando de hoje no servidor: --modo desligado --envio ligado = qualquer número e recebe de todos.
  assert.deepEqual(executar(db, { canal: 'cn_a', modo: 'desligado', envio: 'ligado' }), { id: 'cn_a', nome: 'Canal A', envio_modo: 'qualquer', recebimento_modo: 'todos', numeros_teste: ['+55 65 9••••-0010'] });
  assert.deepEqual((({ envio_modo, recebimento_modo }) => ({ envio_modo, recebimento_modo }))(executar(db, { canal: 'cn_a', recebimento: 'teste' })), { envio_modo: 'qualquer', recebimento_modo: 'teste' }, 'separadas: envio livre, recebimento só da lista');
  assert.equal(executar(db, { canal: 'cn_a', envio: 'desligado' }).envio_modo, 'desligado');
  assert.throws(() => executar(db, { canal: 'cn_a', envio: 'talvez' }), /--envio desligado, teste ou qualquer/);
  const acoes = db.prepare("SELECT acao FROM auditoria WHERE alvo_id = 'cn_a'").all().map(a => a.acao);
  assert.equal(acoes.filter(a => a === 'canal.regra_envio').length, 3);
  assert.equal(acoes.filter(a => a === 'canal.regra_recebimento').length, 2);
});
