// Chat interno (2026-10, modelo WhatsApp) entre analistas logados no chat
// J2A (sessão externa por telefone). Ver migration v49.
//
// Regras:
//  - Participante = consultores.id; tudo sempre dentro de UMA empresa (a da
//    sessão). Nunca aceita destinatário de outra empresa ou inativo.
//  - Conversa direta 1 a 1, criada sob demanda (chave = ids ordenados).
//  - "Enviar para todos com chamados em andamento" (decisão do usuário:
//    liberado para qualquer analista) = uma mensagem em cada conversa direta,
//    como lista de transmissão do WhatsApp; respostas voltam na conversa 1 a 1.
//    Limite anti-disparo: 1 transmissão por remetente a cada 60s.
//  - Recibos por destinatário: entregue (chegou no aparelho) e visto
//    (abriu a conversa) — os ✓ / ✓✓ / ✓✓ azul.
//  - "Chamados em andamento" usa o mesmo critério da grade do Radar
//    (chamado não encerrado) e o mesmo vínculo técnico → consultor
//    (tecnicos.id_origem = consultores.id_softexpert).
//  - O servidor nunca confia em nomes/contagens vindos do navegador.

const crypto = require('crypto');
const { getDB } = require('../database');
const consultorService = require('./consultor-service');
const consultorRepo = require('../repositories/consultor-repository');
const platformStore = require('../../../IAHUB/backend/platform-store');
const cryptoEnvelope = require('./crypto-envelope');

// ── Texto cifrado em repouso (AES-256-GCM) ─────────────────────────────
// Mesma chave-mestra de instalação já exigida pelo deploy (SVC_DATA_CRYPTO_KEY,
// ver deploy/INSTRUCOES.md) — nenhuma chave nova para gerenciar. Sem chave
// válida, grava em claro como antes e avisa no log (nunca derruba o chat).
// Texto cifrado leva o prefixo abaixo; texto sem prefixo (mensagens antigas)
// continua sendo lido normalmente.
const PREFIXO_CIFRA = 'svcchat:v1:';
let _avisouSemChave = false;
function _chaveChat() {
  const bruta = process.env.SVC_DATA_CRYPTO_KEY;
  try {
    if (bruta) return cryptoEnvelope.normalizeKey(bruta) && bruta;
  } catch (_) { /* chave em formato inválido: trata como ausente */ }
  if (!_avisouSemChave) {
    _avisouSemChave = true;
    console.warn('[IA Service] Chat interno gravando mensagens SEM criptografia: SVC_DATA_CRYPTO_KEY ausente ou inválida.');
  }
  return null;
}
function _cifrar(texto) {
  const chave = _chaveChat();
  if (!chave) return texto;
  const envelope = cryptoEnvelope.encryptPayload({ t: texto }, chave, { kid: 'chat-interno' });
  return PREFIXO_CIFRA + Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}
function _decifrar(valor) {
  const s = String(valor ?? '');
  if (!s.startsWith(PREFIXO_CIFRA)) return s;
  try {
    const envelope = JSON.parse(Buffer.from(s.slice(PREFIXO_CIFRA.length), 'base64').toString('utf8'));
    return cryptoEnvelope.decryptPayload(envelope, process.env.SVC_DATA_CRYPTO_KEY).t;
  } catch (_) {
    return '[mensagem protegida — não foi possível abrir com a chave atual]';
  }
}

const MAX_TEXTO = 1000;
const INTERVALO_TRANSMISSAO_MS = 60 * 1000;
const ONLINE_ATE_MS = 2 * 60 * 1000;
const PAGINA_MENSAGENS = 60;

function _erro(msg, status) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function _textoValido(texto) {
  const limpo = String(texto ?? '').replace(/\r\n/g, '\n').trim();
  if (!limpo) throw _erro('A mensagem está vazia.', 400);
  if (limpo.length > MAX_TEXTO) throw _erro(`A mensagem passa do limite de ${MAX_TEXTO} caracteres.`, 400);
  return limpo;
}

function _consultorAtivo(db, empresaId, consultorId) {
  return db.prepare('SELECT id, telefone FROM consultores WHERE id = ? AND empresa_id = ? AND ativo = 1')
    .get(String(consultorId), Number(empresaId));
}

function _chave(a, b) {
  return [String(a), String(b)].sort().join('|');
}

