'use strict';

// C12 — menu de setores no servidor REAL (docs/contratos.md §9.3), com a leitura da resposta
// pela biblioteca X1: conversa nova em triagem, escolha, tentativas, "menu", setor único,
// canal sem envio, vencimento, quem vê, assumir/transferir e configuração do setor e do canal.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const cifra = require('../backend/seguranca/cifra');
const { abrirBanco } = require('../backend/database');
const { Atendimento } = require('../backend/atendimento/servico');
const repo = require('../backend/atendimento/repositorio');
const { criarApp } = require('../backend/servidor');
const { executar: primeiroAcesso } = require('../backend/cli/primeiro-acesso');
const { novoId } = require('../backend/ids');
cifra.definirChaveParaTeste(crypto.randomBytes(32));

const CLIENTE = '5565999981001';

function montar({ menu = { ligado: true }, envio = 'teste', aparecem = ['suporte', 'financeiro', 'comercial'] } = {}) {
  const db = abrirBanco({ arquivo: ':memory:' });
  const t = new Date().toISOString();
  const emp = novoId('empresa');
  db.prepare("INSERT INTO empresas (id, nome, apelido, situacao, criado_em, atualizado_em) VALUES (?, 'J2A', 'j2a', 'ativa', ?, ?)").run(emp, t, t);
  const setores = {};
  ['suporte', 'financeiro', 'comercial'].forEach((codigo, i) => {
    const id = novoId('setor');
    setores[codigo] = id;
    db.prepare('INSERT INTO setores (id, empresa_id, codigo, nome, menu, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, emp, codigo, codigo[0].toUpperCase() + codigo.slice(1), JSON.stringify({ aparece: aparecem.includes(codigo), ordem: i + 1, texto: null }), t, t);
  });
  const canal = novoId('canal');
  db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, numero, provedor, estado, estado_desde, ligado, sessao_id, criado_em, atualizado_em,
      envio_modo, recebimento_modo, numeros_teste, uso, atendimento_empresa_id, setor_padrao_id, menu)
    VALUES (?, ?, 'J2A', '5565900000000', 'wweb', 'conectado', ?, 1, 's1', ?, ?, ?, 'todos', ?, 'atendimento', ?, ?, ?)`)
    .run(canal, emp, t, t, t, envio, JSON.stringify([CLIENTE]), emp, setores.suporte, menu ? JSON.stringify(menu) : null);
  const usuario = (nome) => {
    const id = novoId('usuario');
    db.prepare('INSERT INTO usuarios (id, nome, telefone, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)').run(id, nome, `55659${String(Math.random()).slice(2, 10)}`, t, t);
    return id;
  };
  const carla = usuario('Carla');
  db.prepare('INSERT INTO setor_membros (setor_id, usuario_id) VALUES (?, ?)').run(setores.suporte, carla);
  const atendimento = new Atendimento({ db });
  const chega = (texto) => atendimento.receber(canal, { id_provedor: novoId('mensagem'), de: { tipo: 'telefone', valor: CLIENTE }, tipo: 'texto', texto, em: new Date().toISOString() });
  const conversa = () => db.prepare('SELECT cv.*, s.codigo AS setor_codigo FROM conversas cv JOIN setores s ON s.id = cv.setor_id ORDER BY cv.rowid DESC LIMIT 1').get();
  const automaticas = () => db.prepare("SELECT conteudo FROM mensagens WHERE origem = 'automatica' ORDER BY rowid").all().map(r => r.conteudo);
  const eventos = () => db.prepare("SELECT texto FROM conversa_itens WHERE categoria = 'evento' ORDER BY rowid").all().map(r => r.texto);
  const supervisao = { empresaId: emp, usuarioId: usuario('Ana'), veTudo: true };
  const atendente = { empresaId: emp, usuarioId: carla, veTudo: false };
  return { db, emp, canal, setores, atendimento, chega, conversa, automaticas, eventos, supervisao, atendente };
}

test('menu desligado (padrão): conversa nova vai direto para o setor padrão, como antes', () => {
  const m = montar({ menu: null });
  m.chega('Bom dia');
  assert.equal(m.conversa().setor_codigo, 'suporte');
  assert.equal(m.conversa().triagem_desde, null);
  assert.deepEqual(m.automaticas(), []);
  assert.deepEqual(m.eventos(), ['Conversa aberta no setor Suporte.']);
});

test('menu ligado: conversa nova em triagem, menu enviado; fora da fila e invisível para o atendente', () => {
  const m = montar();
  m.chega('Bom dia');
  const cv = m.conversa();
  assert.ok(cv.triagem_desde);
  assert.equal(m.automaticas().length, 1);
  assert.match(m.automaticas()[0], /1 – Suporte\n2 – Financeiro\n3 – Comercial\nResponda com o número da opção\./);
  const sup = m.atendimento.contadores(m.supervisao);
  assert.deepEqual([sup.triagem, sup.fila, sup.abertas], [1, 0, 0], 'triagem tem contador próprio');
  assert.equal(m.atendimento.podeVer(m.atendente, repo.buscarConversa(m.db, m.emp, cv.id)), false, 'atendente não vê o menu');
  assert.equal(m.atendimento.contadores(m.atendente).triagem, 0);
  assert.equal(repo.paraConversaResumo(m.db, repo.buscarConversa(m.db, m.emp, cv.id)).na_fila, false);
  assert.throws(() => m.atendimento.assumir(m.supervisao, cv.id), (e) => e.status === 409 && /menu de setores/.test(e.message));
});

test('escolha pelo número vai para a fila do setor; nome também vale', () => {
  const m = montar();
  m.chega('Oi');
  m.chega('2');
  assert.equal(m.conversa().setor_codigo, 'financeiro');
  assert.equal(m.conversa().triagem_desde, null);
  assert.ok(m.eventos().includes('Escolheu o setor Financeiro.'));
  assert.equal(m.atendimento.contadores(m.supervisao).fila, 1);
  m.chega('Obrigado'); // depois da escolha, mensagem comum: nada automático
  assert.equal(m.automaticas().length, 1);

  const n = montar();
  n.chega('Oi');
  n.chega('quero falar com o comercial');
  assert.equal(n.conversa().setor_codigo, 'comercial');
});

test('resposta inválida repete o menu; "menu" mostra de novo sem contar; esgotou → setor padrão', () => {
  const m = montar({ menu: { ligado: true, tentativas: 2 } });
  m.chega('Oi');
  m.chega('banana');
  assert.match(m.automaticas()[1], /^Não entendi a opção\./);
  assert.equal(m.conversa().triagem_tentativas, 1);
  m.chega('menu');
  assert.doesNotMatch(m.automaticas()[2], /Não entendi/);
  assert.equal(m.conversa().triagem_tentativas, 1, '"menu" não conta tentativa');
  m.chega('quero o 2 e o 3'); // ambíguo: nunca adivinha
  assert.equal(m.conversa().setor_codigo, 'suporte');
  assert.equal(m.conversa().triagem_desde, null);
  assert.ok(m.eventos().includes('Sem escolha: setor padrão (Suporte).'));
  assert.equal(m.automaticas().length, 3, 'ao ir para o padrão não manda mais nada');
});

test('um setor só no menu: vai direto para ele, sem menu; canal sem envio para o número: setor padrão', () => {
  const um = montar({ aparecem: ['comercial'] });
  um.chega('Oi');
  assert.equal(um.conversa().setor_codigo, 'comercial');
  assert.equal(um.conversa().triagem_desde, null);
  assert.deepEqual(um.automaticas(), []);

  const semEnvio = montar({ envio: 'desligado' });
  semEnvio.chega('Oi');
  assert.equal(semEnvio.conversa().triagem_desde, null, 'menu que não pode ser entregue não prende a conversa');
  assert.equal(semEnvio.conversa().setor_codigo, 'suporte');
});

test('vencimento: menu sem resposta no tempo do canal vai para o setor padrão', () => {
  const m = montar({ menu: { ligado: true, tempo_min: 10 } });
  m.chega('Oi');
  assert.equal(m.atendimento.vencerTriagens(), 0, 'ainda no prazo');
  m.db.prepare('UPDATE conversas SET triagem_desde = ?').run(new Date(Date.now() - 11 * 60_000).toISOString());
  assert.equal(m.atendimento.vencerTriagens(), 1);
  assert.equal(m.conversa().triagem_desde, null);
  assert.ok(m.eventos().includes('Sem resposta ao menu: setor padrão (Suporte).'));
  assert.equal(m.atendimento.vencerTriagens(), 0, 'não repete');
});

test('supervisão transfere uma conversa que está no menu: sai da triagem', () => {
  const m = montar();
  m.chega('Oi');
  const cv = m.conversa();
  m.atendimento.transferir(m.supervisao, cv.id, { setor_id: m.setores.comercial });
  assert.equal(m.conversa().triagem_desde, null);
  assert.equal(m.conversa().setor_codigo, 'comercial');
});

test('configuração do setor: blocos da Onda 1 gravados, parciais e validados', () => {
  const m = montar();
  const s = repo.buscarSetor(m.db, m.emp, m.setores.financeiro);
  const novo = m.atendimento.atualizarSetor(m.supervisao, s.id, { versao: s.versao, menu: { texto: 'Boletos e notas' }, pesquisa: { ligada: true } });
  const publico = repo.paraSetor(m.db, novo);
  assert.deepEqual(publico.menu, { aparece: true, ordem: 2, texto: 'Boletos e notas' }, 'parcial junta com o que existia');
  assert.equal(publico.pesquisa.ligada, true);
  assert.equal(publico.distribuicao.modo, 'fila_livre', 'o resto continua no padrão');
  assert.throws(() => m.atendimento.atualizarSetor(m.supervisao, s.id, { versao: novo.versao, distribuicao: { limite_por_atendente: 0 } }),
    (e) => e.status === 400 && !!e.campos?.distribuicao);
  m.chega('Oi');
  assert.match(m.automaticas()[0], /2 – Boletos e notas/, 'o menu usa o texto da opção');
});

test('canal: campos do menu no PUT só para a administração da plataforma e só com o número em atendimento', async () => {
  const db = abrirBanco({ arquivo: ':memory:' });
  const servidor = http.createServer(criarApp({ db, log: { error() {} }, transportes: { whatsapp: async () => ({ ok: true }) } }));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${servidor.address().port}/app/ia-talk`;
    const { link } = primeiroAcesso({ db, nome: 'Ana Admin', telefone: '5565999990001', empresa: 'J2A Consultoria', apelido: 'j2a' });
    const login = await fetch(`${base}${link.slice(link.indexOf('/api/publico'))}`, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const api = async (caminho, metodo = 'GET', corpo) => {
      const r = await fetch(`${base}/api/admin${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: corpo && JSON.stringify(corpo) });
      return { status: r.status, corpo: await r.json() };
    };
    const emp = db.prepare("SELECT id FROM empresas WHERE apelido = 'j2a'").get().id;
    const t = new Date().toISOString();
    const setor = novoId('setor');
    db.prepare("INSERT INTO setores (id, empresa_id, codigo, nome, criado_em, atualizado_em) VALUES (?, ?, 'suporte', 'Suporte', ?, ?)").run(setor, emp, t, t);
    const canal = novoId('canal');
    db.prepare(`INSERT INTO canais (id, empresa_dona_id, nome, provedor, estado, estado_desde, ligado, sessao_id, criado_em, atualizado_em)
      VALUES (?, ?, 'J2A', 'wweb', 'parado', ?, 0, 's1', ?, ?)`).run(canal, emp, t, t, t);
    db.prepare('INSERT INTO canal_empresas (canal_id, empresa_id, padrao) VALUES (?, ?, 1)').run(canal, emp);

    const semUso = await api(`/canais/${canal}`, 'PUT', { menu_ligado: true });
    assert.equal(semUso.status, 400, 'número só de integração não tem menu');
    assert.ok(semUso.corpo.erro.campos.menu_ligado);
    const ok = await api(`/canais/${canal}`, 'PUT', { uso: 'atendimento', setor_padrao_id: setor, menu_ligado: true, menu_tentativas: 3 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.corpo.atendimento.menu, { ligado: true, saudacao: 'Olá! Para agilizar seu atendimento, escolha o setor:', tempo_min: 10, tentativas: 3 });
    assert.equal((await api(`/canais/${canal}`, 'PUT', { menu_tempo_min: 0 })).status, 400);
    const aud = db.prepare("SELECT resumo FROM auditoria WHERE acao = 'canal.menu'").get();
    assert.match(aud.resumo, /ligado \(3 tentativa\(s\), 10 min\)/);
    const triagem = await api('/conversas?visao=triagem');
    assert.equal(triagem.status, 200);
  } finally {
    await new Promise(r => servidor.close(r));
  }
});
