'use strict';

// Rotas sem sessão: página da empresa (apelido), login por código, link de uso
// único e entrada pelo card do IAHub. Contrato: docs/contratos.md §3.1.

const express = require('express');
const config = require('../config');
const { novoId, agora } = require('../ids');
const { erro, middlewareErros } = require('../erros');
const sessoes = require('../acesso/sessoes');
const desafios = require('../acesso/desafios');
const ticketHub = require('../acesso/ticket-hub');
const auditoria = require('../repositorios/auditoria');
const { Contexto } = require('../repositorios/base');
const telefone = require('../seguranca/telefone');
const { ipDe } = require('../acesso/middleware');

function iniciarSessao(db, req, res, { usuarioId, empresaId, origem, rotinasHub = null, empresasCanaisHub = null }) {
  const token = sessoes.criar(db, { usuarioId, empresaId, origem, ip: ipDe(req), rotinasHub, empresasCanaisHub });
  res.cookie(sessoes.COOKIE, token, sessoes.opcoesCookie(req));
  db.prepare('UPDATE usuarios SET ultimo_acesso_em = ? WHERE id = ?').run(agora(), usuarioId);
  auditoria.registrar(db, new Contexto({ empresaId, usuarioId }), { acao: 'login', alvoTipo: 'sessao', resumo: `Entrou (${origem})`, ip: ipDe(req) });
}

function apelidoLivre(db, nome) {
  const base = String(nome || 'empresa').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'empresa';
  const raiz = base.length < 3 ? `${base}-emp` : base;
  for (let i = 1; i < 1000; i++) {
    const candidato = i === 1 ? raiz : `${raiz}-${i}`;
    if (!db.prepare('SELECT 1 FROM empresas WHERE apelido = ?').get(candidato)) return candidato;
  }
  throw new Error('Não foi possível gerar um apelido livre.');
}

// Empresa do Talk ligada à empresa do IAHub (hub_empresa_id): acha ou cria. Usada na
// entrada pelo card e ao vincular uma empresa do IAHub a um canal — o mesmo
// hub_empresa_id nunca vira duas empresas.
function empresaDoHub(db, { id: hubId, nome }) {
  const t = agora();
  let empresa = db.prepare('SELECT * FROM empresas WHERE hub_empresa_id = ?').get(Number(hubId));
  if (!empresa) {
    const id = novoId('empresa');
    db.prepare(`INSERT INTO empresas (id, nome, apelido, situacao, hub_empresa_id, hub_empresa_nome, criado_em, atualizado_em)
      VALUES (?, ?, ?, 'ativa', ?, ?, ?, ?)`).run(id, String(nome || `Empresa ${hubId}`), apelidoLivre(db, nome),
      Number(hubId), nome || null, t, t);
    empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
  } else if (nome && nome !== empresa.hub_empresa_nome) {
    db.prepare('UPDATE empresas SET hub_empresa_nome = ? WHERE id = ?').run(nome, empresa.id);
  }
  return empresa;
}

// Lista assinada pelo IAHub (empresas_canais): só ids numéricos positivos.
function empresasCanaisDoTicket(dados) {
  return (Array.isArray(dados.empresas_canais) ? dados.empresas_canais : [])
    .filter(e => Number.isInteger(Number(e?.id)) && Number(e.id) > 0)
    .map(e => ({ id: Number(e.id), nome: String(e.nome || '') }));
}

