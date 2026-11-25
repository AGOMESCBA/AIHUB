'use strict';

// API administrativa (sessão do Talk). Mesmas formas do servidor simulado:
// docs/contratos.md §3 e backend/contratos FORMAS. Dado de empresa sempre pelo
// contexto da sessão (repositorios/base.js), nunca por id vindo do cliente.

const express = require('express');
const config = require('../config');
const { novoId, agora } = require('../ids');
const { erro, middlewareErros } = require('../erros');
const { codificarCursor, lerPaginacao } = require('../paginacao');
const { escopo, Contexto } = require('../repositorios/base');
const auditoria = require('../repositorios/auditoria');
const sessoes = require('../acesso/sessoes');
const { PAPEIS, ROTINAS, rotinasDe } = require('../acesso/papeis');
const { exigirSessao, exigirRotina, exigirPlataforma, ipDe } = require('../acesso/middleware');
const tokensAplicacao = require('../acesso/tokens-aplicacao');
const telefone = require('../seguranca/telefone');
const { cifrar, decifrar } = require('../seguranca/cifra');
const { ESCOPOS_APLICACAO } = require('../contratos');
const { gerarSegredo } = require('../lib/assinatura');

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const APELIDO = /^[a-z0-9-]{3,40}$/;
const ORIGEM = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const SENHA_MASCARA = /^•+$/;

function validar(corpo, regras) {
  const campos = {};
  for (const [campo, regra] of Object.entries(regras)) {
    const msg = regra(corpo?.[campo]);
    if (msg) campos[campo] = msg;
  }
  if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
}
const obrigatorio = (rotulo) => (v) => (String(v ?? '').trim() ? null : `Informe ${rotulo}.`);

// Lista já filtrada em memória → página com cursor de deslocamento (cadastros são pequenos).
function paginar(req, lista) {
  const { limite, cursor } = lerPaginacao(req.query);
  const inicio = cursor?.o || 0;
  const itens = lista.slice(inicio, inicio + limite);
  const fim = inicio + itens.length;
  return { itens, proximo_cursor: fim < lista.length ? codificarCursor({ o: fim }) : null, total: lista.length };
}

function ordenar(req, lista, padrao) {
  const campo = req.query.ordenar || padrao;
  const ordem = req.query.ordem || (String(campo).endsWith('_em') ? 'desc' : 'asc');
  const dir = ordem === 'asc' ? 1 : -1;
  return [...lista].sort((a, b) => String(a[campo] ?? '').localeCompare(String(b[campo] ?? ''), 'pt-BR') * dir);
}

const contem = (termo, ...valores) => !termo || valores.some(v => String(v ?? '').toLowerCase().includes(termo));

function mascararIp(ip) {
  if (!ip) return null;
  const v4 = String(ip).split('.');
  return v4.length === 4 ? `${v4[0]}.${v4[1]}.•••.•••` : '••••';
}

const empresaPublica = (e) => ({
  id: e.id, nome: e.nome, documento: e.documento, apelido: e.apelido, logo_url: e.logo_url, situacao: e.situacao,
  vinculo_hub: e.hub_empresa_id ? { empresa_hub_id: e.hub_empresa_id, nome: e.hub_empresa_nome || null } : null,
  criado_em: e.criado_em, atualizado_em: e.atualizado_em,
});

const usuarioPublico = (r) => ({
  id: r.id, nome: r.nome,
  telefone_mascarado: String(r.telefone).startsWith('hub:') ? 'Sem celular (entra pelo IAHub)' : telefone.mascarar(r.telefone),
  email: r.email, papel: r.papel, situacao: r.membro_situacao, ultimo_acesso_em: r.ultimo_acesso_em, criado_em: r.membro_criado_em,
});