function _chamadosPorConsultor(db, empresaId) {
  const rows = db.prepare(`
    SELECT co.id AS consultor_id, COUNT(c.id) AS total
      FROM chamados c
      JOIN tecnicos t ON t.id = c.tecnico_responsavel_id AND t.empresa_id = c.empresa_id
      JOIN consultores co ON co.empresa_id = c.empresa_id AND co.id_softexpert = t.id_origem AND co.ativo = 1
     WHERE c.empresa_id = ?
       AND (c.status_encerramento IS NULL OR c.status_encerramento != 'Encerrado')
     GROUP BY co.id
  `).all(Number(empresaId));
  return new Map(rows.map(r => [r.consultor_id, r.total]));
}

function _onlinePorConsultor(db, empresaId) {
  const agoraMs = Date.now();
  const rows = db.prepare(`
    SELECT s.consultor_id, MAX(p.ultimo_sinal_em) AS ultimo_sinal, MAX(CASE WHEN p.saiu_em IS NULL OR p.saiu_em < p.ultimo_sinal_em THEN 1 ELSE 0 END) AS na_tela
      FROM svc_sessoes_externas s
      JOIN svc_presenca p ON p.empresa_id = s.empresa_id AND p.origem = 'chat' AND p.sessao_ref = s.id
     WHERE s.empresa_id = ? AND s.expira_em > ?
     GROUP BY s.consultor_id
  `).all(Number(empresaId), new Date(agoraMs).toISOString());
  const mapa = new Map();
  for (const r of rows) {
    const online = r.na_tela === 1 && r.ultimo_sinal && agoraMs - new Date(r.ultimo_sinal).getTime() < ONLINE_ATE_MS;
    mapa.set(r.consultor_id, { online: !!online, ultimoSinalEm: r.ultimo_sinal });
  }
  return mapa;
}

function _participa(db, conversaId, empresaId, consultorId) {
  return !!db.prepare('SELECT 1 FROM svc_chat_participantes WHERE conversa_id = ? AND empresa_id = ? AND consultor_id = ?')
    .get(String(conversaId), Number(empresaId), String(consultorId));
}

function _outroParticipante(db, conversaId, eu) {
  return db.prepare('SELECT consultor_id FROM svc_chat_participantes WHERE conversa_id = ? AND consultor_id != ?')
    .get(String(conversaId), String(eu))?.consultor_id || null;
}

function _mensagemParaDominio(row, eu) {
  return {
    id: row.id,
    conversaId: row.conversa_id,
    remetenteId: row.remetente_id,
    minha: row.remetente_id === String(eu),
    texto: _decifrar(row.texto),
    transmissao: !!row.transmissao,
    criadoEm: row.criado_em,
    entregueEm: row.entregue_em || null,
    vistoEm: row.visto_em || null,
  };
}

// Analistas com chamados em andamento (mesma base da grade do Radar), por
// técnico do SoftExpert — inclusive quem nunca entrou no J2A.
function _tecnicosComChamados(db, empresaId) {
  return db.prepare(`
    SELECT t.id, t.id_origem, t.nome, COUNT(c.id) AS total
      FROM chamados c
      JOIN tecnicos t ON t.id = c.tecnico_responsavel_id AND t.empresa_id = c.empresa_id
     WHERE c.empresa_id = ?
       AND (c.status_encerramento IS NULL OR c.status_encerramento != 'Encerrado')
     GROUP BY t.id
  `).all(Number(empresaId));
}

// Quem tem chamados e número autorizado na Platform (vínculo IA Service)
// mas ainda não entrou no J2A não tem cadastro de consultor — e sem ele não
// dá para receber mensagem. Cria/atualiza a partir da Platform, exatamente
// como o login por telefone faz (upsertConsultorPlatform). No máximo a cada
// 5 min por empresa; falha aqui nunca derruba a lista.
const _ultimaSincronizacaoAutorizados = new Map();
function _sincronizarAutorizadosComChamados(db, empresaId) {
  const agora = Date.now();
  if (agora - (_ultimaSincronizacaoAutorizados.get(Number(empresaId)) || 0) < 5 * 60 * 1000) return;
  _ultimaSincronizacaoAutorizados.set(Number(empresaId), agora);
  try {
    const comConsultor = new Set(db.prepare('SELECT id_softexpert FROM consultores WHERE empresa_id = ? AND ativo = 1 AND id_softexpert IS NOT NULL')
      .all(Number(empresaId)).map(r => String(r.id_softexpert)));
    const faltando = new Set(_tecnicosComChamados(db, empresaId).map(t => String(t.id_origem)).filter(id => !comConsultor.has(id)));
    if (!faltando.size) return;
    for (const item of platformStore.listarIaServicePorEmpresa(Number(empresaId))) {
      if (!item.idSoftexpert || !faltando.has(String(item.idSoftexpert))) continue;
      consultorRepo.upsertConsultorPlatform(Number(empresaId), {
        platformIdentityId: item.platformIdentityId,
        usuarioIdIahub: item.usuarioIdIahub,
        idSoftexpert: item.idSoftexpert,
        telefone: item.telefone,
        ativo: item.ativo,
        preAnaliseAutomatica: item.preAnaliseAutomatica,
      });
      faltando.delete(String(item.idSoftexpert));
    }
  } catch (err) {
    console.error('[IA Service] Chat interno: falha ao sincronizar autorizados da Platform:', err.message);
  }
}

