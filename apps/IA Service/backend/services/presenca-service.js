// Monitor de Acessos (2026-10) — presença por sessão no IA Service.
//
// Duas origens, um só modelo (svc_presenca, migration v47):
//  - 'chat'    → Radar J2A, sempre por sessão externa de telefone
//                (svc_sessoes_externas — inclusive para quem já está logado
//                no IAHub, ver nota em frontend/js/sidebar.js). sessao_ref =
//                svc_sessoes_externas.id.
//  - 'interno' → rotinas do shell do IA Service (cookie do IAHub).
//                sessao_ref = hash do sessionID — nunca o sessionID em
//                claro (vazar o banco não pode virar sequestro de sessão).
//
// A tela manda um sinal a cada ~30s SÓ com a aba visível. "Tempo de tela" é
// a soma dos intervalos entre sinais consecutivos que não passaram de
// JANELA_SINAL_MS — a aba escondida não manda sinal, então não acumula.
//
// Privacidade (decisão do usuário, 2026-10): guarda só tela, ação e o chamado
// aberto. Texto digitado pelo usuário nunca chega aqui. O número do chamado
// é resolvido no servidor pelo id, já filtrado pela empresa da sessão — o
// cliente não consegue "pendurar" um chamado de outra empresa no painel.

const crypto = require('crypto');
const { getDB } = require('../database');
const chamadoRepo = require('../repositories/chamado-repository');
const consultorRepo = require('../repositories/consultor-repository');
const consultorService = require('./consultor-service');
const usuariosDb = require('../../../IAHUB/backend/usuarios/database');
const historico = require('./acesso-historico-service');

const INTERVALO_SINAL_SEGUNDOS = 30;
const JANELA_SINAL_MS = 90 * 1000;          // > 2 sinais perdidos = não conta como tempo ativo
const ONLINE_ATE_MS = 2 * 60 * 1000;
const AUSENTE_ATE_MS = 15 * 60 * 1000;
const INTERNO_VISIVEL_ATE_MS = 8 * 60 * 60 * 1000; // sessão interna não tem expiração em banco
const RETENCAO_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_EVENTOS_POR_SESSAO = 20;
const MAX_TEXTO = 120;

function _texto(valor) {
  const limpo = String(valor ?? '').replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, MAX_TEXTO) : null;
}

function hashSessaoInterna(sessionId) {
  return crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 40);
}

function situacaoPorSinal(ultimoSinalIso, agoraMs = Date.now()) {
  const ms = new Date(ultimoSinalIso).getTime();
  if (!Number.isFinite(ms)) return 'inativo';
  const delta = agoraMs - ms;
  if (delta < ONLINE_ATE_MS) return 'online';
  if (delta < AUSENTE_ATE_MS) return 'ausente';
  return 'inativo';
}

