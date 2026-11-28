'use strict';

// Servidor simulado do IA Talk: responde TODOS os contratos de
// docs/contratos.md com dados de exemplo, para as telas (G1–G3), o guia do
// integrador (G5) e o protótipo da central (A0) andarem antes do backend real.
// Nunca toca em WhatsApp, banco real ou dado de cliente.
//
//   node "apps/IA Talk/backend/simulado/servidor-simulado.js"
//   → http://127.0.0.1:3051/app/ia-talk/   (IA_TALK_SIMULADO_PORT muda a porta)
//
// Cenários (cabeçalho X-Talk-Simular ou ?simular=, vários separados por vírgula):
//   vazio | lento | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500
// No navegador: sessionStorage.setItem('talk_simular', 'vazio,lento') faz o
// talk-api.js mandar o cabeçalho em toda chamada (ver frontend/js/talk-api.js).

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const config = require('../config');
const { erro, corpoErro, middlewareErros } = require('../erros');
const { codificarCursor, decodificarCursor, lerPaginacao } = require('../paginacao');
const { EVENTOS_SOCKET, ESTADOS_COM_ACAO_MANUAL } = require('../contratos');
const regras = require('../canais/regras');
const { aplicarSegurancaHttp, montarEstaticos } = require('../servidor');
const { criarDados, mascararTelefone, BASE_SIMULADA } = require('./dados');
const { criarAtendimentoSimulado } = require('./atendimento');

const CENARIOS_ERRO = {
  400: () => erro('requisicao_invalida', 'Confira os campos destacados.', { campos: { nome: 'Informe o nome.', apelido: 'Use só letras minúsculas, números e hífen (3 a 40).' } }),
  401: () => erro('nao_autenticado', 'Sua sessão terminou. Entre de novo.'),
  403: () => erro('sem_permissao', 'Você não tem permissão para esta rotina. Fale com o administrador da empresa.'),
  404: () => erro('nao_encontrado', 'O registro não foi encontrado. Ele pode ter sido removido.'),
  409: () => erro('conflito', 'Este registro foi alterado em outra sessão. Recarregue antes de salvar.'),
  422: () => erro('recurso_nao_suportado', 'Este canal não envia vídeo.'),
  429: () => erro('limite_excedido', 'Muitas requisições. Tente de novo em 30 segundos.', { detalhe: { tentar_novamente_em_seg: 30 } }),
  500: () => erro('erro_interno', 'Não foi possível concluir a operação. Tente de novo em instantes.'),
};

function lerCenarios(req) {
  const bruto = String(req.get('x-talk-simular') || req.query.simular || '');
  return new Set(bruto.split(',').map(s => s.trim()).filter(Boolean));
}

function middlewareCenarios(req, res, next) {
  const cenarios = lerCenarios(req);
  req.cenarios = cenarios;
  const codigoErro = [...cenarios].find(c => CENARIOS_ERRO[c]);
  const seguir = () => {
    if (codigoErro) {
      const e = CENARIOS_ERRO[codigoErro]();
      if (codigoErro === '429') res.set('Retry-After', '30');
      return res.status(e.status).json(corpoErro(e));
    }
    next();
  };
  if (cenarios.has('lento')) setTimeout(seguir, 1500); else seguir();
}

// Filtro, ordenação e paginação iguais para todas as listas do simulado.
//   ?busca=texto  ?<campo>=valor  ?ordenar=campo&ordem=asc|desc  ?limite&cursor
function listar(req, itens, { busca = [], filtros = {}, ordenarPadrao = null, mapa = (x) => x } = {}) {
  if (req.cenarios.has('vazio')) return { itens: [], proximo_cursor: null, total: 0 };
  const { limite, cursor } = lerPaginacao(req.query);
  let lista = [...itens];
  const termo = String(req.query.busca || '').trim().toLowerCase();
  if (termo) lista = lista.filter(i => busca.some(c => String(c(i) ?? '').toLowerCase().includes(termo)));
  for (const [param, fn] of Object.entries(filtros)) {
    const valor = req.query[param];
    if (valor !== undefined && valor !== '') lista = lista.filter(i => fn(i, String(valor)));
  }
  const campo = req.query.ordenar || ordenarPadrao;
  if (campo) {
    // Sem 'ordem': datas (campo *_em) do mais novo ao mais antigo; texto de A a Z.
    const ordem = req.query.ordem || (String(campo).endsWith('_em') ? 'desc' : 'asc');
    const dir = ordem === 'asc' ? 1 : -1;
    lista.sort((a, b) => (a[campo] > b[campo] ? 1 : a[campo] < b[campo] ? -1 : 0) * dir);
  }
  const inicio = cursor?.o || 0;
  const pagina = lista.slice(inicio, inicio + limite);
  const fim = inicio + pagina.length;
  return { itens: pagina.map(mapa), proximo_cursor: fim < lista.length ? codificarCursor({ o: fim }) : null, total: lista.length };
}

const naData = (campo, comparar) => (i, v) => comparar(String(i[campo]).slice(0, 10), v.slice(0, 10));

function exigirCampos(corpo, regras) {
  const campos = {};
  for (const [campo, regra] of Object.entries(regras)) {
    const valor = corpo?.[campo];
    const msg = regra(valor);
    if (msg) campos[campo] = msg;
  }
  if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
}

const obrigatorio = (rotulo) => (v) => (String(v ?? '').trim() ? null : `Informe ${rotulo}.`);
const APELIDO = /^[a-z0-9-]{3,40}$/;

