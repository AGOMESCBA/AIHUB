// Histórico de Acessos (2026-10-28) — complemento do Monitor de Acessos.
//
// O Monitor (presenca-service.js / svc_presenca) é estado AO VIVO: some com
// Limpar, com Sair e após 3 dias. Este serviço grava, à parte, uma linha por
// login (svc_acessos_historico, migration v54) que fica PARA SEMPRE — só sai
// pela exclusão por período do painel (decisão do usuário, auditada).
//
//  - chat    → uma linha por sessão externa (login por código no J2A),
//              criada no momento do login, com IP e navegador.
//  - interno → uma linha por sessão do IAHub (hash do sessionID, mesmo
//              sessao_ref da presença), criada no primeiro sinal da tela.
//
// Também grava as tentativas de login com falha do J2A (svc_acessos_falhas).
// Quando o número não existe em nenhuma empresa, a falha só é atribuída a uma
// empresa se a tela de login foi aberta pelo link dela (apelido); sem isso
// fica com empresa_id NULL e não aparece no painel de nenhuma empresa.
//
// Regra de ouro: auditoria nunca derruba o fluxo principal — quem chama usa
// as funções "seguras" (try/catch interno) e segue em frente se falharem.

const crypto = require('crypto');
const { getDB } = require('../database');
const consultorRepo = require('../repositories/consultor-repository');
const consultorService = require('./consultor-service');
const usuariosDb = require('../../../IAHUB/backend/usuarios/database');

const MAX_CHAMADOS_POR_ACESSO = 30;
const MAX_LINHAS_LISTA = 5000;
const AUSENTE_ATE_MS = 15 * 60 * 1000;
const INTERNO_ENCERRADO_APOS_MS = 8 * 60 * 60 * 1000;

const MOTIVOS = {
  sair: 'Saiu pelo botão Sair',
  derrubado: 'Acesso derrubado pelo Monitor',
  limpar: 'Encerrado pelo Limpar do Monitor',
  desativado: 'Analista desativado na Platform',
};

function _curto(valor, max) {
  const limpo = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, max) : null;
}

/** IP e navegador de quem fez a requisição. ip_encaminhado vem do cabeçalho
 *  X-Forwarded-For (proxy reverso) e é informativo: o cliente pode forjá-lo. */
function clienteDaRequisicao(req) {
  if (!req) return {};
  const encaminhado = String(req.headers?.['x-forwarded-for'] || '').split(',')[0];
  return {
    ip: _curto(req.ip || req.socket?.remoteAddress, 64),
    ipEncaminhado: _curto(encaminhado, 64),
    navegador: _curto(req.headers?.['user-agent'], 300),
  };
}

function _seguro(nome, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[IA Service][historico-acessos] ${nome} falhou:`, err.message);
    return null;
  }
}

function _identidade(empresaId, origem, consultorId, usuarioIdIahub) {
  if (origem === 'chat' && consultorId) {
    const consultor = consultorRepo.getConsultor(Number(empresaId), consultorId);
    return { nome: consultorService.getNomeExibicao(Number(empresaId), consultorId) || null, telefone: consultor?.telefone || null };
  }
  if (usuarioIdIahub) {
    const usuario = usuariosDb.buscarPorId(usuarioIdIahub);
    const consultor = consultorRepo.getConsultorPorUsuario(Number(empresaId), usuarioIdIahub);
    return { nome: usuario?.nome || usuario?.usuario || null, telefone: consultor?.telefone || null };
  }
  return { nome: null, telefone: null };
}

function _inserir(db, { empresaId, origem, sessaoRef, consultorId = null, usuarioIdIahub = null, entrouEm, cliente }) {
  cliente = cliente || {};
  const { nome, telefone } = _identidade(empresaId, origem, consultorId, usuarioIdIahub);
  db.prepare(`
    INSERT OR IGNORE INTO svc_acessos_historico (id, empresa_id, origem, sessao_ref, consultor_id, usuario_id_iahub,
      nome, telefone, ip, ip_encaminhado, navegador, entrou_em, ultimo_sinal_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), Number(empresaId), origem, String(sessaoRef), consultorId, usuarioIdIahub,
    nome, telefone, cliente.ip || null, cliente.ipEncaminhado || null, cliente.navegador || null, entrouEm, entrouEm);
}