function registrarSinal({ empresaId, origem, sessaoRef, consultorId = null, usuarioIdIahub = null, tela, acao, chamadoId, visivel = true, cliente = null }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (origem !== 'chat' && origem !== 'interno') throw new Error('Origem inválida.');
  if (!sessaoRef) throw new Error('Sessão obrigatória.');

  const db = getDB();
  const agora = new Date();
  const agoraIso = agora.toISOString();

  let chamadoIdValido = null;
  let chamadoNumero = null;
  if (chamadoId) {
    const chamado = chamadoRepo.getChamado(Number(empresaId), String(chamadoId));
    if (chamado) {
      chamadoIdValido = chamado.id;
      chamadoNumero = chamado.numero ? String(chamado.numero) : null;
    }
  }
  const telaLimpa = _texto(tela);
  const acaoLimpa = _texto(acao);

  const atual = db.prepare(`
    SELECT * FROM svc_presenca WHERE empresa_id = ? AND origem = ? AND sessao_ref = ?
  `).get(Number(empresaId), origem, String(sessaoRef));

  // A aba escondida só "existe" (renova último sinal), não acumula tempo nem
  // troca a tela registrada — evita que um sinal de fundo apague o contexto.
  if (!visivel) {
    if (atual) db.prepare('UPDATE svc_presenca SET ultimo_sinal_em = ? WHERE id = ?').run(agoraIso, atual.id);
    historico.registrarSinal({ empresaId, origem, sessaoRef, consultorId, usuarioIdIahub, agoraIso, visivel: false, cliente });
    return { intervaloSegundos: INTERVALO_SINAL_SEGUNDOS };
  }

  let somarHistorico = 0;
  let mudouTela = false;
  const gravar = db.transaction(() => {
    let presencaId;
    let mudouContexto;
    if (!atual) {
      presencaId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO svc_presenca (id, empresa_id, origem, sessao_ref, consultor_id, usuario_id_iahub,
          inicio_em, ultimo_sinal_em, segundos_ativos, tela, acao, chamado_id, chamado_numero)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(presencaId, Number(empresaId), origem, String(sessaoRef), consultorId, usuarioIdIahub,
        agoraIso, agoraIso, telaLimpa, acaoLimpa, chamadoIdValido, chamadoNumero);
      mudouContexto = true;
      mudouTela = true;
    } else {
      presencaId = atual.id;
      const delta = agora.getTime() - new Date(atual.ultimo_sinal_em).getTime();
      const somar = delta > 0 && delta <= JANELA_SINAL_MS ? Math.round(delta / 1000) : 0;
      mudouContexto = atual.tela !== telaLimpa || atual.acao !== acaoLimpa || (atual.chamado_numero || null) !== chamadoNumero;
      mudouTela = atual.tela !== telaLimpa;
      somarHistorico = somar;
      db.prepare(`
        UPDATE svc_presenca
           SET ultimo_sinal_em = ?, segundos_ativos = segundos_ativos + ?, tela = ?, acao = ?,
               chamado_id = ?, chamado_numero = ?, saiu_em = NULL
         WHERE id = ?
      `).run(agoraIso, somar, telaLimpa, acaoLimpa, chamadoIdValido, chamadoNumero, presencaId);
    }

    if (mudouContexto) {
      db.prepare(`
        INSERT INTO svc_presenca_eventos (presenca_id, tela, acao, chamado_numero, criado_em) VALUES (?, ?, ?, ?, ?)
      `).run(presencaId, telaLimpa, acaoLimpa, chamadoNumero, agoraIso);
      db.prepare(`
        DELETE FROM svc_presenca_eventos
         WHERE presenca_id = ?
           AND id NOT IN (SELECT id FROM svc_presenca_eventos WHERE presenca_id = ? ORDER BY id DESC LIMIT ?)
      `).run(presencaId, presencaId, MAX_EVENTOS_POR_SESSAO);
    }
  });
  gravar();
  // Fora da transação da presença: falha no histórico nunca desfaz o sinal.
  historico.registrarSinal({ empresaId, origem, sessaoRef, consultorId, usuarioIdIahub, agoraIso, segundos: somarHistorico, mudouTela, chamadoNumero, cliente });

  return { intervaloSegundos: INTERVALO_SINAL_SEGUNDOS };
}

// A tela avisa que foi fechada (pagehide). Não apaga nada: a sessão de
// login continua válida (pode voltar sem novo código), só deixa de contar
// como "na tela". Um sinal visível depois disso limpa saiu_em.
function registrarSaida({ empresaId, origem, sessaoRef }) {
  if (!empresaId || !sessaoRef) return { ok: false };
  const db = getDB();
  const agoraIso = new Date().toISOString();
  const atual = db.prepare('SELECT id FROM svc_presenca WHERE empresa_id = ? AND origem = ? AND sessao_ref = ?')
    .get(Number(empresaId), origem, String(sessaoRef));
  if (!atual) return { ok: true };
  db.transaction(() => {
    db.prepare('UPDATE svc_presenca SET saiu_em = ? WHERE id = ?').run(agoraIso, atual.id);
    db.prepare('INSERT INTO svc_presenca_eventos (presenca_id, tela, acao, chamado_numero, criado_em) VALUES (?, ?, ?, NULL, ?)')
      .run(atual.id, 'Fora da tela', 'Fechou a tela', agoraIso);
  })();
  return { ok: true };
}

