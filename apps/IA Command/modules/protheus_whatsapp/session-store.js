// CRUD de sessoes e mensagens do canal Protheus WhatsApp.
//
// O "contexto anterior" usado pelo pipeline de IA (intent-merger) vem daqui —
// le o ultimo intent_json salvo na sessao — em vez de estado em memoria (como
// o canal WhatsApp real usa), porque este canal e stateless por requisicao HTTP.

const crypto = require('crypto');
const { getDB } = require('../database');

const TITULO_MAX_CHARS = 60;
const PAGE_SIZE = 30;

function truncarTitulo(texto) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= TITULO_MAX_CHARS) return limpo;
  return limpo.slice(0, TITULO_MAX_CHARS - 1).trimEnd() + '…';
}

function criarSessao({ empresaId, celular, tituloInicial = null }) {
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  getDB().prepare(`
    INSERT INTO protheus_chat_sessions (id, empresa_id, celular, titulo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, empresaId, celular, tituloInicial ? truncarTitulo(tituloInicial) : null, agora, agora);
  return id;
}

function buscarSessao({ id, empresaId, celular }) {
  return getDB().prepare(`
    SELECT id, empresa_id, celular, titulo, criado_em, atualizado_em
    FROM protheus_chat_sessions
    WHERE id = ? AND empresa_id = ? AND celular = ?
  `).get(id, empresaId, celular) || null;
}

function listarSessoes({ empresaId, celular, limite = 30 }) {
  const sessoes = getDB().prepare(`
    SELECT id, titulo, criado_em, atualizado_em
    FROM protheus_chat_sessions
    WHERE empresa_id = ? AND celular = ?
    ORDER BY atualizado_em DESC
    LIMIT ?
  `).all(empresaId, celular, limite);

  const ultimaMsgStmt = getDB().prepare(`
    SELECT texto, direcao FROM protheus_chat_messages
    WHERE sessao_id = ? ORDER BY criado_em DESC LIMIT 1
  `);

  return sessoes.map(s => {
    const ultima = ultimaMsgStmt.get(s.id);
    return {
      sessaoId: s.id,
      titulo: s.titulo || 'Nova conversa',
      ultimaMensagem: ultima ? ultima.texto : null,
      atualizadoEm: s.atualizado_em,
    };
  });
}

function salvarTurno({ sessaoId, perguntaTexto, respostaTexto, rows = null, tipoResultado = null, intent = null }) {
  const db = getDB();
  const agora = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, rows_json, tipo_resultado, intent_json, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(crypto.randomUUID(), sessaoId, 'out', perguntaTexto, null, null, null, agora);
  insert.run(
    crypto.randomUUID(), sessaoId, 'in', respostaTexto,
    rows ? JSON.stringify(rows) : null,
    tipoResultado,
    intent ? JSON.stringify(intent) : null,
    agora,
  );

  db.prepare(`UPDATE protheus_chat_sessions SET atualizado_em = ? WHERE id = ?`).run(agora, sessaoId);

  const sessaoAtual = db.prepare(`SELECT titulo FROM protheus_chat_sessions WHERE id = ?`).get(sessaoId);
  if (sessaoAtual && !sessaoAtual.titulo) {
    db.prepare(`UPDATE protheus_chat_sessions SET titulo = ? WHERE id = ?`)
      .run(truncarTitulo(perguntaTexto), sessaoId);
  }
}

function listarMensagens({ sessaoId, cursor = null, limite = PAGE_SIZE }) {
  const db = getDB();
  const rows = cursor
    ? db.prepare(`
        SELECT id, direcao, texto, rows_json, tipo_resultado, criado_em
        FROM protheus_chat_messages
        WHERE sessao_id = ? AND criado_em < ?
        ORDER BY criado_em DESC LIMIT ?
      `).all(sessaoId, cursor, limite)
    : db.prepare(`
        SELECT id, direcao, texto, rows_json, tipo_resultado, criado_em
        FROM protheus_chat_messages
        WHERE sessao_id = ?
        ORDER BY criado_em DESC LIMIT ?
      `).all(sessaoId, limite);

  const mensagens = rows.reverse().map(r => ({
    id: r.id,
    direcao: r.direcao,
    texto: r.texto,
    rows: r.rows_json ? JSON.parse(r.rows_json) : null,
    tipo: r.tipo_resultado,
    criadoEm: r.criado_em,
  }));

  return {
    mensagens,
    proximoCursor: rows.length === limite ? rows[rows.length - 1].criado_em : null,
  };
}

function ultimoIntent({ sessaoId }) {
  const row = getDB().prepare(`
    SELECT intent_json FROM protheus_chat_messages
    WHERE sessao_id = ? AND direcao = 'in' AND intent_json IS NOT NULL
    ORDER BY criado_em DESC LIMIT 1
  `).get(sessaoId);
  return row ? JSON.parse(row.intent_json) : null;
}

module.exports = {
  criarSessao,
  buscarSessao,
  listarSessoes,
  salvarTurno,
  listarMensagens,
  ultimoIntent,
};