/** Login do chat J2A concluído (sessão externa emitida). */
function registrarLoginChat({ empresaId, sessaoId, consultorId, entrouEm, cliente }) {
  return _seguro('registrarLoginChat', () => {
    _inserir(getDB(), { empresaId, origem: 'chat', sessaoRef: sessaoId, consultorId, entrouEm: entrouEm || new Date().toISOString(), cliente });
  });
}

/**
 * Sinal da tela (chamado por presenca-service.registrarSinal depois de gravar
 * a presença). Cria a linha se ainda não existir: interno no primeiro sinal;
 * chat só se a sessão vier de antes deste recurso (entrada = criação da sessão).
 */
function registrarSinal({ empresaId, origem, sessaoRef, consultorId = null, usuarioIdIahub = null, agoraIso, segundos = 0, mudouTela = false, chamadoNumero = null, visivel = true, cliente }) {
  return _seguro('registrarSinal', () => {
    const db = getDB();
    let atual = db.prepare('SELECT id, chamados FROM svc_acessos_historico WHERE empresa_id = ? AND origem = ? AND sessao_ref = ?')
      .get(Number(empresaId), origem, String(sessaoRef));
    if (!atual) {
      if (!visivel) return;
      const sessao = origem === 'chat'
        ? db.prepare('SELECT criado_em FROM svc_sessoes_externas WHERE id = ? AND empresa_id = ?').get(String(sessaoRef), Number(empresaId))
        : null;
      _inserir(db, { empresaId, origem, sessaoRef, consultorId, usuarioIdIahub, entrouEm: sessao?.criado_em || agoraIso, cliente });
      atual = db.prepare('SELECT id, chamados FROM svc_acessos_historico WHERE empresa_id = ? AND origem = ? AND sessao_ref = ?')
        .get(Number(empresaId), origem, String(sessaoRef));
      if (!atual) return;
    }
    if (!visivel) {
      db.prepare('UPDATE svc_acessos_historico SET ultimo_sinal_em = ? WHERE id = ?').run(agoraIso, atual.id);
      return;
    }
    let chamados = atual.chamados || null;
    if (chamadoNumero) {
      const lista = chamados ? chamados.split(',') : [];
      if (!lista.includes(String(chamadoNumero)) && lista.length < MAX_CHAMADOS_POR_ACESSO) lista.push(String(chamadoNumero));
      chamados = lista.join(',') || null;
    }
    db.prepare(`
      UPDATE svc_acessos_historico
         SET ultimo_sinal_em = ?, segundos_ativos = segundos_ativos + ?, telas_visitadas = telas_visitadas + ?, chamados = ?
       WHERE id = ?
    `).run(agoraIso, Math.max(0, Math.round(segundos || 0)), mudouTela ? 1 : 0, chamados, atual.id);
  });
}

/** Marca o fim de um ou mais logins (só os que ainda não tinham fim). */
function registrarEncerramento({ empresaId, origem = 'chat', sessaoRefs, motivo, usuarioId = null }) {
  return _seguro('registrarEncerramento', () => {
    const refs = (sessaoRefs || []).filter(Boolean).map(String);
    if (!refs.length) return;
    const db = getDB();
    const agoraIso = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE svc_acessos_historico SET encerrado_em = ?, motivo_encerramento = ?, encerrado_por = ?
       WHERE empresa_id = ? AND origem = ? AND sessao_ref = ? AND encerrado_em IS NULL
    `);
    db.transaction(() => refs.forEach(ref => stmt.run(agoraIso, motivo, usuarioId, Number(empresaId), origem, ref)))();
  });
}

/** Tentativa de login do J2A que não terminou em sessão. empresaId pode ser nulo. */
function registrarFalha({ empresaId = null, telefone = null, etapa, motivo, cliente }) {
  return _seguro('registrarFalha', () => {
    cliente = cliente || {};
    getDB().prepare(`
      INSERT INTO svc_acessos_falhas (id, empresa_id, telefone, etapa, motivo, ip, ip_encaminhado, navegador, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), empresaId ? Number(empresaId) : null, _curto(telefone, 20), String(etapa), _curto(motivo, 200),
      cliente.ip || null, cliente.ipEncaminhado || null, cliente.navegador || null, new Date().toISOString());
  });
}