// ── Teste do e-mail de envio (padrão "E-mail Geral" do IA Recruit:
// apps/IA Recruit/backend/processo-seletivo/routes.js — DNS, porta, login, envio) ──
async function testarEmailPadrao(cfg, senha) {
  const dns = require('dns').promises;
  const net = require('net');
  const { criarTransporteSmtp } = require('../acesso/envio-codigo');
  const host = cfg.tipo === 'gmail' ? 'smtp.gmail.com' : cfg.smtp_host;
  const porta = cfg.tipo === 'gmail' ? 465 : Number(cfg.smtp_porta) || 465;
  const etapas = [];
  const etapa = (nome, ok, mensagem) => { etapas.push({ etapa: nome, ok, mensagem }); return ok; };
  let ip;
  try { ip = (await dns.lookup(host)).address; etapa('dns', true, `DNS OK — ${host}`); } catch (_) {
    etapa('dns', false, `Não foi possível encontrar o servidor "${host}". Confira o endereço e o acesso do servidor à internet.`);
    return etapas;
  }
  const portaOk = await new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(8000);
    s.connect(porta, ip, () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
  if (!etapa('porta', portaOk, portaOk ? `Porta ${porta} respondeu.` : `A porta ${porta} não respondeu em ${host}. Peça a liberação da porta de saída no firewall.`)) return etapas;
  const t = criarTransporteSmtp(cfg, senha);
  try { await t.verify(); etapa('autenticacao', true, 'Usuário e senha aceitos.'); } catch (_) {
    etapa('autenticacao', false, 'O servidor recusou o usuário ou a senha. Confira os dados (no Gmail, use uma senha de app).');
    return etapas;
  }
  try {
    await t.sendMail({ from: `"${(cfg.remetente_nome || 'IA Talk').replace(/"/g, '')}" <${cfg.email}>`, to: cfg.email,
      subject: 'IA Talk — teste do e-mail de envio', text: 'O e-mail de envio do IA Talk está funcionando.' });
    etapa('envio', true, `E-mail de teste enviado para ${cfg.email}.`);
  } catch (_) {
    etapa('envio', false, 'O login funcionou, mas o envio foi recusado. Confira se o remetente tem permissão de envio.');
  }
  return etapas;
}

function criarRotasAdmin({ db, testarEmail = testarEmailPadrao, log = console }) {
  const r = express.Router();
  const auditar = (req, acao, { alvoTipo, alvoId, resumo } = {}) =>
    auditoria.registrar(db, req.contexto, { acao, alvoTipo: alvoTipo ?? acao.split('.')[0], alvoId, resumo, ip: ipDe(req) });

  // ── Sessão ───────────────────────────────────────────────────────────────
  function empresasDisponiveis(req) {
    if (req.contexto.plataforma) {
      return db.prepare("SELECT id, nome, apelido FROM empresas WHERE situacao = 'ativa' ORDER BY nome").all();
    }
    return db.prepare(`SELECT e.id, e.nome, e.apelido FROM membros m JOIN empresas e ON e.id = m.empresa_id
      WHERE m.usuario_id = ? AND m.situacao = 'ativo' AND e.situacao = 'ativa' ORDER BY e.nome`).all(req.contexto.usuarioId);
  }

  r.get('/sessao', exigirSessao, (req, res) => {
    const s = req.sessao;
    const e = db.prepare('SELECT id, nome, apelido, logo_url FROM empresas WHERE id = ?').get(s.empresa_id);
    res.json({
      usuario: { id: s.usuario_id, nome: s.usuario_nome, telefone_mascarado: String(s.telefone).startsWith('hub:') ? null : telefone.mascarar(s.telefone),
        administrador_plataforma: !!s.administrador_plataforma },
      empresa: e,
      papel: req.contexto.papel,
      rotinas: req.rotinas,
      empresas_disponiveis: empresasDisponiveis(req),
      origem: s.origem,
      expira_em: s.expira_em,
    });
  });

  r.post('/sessao/empresa', exigirSessao, (req, res) => {
    const alvo = empresasDisponiveis(req).find(e => e.id === req.body?.empresa_id);
    if (!alvo) throw erro('sem_permissao', 'Você não tem acesso a esta empresa.');
    sessoes.trocarEmpresa(db, req.sessao.id, alvo.id);
    auditoria.registrar(db, new Contexto({ empresaId: alvo.id, usuarioId: req.contexto.usuarioId }),
      { acao: 'sessao.empresa_trocada', alvoTipo: 'sessao', resumo: `Passou a usar ${alvo.nome}`, ip: ipDe(req) });
    const e = db.prepare('SELECT id, nome, apelido, logo_url FROM empresas WHERE id = ?').get(alvo.id);
    res.json({ ok: true, empresa: e });
  });

  r.post('/sair', (req, res) => {
    let apelido = '';
    if (req.sessao) {
      sessoes.revogar(db, req.sessao.id);
      apelido = db.prepare('SELECT apelido FROM empresas WHERE id = ?').get(req.sessao.empresa_id)?.apelido || '';
    }
    res.clearCookie(sessoes.COOKIE, { path: config.BASE_PATH });
    res.json({ ok: true, redirecionar: `${config.BASE_PATH}/${apelido}` });
  });

  r.get('/papeis', exigirSessao, (_req, res) => res.json({ itens: PAPEIS, proximo_cursor: null }));

  // ── Empresas (administração da plataforma) ───────────────────────────────
  r.get('/empresas', exigirPlataforma, (req, res) => {
    const termo = String(req.query.busca || '').trim().toLowerCase();
    let lista = db.prepare('SELECT * FROM empresas').all()
      .filter(e => contem(termo, e.nome, e.apelido, e.documento))
      .filter(e => !req.query.situacao || e.situacao === req.query.situacao)
      .filter(e => !req.query.vinculo_hub || (req.query.vinculo_hub === 'com' ? !!e.hub_empresa_id : !e.hub_empresa_id))
      .map(empresaPublica);
    lista = ordenar(req, lista, 'nome');
    res.json(paginar(req, lista));
  });

  const acharEmpresa = (id) => {
    const e = db.prepare('SELECT * FROM empresas WHERE id = ?').get(String(id));
    if (!e) throw erro('nao_encontrado', 'Empresa não encontrada.');
    return e;
  };
  r.get('/empresas/:id', exigirPlataforma, (req, res) => res.json(empresaPublica(acharEmpresa(req.params.id))));

  function validarEmpresa(corpo, idAtual) {
    validar(corpo, {
      nome: obrigatorio('o nome'),
      apelido: (v) => (APELIDO.test(String(v || '')) ? null : 'Use só letras minúsculas, números e hífen (3 a 40).'),
      situacao: (v) => (v === undefined || ['ativa', 'inativa'].includes(v) ? null : 'Situação inválida.'),
      logo_url: (v) => (!v || /^https:\/\//.test(v) ? null : 'Use um endereço https.'),
    });
    const dono = db.prepare('SELECT id FROM empresas WHERE apelido = ?').get(corpo.apelido);
    if (dono && dono.id !== idAtual) throw erro('conflito', 'Já existe uma empresa com este apelido.', { campos: { apelido: 'Apelido em uso.' } });
  }

  r.post('/empresas', exigirPlataforma, (req, res) => {
    const c = { ...req.body, apelido: String(req.body?.apelido || '').trim().toLowerCase() };
    validarEmpresa(c);
    const id = novoId('empresa');
    const t = agora();
    db.prepare(`INSERT INTO empresas (id, nome, documento, apelido, logo_url, situacao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, c.nome.trim(), c.documento || null, c.apelido, c.logo_url || null, c.situacao || 'ativa', t, t);
    auditar(req, 'empresa.criada', { alvoId: id, resumo: `Cadastrou a empresa ${c.nome.trim()}` });
    res.status(201).json(empresaPublica(acharEmpresa(id)));
  });

  r.put('/empresas/:id', exigirPlataforma, (req, res) => {
    const atual = acharEmpresa(req.params.id);
    const c = { ...atual, ...req.body };
    c.apelido = String(c.apelido || '').trim().toLowerCase();
    validarEmpresa(c, atual.id);
    db.prepare(`UPDATE empresas SET nome = ?, documento = ?, apelido = ?, logo_url = ?, situacao = ?, atualizado_em = ? WHERE id = ?`)
      .run(c.nome.trim(), c.documento || null, c.apelido, c.logo_url || null, c.situacao, agora(), atual.id);
    auditar(req, 'empresa.alterada', { alvoId: atual.id, resumo: `Alterou a empresa ${c.nome.trim()}` });
    res.json(empresaPublica(acharEmpresa(atual.id)));
  });

  // ── Usuários da empresa da sessão ────────────────────────────────────────
  const SQL_USUARIOS = `SELECT u.*, m.id AS membro_id, m.papel, m.situacao AS membro_situacao, m.criado_em AS membro_criado_em
    FROM membros m JOIN usuarios u ON u.id = m.usuario_id WHERE m.empresa_id = @empresa_id`;

  r.get('/usuarios', exigirRotina(ROTINAS.usuarios), (req, res) => {
    const termo = String(req.query.busca || '').trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    let lista = escopo(db, req.contexto).todos(SQL_USUARIOS)
      .filter(u => contem(termo, u.nome, u.email) || (digitos.length >= 4 && u.telefone.includes(digitos)))
      .filter(u => !req.query.papel || u.papel === req.query.papel)
      .filter(u => !req.query.situacao || u.membro_situacao === req.query.situacao)
      .map(usuarioPublico);
    lista = ordenar(req, lista, 'nome');
    res.json(paginar(req, lista));
  });

  const acharUsuario = (req, id) => {
    const u = escopo(db, req.contexto).um(`${SQL_USUARIOS} AND u.id = @id`, { id: String(id) });
    if (!u) throw erro('nao_encontrado', 'Usuário não encontrado nesta empresa.');
    return u;
  };
  r.get('/usuarios/:id', exigirRotina(ROTINAS.usuarios), (req, res) => res.json(usuarioPublico(acharUsuario(req, req.params.id))));

  const regrasUsuario = (parcial) => ({
    nome: parcial ? (v) => (v === undefined || String(v).trim() ? null : 'Informe o nome.') : obrigatorio('o nome'),
    telefone: (v) => (parcial && v === undefined) || telefone.valido(v) ? null : 'Informe o celular com DDI e DDD (ex.: 55 65 99999-0000).',
    papel: (v) => ((parcial && v === undefined) || PAPEIS.some(p => p.codigo === v) ? null : 'Escolha um papel.'),
    email: (v) => (!v || EMAIL.test(v) ? null : 'E-mail inválido.'),
    situacao: (v) => (v === undefined || ['ativo', 'inativo'].includes(v) ? null : 'Situação inválida.'),
  });

  r.post('/usuarios', exigirRotina(ROTINAS.usuarios), (req, res) => {
    validar(req.body, regrasUsuario(false));
    const tel = telefone.normalizar(req.body.telefone);
    const empresaId = req.contexto.exigirEmpresa();
    const t = agora();
    const marcas = telefone.variantesBrasil(tel);
    let usuario = db.prepare(`SELECT * FROM usuarios WHERE telefone IN (${marcas.map(() => '?').join(',')})`).get(...marcas);
    if (usuario && db.prepare('SELECT 1 FROM membros WHERE empresa_id = ? AND usuario_id = ?').get(empresaId, usuario.id)) {
      throw erro('conflito', 'Este celular já está cadastrado nesta empresa.', { campos: { telefone: 'Celular já cadastrado.' } });
    }
    db.transaction(() => {
      if (!usuario) {
        const id = novoId('usuario');
        db.prepare('INSERT INTO usuarios (id, nome, telefone, email, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, req.body.nome.trim(), tel, req.body.email || null, t, t);
        usuario = { id };
      }
      db.prepare('INSERT INTO membros (id, empresa_id, usuario_id, papel, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)')
        .run(novoId('membro'), empresaId, usuario.id, req.body.papel, t, t);
    })();
    auditar(req, 'usuario.criado', { alvoId: usuario.id, resumo: `Cadastrou ${req.body.nome.trim()} como ${req.body.papel}` });
    res.status(201).json(usuarioPublico(acharUsuario(req, usuario.id)));
  });

  r.put('/usuarios/:id', exigirRotina(ROTINAS.usuarios), (req, res) => {
    const atual = acharUsuario(req, req.params.id);
    validar(req.body, regrasUsuario(true));
    const proprio = atual.id === req.contexto.usuarioId;
    const papel = req.body.papel ?? atual.papel;
    const situacao = req.body.situacao ?? atual.membro_situacao;
    if (proprio && (situacao !== 'ativo' || (atual.papel === 'admin_empresa' && papel !== 'admin_empresa'))) {
      throw erro('conflito', 'Você não pode tirar o próprio acesso de administrador. Peça a outro administrador.');
    }
    let tel = atual.telefone;
    if (req.body.telefone !== undefined) {
      tel = telefone.normalizar(req.body.telefone);
      const outro = db.prepare('SELECT id FROM usuarios WHERE telefone = ? AND id <> ?').get(tel, atual.id);
      if (outro) throw erro('conflito', 'Este celular já pertence a outro usuário.', { campos: { telefone: 'Celular em uso.' } });
    }
    const t = agora();
    db.transaction(() => {
      db.prepare('UPDATE usuarios SET nome = ?, email = ?, telefone = ?, atualizado_em = ? WHERE id = ?')
        .run(String(req.body.nome ?? atual.nome).trim(), req.body.email === undefined ? atual.email : (req.body.email || null), tel, t, atual.id);
      db.prepare('UPDATE membros SET papel = ?, situacao = ?, atualizado_em = ? WHERE id = ?').run(papel, situacao, t, atual.membro_id);
    })();
    // Perdeu acesso ou mudou de papel: as sessões abertas nesta empresa caem na hora.
    if (papel !== atual.papel || situacao !== atual.membro_situacao) sessoes.revogarDoUsuario(db, atual.id, { empresaId: req.contexto.empresaId });
    auditar(req, 'usuario.alterado', { alvoId: atual.id, resumo: `Alterou ${String(req.body.nome ?? atual.nome).trim()}` });
    res.json(usuarioPublico(acharUsuario(req, atual.id)));
  });

  // ── Sites autorizados (mesmo conceito do IAHub, por empresa) ─────────────
  const sitesDaEmpresa = (req) => {
    const s = escopo(db, req.contexto).um('SELECT origens, versao, atualizado_em FROM sites_autorizados WHERE empresa_id = @empresa_id');
    return s ? { origens: JSON.parse(s.origens), versao: s.versao, atualizado_em: s.atualizado_em } : { origens: [], versao: 0, atualizado_em: null };
  };
  r.get('/sites-autorizados', exigirRotina(ROTINAS.configuracoes), (req, res) => res.json(sitesDaEmpresa(req)));
  r.put('/sites-autorizados', exigirRotina(ROTINAS.configuracoes), (req, res) => {
    const atual = sitesDaEmpresa(req);
    if (Number(req.body?.versao) !== atual.versao) throw erro('conflito', 'A lista foi alterada em outra sessão. Recarregue antes de salvar.');
    const origens = Array.isArray(req.body?.origens) ? [...new Set(req.body.origens.map(o => String(o).trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean))] : null;
    const invalidas = (origens || []).filter(o => !ORIGEM.test(o));
    if (!origens || invalidas.length || origens.length > 20) {
      throw erro('requisicao_invalida', 'Use só endereços https, sem caminho (ex.: https://sistema.exemplo.com.br), até 20.', { campos: { origens: invalidas.join(', ') || 'Lista inválida.' } });
    }
    escopo(db, req.contexto).executar(`INSERT INTO sites_autorizados (empresa_id, origens, versao, atualizado_em, atualizado_por)
      VALUES (@empresa_id, @origens, @versao, @em, @por)
      ON CONFLICT(empresa_id) DO UPDATE SET origens = excluded.origens, versao = excluded.versao, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
    { origens: JSON.stringify(origens), versao: atual.versao + 1, em: agora(), por: req.contexto.usuarioId });
    auditar(req, 'sites_autorizados.alterado', { resumo: `Lista de sites autorizados com ${origens.length} endereço(s)` });
    res.json(sitesDaEmpresa(req));
  });

  // ── E-mail de envio (reserva do código de login) ─────────────────────────
  const emailDaEmpresa = (req) => {
    const e = escopo(db, req.contexto).um('SELECT * FROM email_envio WHERE empresa_id = @empresa_id');
    if (!e) return { tipo: 'smtp', email: '', senha_configurada: false, smtp_host: '', smtp_porta: 465, smtp_seguro: true, remetente_nome: null, situacao: 'nao_testado', atualizado_em: null };
    return { tipo: e.tipo, email: e.email, senha_configurada: !!e.senha_cifrada, smtp_host: e.smtp_host || '', smtp_porta: e.smtp_porta || 465,
      smtp_seguro: !!e.smtp_seguro, remetente_nome: e.remetente_nome, situacao: e.situacao, atualizado_em: e.atualizado_em };
  };
  r.get('/email-envio', exigirRotina(ROTINAS.configuracoes), (req, res) => res.json(emailDaEmpresa(req)));
  r.put('/email-envio', exigirRotina(ROTINAS.configuracoes), (req, res) => {
    const c = req.body || {};
    validar(c, {
      tipo: (v) => (['gmail', 'smtp'].includes(v) ? null : 'Escolha Gmail ou SMTP.'),
      email: (v) => (EMAIL.test(String(v || '')) ? null : 'E-mail inválido.'),
      smtp_host: (v) => (c.tipo !== 'smtp' || String(v || '').trim() ? null : 'Informe o servidor SMTP.'),
      smtp_porta: (v) => (c.tipo !== 'smtp' || (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536) ? null : 'Porta inválida.'),
    });
    const anterior = escopo(db, req.contexto).um('SELECT senha_cifrada FROM email_envio WHERE empresa_id = @empresa_id');
    const novaSenha = c.senha && !SENHA_MASCARA.test(c.senha) ? cifrar(c.senha) : (anterior?.senha_cifrada || null);
    escopo(db, req.contexto).executar(`INSERT INTO email_envio (empresa_id, tipo, email, senha_cifrada, smtp_host, smtp_porta, smtp_seguro, remetente_nome, situacao, atualizado_em)
      VALUES (@empresa_id, @tipo, @email, @senha, @host, @porta, @seguro, @remetente, 'nao_testado', @em)
      ON CONFLICT(empresa_id) DO UPDATE SET tipo = excluded.tipo, email = excluded.email, senha_cifrada = excluded.senha_cifrada, smtp_host = excluded.smtp_host,
        smtp_porta = excluded.smtp_porta, smtp_seguro = excluded.smtp_seguro, remetente_nome = excluded.remetente_nome, situacao = 'nao_testado', atualizado_em = excluded.atualizado_em`,
    { tipo: c.tipo, email: c.email.trim(), senha: novaSenha, host: c.tipo === 'smtp' ? String(c.smtp_host).trim() : null,
      porta: c.tipo === 'smtp' ? Number(c.smtp_porta) : 465, seguro: c.smtp_seguro === false ? 0 : 1, remetente: c.remetente_nome || null, em: agora() });
    auditar(req, 'email_envio.alterado', { resumo: `E-mail de envio: ${c.email.trim()}` });
    res.json(emailDaEmpresa(req));
  });
  r.post('/email-envio/testar', exigirRotina(ROTINAS.configuracoes), async (req, res, next) => {
    try {
      const cfg = escopo(db, req.contexto).um('SELECT * FROM email_envio WHERE empresa_id = @empresa_id');
      if (!cfg?.email || !cfg.senha_cifrada) throw erro('requisicao_invalida', 'Salve o e-mail e a senha antes de testar.');
      const etapas = await testarEmail(cfg, decifrar(cfg.senha_cifrada));
      const ok = etapas.length > 0 && etapas.every(e => e.ok);
      escopo(db, req.contexto).executar('UPDATE email_envio SET situacao = @s WHERE empresa_id = @empresa_id', { s: ok ? 'testado' : 'falhou' });
      auditar(req, 'email_envio.testado', { resumo: ok ? 'Teste do e-mail de envio funcionou' : 'Teste do e-mail de envio falhou' });
      res.json({ ok, etapas });
    } catch (err) { next(err); }
  });

  // ── Aplicações e tokens ──────────────────────────────────────────────────
  function aplicacaoPublica(a) {
    const tokens = db.prepare('SELECT id, prefixo, criado_em, ultimo_uso_em, revogado_em FROM aplicacao_tokens WHERE aplicacao_id = ? ORDER BY criado_em DESC').all(a.id);
    const canais = db.prepare('SELECT canal_id FROM aplicacao_canais WHERE aplicacao_id = ? ORDER BY canal_id').all(a.id).map(c => c.canal_id);
    return { id: a.id, nome: a.nome, descricao: a.descricao, situacao: a.situacao, escopos: JSON.parse(a.escopos || '[]'), canais_autorizados: canais,
      webhook: { url: a.webhook_url, ativo: !!a.webhook_ativo, segredo_configurado: !!a.webhook_segredo_cifrado }, tokens, criado_em: a.criado_em };
  }
  const acharAplicacao = (req, id) => {
    const a = escopo(db, req.contexto).um('SELECT * FROM aplicacoes WHERE empresa_id = @empresa_id AND id = @id', { id: String(id) });
    if (!a) throw erro('nao_encontrado', 'Aplicação não encontrada.');
    return a;
  };
  const urlWebhookValida = (v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname));
    } catch (_) { return false; }
  };
  const regrasAplicacao = (parcial) => ({
    nome: parcial ? (v) => (v === undefined || String(v).trim() ? null : 'Informe o nome.') : obrigatorio('o nome'),
    escopos: (v) => ((parcial && v === undefined) || (Array.isArray(v) && v.length && v.every(e => ESCOPOS_APLICACAO.includes(e))) ? null : 'Escolha pelo menos um escopo.'),
    canais_autorizados: (v) => (v === undefined || (Array.isArray(v) && v.every(c => /^cn_[A-Za-z0-9_-]+$/.test(c))) ? null : 'Canal inválido.'),
    situacao: (v) => (v === undefined || ['ativa', 'inativa'].includes(v) ? null : 'Situação inválida.'),
    webhook: (v) => (v === undefined || urlWebhookValida(v?.url) ? null : 'Use https (ou http só para 127.0.0.1).'),
  });
  const gravarCanais = (aplicacaoId, canais) => {
    db.prepare('DELETE FROM aplicacao_canais WHERE aplicacao_id = ?').run(aplicacaoId);
    const ins = db.prepare('INSERT INTO aplicacao_canais (aplicacao_id, canal_id) VALUES (?, ?)');
    for (const c of new Set(canais)) ins.run(aplicacaoId, c);
  };

  r.get('/aplicacoes', exigirRotina(ROTINAS.aplicacoes), (req, res) => {
    const termo = String(req.query.busca || '').trim().toLowerCase();
    let lista = escopo(db, req.contexto).todos('SELECT * FROM aplicacoes WHERE empresa_id = @empresa_id')
      .filter(a => contem(termo, a.nome, a.descricao))
      .filter(a => !req.query.situacao || a.situacao === req.query.situacao)
      .map(aplicacaoPublica);
    lista = ordenar(req, lista, 'nome');
    res.json(paginar(req, lista));
  });
  r.get('/aplicacoes/:id', exigirRotina(ROTINAS.aplicacoes), (req, res) => res.json(aplicacaoPublica(acharAplicacao(req, req.params.id))));

  r.post('/aplicacoes', exigirRotina(ROTINAS.aplicacoes), (req, res) => {
    validar(req.body, regrasAplicacao(false));
    const id = novoId('aplicacao');
    const t = agora();
    db.transaction(() => {
      escopo(db, req.contexto).executar(`INSERT INTO aplicacoes (id, empresa_id, nome, descricao, situacao, escopos, webhook_url, webhook_ativo, criado_em, atualizado_em)
        VALUES (@id, @empresa_id, @nome, @descricao, 'ativa', @escopos, @url, @ativo, @t, @t)`,
      { id, nome: req.body.nome.trim(), descricao: req.body.descricao || null, escopos: JSON.stringify(req.body.escopos),
        url: req.body.webhook?.url || null, ativo: req.body.webhook?.ativo ? 1 : 0, t });
      gravarCanais(id, req.body.canais_autorizados || []);
    })();
    auditar(req, 'aplicacao.criada', { alvoId: id, resumo: `Cadastrou a aplicação ${req.body.nome.trim()}` });
    res.status(201).json(aplicacaoPublica(acharAplicacao(req, id)));
  });

  r.put('/aplicacoes/:id', exigirRotina(ROTINAS.aplicacoes), (req, res) => {
    const a = acharAplicacao(req, req.params.id);
    validar(req.body, regrasAplicacao(true));
    const b = req.body;
    db.transaction(() => {
      escopo(db, req.contexto).executar(`UPDATE aplicacoes SET nome = @nome, descricao = @descricao, situacao = @situacao, escopos = @escopos,
        webhook_url = @url, webhook_ativo = @ativo, atualizado_em = @t WHERE empresa_id = @empresa_id AND id = @id`, {
        id: a.id, nome: String(b.nome ?? a.nome).trim(), descricao: b.descricao === undefined ? a.descricao : (b.descricao || null),
        situacao: b.situacao ?? a.situacao, escopos: b.escopos ? JSON.stringify(b.escopos) : a.escopos,
        url: b.webhook ? (b.webhook.url ?? a.webhook_url) : a.webhook_url, ativo: b.webhook?.ativo === undefined ? a.webhook_ativo : (b.webhook.ativo ? 1 : 0), t: agora(),
      });
      if (b.canais_autorizados) gravarCanais(a.id, b.canais_autorizados);
    })();
    auditar(req, 'aplicacao.alterada', { alvoId: a.id, resumo: `Alterou a aplicação ${String(b.nome ?? a.nome).trim()}` });
    res.json(aplicacaoPublica(acharAplicacao(req, a.id)));
  });

  r.post('/aplicacoes/:id/tokens', exigirRotina(ROTINAS.aplicacoes), (req, res) => {
    const a = acharAplicacao(req, req.params.id);
    const { token, registro } = tokensAplicacao.gerar(db, { aplicacaoId: a.id, empresaId: a.empresa_id });
    auditar(req, 'aplicacao.token_gerado', { alvoId: a.id, resumo: `Gerou o token ${registro.prefixo}… para ${a.nome}` });
    // Token completo só nesta resposta. Depois, só o prefixo.
    res.status(201).json({ token, registro, aviso: 'Copie o token agora. Ele não será mostrado de novo.' });
  });

  r.delete('/aplicacoes/:id/tokens/:tokenId', exigirRotina(ROTINAS.aplicacoes), (req, res) => {
    const a = acharAplicacao(req, req.params.id);
    const t = db.prepare('SELECT * FROM aplicacao_tokens WHERE id = ? AND aplicacao_id = ?').get(String(req.params.tokenId), a.id);
    if (!t) throw erro('nao_encontrado', 'Token não encontrado.');
    if (!t.revogado_em) db.prepare('UPDATE aplicacao_tokens SET revogado_em = ? WHERE id = ?').run(agora(), t.id);
    auditar(req, 'aplicacao.token_revogado', { alvoId: a.id, resumo: `Revogou o token ${t.prefixo}… de ${a.nome}` });
    res.json(db.prepare('SELECT id, prefixo, criado_em, ultimo_uso_em, revogado_em FROM aplicacao_tokens WHERE id = ?').get(t.id));
  });

  r.post('/aplicacoes/:id/webhook/segredo', exigirRotina(ROTINAS.aplicacoes), (req, res) => {
    const a = acharAplicacao(req, req.params.id);
    const segredo = gerarSegredo();
    db.prepare('UPDATE aplicacoes SET webhook_segredo_cifrado = ?, atualizado_em = ? WHERE id = ?').run(cifrar(segredo), agora(), a.id);
    auditar(req, 'aplicacao.segredo_webhook_gerado', { alvoId: a.id, resumo: `Gerou novo segredo de webhook para ${a.nome}` });
    res.status(201).json({ segredo, aviso: 'Copie o segredo agora. Ele não será mostrado de novo.' });
  });

  // ── Auditoria ────────────────────────────────────────────────────────────
  r.get('/auditoria', exigirRotina(ROTINAS.auditoria), (req, res) => {
    const termo = String(req.query.busca || '').trim().toLowerCase();
    let lista = escopo(db, req.contexto).todos(`SELECT a.*, u.nome AS usuario_nome, ap.nome AS aplicacao_nome
        FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN aplicacoes ap ON ap.id = a.aplicacao_id
       WHERE a.empresa_id = @empresa_id`)
      .filter(a => contem(termo, a.resumo, a.acao, a.usuario_nome))
      .filter(a => !req.query.acao || a.acao.startsWith(req.query.acao))
      .filter(a => !req.query.usuario_id || a.usuario_id === req.query.usuario_id)
      .filter(a => !req.query.de || a.em.slice(0, 10) >= req.query.de)
      .filter(a => !req.query.ate || a.em.slice(0, 10) <= req.query.ate)
      .map(a => ({ id: a.id, em: a.em, usuario: a.usuario_id ? { id: a.usuario_id, nome: a.usuario_nome } : null,
        aplicacao: a.aplicacao_id ? { id: a.aplicacao_id, nome: a.aplicacao_nome } : null, acao: a.acao, alvo_tipo: a.alvo_tipo,
        alvo_id: a.alvo_id, resumo: a.resumo, ip_mascarado: mascararIp(a.ip) }));
    lista = ordenar(req, lista, 'em');
    res.json(paginar(req, lista));
  });

  r.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  r.use(middlewareErros(log));
  return r;
}

module.exports = { criarRotasAdmin, testarEmailPadrao, rotinasDe };