/**
 * Lista de contatos do analista (modelo WhatsApp):
 *  - TODOS os analistas com chamados em andamento (mesma base do Radar),
 *    online ou offline — offline recebe quando entrar no J2A;
 *  - quem tem chamados mas não tem acesso ao J2A (número não autorizado na
 *    Platform) aparece com semAcesso=true e não pode receber mensagem;
 *  - demais consultores ativos da empresa (sem chamados) também aparecem.
 * Ordem: conversas recentes; quem tem chamados; online; nome. Sem acesso por último.
 */
function listarContatos(empresaId, eu) {
  const db = getDB();
  _sincronizarAutorizadosComChamados(db, empresaId);
  const chamados = _chamadosPorConsultor(db, empresaId);
  const online = _onlinePorConsultor(db, empresaId);
  const consultores = db.prepare('SELECT id, telefone FROM consultores WHERE empresa_id = ? AND ativo = 1 AND id != ?')
    .all(Number(empresaId), String(eu));

  const conversas = db.prepare(`
    SELECT c.id AS conversa_id, c.atualizado_em, p2.consultor_id AS outro,
           (SELECT COUNT(*) FROM svc_chat_mensagens m JOIN svc_chat_recibos r ON r.mensagem_id = m.id
             WHERE m.conversa_id = c.id AND r.destinatario_id = ? AND r.visto_em IS NULL) AS nao_lidas
      FROM svc_chat_conversas c
      JOIN svc_chat_participantes p1 ON p1.conversa_id = c.id AND p1.consultor_id = ?
      JOIN svc_chat_participantes p2 ON p2.conversa_id = c.id AND p2.consultor_id != ?
     WHERE c.empresa_id = ?
  `).all(String(eu), String(eu), String(eu), Number(empresaId));
  const conversaPorOutro = new Map(conversas.map(c => [c.outro, c]));
  const ultimaMsg = db.prepare('SELECT * FROM svc_chat_mensagens WHERE conversa_id = ? ORDER BY criado_em DESC, rowid DESC LIMIT 1');

  const contatos = consultores.map((c) => {
    const conv = conversaPorOutro.get(c.id);
    const ultima = conv ? ultimaMsg.get(conv.conversa_id) : null;
    return {
      consultorId: c.id,
      nome: consultorService.getNomeExibicao(Number(empresaId), c.id) || 'Analista sem nome',
      online: online.get(c.id)?.online || false,
      ultimoSinalEm: online.get(c.id)?.ultimoSinalEm || null,
      chamadosEmAndamento: chamados.get(c.id) || 0,
      conversaId: conv?.conversa_id || null,
      naoLidas: conv?.nao_lidas || 0,
      ultimaMensagem: ultima ? { texto: _decifrar(ultima.texto).slice(0, 140), em: ultima.criado_em, minha: ultima.remetente_id === String(eu) } : null,
    };
  });

  // Técnicos com chamados sem consultor ativo (nunca autorizados no J2A):
  // aparecem para a equipe saber que existem, mas não recebem mensagem.
  const meuIdSoftexpert = db.prepare('SELECT id_softexpert FROM consultores WHERE id = ? AND empresa_id = ?').get(String(eu), Number(empresaId))?.id_softexpert;
  const ativosPorSoftexpert = new Set(db.prepare('SELECT id_softexpert FROM consultores WHERE empresa_id = ? AND ativo = 1 AND id_softexpert IS NOT NULL')
    .all(Number(empresaId)).map(r => String(r.id_softexpert)));
  for (const t of _tecnicosComChamados(db, empresaId)) {
    if (ativosPorSoftexpert.has(String(t.id_origem)) || String(t.id_origem) === String(meuIdSoftexpert || '')) continue;
    contatos.push({
      consultorId: null,
      tecnicoId: t.id,
      nome: t.nome || 'Analista sem nome',
      semAcesso: true,
      online: false,
      ultimoSinalEm: null,
      chamadosEmAndamento: t.total,
      conversaId: null,
      naoLidas: 0,
      ultimaMensagem: null,
    });
  }

  contatos.sort((a, b) => {
    if (!!a.semAcesso !== !!b.semAcesso) return a.semAcesso ? 1 : -1;
    const ea = a.ultimaMensagem?.em || '';
    const eb = b.ultimaMensagem?.em || '';
    if (ea !== eb) return eb.localeCompare(ea);
    if ((b.chamadosEmAndamento > 0) !== (a.chamadosEmAndamento > 0)) return b.chamadosEmAndamento > 0 ? 1 : -1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  const naoLidasTotal = contatos.reduce((s, c) => s + c.naoLidas, 0);
  const comChamados = contatos.filter(c => c.chamadosEmAndamento > 0 && !c.semAcesso).length;
  return { contatos, naoLidasTotal, destinatariosTransmissao: comChamados };
}

function abrirConversaDireta(empresaId, eu, outroId) {
  const db = getDB();
  if (String(eu) === String(outroId)) throw _erro('Não é possível conversar consigo mesmo.', 400);
  if (!_consultorAtivo(db, empresaId, eu)) throw _erro('Sessão sem consultor ativo.', 403);
  if (!_consultorAtivo(db, empresaId, outroId)) throw _erro('Analista não encontrado nesta empresa.', 404);

  const chave = _chave(eu, outroId);
  const existente = db.prepare('SELECT id FROM svc_chat_conversas WHERE empresa_id = ? AND chave_direta = ?').get(Number(empresaId), chave);
  if (existente) return existente.id;

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO svc_chat_conversas (id, empresa_id, chave_direta, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
      .run(id, Number(empresaId), chave, agora, agora);
    const ins = db.prepare('INSERT INTO svc_chat_participantes (conversa_id, empresa_id, consultor_id) VALUES (?, ?, ?)');
    ins.run(id, Number(empresaId), String(eu));
    ins.run(id, Number(empresaId), String(outroId));
  })();
  return id;
}

function listarMensagens(empresaId, eu, conversaId, { antesDe = null } = {}) {
  const db = getDB();
  if (!_participa(db, conversaId, empresaId, eu)) throw _erro('Conversa não encontrada.', 404);
  const params = [String(conversaId)];
  let filtro = '';
  if (antesDe) { filtro = 'AND m.criado_em < ?'; params.push(String(antesDe)); }
  const rows = db.prepare(`
    SELECT m.*, r.entregue_em, r.visto_em
      FROM svc_chat_mensagens m
      LEFT JOIN svc_chat_recibos r ON r.mensagem_id = m.id AND r.destinatario_id != m.remetente_id
     WHERE m.conversa_id = ? ${filtro}
     ORDER BY m.criado_em DESC, m.rowid DESC
     LIMIT ${PAGINA_MENSAGENS}
  `).all(...params);
  const outro = _outroParticipante(db, conversaId, eu);
  return {
    conversaId: String(conversaId),
    contato: outro ? { consultorId: outro, nome: consultorService.getNomeExibicao(Number(empresaId), outro) || 'Analista sem nome' } : null,
    mensagens: rows.reverse().map(r => _mensagemParaDominio(r, eu)),
    temMais: rows.length === PAGINA_MENSAGENS,
  };
}

function _inserirMensagem(db, empresaId, conversaId, eu, texto, transmissao) {
  const destinatario = _outroParticipante(db, conversaId, eu);
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  db.prepare('INSERT INTO svc_chat_mensagens (id, conversa_id, empresa_id, remetente_id, texto, transmissao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, String(conversaId), Number(empresaId), String(eu), _cifrar(texto), transmissao ? 1 : 0, agora);
  if (destinatario) {
    db.prepare('INSERT INTO svc_chat_recibos (mensagem_id, destinatario_id) VALUES (?, ?)').run(id, destinatario);
  }
  db.prepare('UPDATE svc_chat_conversas SET atualizado_em = ? WHERE id = ?').run(agora, String(conversaId));
  return {
    destinatario,
    mensagem: { id, conversaId: String(conversaId), remetenteId: String(eu), texto, transmissao: !!transmissao, criadoEm: agora, entregueEm: null, vistoEm: null },
  };
}

/** Envia numa conversa existente. Retorna { mensagem, destinatario } para o tempo real. */
function enviarMensagem(empresaId, eu, conversaId, texto) {
  const db = getDB();
  const limpo = _textoValido(texto);
  if (!_participa(db, conversaId, empresaId, eu)) throw _erro('Conversa não encontrada.', 404);
  if (!_consultorAtivo(db, empresaId, eu)) throw _erro('Sessão sem consultor ativo.', 403);
  const destinatario = _outroParticipante(db, conversaId, eu);
  if (destinatario && !_consultorAtivo(db, empresaId, destinatario)) throw _erro('Este analista não está mais ativo.', 409);
  return db.transaction(() => _inserirMensagem(db, empresaId, conversaId, eu, limpo, false))();
}

/**
 * "Enviar para todos com chamados em andamento": uma mensagem em cada
 * conversa direta. Retorna a lista de { mensagem, destinatario }.
 */
function enviarParaTodos(empresaId, eu, texto) {
  const db = getDB();
  const limpo = _textoValido(texto);
  if (!_consultorAtivo(db, empresaId, eu)) throw _erro('Sessão sem consultor ativo.', 403);

  const ultima = db.prepare(`
    SELECT MAX(criado_em) AS em FROM svc_chat_mensagens WHERE empresa_id = ? AND remetente_id = ? AND transmissao = 1
  `).get(Number(empresaId), String(eu))?.em;
  if (ultima && Date.now() - new Date(ultima).getTime() < INTERVALO_TRANSMISSAO_MS) {
    throw _erro('Aguarde 1 minuto entre mensagens para todos.', 429);
  }

  const destinos = [..._chamadosPorConsultor(db, empresaId).keys()].filter(id => id !== String(eu));
  if (!destinos.length) throw _erro('Nenhum analista com chamados em andamento para receber.', 400);

  return db.transaction(() => destinos.map((outro) => {
    const conversaId = abrirConversaDireta(empresaId, eu, outro);
    return _inserirMensagem(db, empresaId, conversaId, eu, limpo, true);
  }))();
}

// Marca como entregue tudo o que estava pendente para mim (ou só os ids
// informados). Retorna, por remetente, o que mudou — para avisar quem enviou.
function marcarEntregues(empresaId, eu, mensagemIds = null) {
  const db = getDB();
  const agora = new Date().toISOString();
  const params = [Number(empresaId), String(eu)];
  let filtro = '';
  if (Array.isArray(mensagemIds)) {
    const ids = mensagemIds.map(String).slice(0, 500);
    if (!ids.length) return [];
    filtro = `AND m.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  const pendentes = db.prepare(`
    SELECT m.id, m.conversa_id, m.remetente_id FROM svc_chat_mensagens m
      JOIN svc_chat_recibos r ON r.mensagem_id = m.id
     WHERE m.empresa_id = ? AND r.destinatario_id = ? AND r.entregue_em IS NULL ${filtro}
  `).all(...params);
  if (!pendentes.length) return [];
  const upd = db.prepare('UPDATE svc_chat_recibos SET entregue_em = ? WHERE mensagem_id = ? AND destinatario_id = ?');
  db.transaction(() => pendentes.forEach(p => upd.run(agora, p.id, String(eu))))();
  return _agruparRecibos(pendentes, 'entregue', agora);
}

function marcarVistas(empresaId, eu, conversaId) {
  const db = getDB();
  if (!_participa(db, conversaId, empresaId, eu)) throw _erro('Conversa não encontrada.', 404);
  const agora = new Date().toISOString();
  const pendentes = db.prepare(`
    SELECT m.id, m.conversa_id, m.remetente_id FROM svc_chat_mensagens m
      JOIN svc_chat_recibos r ON r.mensagem_id = m.id
     WHERE m.conversa_id = ? AND r.destinatario_id = ? AND r.visto_em IS NULL
  `).all(String(conversaId), String(eu));
  if (!pendentes.length) return [];
  const upd = db.prepare('UPDATE svc_chat_recibos SET visto_em = ?, entregue_em = COALESCE(entregue_em, ?) WHERE mensagem_id = ? AND destinatario_id = ?');
  db.transaction(() => pendentes.forEach(p => upd.run(agora, agora, p.id, String(eu))))();
  return _agruparRecibos(pendentes, 'visto', agora);
}

function _agruparRecibos(linhas, tipo, em) {
  const porRemetente = new Map();
  for (const l of linhas) {
    const chave = `${l.remetente_id}|${l.conversa_id}`;
    if (!porRemetente.has(chave)) porRemetente.set(chave, { remetenteId: l.remetente_id, conversaId: l.conversa_id, tipo, em, mensagemIds: [] });
    porRemetente.get(chave).mensagemIds.push(l.id);
  }
  return [...porRemetente.values()];
}

module.exports = {
  listarContatos,
  abrirConversaDireta,
  listarMensagens,
  enviarMensagem,
  enviarParaTodos,
  marcarEntregues,
  marcarVistas,
  MAX_TEXTO,
};