function _periodo(de, ate) {
  const deMs = new Date(de).getTime();
  const ateMs = new Date(ate).getTime();
  if (!de || !ate || !Number.isFinite(deMs) || !Number.isFinite(ateMs)) {
    throw Object.assign(new Error('Período inválido: informe data inicial e final.'), { status: 400 });
  }
  if (deMs > ateMs) throw Object.assign(new Error('Período inválido: a data inicial é maior que a final.'), { status: 400 });
  return { deIso: new Date(deMs).toISOString(), ateIso: new Date(ateMs).toISOString() };
}

function _situacao(row, sessaoExpiraEm, agoraMs) {
  if (row.encerrado_em) return { codigo: 'encerrado', rotulo: MOTIVOS[row.motivo_encerramento] || 'Encerrado' };
  const ultimoMs = new Date(row.ultimo_sinal_em || row.entrou_em).getTime();
  if (row.origem === 'chat') {
    if (!sessaoExpiraEm || new Date(sessaoExpiraEm).getTime() <= agoraMs) return { codigo: 'expirou', rotulo: 'Login expirou' };
  } else if (agoraMs - ultimoMs > INTERNO_ENCERRADO_APOS_MS) {
    return { codigo: 'expirou', rotulo: 'Sem sinal (sessão encerrada)' };
  }
  return agoraMs - ultimoMs < AUSENTE_ATE_MS
    ? { codigo: 'em_andamento', rotulo: 'Em andamento' }
    : { codigo: 'fora_da_tela', rotulo: 'Login válido, fora da tela' };
}

/**
 * Histórico de UMA empresa (a da sessão de quem consulta) num período
 * [de, ate] pelo horário de entrada. Devolve acessos, falhas e o resumo por
 * pessoa. Busca por nome/telefone/chamado/IP é feita aqui para o resumo
 * refletir o filtro.
 */