// Primeira entrada de uma empresa/usuário do IAHub: cria o vínculo. A empresa só
// chega aqui se a IA Gestão ligou o IA Talk para ela (o IAHub confere antes de assinar).
function provisionarDoHub(db, dados) {
  const t = agora();
  const empresa = empresaDoHub(db, dados.empresa);
  const empresasCanaisHub = empresasCanaisDoTicket(dados);
  if (empresa.situacao !== 'ativa') throw erro('sem_permissao', 'Esta empresa está inativa no IA Talk.');

  const u = dados.usuario;
  const hubId = String(u.id);
  let usuario = db.prepare('SELECT * FROM usuarios WHERE hub_usuario_id = ?').get(hubId);
  const cel = telefone.valido(u.celular) ? telefone.normalizar(u.celular) : null;
  if (!usuario && cel) {
    usuario = db.prepare('SELECT * FROM usuarios WHERE telefone = ? AND hub_usuario_id IS NULL').get(cel) || null;
    if (usuario) db.prepare('UPDATE usuarios SET hub_usuario_id = ? WHERE id = ?').run(hubId, usuario.id);
  }
  if (!usuario) {
    const id = novoId('usuario');
    db.prepare(`INSERT INTO usuarios (id, nome, telefone, email, hub_usuario_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, String(u.nome || 'Usuário do IAHub'), cel || `hub:${hubId}`, u.email || null, hubId, t, t);
    usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  }
  if (usuario.situacao !== 'ativo') throw erro('sem_permissao', 'Seu usuário está inativo no IA Talk. Fale com o administrador.');

  if (u.admin) {
    db.prepare('UPDATE usuarios SET administrador_plataforma = 1 WHERE id = ?').run(usuario.id);
    const membro = db.prepare('SELECT * FROM membros WHERE empresa_id = ? AND usuario_id = ?').get(empresa.id, usuario.id);
    if (!membro) {
      db.prepare(`INSERT INTO membros (id, empresa_id, usuario_id, papel, criado_em, atualizado_em) VALUES (?, ?, ?, 'admin_empresa', ?, ?)`)
        .run(novoId('membro'), empresa.id, usuario.id, t, t);
    }
    return { usuarioId: usuario.id, empresaId: empresa.id, rotinasHub: null, empresasCanaisHub };
  }
  // Usuário comum: valem as rotinas talk-* liberadas na IA Gestão (por usuário e empresa).
  const rotinasHub = Array.isArray(dados.rotinas) ? dados.rotinas.filter(r => String(r).startsWith('talk-')) : [];
  if (!rotinasHub.length) throw erro('sem_permissao', 'Seu usuário ainda não tem acesso ao IA Talk nesta empresa. Peça ao administrador para liberar as rotinas na IA Gestão.');
  const membro = db.prepare('SELECT * FROM membros WHERE empresa_id = ? AND usuario_id = ?').get(empresa.id, usuario.id);
  if (membro && membro.situacao !== 'ativo') throw erro('sem_permissao', 'Seu acesso a esta empresa foi desativado no IA Talk. Fale com o administrador.');
  if (!membro) {
    db.prepare(`INSERT INTO membros (id, empresa_id, usuario_id, papel, criado_em, atualizado_em) VALUES (?, ?, ?, 'atendente', ?, ?)`)
      .run(novoId('membro'), empresa.id, usuario.id, t, t);
  }
  return { usuarioId: usuario.id, empresaId: empresa.id, rotinasHub, empresasCanaisHub };
}

// Erro numa rota aberta pelo navegador (link, card): página simples em vez de JSON.
function paginaDeErro(res, err) {
  const status = err.status || 500;
  const msg = err.status ? err.message : 'Não foi possível concluir o acesso. Tente de novo.';
  const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  res.status(status).type('html').send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IA Talk</title><link rel="stylesheet" href="${config.BASE_PATH}/ui/css/iahub.css"></head>
<body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:var(--bg-base)">
<main style="max-width:440px;text-align:center;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:28px">
<h1 style="font-size:18px;margin:0 0 8px">Não foi possível entrar</h1><p style="color:var(--text-md);margin:0">${esc(msg)}</p></main></body></html>`);
}

function criarRotasPublicas({ db, transportes = {}, chavePublicaHub = () => ticketHub.carregarChavePublica(), log = console }) {
  const r = express.Router();

  r.get('/empresa/:apelido', (req, res) => {
    const e = desafios.empresaPorApelido(db, req.params.apelido);
    res.json({ nome: e.nome, apelido: e.apelido, logo_url: e.logo_url, metodos: ['telefone'] });
  });

  r.post('/login/codigo', async (req, res, next) => {
    try {
      res.json(await desafios.pedirCodigo(db, { apelido: req.body?.apelido, telefone: req.body?.telefone, ip: ipDe(req), transportes }));
    } catch (err) {
      if (err.codigo === 'indisponivel') log.error?.(`[IA Talk] Código de login não enviado: ${(err.detalhe?.motivos || []).join(', ')}`);
      if (err.detalhe?.motivos) delete err.detalhe; // motivos técnicos só no log
      next(err);
    }
  });

  r.post('/login/confirmar', (req, res) => {
    const { usuario_id, empresa_id } = desafios.confirmarCodigo(db, { desafioId: req.body?.desafio_id, codigo: req.body?.codigo });
    iniciarSessao(db, req, res, { usuarioId: usuario_id, empresaId: empresa_id, origem: 'telefone' });
    res.json({ ok: true, redirecionar: `${config.BASE_PATH}/shell.html` });
  });

  r.get('/link/:token', (req, res) => {
    try {
      const { usuario_id, empresa_id } = desafios.usarLink(db, req.params.token);
      iniciarSessao(db, req, res, { usuarioId: usuario_id, empresaId: empresa_id, origem: 'servidor' });
      res.redirect(`${config.BASE_PATH}/shell.html`);
    } catch (err) { paginaDeErro(res, err); }
  });

  r.get('/entrar-hub', (req, res) => {
    try {
      const dados = ticketHub.verificar(req.query.ticket, { chavePublica: chavePublicaHub() });
      ticketHub.consumir(db, dados);
      const alvo = db.transaction(() => provisionarDoHub(db, dados))();
      iniciarSessao(db, req, res, { ...alvo, origem: 'hub' });
      res.redirect(`${config.BASE_PATH}/shell.html`);
    } catch (err) { paginaDeErro(res, err); }
  });

  r.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasPublicas, provisionarDoHub, apelidoLivre, empresaDoHub };