function criarServidorSimulado({ intervaloLogMs = 2000, intervaloQrMs = 20000, intervaloConversaMs = 25000, log = console } = {}) {
  const dados = criarDados();
  const sessao = { empresaId: 'emp_j2a', usuarioId: 'usr_ana', plataforma: true };
  const idempotencia = new Map(); // Idempotency-Key -> { corpo, resposta }
  const desafios = new Map();     // desafio_id -> { apelido, telefone, tentativas }
  let seq = 0;
  const novo = (prefixo) => `${prefixo}_sim${String(++seq).padStart(4, '0')}`;
  const agora = () => new Date().toISOString();

  const empresaAtual = () => dados.empresas.find(e => e.id === sessao.empresaId);
  const acharOu404 = (lista, id, nome) => {
    const item = lista.find(i => i.id === id);
    if (!item) throw erro('nao_encontrado', `${nome} não encontrado(a).`);
    return item;
  };
  const usuarioPublico = (u) => {
    const { telefone, ...resto } = u;
    return { ...resto, telefone_mascarado: mascararTelefone(telefone) };
  };
  const canalPublico = (c) => {
    const { numero, numeros_teste, ...resto } = c;
    return { ...resto, numero_mascarado: mascararTelefone(numero), numeros_teste_mascarados: (numeros_teste || []).map(mascararTelefone),
      envio_habilitado: c.envio_modo !== 'desligado', modo_teste: c.recebimento_modo === 'teste' || c.envio_modo === 'teste' };
  };
  const auditar = (acao, resumo) => dados.auditoria.unshift({
    id: novo('aud'), em: agora(), usuario: { id: 'usr_ana', nome: 'Ana Ribeiro' }, aplicacao: null,
    acao, alvo_tipo: acao.split('.')[0], alvo_id: null, resumo, ip_mascarado: '127.0.•••.•••',
  });

  // C8 — Atendimento (setores, conversas, contatos, respostas rápidas): backend/simulado/atendimento.js.
  const atendimento = criarAtendimentoSimulado({ dados, sessao, novo, agora, auditar, listar, exigirCampos, emitir, intervaloConversaMs });

  const app = express();
  aplicarSegurancaHttp(app);
  app.use(express.json({ limit: '20mb' }));

  // ── API administrativa (sessão) ─────────────────────────────────────────────
  const admin = express.Router();
  admin.use(middlewareCenarios);

  admin.get('/sessao', (req, res) => {
    // ?simular=atendente: sessão da atendente Carla (papel atendente, sem a administração), como na Central.
    const atendente = req.cenarios.has('atendente');
    const u = dados.usuarios.find(x => x.id === (atendente ? 'usr_carla' : sessao.usuarioId));
    const papel = dados.papeis.find(p => p.codigo === u.papel);
    const empresa = empresaAtual();
    res.json({
      usuario: { id: u.id, nome: u.nome, telefone_mascarado: mascararTelefone(u.telefone), administrador_plataforma: !atendente && sessao.plataforma },
      empresa: { id: empresa.id, nome: empresa.nome, apelido: empresa.apelido, logo_url: empresa.logo_url },
      papel: papel.codigo,
      rotinas: [...papel.rotinas, ...(!atendente && sessao.plataforma ? ['talk-empresas'] : [])],
      empresas_disponiveis: dados.empresas.filter(e => e.situacao === 'ativa').map(e => ({ id: e.id, nome: e.nome, apelido: e.apelido })),
      origem: 'telefone',
      expira_em: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    });
  });

  admin.post('/sessao/empresa', (req, res) => {
    const alvo = dados.empresas.find(e => e.id === req.body?.empresa_id && e.situacao === 'ativa');
    if (!alvo) throw erro('sem_permissao', 'Você não tem acesso a esta empresa.');
    sessao.empresaId = alvo.id;
    res.json({ ok: true, empresa: { id: alvo.id, nome: alvo.nome, apelido: alvo.apelido, logo_url: alvo.logo_url } });
  });

  admin.post('/sair', (_req, res) => res.json({ ok: true, redirecionar: `${config.BASE_PATH}/${empresaAtual().apelido}` }));

  admin.get('/papeis', (_req, res) => res.json({ itens: dados.papeis, proximo_cursor: null }));

  // Empresas (só administração da plataforma)
  admin.get('/empresas', (req, res) => res.json(listar(req, dados.empresas, {
    busca: [i => i.nome, i => i.apelido, i => i.documento],
    filtros: { situacao: (i, v) => i.situacao === v, vinculo_hub: (i, v) => (v === 'com' ? !!i.vinculo_hub : !i.vinculo_hub) },
    ordenarPadrao: 'nome',
  })));
  admin.get('/empresas/:id', (req, res) => res.json(acharOu404(dados.empresas, req.params.id, 'Empresa')));
  const validarEmpresa = (corpo, idAtual) => {
    exigirCampos(corpo, {
      nome: obrigatorio('o nome'),
      apelido: (v) => (APELIDO.test(String(v || '')) ? null : 'Use só letras minúsculas, números e hífen (3 a 40).'),
      situacao: (v) => (v === undefined || ['ativa', 'inativa'].includes(v) ? null : 'Situação inválida.'),
    });
    if (dados.empresas.some(e => e.apelido === corpo.apelido && e.id !== idAtual)) {
      throw erro('conflito', 'Já existe uma empresa com este apelido.', { campos: { apelido: 'Apelido em uso.' } });
    }
  };
  admin.post('/empresas', (req, res) => {
    validarEmpresa(req.body);
    const e = { id: novo('emp'), nome: req.body.nome.trim(), documento: req.body.documento || null, apelido: req.body.apelido, logo_url: req.body.logo_url || null,
      situacao: req.body.situacao || 'ativa', vinculo_hub: null, criado_em: agora(), atualizado_em: agora() };
    dados.empresas.push(e);
    auditar('empresa.criada', `Cadastrou a empresa ${e.nome}`);
    res.status(201).json(e);
  });
  admin.put('/empresas/:id', (req, res) => {
    const e = acharOu404(dados.empresas, req.params.id, 'Empresa');
    const corpo = { ...e, ...req.body };
    validarEmpresa(corpo, e.id);
    Object.assign(e, { nome: corpo.nome.trim(), documento: corpo.documento || null, apelido: corpo.apelido, logo_url: corpo.logo_url || null, situacao: corpo.situacao, atualizado_em: agora() });
    auditar('empresa.alterada', `Alterou a empresa ${e.nome}`);
    res.json(e);
  });

  // Usuários da empresa da sessão
  admin.get('/usuarios', (req, res) => res.json(listar(req, dados.usuarios, {
    busca: [i => i.nome, i => i.email, i => i.telefone],
    filtros: { papel: (i, v) => i.papel === v, situacao: (i, v) => i.situacao === v },
    ordenarPadrao: 'nome', mapa: usuarioPublico,
  })));
  admin.get('/usuarios/:id', (req, res) => res.json(usuarioPublico(acharOu404(dados.usuarios, req.params.id, 'Usuário'))));
  const validarUsuario = (corpo, idAtual) => {
    exigirCampos(corpo, {
      nome: obrigatorio('o nome'),
      telefone: (v) => (idAtual && v === undefined ? null : /^\d{12,13}$/.test(String(v || '').replace(/\D/g, '')) ? null : 'Informe o celular com DDI e DDD (ex.: 5565999990000).'),
      papel: (v) => (dados.papeis.some(p => p.codigo === v) ? null : 'Escolha um papel.'),
      email: (v) => (!v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'E-mail inválido.'),
    });
  };
  admin.post('/usuarios', (req, res) => {
    validarUsuario(req.body);
    const telefone = String(req.body.telefone).replace(/\D/g, '');
    if (dados.usuarios.some(u => u.telefone === telefone)) throw erro('conflito', 'Este celular já está cadastrado.', { campos: { telefone: 'Celular em uso.' } });
    const u = { id: novo('usr'), nome: req.body.nome.trim(), telefone, email: req.body.email || null, papel: req.body.papel, situacao: 'ativo', ultimo_acesso_em: null, criado_em: agora() };
    dados.usuarios.push(u);
    auditar('usuario.criado', `Cadastrou ${u.nome}`);
    res.status(201).json(usuarioPublico(u));
  });
  admin.put('/usuarios/:id', (req, res) => {
    const u = acharOu404(dados.usuarios, req.params.id, 'Usuário');
    validarUsuario({ ...u, ...req.body, telefone: req.body.telefone }, u.id);
    Object.assign(u, {
      nome: req.body.nome ?? u.nome, email: req.body.email ?? u.email, papel: req.body.papel ?? u.papel,
      situacao: req.body.situacao ?? u.situacao, ...(req.body.telefone ? { telefone: String(req.body.telefone).replace(/\D/g, '') } : {}),
    });
    auditar('usuario.alterado', `Alterou ${u.nome}`);
    res.json(usuarioPublico(u));
  });

  // Sites autorizados (iframe) — mesmo conceito do IAHub, com controle de versão
  admin.get('/sites-autorizados', (_req, res) => res.json(dados.sitesAutorizados));
  admin.put('/sites-autorizados', (req, res) => {
    if (Number(req.body?.versao) !== dados.sitesAutorizados.versao) throw erro('conflito', 'A lista foi alterada em outra sessão. Recarregue antes de salvar.');
    const origens = Array.isArray(req.body?.origens) ? req.body.origens : null;
    const invalidas = (origens || []).filter(o => !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
    if (!origens || invalidas.length) throw erro('requisicao_invalida', 'Use só endereços https, sem caminho (ex.: https://sistema.exemplo.com.br).', { campos: { origens: invalidas.join(', ') || 'obrigatório' } });
    Object.assign(dados.sitesAutorizados, { origens, versao: dados.sitesAutorizados.versao + 1, atualizado_em: agora() });
    auditar('sites_autorizados.alterado', 'Alterou a lista de sites autorizados');
    res.json(dados.sitesAutorizados);
  });

  // E-mail de envio (reserva do código de login) — padrão "E-mail Geral" do IA Recruit
  admin.get('/email-envio', (_req, res) => res.json(dados.emailEnvio));
  admin.put('/email-envio', (req, res) => {
    exigirCampos(req.body, {
      tipo: (v) => (['gmail', 'smtp'].includes(v) ? null : 'Escolha Gmail ou SMTP.'),
      email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '')) ? null : 'E-mail inválido.'),
      smtp_porta: (v) => (v === undefined || (Number.isInteger(Number(v)) && Number(v) > 0) ? null : 'Porta inválida.'),
    });
    const { senha, ...resto } = req.body;
    Object.assign(dados.emailEnvio, resto, { senha_configurada: dados.emailEnvio.senha_configurada || !!senha, situacao: 'nao_testado', atualizado_em: agora() });
    res.json(dados.emailEnvio);
  });
  admin.post('/email-envio/testar', (_req, res) => {
    dados.emailEnvio.situacao = 'testado';
    res.json({ ok: true, etapas: [
      { etapa: 'dns', ok: true, mensagem: 'DNS OK — smtp.exemplo.com.br' },
      { etapa: 'porta', ok: true, mensagem: 'Porta 465 respondeu.' },
      { etapa: 'autenticacao', ok: true, mensagem: 'Usuário e senha aceitos.' },
      { etapa: 'envio', ok: true, mensagem: 'E-mail de teste enviado para nao-responda@exemplo.com.br.' },
    ] });
  });

  // Aplicações e tokens
  admin.get('/aplicacoes', (req, res) => res.json(listar(req, dados.aplicacoes, {
    busca: [i => i.nome, i => i.descricao], filtros: { situacao: (i, v) => i.situacao === v }, ordenarPadrao: 'nome',
  })));
  admin.get('/aplicacoes/:id', (req, res) => res.json(acharOu404(dados.aplicacoes, req.params.id, 'Aplicação')));
  const validarAplicacao = (corpo) => exigirCampos(corpo, {
    nome: obrigatorio('o nome'),
    escopos: (v) => (Array.isArray(v) && v.length ? null : 'Escolha pelo menos um escopo.'),
    canais_autorizados: (v) => (v === undefined || (Array.isArray(v) && v.every(id => dados.canais.some(c => c.id === id))) ? null : 'Canal inválido.'),
  });
  admin.post('/aplicacoes', (req, res) => {
    validarAplicacao(req.body);
    const a = { id: novo('app'), nome: req.body.nome.trim(), descricao: req.body.descricao || null, situacao: 'ativa', escopos: req.body.escopos,
      canais_autorizados: req.body.canais_autorizados || [], webhook: { url: req.body.webhook?.url || null, ativo: !!req.body.webhook?.ativo, segredo_configurado: false },
      tokens: [], criado_em: agora() };
    dados.aplicacoes.push(a);
    auditar('aplicacao.criada', `Cadastrou a aplicação ${a.nome}`);
    res.status(201).json(a);
  });
  admin.put('/aplicacoes/:id', (req, res) => {
    const a = acharOu404(dados.aplicacoes, req.params.id, 'Aplicação');
    validarAplicacao({ ...a, ...req.body });
    Object.assign(a, {
      nome: req.body.nome ?? a.nome, descricao: req.body.descricao ?? a.descricao, situacao: req.body.situacao ?? a.situacao,
      escopos: req.body.escopos ?? a.escopos, canais_autorizados: req.body.canais_autorizados ?? a.canais_autorizados,
      webhook: req.body.webhook ? { ...a.webhook, url: req.body.webhook.url ?? a.webhook.url, ativo: req.body.webhook.ativo ?? a.webhook.ativo } : a.webhook,
    });
    res.json(a);
  });
  admin.post('/aplicacoes/:id/tokens', (req, res) => {
    const a = acharOu404(dados.aplicacoes, req.params.id, 'Aplicação');
    const sufixo = Math.abs(hash(`${a.id}${seq}`)).toString(36).padStart(8, '0');
    const token = `tk_teste_${sufixo}${'x'.repeat(24)}`;
    const registro = { id: novo('tok'), prefixo: token.slice(0, 13), criado_em: agora(), ultimo_uso_em: null, revogado_em: null };
    a.tokens.unshift(registro);
    auditar('aplicacao.token_gerado', `Gerou o token ${registro.prefixo}… para ${a.nome}`);
    // O token completo aparece SÓ nesta resposta. Depois, só o prefixo.
    res.status(201).json({ token, registro, aviso: 'Copie o token agora. Ele não será mostrado de novo.' });
  });
  admin.delete('/aplicacoes/:id/tokens/:tokenId', (req, res) => {
    const a = acharOu404(dados.aplicacoes, req.params.id, 'Aplicação');
    const t = acharOu404(a.tokens, req.params.tokenId, 'Token');
    if (!t.revogado_em) t.revogado_em = agora();
    auditar('aplicacao.token_revogado', `Revogou o token ${t.prefixo}… de ${a.nome}`);
    res.json(t);
  });
  admin.post('/aplicacoes/:id/webhook/segredo', (req, res) => {
    const a = acharOu404(dados.aplicacoes, req.params.id, 'Aplicação');
    a.webhook.segredo_configurado = true;
    res.status(201).json({ segredo: `whsec_teste_${'y'.repeat(32)}`, aviso: 'Copie o segredo agora. Ele não será mostrado de novo.' });
  });

  // Canais
  admin.get('/canais', (req, res) => res.json(listar(req, dados.canais, {
    busca: [i => i.nome, i => i.numero], filtros: { estado: (i, v) => i.estado === v, provedor: (i, v) => i.provedor === v },
    ordenarPadrao: 'nome', mapa: canalPublico,
  })));
  // Mesmo número (com ou sem o nono dígito) não entra em dois canais.
  const numeroValido = (v) => (/^\d{12,13}$/.test(String(v || '').replace(/\D/g, '')) ? null : 'Informe o número com DDI e DDD (ex.: 5565999990000).');
  const semNono = (n) => (n.length === 13 ? n.slice(0, 4) + n.slice(5) : n);
  function numeroUnico(valor, idAtual = null) {
    const n = String(valor).replace(/\D/g, '');
    if (dados.canais.some(c => c.id !== idAtual && c.numero && semNono(String(c.numero).replace(/\D/g, '')) === semNono(n))) {
      throw erro('conflito', 'Este número já está cadastrado em outro canal do IA Talk. Para várias empresas no mesmo número, vincule-as na aba Empresas desse canal.');
    }
    return n;
  }
  // Contrato real: empresas com IA Talk liberado em que a pessoa administra canais
  // (regra do IA Command). Aqui: as ativas + uma do IAHub ainda não criada no Talk.
  admin.get('/canais/empresas-vinculaveis', (req, res) => res.json({
    itens: [...dados.empresas.filter(e => e.situacao === 'ativa').map(e => ({ id: e.id, nome: e.nome })), { id: 'hub:9001', nome: 'Empresa do IAHub (simulada)' }],
  }));

  admin.get('/canais/:id', (req, res) => res.json(canalPublico(acharOu404(dados.canais, req.params.id, 'Canal'))));
  admin.post('/canais', (req, res) => {
    exigirCampos(req.body, {
      nome: obrigatorio('o nome'),
      provedor: (v) => (v === 'wweb' ? null : v === 'meta' ? 'A Meta Cloud API ainda não está disponível (etapa G6).' : 'Escolha o provedor.'),
      numero: numeroValido,
    });
    const numero = numeroUnico(req.body.numero);
    const c = { id: novo('cn'), nome: req.body.nome.trim(), numero, provedor: 'wweb', estado: 'parado', estado_desde: agora(),
      empresa_dona: { id: empresaAtual().id, nome: empresaAtual().nome }, empresas_vinculadas: [{ id: empresaAtual().id, nome: empresaAtual().nome, padrao: true }],
      capacidades: dados.canais[0].capacidades, fila_pendente: 0, ultima_mensagem_em: null, uso: 'integracao', atendimento: null };
    dados.canais.push(c);
    dados.logCanal[c.id] = [{ em: agora(), tipo: 'system', mensagem: 'Canal cadastrado. Clique em Conectar para gerar o QR Code.' }];
    res.status(201).json(canalPublico(c));
  });
  admin.put('/canais/:id', (req, res) => {
    const c = acharOu404(dados.canais, req.params.id, 'Canal');
    if (req.body?.numero !== undefined) {
      exigirCampos(req.body, { numero: numeroValido });
      c.numero = numeroUnico(req.body.numero, c.id);
    }
    if (req.body?.nome !== undefined) exigirCampos(req.body, { nome: obrigatorio('o nome') });
    if (req.body?.nome) c.nome = req.body.nome.trim();
    // Regras do canal (como o servidor real, canais/regras.js). Sessão simulada é da plataforma.
    const b = req.body || {};
    if (['envio_modo', 'recebimento_modo', 'numeros_teste', 'numeros_teste_adicionar', 'numeros_teste_remover', 'envio_habilitado', 'modo_teste'].some(k => b[k] !== undefined)) {
      if (!sessao.plataforma) throw erro('sem_permissao', 'Só a administração da plataforma altera as regras de envio e recebimento do canal.');
      const novas = regras.traduzirLegado(c, b);
      if (b.envio_modo !== undefined) novas.envio_modo = b.envio_modo;
      if (b.recebimento_modo !== undefined) novas.recebimento_modo = b.recebimento_modo;
      const campos = {};
      if (!regras.ENVIO_MODOS.includes(novas.envio_modo)) campos.envio_modo = 'Use desligado, teste ou qualquer.';
      if (!regras.RECEBIMENTO_MODOS.includes(novas.recebimento_modo)) campos.recebimento_modo = 'Use teste ou todos.';
      let lista = c.numeros_teste || [];
      if (b.numeros_teste !== undefined) {
        lista = Array.isArray(b.numeros_teste) ? b.numeros_teste.map(n => String(n).replace(/\D/g, '')) : null;
        if (!lista || lista.some(n => !/^\d{12,13}$/.test(n))) campos.numeros_teste = 'Use DDI e DDD (ex.: 5565999990000).';
      }
      if (b.numeros_teste_remover !== undefined || b.numeros_teste_adicionar !== undefined) {
        const remover = new Set(Array.isArray(b.numeros_teste_remover) ? b.numeros_teste_remover : []);
        const novos = (Array.isArray(b.numeros_teste_adicionar) ? b.numeros_teste_adicionar : []).map(n => String(n).replace(/\D/g, ''));
        if (novos.some(n => !/^\d{12,13}$/.test(n))) campos.numeros_teste_adicionar = 'Informe o número com DDI e DDD (ex.: 5565999990000).';
        lista = (lista || []).filter((_, i) => !remover.has(i));
        for (const n of novos) if (!lista.includes(n)) lista.push(n);
      }
      if (Object.keys(campos).length) throw erro('requisicao_invalida', 'Confira os campos destacados.', { campos });
      Object.assign(c, novas, { numeros_teste: lista });
    }
    if (Array.isArray(req.body?.empresas_vinculadas)) {
      // "hub:<n>": empresa do IAHub criada no Talk ao vincular (como o servidor real).
      for (const v of req.body.empresas_vinculadas) {
        if (!String(v.id).startsWith('hub:')) continue;
        const n = String(v.id).slice(4);
        const nova = { id: `emp_hub_${n}`, nome: 'Empresa do IAHub (simulada)', documento: null, apelido: `empresa-hub-${n}`, logo_url: null,
          situacao: 'ativa', vinculo_hub: { empresa_hub_id: Number(n), nome: 'Empresa do IAHub (simulada)' }, criado_em: agora(), atualizado_em: agora() };
        if (!dados.empresas.some(e => e.id === nova.id)) dados.empresas.push(nova);
        v.id = nova.id;
      }
      const padroes = new Map(req.body.empresas_vinculadas.map(v => [v.id, !!v.padrao]));
      c.empresas_vinculadas = dados.empresas.filter(e => padroes.has(e.id)).map(e => ({ id: e.id, nome: e.nome, padrao: padroes.get(e.id) }));
    }
    atendimento.aplicarNoCanal(req, c);
    res.json(canalPublico(c));
  });
  const ACOES_CANAL = {
    conectar: (c) => mudarEstadoCanal(c, 'qr_pendente', 'Aguardando leitura do QR Code.'),
    desconectar: (c) => mudarEstadoCanal(c, 'parado', 'Canal parado pelo usuário.'),
    reconectar: (c) => mudarEstadoCanal(c, 'reconectando', 'Reconexão pedida pelo usuário.'),
    'novo-qr': (c) => mudarEstadoCanal(c, 'qr_pendente', 'Novo QR Code gerado.'),
    'limpar-sessao': (c, req) => {
      // Ação destrutiva: o número precisa ler um QR novo. Exige confirmação explícita.
      if (req.body?.confirmar !== true) throw erro('requisicao_invalida', 'Confirme que deseja limpar a sessão. O celular terá de ler um novo QR Code.', { campos: { confirmar: 'obrigatório' } });
      mudarEstadoCanal(c, 'parado', 'Sessão limpa. Conecte de novo para gerar um QR Code.');
    },
  };
  admin.post('/canais/:id/:acao(conectar|desconectar|reconectar|novo-qr|limpar-sessao)', (req, res) => {
    const c = acharOu404(dados.canais, req.params.id, 'Canal');
    ACOES_CANAL[req.params.acao](c, req);
    auditar(`canal.${req.params.acao}`, `${req.params.acao} no canal ${c.nome}`);
    res.json(canalPublico(c));
  });
  admin.get('/canais/:id/qr', async (req, res, next) => {
    try {
      const c = acharOu404(dados.canais, req.params.id, 'Canal');
      res.json(await qrDoCanal(c));
    } catch (err) { next(err); }
  });
  admin.get('/canais/:id/log', (req, res) => {
    acharOu404(dados.canais, req.params.id, 'Canal');
    const linhas = [...(dados.logCanal[req.params.id] || [])].reverse();
    res.json(listar(req, linhas, { filtros: { tipo: (i, v) => i.tipo === v } }));
  });

  // Painel
  admin.get('/painel', (req, res) => res.json(painel(req.cenarios.has('vazio'))));

  // Mensagens
  const filtrosMensagens = {
    de: naData('criada_em', (a, v) => a >= v),
    ate: naData('criada_em', (a, v) => a <= v),
    canal_id: (i, v) => i.canal.id === v,
    provedor: (i, v) => (dados.canais.find(c => c.id === i.canal.id)?.provedor || 'wweb') === v,
    aplicacao_id: (i, v) => (v === 'nenhuma' ? !i.aplicacao : i.aplicacao?.id === v),
    direcao: (i, v) => i.direcao === v,
    tipo: (i, v) => i.tipo === v,
    estado: (i, v) => v.split('|').includes(i.estado),
    apenas_falhas: (i, v) => (v === '1' || v === 'true' ? ESTADOS_COM_ACAO_MANUAL.includes(i.estado) : true),
    correlacao_id: (i, v) => String(i.correlacao_id || '').includes(v),
    // O destinatário é buscado pelo número completo; a resposta só traz mascarado.
    destinatario: (i, v) => i.contato_mascarado.endsWith(String(v).replace(/\D/g, '').slice(-4)),
  };
  const resumoMensagem = ({ historico_estados, metadados, anexos, ...resto }) => resto; // eslint-disable-line no-unused-vars
  admin.get('/mensagens', (req, res) => res.json(listar(req, dados.mensagens, {
    busca: [i => i.previa, i => i.correlacao_id, i => i.id], filtros: filtrosMensagens, ordenarPadrao: 'criada_em', mapa: resumoMensagem,
  })));
  admin.get('/mensagens/exportar', (req, res) => {
    const todas = listar({ ...req, query: { ...req.query, limite: 200, cursor: undefined } }, dados.mensagens, { filtros: filtrosMensagens, ordenarPadrao: 'criada_em' }).itens;
    const csv = ['id;direcao;canal;aplicacao;contato;tipo;estado;correlacao;criada_em']
      .concat(todas.map(m => [m.id, m.direcao, m.canal.nome, m.aplicacao?.nome || '', m.contato_mascarado, m.tipo, m.estado, m.correlacao_id || '', m.criada_em].join(';')))
      .join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="mensagens.csv"').send(`﻿${csv}`);
  });
  admin.get('/mensagens/:id', (req, res) => res.json(acharOu404(dados.mensagens, req.params.id, 'Mensagem')));
  const acaoManual = (novoEstado, detalhe) => (req, res) => {
    const m = acharOu404(dados.mensagens, req.params.id, 'Mensagem');
    if (!ESTADOS_COM_ACAO_MANUAL.includes(m.estado)) throw erro('conflito', 'Só mensagens com resultado desconhecido ou com falha aceitam esta ação.');
    m.estado = novoEstado;
    m.atualizada_em = agora();
    m.historico_estados.push({ estado: novoEstado, em: m.atualizada_em, detalhe });
    emitir(EVENTOS_SOCKET.servidor.estadoMensagem, { id: m.id, estado: m.estado, em: m.atualizada_em }, 'painel');
    res.json(m);
  };
  admin.post('/mensagens/:id/reenviar', acaoManual('aceita', 'Reenvio pedido manualmente.'));
  admin.post('/mensagens/:id/dar-como-falha', acaoManual('falhou', 'Marcada como falha manualmente.'));

  // C3 — envio de teste pela tela (contratos.md §4). Só canal conectado, com envio
  // ligado e para número da lista de teste. Estados andam sozinhos a cada ~1,2 s;
  // texto com a palavra "falha" termina em `falhou` (para testar a tela de erro).
  admin.post('/canais/:id/enviar-teste', (req, res) => {
    const c = acharOu404(dados.canais, req.params.id, 'Canal');
    // para_indice: posição (0, 1, …) em numeros_teste_mascarados — a tela nunca tem o número completo.
    exigirCampos(req.body, {
      para_indice: (v) => (Number.isInteger(v) && v >= 0 ? null : 'Escolha um número da lista de teste.'),
      texto: (v) => { const t = String(v || '').trim(); return !t ? 'Escreva a mensagem.' : (t.length > 1000 ? 'Use no máximo 1000 caracteres.' : null); },
    });
    if (c.envio_modo === 'desligado') throw erro('conflito', 'O envio está desligado neste canal. A administração da plataforma liga quando for liberado.');
    if (c.estado !== 'conectado') throw erro('conflito', 'Conecte o canal antes de enviar.');
    const para = (c.numeros_teste || [])[req.body.para_indice];
    if (!para) throw erro('sem_permissao', 'Em teste, só os números da lista de teste deste canal recebem mensagens.', { campos: { para_indice: 'Fora da lista de teste.' } });
    const t0 = agora();
    const m = { id: novo('msg'), direcao: 'saida', canal: { id: c.id, nome: c.nome }, aplicacao: null, origem: 'teste_tela',
      contato_mascarado: mascararTelefone(para), tipo: 'texto', previa: String(req.body.texto).trim().slice(0, 80), texto: String(req.body.texto).trim(), estado: 'aceita',
      correlacao_id: null, criada_em: t0, atualizada_em: t0, historico_estados: [{ estado: 'aceita', em: t0, detalhe: 'Envio de teste pela tela.' }], metadados: {}, anexos: [] };
    dados.mensagens.unshift(m);
    const falhar = /falha/i.test(req.body.texto);
    const passos = falhar ? ['aguardando', 'encaminhada', 'falhou'] : ['aguardando', 'encaminhada', 'enviada', 'entregue', 'lida'];
    passos.forEach((estado, i) => setTimeout(() => {
      m.estado = estado;
      m.atualizada_em = agora();
      m.historico_estados.push({ estado, em: m.atualizada_em, detalhe: estado === 'falhou' ? 'Número não encontrado no WhatsApp.' : null });
      emitir(EVENTOS_SOCKET.servidor.estadoMensagem, { id: m.id, estado, em: m.atualizada_em }, 'painel');
      emitir(EVENTOS_SOCKET.servidor.estadoMensagem, { id: m.id, estado, em: m.atualizada_em }, sala(c.id));
      if (estado === 'enviada') {
        // Como o servidor real: a linha do log só referencia a mensagem; o texto vem da mensagem.
        const linha = { em: m.atualizada_em, tipo: 'sent', mensagem: `Mensagem (texto) enviada para ${m.contato_mascarado} (teste pela tela).`, mensagem_id: m.id };
        (dados.logCanal[c.id] ||= []).push({ ...linha, texto: m.texto });
        emitir(S.servidor.logCanal, { canal_id: c.id, ...linha }, sala(c.id));
      }
    }, (i + 1) * 1200).unref?.());
    auditar('canal.enviar_teste', `Enviou mensagem de teste pelo canal ${c.nome}`);
    res.status(202).json(m);
  });

  // Eventos (webhooks)
  admin.get('/eventos', (req, res) => res.json(listar(req, dados.eventos, {
    busca: [i => i.id, i => i.tipo],
    filtros: { tipo: (i, v) => i.tipo === v, aplicacao_id: (i, v) => i.aplicacao.id === v, situacao: (i, v) => i.entrega.situacao === v,
      de: naData('em', (a, v) => a >= v), ate: naData('em', (a, v) => a <= v) },
    ordenarPadrao: 'em',
  })));
  admin.get('/eventos/:id', (req, res) => {
    const e = acharOu404(dados.eventos, req.params.id, 'Evento');
    res.json({ ...e, corpo: { id: e.id, tipo: e.tipo, em: e.em, dados: { mensagem_id: 'msg_ex001', estado: 'lida' } },
      tentativas: Array.from({ length: e.entrega.tentativas }, (_, k) => ({ em: new Date(Date.parse(e.em) + k * 60_000).toISOString(), status_http: k === e.entrega.tentativas - 1 ? e.entrega.ultimo_status_http : 503, duracao_ms: 120 + k * 15 })) });
  });
  admin.post('/eventos/:id/reentregar', (req, res) => {
    const e = acharOu404(dados.eventos, req.params.id, 'Evento');
    Object.assign(e.entrega, { situacao: 'pendente', proxima_tentativa_em: agora() });
    res.json(e);
  });

  admin.get('/auditoria', (req, res) => res.json(listar(req, dados.auditoria, {
    busca: [i => i.resumo, i => i.acao, i => i.usuario?.nome],
    filtros: { acao: (i, v) => i.acao.startsWith(v), usuario_id: (i, v) => i.usuario?.id === v, de: naData('em', (a, v) => a >= v), ate: naData('em', (a, v) => a <= v) },
    ordenarPadrao: 'em',
  })));

  atendimento.rotas(admin);

  admin.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  admin.use(middlewareErros(log));
  app.use(config.API_ADMIN, admin);

  // ── API pública (página de entrada por apelido) ─────────────────────────────
  const publico = express.Router();
  publico.use(middlewareCenarios);
  publico.get('/empresa/:apelido', (req, res) => {
    const e = dados.empresas.find(x => x.apelido === String(req.params.apelido).toLowerCase() && x.situacao === 'ativa');
    if (!e) throw erro('nao_encontrado', 'Link de acesso não encontrado. Confira o endereço com a sua empresa.');
    res.json({ nome: e.nome, apelido: e.apelido, logo_url: e.logo_url, metodos: ['telefone'] });
  });
  publico.post('/login/codigo', (req, res) => {
    exigirCampos(req.body, {
      apelido: obrigatorio('o link da empresa'),
      telefone: (v) => (/^\d{12,13}$/.test(String(v || '').replace(/\D/g, '')) ? null : 'Informe o celular com DDD.'),
    });
    const id = novo('dsf');
    desafios.set(id, { apelido: req.body.apelido, tentativas: 0 });
    // Mesmo para número desconhecido a resposta é igual (não revela quem é cadastrado).
    res.json({ desafio_id: id, expira_em: new Date(Date.now() + 5 * 60 * 1000).toISOString(), enviado_por: req.cenarios.has('email') ? 'email' : 'whatsapp',
      destino_mascarado: req.cenarios.has('email') ? 'a••@exemplo.com.br' : mascararTelefone(req.body.telefone), dica_simulado: 'No servidor simulado o código é 123456.' });
  });
  publico.post('/login/confirmar', (req, res) => {
    const d = desafios.get(req.body?.desafio_id);
    if (!d) throw erro('nao_encontrado', 'O código expirou. Peça um novo.');
    d.tentativas += 1;
    if (d.tentativas > 5) { desafios.delete(req.body.desafio_id); throw erro('limite_excedido', 'Muitas tentativas. Peça um novo código.'); }
    if (String(req.body?.codigo) !== '123456') throw erro('requisicao_invalida', 'Código incorreto.', { campos: { codigo: 'Código incorreto.' }, detalhe: { tentativas_restantes: 5 - d.tentativas } });
    desafios.delete(req.body.desafio_id);
    // §9.1: destino 'atendimento' leva ao portal da empresa do login (só esse valor; nada de URL livre).
    const portal = req.body?.destino === 'atendimento' && /^[a-z0-9-]{3,40}$/.test(String(d.apelido || ''));
    res.json({ ok: true, redirecionar: portal ? `${config.BASE_PATH}/${d.apelido}/atendimento` : `${config.BASE_PATH}/shell.html` });
  });
  // Entrada pelo card do IAHub (ticket assinado de 60 s, uso único) — C1.
  publico.get('/entrar-hub', (req, res) => {
    if (!req.query.ticket) throw erro('nao_autenticado', 'Ticket do IAHub ausente ou vencido. Volte ao IAHub e clique no card de novo.');
    res.redirect(`${config.BASE_PATH}/shell.html`);
  });
  publico.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  publico.use(middlewareErros(log));
  app.use(config.API_PUBLICA, publico);

  // ── API oficial v1 (integradores, token Bearer) ─────────────────────────────
  const v1 = express.Router();
  v1.use(middlewareCenarios);
  v1.use((req, res, next) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token.startsWith('tk_teste_')) return next(erro('nao_autenticado', 'Token ausente ou inválido. Use Authorization: Bearer <token da aplicação>.'));
    res.set({ 'X-RateLimit-Limit': '120', 'X-RateLimit-Remaining': '119', 'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 60) });
    next();
  });
  v1.post('/mensagens', (req, res) => {
    const chave = req.get('idempotency-key');
    if (!chave) throw erro('requisicao_invalida', 'O cabeçalho Idempotency-Key é obrigatório.', { campos: { 'Idempotency-Key': 'obrigatório' } });
    const corpoJson = JSON.stringify(req.body || {});
    const anterior = idempotencia.get(chave);
    if (anterior) {
      if (anterior.corpo !== corpoJson) throw erro('idempotencia_conflito', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
      return res.status(202).set('Idempotent-Replayed', 'true').json(anterior.resposta);
    }
    exigirCampos(req.body, {
      canal: (v) => (dados.canais.some(c => c.id === v) ? null : 'Canal inexistente ou não autorizado.'),
      para: (v) => (/^\+?\d{12,13}$/.test(String(v || '').replace(/[\s-]/g, '')) ? null : 'Informe o número com DDI e DDD.'),
      tipo: (v) => (['texto', 'imagem', 'documento', 'audio', 'video'].includes(v) ? null : 'Tipo inválido.'),
    });
    const canal = dados.canais.find(c => c.id === req.body.canal);
    if (!canal.capacidades[req.body.tipo]) throw erro('recurso_nao_suportado', `Este canal não envia ${req.body.tipo}.`);
    if (req.body.tipo === 'texto' && !String(req.body.texto || '').trim()) throw erro('requisicao_invalida', 'Texto vazio.', { campos: { texto: 'obrigatório' } });
    if (req.body.tipo !== 'texto' && !req.body.arquivo?.base64 && !req.body.arquivo?.url && !req.body.arquivo?.midia_id) {
      throw erro('requisicao_invalida', 'Informe o arquivo em base64, url ou midia_id.', { campos: { arquivo: 'obrigatório' } });
    }
    const resposta = { id: novo('msg'), estado: 'aceita', canal: canal.id, criada_em: agora(), correlacao_id: req.get('x-correlation-id') || null,
      aviso: 'Aceita para envio. Isto não confirma a entrega: acompanhe pelo estado ou pelo webhook.' };
    idempotencia.set(chave, { corpo: corpoJson, resposta });
    dados.mensagens.unshift({ id: resposta.id, direcao: 'saida', canal: { id: canal.id, nome: canal.nome }, aplicacao: { id: 'app_iacommand', nome: 'IA Command' },
      contato_mascarado: mascararTelefone(req.body.para), tipo: req.body.tipo, previa: String(req.body.texto || req.body.arquivo?.nome || '').slice(0, 80), estado: 'aceita',
      correlacao_id: resposta.correlacao_id, criada_em: resposta.criada_em, atualizada_em: resposta.criada_em,
      historico_estados: [{ estado: 'aceita', em: resposta.criada_em, detalhe: null }], metadados: req.body.metadados || {}, anexos: [] });
    res.status(202).json(resposta);
  });
  v1.get('/mensagens/:id', (req, res) => {
    const m = acharOu404(dados.mensagens, req.params.id, 'Mensagem');
    if (m.direcao !== 'saida') throw erro('nao_encontrado', 'Mensagem não encontrada.');
    res.json({ id: m.id, estado: m.estado, canal: m.canal.id, para_mascarado: m.contato_mascarado, tipo: m.tipo, correlacao_id: m.correlacao_id,
      criada_em: m.criada_em, atualizada_em: m.atualizada_em, historico_estados: m.historico_estados });
  });
  v1.get('/canais/:id/estado', (req, res) => {
    const c = acharOu404(dados.canais, req.params.id, 'Canal');
    res.json({ id: c.id, estado: c.estado, estado_desde: c.estado_desde, capacidades: c.capacidades });
  });
  v1.get('/eventos', (req, res) => {
    const depois = req.query.depois ? decodificarCursor(req.query.depois)?.o || 0 : 0;
    const limite = Math.min(Number(req.query.limite) || 50, 200);
    const fila = [...dados.eventos].reverse();
    const itens = fila.slice(depois, depois + limite).map(e => ({ id: e.id, tipo: e.tipo, em: e.em, dados: { mensagem_id: 'msg_ex001', estado: 'lida' } }));
    res.json({ itens, proximo_cursor: codificarCursor({ o: depois + itens.length }), tem_mais: depois + itens.length < fila.length });
  });
  atendimento.rotasV1(v1); // C8 §8.9: conversas e retornos do sistema de origem
  v1.use((req, _res, next) => next(erro('nao_encontrado', `Rota não encontrada: ${req.method} ${req.path}`)));
  v1.use(middlewareErros(log));
  app.use(config.API_V1, v1);

  montarEstaticos(app, { comPrototipos: true });

  // Página de entrada da empresa: /app/ia-talk/<apelido> serve frontend/entrar.html (G1).
  // A tela lê o apelido do último trecho do endereço (ou de ?apelido= ao abrir entrar.html direto).
  app.get(`${config.BASE_PATH}/:apelido([a-z0-9-]{3,40})`, (req, res) => {
    const arquivo = path.join(config.DIR_FRONTEND, 'entrar.html');
    if (!fs.existsSync(arquivo)) return res.status(404).send('Página de entrada ainda não entregue (etapa G1).');
    res.set('Cache-Control', 'no-cache, must-revalidate').sendFile(arquivo);
  });

  // Portal do atendente (§9.1): /app/ia-talk/<apelido>/atendimento → frontend/portal.html (G15).
  app.get(`${config.BASE_PATH}/:apelido([a-z0-9-]{3,40})/atendimento`, (req, res) => {
    const arquivo = path.join(config.DIR_FRONTEND, 'portal.html');
    if (!fs.existsSync(arquivo)) return res.status(404).send('Portal do atendente ainda não entregue (etapa G15).');
    res.set('Cache-Control', 'no-cache, must-revalidate').sendFile(arquivo);
  });

  // ── Socket.IO (QR, estado e terminal do canal; painel) ──────────────────────
  const servidor = http.createServer(app);
  const io = new Server(servidor, { path: config.SOCKET_PATH, serveClient: true });
  const ns = io.of(config.SOCKET_NAMESPACE);
  const S = EVENTOS_SOCKET;
  const sala = (canalId) => `canal:${canalId}`;

  function emitir(evento, corpo, nomeSala) { ns.to(nomeSala).emit(evento, corpo); }

  let geracaoQr = 0;
  async function qrDoCanal(c) {
    if (c.estado !== 'qr_pendente') return { canal_id: c.id, estado: c.estado, qr: null, expira_em: null };
    const qr = await QRCode.toDataURL(`IA-TALK-SIMULADO|${c.id}|${geracaoQr}`, { margin: 1, width: 264 });
    return { canal_id: c.id, estado: c.estado, qr, expira_em: new Date(Date.now() + intervaloQrMs).toISOString() };
  }

  function mudarEstadoCanal(c, estado, mensagem) {
    c.estado = estado;
    c.estado_desde = agora();
    const linha = { em: c.estado_desde, tipo: estado === 'conectado' ? 'success' : estado === 'parado' ? 'system' : 'info', mensagem };
    (dados.logCanal[c.id] ||= []).push(linha);
    emitir(S.servidor.estadoCanal, { canal_id: c.id, estado, em: c.estado_desde, detalhe: mensagem }, sala(c.id));
    emitir(S.servidor.logCanal, { canal_id: c.id, ...linha }, sala(c.id));
    if (estado === 'qr_pendente') qrDoCanal(c).then(q => emitir(S.servidor.qrCanal, { canal_id: c.id, qr: q.qr, expira_em: q.expira_em }, sala(c.id))).catch(() => {});
  }

  function painel(vazio = false) {
    if (vazio) {
      return { canais: { total: 0, conectados: 0, com_problema: 0 }, mensagens_hoje: { enviadas: 0, recebidas: 0, falhas: 0 },
        fila: { aguardando: 0, desconhecidas: 0 }, tempo_medio_envio_ms: null, pendencias: [], atualizado_em: agora() };
    }
    const hoje = new Date(BASE_SIMULADA).toISOString().slice(0, 10);
    const doDia = dados.mensagens.filter(m => m.criada_em.startsWith(hoje));
    return {
      canais: { total: dados.canais.length, conectados: dados.canais.filter(c => c.estado === 'conectado').length,
        com_problema: dados.canais.filter(c => !['conectado', 'parado'].includes(c.estado)).length },
      mensagens_hoje: { enviadas: doDia.filter(m => m.direcao === 'saida').length, recebidas: doDia.filter(m => m.direcao === 'entrada').length,
        falhas: doDia.filter(m => m.estado === 'falhou').length },
      fila: { aguardando: dados.mensagens.filter(m => m.estado === 'aguardando').length, desconhecidas: dados.mensagens.filter(m => m.estado === 'desconhecida').length },
      tempo_medio_envio_ms: 1800,
      pendencias: [
        { tipo: 'mensagens_desconhecidas', gravidade: 'alta', mensagem: 'Há mensagens com resultado desconhecido.', link: `${config.BASE_PATH}/mensagens.html?estado=desconhecida` },
        { tipo: 'canal_com_problema', gravidade: 'media', mensagem: 'O canal Financeiro está reconectando.', link: `${config.BASE_PATH}/canais.html?id=cn_financeiro` },
        { tipo: 'webhook_falhando', gravidade: 'media', mensagem: 'Webhook do IA Command falhando.', link: `${config.BASE_PATH}/eventos.html?situacao=falhando` },
      ],
      atualizado_em: agora(),
    };
  }

  ns.on('connection', (socket) => {
    socket.on(S.cliente.assinarCanal, async ({ canal_id } = {}) => {
      const c = dados.canais.find(x => x.id === canal_id);
      if (!c) return socket.emit(S.servidor.erro, { codigo: 'nao_encontrado', mensagem: 'Canal não encontrado.' });
      socket.join(sala(c.id));
      socket.emit(S.servidor.estadoCanal, { canal_id: c.id, estado: c.estado, em: c.estado_desde });
      if (c.estado === 'qr_pendente') {
        const q = await qrDoCanal(c);
        socket.emit(S.servidor.qrCanal, { canal_id: c.id, qr: q.qr, expira_em: q.expira_em });
      }
    });
    socket.on(S.cliente.sairCanal, ({ canal_id } = {}) => socket.leave(sala(canal_id)));
    socket.on(S.cliente.assinarPainel, () => { socket.join('painel'); socket.emit(S.servidor.painelAtualizado, painel()); });
    atendimento.socket(socket);
  });

  // Terminal "ao vivo": linhas periódicas em todos os canais assinados.
  const FRASES = [['info', 'Sincronizando conversas...'], ['received', 'Mensagem recebida de +55 65 9••••-0003'], ['sent', 'Mensagem enviada (IA Service).'],
    ['success', 'Recibo de leitura recebido.'], ['warning', 'Envio lento: 4,2 s até confirmar.'], ['error', 'Número não encontrado no WhatsApp.']];
  let tique = 0;
  const timers = [];
  timers.push(setInterval(() => {
    tique++;
    for (const c of dados.canais) {
      const [tipo, mensagem] = c.estado === 'conectado' ? FRASES[tique % FRASES.length]
        : c.estado === 'reconectando' ? ['info', `Tentando reconectar (${(tique % 5) + 1}/5)...`] : c.estado === 'qr_pendente' ? ['info', 'Aguardando leitura do QR Code.'] : [null];
      if (!tipo) continue;
      const linha = { em: agora(), tipo, mensagem };
      const log = (dados.logCanal[c.id] ||= []);
      log.push(linha);
      if (log.length > 500) log.shift();
      emitir(S.servidor.logCanal, { canal_id: c.id, ...linha }, sala(c.id));
    }
    // O canal Financeiro alterna entre reconectando e conectado, para a tela mostrar a troca de estado.
    if (tique % 15 === 0) {
      const fin = dados.canais.find(c => c.id === 'cn_financeiro');
      if (fin && ['reconectando', 'conectado'].includes(fin.estado)) mudarEstadoCanal(fin, fin.estado === 'reconectando' ? 'conectado' : 'reconectando', fin.estado === 'reconectando' ? 'Canal reconectado.' : 'Conexão perdida com o WhatsApp.');
      emitir(S.servidor.painelAtualizado, painel(), 'painel');
    }
  }, intervaloLogMs));
  timers.push(setInterval(() => {
    geracaoQr++;
    for (const c of dados.canais.filter(x => x.estado === 'qr_pendente')) {
      qrDoCanal(c).then(q => emitir(S.servidor.qrCanal, { canal_id: c.id, qr: q.qr, expira_em: q.expira_em }, sala(c.id))).catch(() => {});
    }
  }, intervaloQrMs));
  timers.forEach(t => t.unref());

  return {
    app,
    servidor,
    io,
    dados,
    iniciar(porta = config.portaSimulada(), host = '127.0.0.1') {
      return new Promise((resolve) => servidor.listen(porta, host, () => resolve(servidor.address())));
    },
    fechar() {
      timers.forEach(clearInterval);
      atendimento.parar();
      return new Promise((resolve) => { io.close(); servidor.close(() => resolve()); });
    },
  };
}

function hash(texto) {
  let h = 0;
  for (const ch of String(texto)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

module.exports = { criarServidorSimulado };

if (require.main === module) {
  const sim = criarServidorSimulado();
  sim.iniciar().then(({ address, port }) => {
    console.log(`[IA Talk · simulado] http://${address}:${port}${config.BASE_PATH}/`);
    console.log('[IA Talk · simulado] Cenários: cabeçalho X-Talk-Simular ou ?simular=vazio,lento,atendente,400,401,403,404,409,422,429,500');
  });
}