function listarHistorico(empresaId, { de, ate, origem = null, busca = null } = {}, agoraMs = Date.now()) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const { deIso, ateIso } = _periodo(de, ate);
  const db = getDB();
  const filtroOrigem = origem === 'chat' || origem === 'interno' ? origem : null;

  const linhas = db.prepare(`
    SELECT h.*, s.expira_em AS sessao_expira_em
      FROM svc_acessos_historico h
      LEFT JOIN svc_sessoes_externas s ON h.origem = 'chat' AND s.id = h.sessao_ref
     WHERE h.empresa_id = ? AND h.entrou_em >= ? AND h.entrou_em <= ?
       ${filtroOrigem ? 'AND h.origem = ?' : ''}
     ORDER BY h.entrou_em DESC
     LIMIT ${MAX_LINHAS_LISTA + 1}
  `).all(...[Number(empresaId), deIso, ateIso, filtroOrigem].filter(v => v !== null));

  const termo = _curto(busca, 80)?.toLowerCase() || null;
  const termoDigitos = termo ? termo.replace(/\D/g, '') : '';
  const casa = (...campos) => !termo || campos.some(c => {
    const txt = String(c || '').toLowerCase();
    return txt.includes(termo) || (termoDigitos.length >= 3 && txt.replace(/\D/g, '').includes(termoDigitos));
  });

  const truncado = linhas.length > MAX_LINHAS_LISTA;
  const acessos = linhas.slice(0, MAX_LINHAS_LISTA)
    .filter(r => casa(r.nome, r.telefone, r.chamados, r.ip, r.ip_encaminhado))
    .map(r => {
      const fim = r.encerrado_em || r.ultimo_sinal_em || r.entrou_em;
      const situacao = _situacao(r, r.sessao_expira_em, agoraMs);
      return {
        id: r.id,
        pessoaRef: r.origem === 'chat' ? `chat:${r.consultor_id}` : `interno:${r.usuario_id_iahub || r.id}`,
        origem: r.origem,
        nome: r.nome || (r.origem === 'chat' ? 'Consultor sem nome' : 'Usuário IAHub'),
        telefone: r.telefone,
        entrouEm: r.entrou_em,
        ultimoSinalEm: r.ultimo_sinal_em,
        encerradoEm: r.encerrado_em,
        duracaoSegundos: Math.max(0, Math.round((new Date(fim).getTime() - new Date(r.entrou_em).getTime()) / 1000)),
        segundosAtivos: r.segundos_ativos || 0,
        telasVisitadas: r.telas_visitadas || 0,
        chamados: r.chamados ? r.chamados.split(',') : [],
        situacao: situacao.codigo,
        situacaoRotulo: situacao.rotulo,
        ip: r.ip_encaminhado || r.ip,
        ipServidor: r.ip,
        navegador: r.navegador,
      };
    });

  const falhas = (filtroOrigem === 'interno' ? [] : db.prepare(`
    SELECT * FROM svc_acessos_falhas WHERE empresa_id = ? AND criado_em >= ? AND criado_em <= ?
     ORDER BY criado_em DESC LIMIT ${MAX_LINHAS_LISTA}
  `).all(Number(empresaId), deIso, ateIso))
    .filter(f => casa(f.telefone, f.ip, f.ip_encaminhado, f.motivo))
    .map(f => ({ id: f.id, em: f.criado_em, telefone: f.telefone, etapa: f.etapa, motivo: f.motivo, ip: f.ip_encaminhado || f.ip, navegador: f.navegador }));

  const porPessoa = new Map();
  for (const a of acessos) {
    let p = porPessoa.get(a.pessoaRef);
    if (!p) {
      p = { pessoaRef: a.pessoaRef, nome: a.nome, telefone: a.telefone, origens: new Set(), acessos: 0, dias: new Set(), segundosAtivos: 0, primeiroAcessoEm: a.entrouEm, ultimoAcessoEm: a.entrouEm };
      porPessoa.set(a.pessoaRef, p);
    }
    p.origens.add(a.origem);
    p.acessos += 1;
    p.dias.add(a.entrouEm.slice(0, 10));
    p.segundosAtivos += a.segundosAtivos;
    if (a.entrouEm < p.primeiroAcessoEm) p.primeiroAcessoEm = a.entrouEm;
    if (a.entrouEm > p.ultimoAcessoEm) p.ultimoAcessoEm = a.entrouEm;
  }
  const resumoPorUsuario = [...porPessoa.values()]
    .map(p => ({ ...p, origens: [...p.origens], dias: p.dias.size }))
    .sort((a, b) => b.segundosAtivos - a.segundosAtivos);

  return {
    geradoEm: new Date(agoraMs).toISOString(),
    periodo: { de: deIso, ate: ateIso },
    truncado,
    totais: {
      acessos: acessos.length,
      usuarios: resumoPorUsuario.length,
      segundosAtivos: acessos.reduce((s, a) => s + a.segundosAtivos, 0),
      falhas: falhas.length,
    },
    resumoPorUsuario,
    acessos,
    falhas,
  };
}

/**
 * Exclusão por período (única forma de apagar o histórico — decisão do
 * usuário). Apaga acessos pelo horário de entrada e falhas pelo horário da
 * tentativa, só da empresa da sessão. Um login ainda ativo apagado aqui volta
 * a aparecer no próximo sinal da tela (chat: com a hora original do login;
 * interno: a partir daquele sinal), sem o tempo de tela já apagado.
 */
function excluirPeriodo(empresaId, { de, ate }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const { deIso, ateIso } = _periodo(de, ate);
  const db = getDB();
  return db.transaction(() => ({
    acessosRemovidos: db.prepare('DELETE FROM svc_acessos_historico WHERE empresa_id = ? AND entrou_em >= ? AND entrou_em <= ?')
      .run(Number(empresaId), deIso, ateIso).changes,
    falhasRemovidas: db.prepare('DELETE FROM svc_acessos_falhas WHERE empresa_id = ? AND criado_em >= ? AND criado_em <= ?')
      .run(Number(empresaId), deIso, ateIso).changes,
  }))();
}

module.exports = {
  clienteDaRequisicao,
  registrarLoginChat,
  registrarSinal,
  registrarEncerramento,
  registrarFalha,
  listarHistorico,
  excluirPeriodo,
  MOTIVOS,
};