// "Sair" do J2A: encerra a sessão de login de verdade (antes o botão só
// apagava o token do navegador e a sessão seguia válida por até 8h no
// servidor — achado na homologação do Monitor, 2026-10). Expira em vez de
// apagar, mesmo critério de limparMonitor: a linha fica para auditoria.
function encerrarSessaoChat(empresaId, sessaoId, { motivo = 'sair', usuarioId = null } = {}) {
  if (!empresaId || !sessaoId) return { ok: false };
  const db = getDB();
  db.transaction(() => {
    db.prepare('UPDATE svc_sessoes_externas SET expira_em = ? WHERE id = ? AND empresa_id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), String(sessaoId), Number(empresaId));
    db.prepare("DELETE FROM svc_presenca WHERE empresa_id = ? AND origem = 'chat' AND sessao_ref = ?")
      .run(Number(empresaId), String(sessaoId));
  })();
  historico.registrarEncerramento({ empresaId, origem: 'chat', sessaoRefs: [sessaoId], motivo, usuarioId });
  return { ok: true };
}

// "Derrubar" do Monitor: encerra TODAS as sessões válidas do chat J2A de um
// analista (a pessoa pode estar em mais de uma aba/aparelho). Devolve os ids
// das sessões encerradas para o tempo real derrubar os sockets na hora.
// A pessoa pode entrar de novo com um novo código (decisão do usuário: só
// derrubar, sem bloquear — para bloquear, desativar na Platform).
function derrubarPessoaChat(empresaId, consultorId, usuarioId = null) {
  if (!empresaId || !consultorId) throw Object.assign(new Error('Analista obrigatório.'), { status: 400 });
  const db = getDB();
  const agora = Date.now();
  const sessoes = db.prepare('SELECT id FROM svc_sessoes_externas WHERE empresa_id = ? AND consultor_id = ? AND expira_em > ?')
    .all(Number(empresaId), String(consultorId), new Date(agora).toISOString()).map(r => r.id);
  if (!sessoes.length) return { sessaoIds: [] };
  db.transaction(() => sessoes.forEach((id) => encerrarSessaoChat(empresaId, id, { motivo: 'derrubado', usuarioId })))();
  return { sessaoIds: sessoes };
}

// ── Desconectar (2026-10-28) ────────────────────────────────────────────────
// Sessão interna desconectada "só do IA Service": o IAHub não tem como tirar
// UM sistema de uma sessão (no MDI as telas mandam empresa_id e o
// requireSystemAccess ignora system_code), então a marca fica aqui, pelo hash
// do sessionID. Toda chamada a /api/ia-service dessa sessão recebe 403 até o
// sinal de presença do shell ler a marca — o shell então volta para a tela
// inicial do IAHub e a marca é consumida (pode entrar de novo, igual ao chat:
// derrubar não é bloquear). Em memória: produção roda 1 processo; um restart
// antes do próximo sinal perde a marca (a pessoa segue no IA Service).
// "Do IAHub inteiro" apaga o arquivo da sessão (login some em todo o IAHub).
const DESCONECTADO_VALIDO_MS = 8 * 60 * 60 * 1000; // vida máxima da sessão do IAHub
const _desconectados = new Map(); // hash do sessionID -> { escopo, ate }

function desconexaoPendente(sessionId) {
  if (!sessionId) return null;
  const hash = hashSessaoInterna(sessionId);
  const marca = _desconectados.get(hash);
  if (!marca) return null;
  if (marca.ate < Date.now()) { _desconectados.delete(hash); return null; }
  return marca.escopo;
}

function consumirDesconexao(sessionId) {
  if (sessionId) _desconectados.delete(hashSessaoInterna(sessionId));
}

// Apaga do disco a(s) sessão(ões) do IAHub cujo hash está em `hashes`. O
// arquivo tem o nome do sessionID (FileSessionStore). Devolve quantas apagou.
function _apagarSessoesIahub(hashes) {
  if (!hashes.size) return 0;
  const fs = require('fs');
  const path = require('path');
  const dir = require('../../../IAHUB/backend/data-paths').appDataDir('sessions');
  let n = 0;
  let arquivos = [];
  try { arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (_) { return 0; }
  for (const f of arquivos) {
    if (!hashes.has(hashSessaoInterna(f.slice(0, -5)))) continue;
    try { fs.unlinkSync(path.join(dir, f)); n += 1; } catch (_) {}
  }
  return n;
}

/**
 * Desconecta sessões INTERNAS da empresa. `presencaIds` limita a uma pessoa
 * (ids de svc_presenca); sem ele, todas as internas visíveis no painel.
 * `excetoSessionId` = sessão de quem está desconectando (nunca derruba a si
 * mesmo). escopo: 'ia-service' | 'iahub'.
 */
function desconectarInternos(empresaId, { presencaIds = null, escopo = 'ia-service', excetoSessionId = null, usuarioId = null, agoraMs = Date.now() } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (escopo !== 'ia-service' && escopo !== 'iahub') throw Object.assign(new Error('Escopo inválido.'), { status: 400 });
  const db = getDB();
  const exceto = excetoSessionId ? hashSessaoInterna(excetoSessionId) : null;
  let linhas = db.prepare(`
    SELECT id, sessao_ref FROM svc_presenca WHERE empresa_id = ? AND origem = 'interno' AND ultimo_sinal_em > ?
  `).all(Number(empresaId), new Date(agoraMs - INTERNO_VISIVEL_ATE_MS).toISOString());
  if (Array.isArray(presencaIds)) {
    const ids = new Set(presencaIds.map(Number));
    linhas = linhas.filter(l => ids.has(Number(l.id)));
  }
  const alvo = linhas.filter(l => l.sessao_ref !== exceto);
  const ignorouPropria = alvo.length < linhas.length;
  if (!alvo.length) return { sessoesDesconectadas: 0, ignorouPropria };

  const hashes = new Set(alvo.map(l => l.sessao_ref));
  for (const h of hashes) _desconectados.set(h, { escopo, ate: agoraMs + DESCONECTADO_VALIDO_MS });
  if (escopo === 'iahub') _apagarSessoesIahub(hashes);

  db.transaction(() => {
    for (const l of alvo) {
      db.prepare('DELETE FROM svc_presenca_eventos WHERE presenca_id = ?').run(l.id);
      db.prepare('DELETE FROM svc_presenca WHERE id = ?').run(l.id);
    }
  })();
  historico.registrarEncerramento({
    empresaId, origem: 'interno', sessaoRefs: [...hashes],
    motivo: escopo === 'iahub' ? 'desconectado_iahub' : 'desconectado', usuarioId,
  });
  return { sessoesDesconectadas: hashes.size, ignorouPropria };
}

// Todos os logins válidos do chat J2A da empresa (mesmo efeito do derrubar
// por pessoa, para todo mundo). Devolve os ids para o tempo real.
function desconectarChatTodos(empresaId, usuarioId = null) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const sessoes = db.prepare('SELECT id FROM svc_sessoes_externas WHERE empresa_id = ? AND expira_em > ?')
    .all(Number(empresaId), new Date().toISOString()).map(r => r.id);
  if (sessoes.length) {
    db.transaction(() => sessoes.forEach((id) => encerrarSessaoChat(empresaId, id, { motivo: 'derrubado', usuarioId })))();
  }
  return { sessaoIds: sessoes };
}

function registrarAuditoria({ empresaId, acao, alvo = null, usuarioId = null, motivo = null, detalhe = null }) {
  getDB().prepare(`
    INSERT INTO svc_monitor_auditoria (id, empresa_id, acao, alvo, usuario_id, motivo, detalhe, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), Number(empresaId), String(acao), alvo, usuarioId, _texto(motivo), detalhe ? JSON.stringify(detalhe) : null, new Date().toISOString());
}

function _saiuDaTela(p) {
  return !!(p.saiu_em && p.ultimo_sinal_em && p.saiu_em >= p.ultimo_sinal_em);
}

function _limparAntigos(db, agoraMs) {
  db.prepare('DELETE FROM svc_presenca WHERE ultimo_sinal_em < ?')
    .run(new Date(agoraMs - RETENCAO_MS).toISOString());
}

function _eventos(db, presencaId) {
  if (!presencaId) return [];
  return db.prepare(`
    SELECT tela, acao, chamado_numero, criado_em FROM svc_presenca_eventos
     WHERE presenca_id = ? ORDER BY id DESC LIMIT 6
  `).all(presencaId).map(e => ({ tela: e.tela, acao: e.acao, chamadoNumero: e.chamado_numero, em: e.criado_em }));
}

/**
 * Lista do painel, sempre de UMA empresa (a da sessão de quem consulta).
 * Sessões do chat entram mesmo sem nenhum sinal ainda (ex.: aba aberta antes
 * do deploy desta função) — nesse caso o "último sinal" é o último acesso à
 * API registrado em svc_sessoes_externas.
 */
function listarMonitor(empresaId, agoraMs = Date.now()) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  _limparAntigos(db, agoraMs);
  const agoraIso = new Date(agoraMs).toISOString();
  const lista = [];

  const sessoesChat = db.prepare(`
    SELECT s.id AS sessao_id, s.consultor_id, s.criado_em, s.ultimo_acesso_em, s.expira_em,
           p.id AS presenca_id, p.ultimo_sinal_em, p.saiu_em, p.segundos_ativos, p.tela, p.acao, p.chamado_id, p.chamado_numero
      FROM svc_sessoes_externas s
      LEFT JOIN svc_presenca p ON p.empresa_id = s.empresa_id AND p.origem = 'chat' AND p.sessao_ref = s.id
     WHERE s.empresa_id = ? AND s.expira_em > ?
  `).all(Number(empresaId), agoraIso);

  for (const s of sessoesChat) {
    const consultor = consultorRepo.getConsultor(Number(empresaId), s.consultor_id);
    const ultimoSinal = s.ultimo_sinal_em || s.ultimo_acesso_em;
    const saiu = _saiuDaTela(s);
    lista.push({
      id: `chat:${s.sessao_id}`,
      pessoaRef: `chat:${s.consultor_id}`,
      origem: 'chat',
      nome: consultorService.getNomeExibicao(Number(empresaId), s.consultor_id) || 'Consultor sem nome',
      telefone: consultor?.telefone || null,
      inicioEm: s.criado_em,
      ultimoSinalEm: ultimoSinal,
      expiraEm: s.expira_em,
      situacao: saiu ? 'inativo' : situacaoPorSinal(ultimoSinal, agoraMs),
      segundosAtivos: s.segundos_ativos || 0,
      tela: saiu ? 'Fora da tela' : (s.tela || 'Radar J2A'),
      acao: saiu ? 'Fechou a tela (login ainda válido)' : (s.acao || (s.presenca_id ? null : 'Aguardando o primeiro sinal da tela')),
      chamadoId: s.chamado_id || null,
      chamadoNumero: s.chamado_numero || null,
      eventos: _eventos(db, s.presenca_id),
    });
  }

  const internos = db.prepare(`
    SELECT * FROM svc_presenca WHERE empresa_id = ? AND origem = 'interno' AND ultimo_sinal_em > ?
  `).all(Number(empresaId), new Date(agoraMs - INTERNO_VISIVEL_ATE_MS).toISOString());

  for (const p of internos) {
    const usuario = p.usuario_id_iahub ? usuariosDb.buscarPorId(p.usuario_id_iahub) : null;
    const consultor = p.usuario_id_iahub ? consultorRepo.getConsultorPorUsuario(Number(empresaId), p.usuario_id_iahub) : null;
    lista.push({
      id: `interno:${p.id}`,
      pessoaRef: p.usuario_id_iahub ? `interno:${p.usuario_id_iahub}` : `interno:${p.id}`,
      origem: 'interno',
      nome: usuario?.nome || usuario?.usuario || 'Usuário IAHub',
      telefone: consultor?.telefone || null,
      inicioEm: p.inicio_em,
      ultimoSinalEm: p.ultimo_sinal_em,
      expiraEm: null,
      situacao: _saiuDaTela(p) ? 'inativo' : situacaoPorSinal(p.ultimo_sinal_em, agoraMs),
      segundosAtivos: p.segundos_ativos || 0,
      tela: _saiuDaTela(p) ? 'Fora da tela' : p.tela,
      acao: _saiuDaTela(p) ? 'Fechou a tela' : p.acao,
      chamadoId: p.chamado_id || null,
      chamadoNumero: p.chamado_numero || null,
      eventos: _eventos(db, p.id),
    });
  }

  lista.sort((a, b) => String(b.ultimoSinalEm || '').localeCompare(String(a.ultimoSinalEm || '')));

  const resumo = { online: 0, ausente: 0, inativo: 0, segundosAtivos: 0, total: lista.length };
  for (const item of lista) {
    resumo[item.situacao] += 1;
    resumo.segundosAtivos += item.segundosAtivos;
  }
  return { geradoEm: agoraIso, intervaloSinalSegundos: INTERVALO_SINAL_SEGUNDOS, resumo, sessoes: lista };
}

/**
 * "Limpar" do painel (decisão do usuário, 2026-10): zera a presença da
 * empresa (tempos de tela e trilha de telas) e ENCERRA todos os logins do
 * chat J2A da empresa, inclusive de quem está online — todos precisam entrar
 * de novo com o código. A sessão é expirada (expira_em no passado), não
 * apagada: validarSessaoExterna já rejeita sessão vencida, e a linha de
 * auditoria continua no banco. Rotinas internas (cookie do IAHub) não são
 * deslogadas; voltam a aparecer no próximo sinal.
 */
function limparMonitor(empresaId, agoraMs = Date.now(), usuarioId = null) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const expirarEm = new Date(agoraMs - 1000).toISOString();
  const ativas = db.prepare('SELECT id FROM svc_sessoes_externas WHERE empresa_id = ? AND expira_em > ?')
    .all(Number(empresaId), new Date(agoraMs).toISOString()).map(r => r.id);
  const resultado = db.transaction(() => {
    const eventos = db.prepare('DELETE FROM svc_presenca_eventos WHERE presenca_id IN (SELECT id FROM svc_presenca WHERE empresa_id = ?)')
      .run(Number(empresaId)).changes;
    const presencas = db.prepare('DELETE FROM svc_presenca WHERE empresa_id = ?').run(Number(empresaId)).changes;
    const sessoesEncerradas = db.prepare('UPDATE svc_sessoes_externas SET expira_em = ? WHERE empresa_id = ? AND expira_em > ?')
      .run(expirarEm, Number(empresaId), new Date(agoraMs).toISOString()).changes;
    return { presencasRemovidas: presencas, eventosRemovidos: eventos, sessoesEncerradas };
  })();
  historico.registrarEncerramento({ empresaId, origem: 'chat', sessaoRefs: ativas, motivo: 'limpar', usuarioId });
  return resultado;
}

/**
 * Resumo somente leitura de um chamado para o painel (nunca abre
 * atendimento nem dispara análise — diferente do POST abrir-atendimento
 * usado pelo J2A).
 */
function resumoChamado(empresaId, chamadoId) {
  const chamado = chamadoRepo.getChamado(Number(empresaId), String(chamadoId));
  if (!chamado) return null;
  const cliente = chamado.clienteId
    ? getDB().prepare('SELECT nome, nome_fantasia FROM clientes WHERE id = ? AND empresa_id = ?').get(chamado.clienteId, Number(empresaId))
    : null;
  const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(Number(empresaId), chamado.id)
    .slice(-5).reverse()
    .map(p => ({ em: p.dataPosicionamento, tecnico: p.tecnicoNomeOrigem, situacao: p.situacao, assunto: p.assunto, situacaoRetorno: p.situacaoRetorno }));
  return {
    id: chamado.id,
    numero: chamado.numero,
    titulo: chamado.titulo || chamado.assunto || chamado.breveDescricao,
    cliente: cliente?.nome_fantasia || cliente?.nome || null,
    modulo: chamado.modulo,
    produto: chamado.produto,
    abertoEm: chamado.dataAbertura,
    status: chamado.statusEncerramento,
    aguardando: chamado.aguardandoConsolidado,
    slaStatus: chamado.slaStatusFinal || chamado.slaStatus,
    slaPrazo: chamado.slaPrazo || chamado.slaDataPrevFim,
    posicionamentos,
  };
}

module.exports = {
  registrarSinal,
  registrarSaida,
  encerrarSessaoChat,
  derrubarPessoaChat,
  desconectarInternos,
  desconectarChatTodos,
  desconexaoPendente,
  consumirDesconexao,
  registrarAuditoria,
  listarMonitor,
  limparMonitor,
  resumoChamado,
  situacaoPorSinal,
  hashSessaoInterna,
  INTERVALO_SINAL_SEGUNDOS,
  JANELA_SINAL_MS,
};
