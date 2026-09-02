// CRUD de sessoes e mensagens do canal Protheus WhatsApp.
//
// O "contexto anterior" usado pelo pipeline de IA (intent-merger) vem daqui —
// le o ultimo intent_json salvo na sessao — em vez de estado em memoria (como
// o canal WhatsApp real usa), porque este canal e stateless por requisicao HTTP.

const crypto = require('crypto');
const { getDB } = require('../database');
const periodResolver = require('../ai/period-resolver');
const secureFields = require('../security/chat-secure-fields');

const TITULO_MAX_CHARS = 60;
const PAGE_SIZE = 30;
let chatMessagesHasFilialEscopoColumn = null;

function tabelaTemColuna(cTabela, cColuna) {
  try {
    return getDB().prepare(`PRAGMA table_info(${cTabela})`).all()
      .some(col => String(col.name || '').toLowerCase() === String(cColuna || '').toLowerCase());
  } catch (_) {
    return false;
  }
}

function temFilialEscopoChatMessages() {
  if (chatMessagesHasFilialEscopoColumn === null) {
    chatMessagesHasFilialEscopoColumn = tabelaTemColuna('protheus_chat_messages', 'filial_escopo_json');
  }
  return chatMessagesHasFilialEscopoColumn;
}

function parseJsonSeguro(valor) {
  if (!valor) return null;
  const descriptografado = secureFields.decryptJson(valor);
  if (descriptografado && typeof descriptografado === 'object') return descriptografado;
  if (typeof descriptografado !== 'string') return descriptografado || null;
  try {
    return JSON.parse(descriptografado);
  } catch (_) {
    return null;
  }
}

function parseRowsMeta(rowsJson) {
  if (!rowsJson) return { rows: null, temDados: false, rowsCount: 0 };
  const descriptografado = secureFields.decryptJson(rowsJson);
  if (Array.isArray(descriptografado)) {
    return {
      rows: descriptografado,
      temDados: descriptografado.length > 0,
      rowsCount: descriptografado.length,
    };
  }
  try {
    const rows = JSON.parse(descriptografado);
    return {
      rows: Array.isArray(rows) ? rows : null,
      temDados: Array.isArray(rows) && rows.length > 0,
      rowsCount: Array.isArray(rows) ? rows.length : 0,
    };
  } catch (_) {
    return { rows: null, temDados: false, rowsCount: 0 };
  }
}

function truncarTitulo(texto) {
  const limpo = String(secureFields.decryptText(texto || '') || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= TITULO_MAX_CHARS) return limpo;
  return limpo.slice(0, TITULO_MAX_CHARS - 1).trimEnd() + '…';
}

function textoClaro(valor) {
  return String(secureFields.decryptText(valor || '') || '');
}

function jsonParaSalvar(valor) {
  if (valor === null || valor === undefined) return null;
  return secureFields.encryptJson(valor);
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
    SELECT s.id, s.titulo, s.criado_em, s.atualizado_em,
           (
             SELECT m.texto
             FROM protheus_chat_messages m
             WHERE m.sessao_id = s.id
             ORDER BY m.criado_em DESC
             LIMIT 1
           ) AS ultima_mensagem
    FROM protheus_chat_sessions
    s
    WHERE empresa_id = ? AND celular = ?
    ORDER BY atualizado_em DESC
    LIMIT ?
  `).all(empresaId, celular, limite);

  return sessoes.map(s => ({
    sessaoId: s.id,
    titulo: s.titulo || 'Nova conversa',
    ultimaMensagem: s.ultima_mensagem ? textoClaro(s.ultima_mensagem) : null,
    atualizadoEm: s.atualizado_em,
  }));
}

// Retorna os ids das duas mensagens criadas (pergunta 'out' e resposta 'in')
// — usados pelo frontend para referenciar essas mensagens especificas ao
// salvar config de grid ou ao excluir mensagens individuais (selecao
// multipla) sem precisar recarregar o historico da sessao.
function salvarTurno({ sessaoId, perguntaTexto, respostaTexto, rows = null, tipoResultado = null, intent = null, filialEscopo = null }) {
  const db = getDB();
  const agora = new Date().toISOString();
  const perguntaId = crypto.randomUUID();
  const respostaId = crypto.randomUUID();
  let insert;

  if (temFilialEscopoChatMessages()) {
    insert = db.prepare(`
      INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, rows_json, tipo_resultado, intent_json, filial_escopo_json, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(perguntaId, sessaoId, 'out', secureFields.encryptText(perguntaTexto), null, null, null, null, agora);
    insert.run(
      respostaId, sessaoId, 'in', secureFields.encryptText(respostaTexto),
      jsonParaSalvar(rows),
      tipoResultado,
      jsonParaSalvar(intent),
      jsonParaSalvar(filialEscopo),
      agora,
    );
  } else {
    insert = db.prepare(`
      INSERT INTO protheus_chat_messages (id, sessao_id, direcao, texto, rows_json, tipo_resultado, intent_json, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(perguntaId, sessaoId, 'out', secureFields.encryptText(perguntaTexto), null, null, null, agora);
    insert.run(
      respostaId, sessaoId, 'in', secureFields.encryptText(respostaTexto),
      jsonParaSalvar(rows),
      tipoResultado,
      jsonParaSalvar(intent),
      agora,
    );
  }

  db.prepare(`UPDATE protheus_chat_sessions SET atualizado_em = ? WHERE id = ?`).run(agora, sessaoId);

  const sessaoAtual = db.prepare(`SELECT titulo FROM protheus_chat_sessions WHERE id = ?`).get(sessaoId);
  if (sessaoAtual && !sessaoAtual.titulo) {
    db.prepare(`UPDATE protheus_chat_sessions SET titulo = ? WHERE id = ?`)
      .run(truncarTitulo(perguntaTexto), sessaoId);
  }

  return { perguntaId, respostaId };
}

function listarMensagens({ sessaoId, cursor = null, limite = PAGE_SIZE }) {
  const db = getDB();
  const cFilialEscopoCol = temFilialEscopoChatMessages() ? 'filial_escopo_json' : 'NULL AS filial_escopo_json';
  const rows = cursor
    ? db.prepare(`
        SELECT id, direcao, texto, rows_json,
               tipo_resultado, grid_config_json, intent_json, ${cFilialEscopoCol}, criado_em,
               (
                 SELECT f.id
                 FROM protheus_chat_favorites f
                 WHERE f.resposta_mensagem_id = protheus_chat_messages.id
                   AND f.ativo = 1
                 LIMIT 1
               ) AS favorito_id
        FROM protheus_chat_messages
        WHERE sessao_id = ? AND criado_em < ?
        ORDER BY criado_em DESC LIMIT ?
      `).all(sessaoId, cursor, limite)
    : db.prepare(`
        SELECT id, direcao, texto, rows_json,
               tipo_resultado, grid_config_json, intent_json, ${cFilialEscopoCol}, criado_em,
               (
                 SELECT f.id
                 FROM protheus_chat_favorites f
                 WHERE f.resposta_mensagem_id = protheus_chat_messages.id
                   AND f.ativo = 1
                 LIMIT 1
               ) AS favorito_id
        FROM protheus_chat_messages
        WHERE sessao_id = ?
        ORDER BY criado_em DESC LIMIT ?
      `).all(sessaoId, limite);

  const mensagens = rows.reverse().map((r) => {
    const metaRows = parseRowsMeta(r.rows_json);
    return {
      id: r.id,
      direcao: r.direcao,
      texto: textoClaro(r.texto),
      rows: null,
      temDados: metaRows.temDados,
      rowsCount: metaRows.temDados ? metaRows.rowsCount : 0,
      tipo: r.tipo_resultado,
      gridConfig: parseJsonSeguro(r.grid_config_json),
      // intent_json exposto SO para o frontend reidratar o estado visual da
      // arvore de filial ao trocar/reabrir sessao (ver
      // hidratarSelecaoFilialDaSessao em protheus-chat.html) — mesmo dado
      // que o backend ja usa para herdar contexto entre turnos
      // (ultimoIntent), nao e novo dado sensivel, so passa a ser lido tambem
      // no client.
      intent_json: parseJsonSeguro(r.intent_json),
      filial_escopo_json: parseJsonSeguro(r.filial_escopo_json),
      favoritoId: r.favorito_id || null,
      criadoEm: r.criado_em,
    };
  });

  return {
    mensagens,
    proximoCursor: rows.length === limite ? rows[rows.length - 1].criado_em : null,
  };
}

// Ultima mensagem 'in' da sessao que tenha dados tabulares (rows com pelo
// menos 1 linha) — usada para popular a aba Relatorio ao carregar a conversa.
// Pergunta (mensagem 'out') imediatamente anterior a uma mensagem de resposta
// especifica, por ordem cronologica — usada para nomear o arquivo exportado
// (Excel/PDF) com a pergunta REAL daquela resposta, em vez de depender do
// cache de mensagens do frontend (que pode nao ter a pergunta carregada,
// caindo no fallback do titulo da sessao — sempre a PRIMEIRA pergunta feita).
function _perguntaAnteriorMensagem({ sessaoId, criadoEm }) {
  const row = getDB().prepare(`
    SELECT texto FROM protheus_chat_messages
    WHERE sessao_id = ? AND direcao = 'out' AND criado_em <= ?
    ORDER BY criado_em DESC LIMIT 1
  `).get(sessaoId, criadoEm);
  return row?.texto ? textoClaro(row.texto) : null;
}

function ultimaMensagemTabular({ sessaoId }) {
  const cFilialEscopoCol = temFilialEscopoChatMessages() ? 'filial_escopo_json' : 'NULL AS filial_escopo_json';
  const row = getDB().prepare(`
    SELECT id, texto, rows_json, tipo_resultado, grid_config_json, ${cFilialEscopoCol}, criado_em
    FROM protheus_chat_messages
    WHERE sessao_id = ? AND direcao = 'in' AND rows_json IS NOT NULL
    ORDER BY criado_em DESC LIMIT 1
  `).get(sessaoId);
  if (!row) return null;
  const meta = parseRowsMeta(row.rows_json);
  if (!meta.temDados) return null;
  return {
    id: row.id,
    texto: textoClaro(row.texto),
    perguntaTexto: _perguntaAnteriorMensagem({ sessaoId, criadoEm: row.criado_em }),
    rows: meta.rows,
    rowsCount: meta.rowsCount,
    tipo: row.tipo_resultado,
    gridConfig: parseJsonSeguro(row.grid_config_json),
    filial_escopo_json: parseJsonSeguro(row.filial_escopo_json),
    criadoEm: row.criado_em,
  };
}

function mensagemTabular({ sessaoId, mensagemId }) {
  const cFilialEscopoCol = temFilialEscopoChatMessages() ? 'filial_escopo_json' : 'NULL AS filial_escopo_json';
  const row = getDB().prepare(`
    SELECT id, texto, rows_json, tipo_resultado, grid_config_json, ${cFilialEscopoCol}, criado_em
    FROM protheus_chat_messages
    WHERE sessao_id = ? AND id = ? AND direcao = 'in' AND rows_json IS NOT NULL
    LIMIT 1
  `).get(sessaoId, mensagemId);
  if (!row) return null;
  const meta = parseRowsMeta(row.rows_json);
  if (!meta.temDados) return null;
  return {
    id: row.id,
    texto: textoClaro(row.texto),
    perguntaTexto: _perguntaAnteriorMensagem({ sessaoId, criadoEm: row.criado_em }),
    rows: meta.rows,
    rowsCount: meta.rowsCount,
    tipo: row.tipo_resultado,
    gridConfig: parseJsonSeguro(row.grid_config_json),
    filial_escopo_json: parseJsonSeguro(row.filial_escopo_json),
    criadoEm: row.criado_em,
  };
}

// Salva a configuracao de grid (agrupamento/filtros escolhidos pelo usuario)
// de uma mensagem especifica, restaurada da proxima vez que a sessao/mensagem
// for reaberta. gridConfig e um objeto livre definido pelo frontend
// (ex.: { groupBy: ['vendedor'], filters: [...] }) — o backend so persiste.
function salvarGridConfig({ mensagemId, sessaoId, gridConfig }) {
  const info = getDB().prepare(`
    UPDATE protheus_chat_messages SET grid_config_json = ?
    WHERE id = ? AND sessao_id = ?
  `).run(jsonParaSalvar(gridConfig || {}), mensagemId, sessaoId);
  return info.changes > 0;
}

function vincularInterpretacao({ mensagemId, sessaoId, interpretationLogId }) {
  if (!mensagemId || !sessaoId || !interpretationLogId) return false;
  const info = getDB().prepare(`
    UPDATE protheus_chat_messages
       SET interpretation_log_id = ?
     WHERE id = ? AND sessao_id = ? AND direcao = 'in'
  `).run(interpretationLogId, mensagemId, sessaoId);
  return info.changes > 0;
}

function sqlDaMensagem({ sessaoId, mensagemId }) {
  if (!sessaoId || !mensagemId) return null;
  const row = getDB().prepare(`
    SELECT m.id, m.criado_em, m.interpretation_log_id,
           l.sql_final_executado, l.sql_gerado, l.sql_template, l.modulo,
           l.sql_ia_bruto, l.sql_canonico_original, l.sql_canonico_adaptado,
           l.sql_auditoria_json, l.sql_canonico_parametros_json,
           l.sql_canonico_origem, l.sql_canonico_empresa_origem,
           l.sql_canonico_reuso_motivo, l.sql_canonico_reuso_permitido,
           l.sql_validacao_erro, l.trace_json, l.intent_canonico_json,
           l.intent_canonico_estrutural_json, l.chave_cache, l.pipeline_origem,
           l.fase_execucao, l.duracao_ms, l.rows_count, l.resultado_tipo,
           (
             SELECT f.id
             FROM protheus_chat_favorites f
             WHERE f.resposta_mensagem_id = m.id
               AND f.ativo = 1
             LIMIT 1
           ) AS favorito_id,
           (
             SELECT f.sql_final_executado
             FROM protheus_chat_favorites f
             WHERE f.resposta_mensagem_id = m.id
               AND f.ativo = 1
             LIMIT 1
           ) AS favorito_sql_final_executado
    FROM protheus_chat_messages m
    LEFT JOIN interpretation_log l ON l.id = m.interpretation_log_id
    WHERE m.sessao_id = ? AND m.id = ? AND m.direcao = 'in'
    LIMIT 1
  `).get(sessaoId, mensagemId);
  if (!row) return null;

  const sqlFavorito = String(secureFields.decryptText(row.favorito_sql_final_executado || '') || '').trim();
  const sql = String(sqlFavorito || row.sql_final_executado || row.sql_gerado || '').trim();
  return {
    mensagemId: row.id,
    criadoEm: row.criado_em,
    interpretationLogId: row.interpretation_log_id || null,
    modulo: row.modulo || null,
    sql,
    sqlFonte: sqlFavorito ? 'favorito' : 'interpretation_log',
    sqlTemplate: row.sql_template ? textoClaro(row.sql_template) : null,
    sqlIaBruto: row.sql_ia_bruto || null,
    sqlCanonicoOriginal: row.sql_canonico_original || null,
    sqlCanonicoAdaptado: row.sql_canonico_adaptado || null,
    sqlAuditoria: parseJsonSeguro(row.sql_auditoria_json),
    sqlAuditoriaJson: row.sql_auditoria_json || null,
    sqlCanonicoParametros: parseJsonSeguro(row.sql_canonico_parametros_json),
    sqlCanonicoOrigem: row.sql_canonico_origem || null,
    sqlCanonicoEmpresaOrigem: row.sql_canonico_empresa_origem || null,
    sqlCanonicoReusoMotivo: row.sql_canonico_reuso_motivo || null,
    sqlCanonicoReusoPermitido: row.sql_canonico_reuso_permitido,
    sqlValidacaoErro: row.sql_validacao_erro || null,
    trace: parseJsonSeguro(row.trace_json),
    traceJson: row.trace_json || null,
    intentCanonico: parseJsonSeguro(row.intent_canonico_json),
    intentCanonicoEstrutural: parseJsonSeguro(row.intent_canonico_estrutural_json),
    chaveCache: row.chave_cache || null,
    pipelineOrigem: row.pipeline_origem || null,
    faseExecucao: row.fase_execucao || null,
    duracaoMs: row.duracao_ms ?? null,
    rowsCount: row.rows_count ?? null,
    resultadoTipo: row.resultado_tipo || null,
    temSql: !!sql,
    favoritoId: row.favorito_id || null,
  };
}

function moduloDoIntentJson(intentJson) {
  try {
    const intent = parseJsonSeguro(intentJson) || {};
    return String(intent._moduloDinamico || intent.modulo || intent.module || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function tituloFavorito(texto) {
  return truncarTitulo(texto || 'Pergunta favorita');
}

function buscarLogParaFavorito({ empresaId, celular, mensagem, perguntaTexto }) {
  const db = getDB();
  if (mensagem.interpretation_log_id) {
    const row = db.prepare(`
      SELECT *
      FROM interpretation_log
      WHERE id = ? AND empresa_id = ?
      LIMIT 1
    `).get(mensagem.interpretation_log_id, empresaId);
    if (row) return row;
  }

  const numero = String(celular || '').replace(/\D/g, '');
  return db.prepare(`
    SELECT *
    FROM interpretation_log
    WHERE empresa_id = ?
      AND numero_wa = ?
      AND texto_original = ?
      AND sql_final_executado IS NOT NULL
    ORDER BY criado_em DESC
    LIMIT 1
  `).get(empresaId, numero, perguntaTexto) || null;
}

function periodoDeMacro(perguntaTexto, periodoHint = null) {
  const periodoTexto = periodResolver.identificarPeriodoTexto(perguntaTexto);
  if (periodoTexto && periodoTexto.tipo && periodoTexto.tipo !== 'nenhum') return periodoTexto;
  const hint = periodoHint && typeof periodoHint === 'object' ? periodoHint : null;
  return hint && hint.tipo && hint.tipo !== 'nenhum' ? hint : periodoTexto;
}

function macroPeriodoAgendamento(perguntaTexto, periodoHint = null) {
  const periodo = periodoDeMacro(perguntaTexto, periodoHint);
  if (!periodo || !periodo.tipo || periodo.tipo === 'nenhum') return null;

  switch (periodo.tipo) {
    case 'hoje':
      return { start: '{{HOJE}}', end: '{{HOJE}}' };
    case 'ontem':
      return { start: '{{ONTEM}}', end: '{{ONTEM}}' };
    case 'amanha':
      return { start: '{{AMANHA}}', end: '{{AMANHA}}' };
    case 'esta_semana':
      return { start: '{{INICIO_SEMANA}}', end: '{{FIM_SEMANA}}' };
    case 'semana_anterior':
      return { start: '{{INICIO_SEMANA_ANTERIOR}}', end: '{{FIM_SEMANA_ANTERIOR}}' };
    case 'proxima_semana':
      return { start: '{{INICIO_PROXIMA_SEMANA}}', end: '{{FIM_PROXIMA_SEMANA}}' };
    case 'mes_atual':
      return { start: '{{INICIO_MES}}', end: '{{FIM_MES}}' };
    case 'mes_anterior':
      return { start: '{{INICIO_MES_ANTERIOR}}', end: '{{FIM_MES_ANTERIOR}}' };
    case 'proximo_mes':
      return { start: '{{INICIO_MES:1}}', end: '{{FIM_MES:1}}' };
    case 'ano_atual':
      return { start: '{{INICIO_ANO}}', end: '{{FIM_ANO}}' };
    case 'ano_anterior':
      return { start: '{{INICIO_ANO_ANTERIOR}}', end: '{{FIM_ANO_ANTERIOR}}' };
    case 'proximo_ano':
      return { start: '{{INICIO_ANO:1}}', end: '{{FIM_ANO:1}}' };
    case 'ultimos_N_dias': {
      const dias = Math.max(Number(periodo.dias || 0), 1);
      return { start: `{{HOJE:-${dias - 1}}}`, end: '{{HOJE}}' };
    }
    default:
      return null;
  }
}

function escapeRegexLiteral(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function substituirLiteralData(sql, valor, macro) {
  const compacto = String(valor || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(compacto)) return sql;
  const iso = `${compacto.slice(0, 4)}-${compacto.slice(4, 6)}-${compacto.slice(6, 8)}`;
  let out = String(sql || '');
  for (const v of [compacto, iso]) {
    out = out.replace(new RegExp(`'${escapeRegexLiteral(v)}'`, 'g'), `'${macro}'`);
    out = out.replace(new RegExp(`(^|[^'\\d])${escapeRegexLiteral(v)}(?=[^\\d]|$)`, 'g'), `$1'${macro}'`);
  }
  return out;
}

function substituirBetweenDatasPorMacros(sql, macros) {
  if (!macros?.start || !macros?.end) return sql;
  return String(sql || '').replace(
    /\bBETWEEN\s+'?(\d{8}|\d{4}-\d{2}-\d{2})'?\s+AND\s+'?(\d{8}|\d{4}-\d{2}-\d{2})'?/i,
    `BETWEEN '${macros.start}' AND '${macros.end}'`
  );
}

function macrosDataComoTexto(sql) {
  const macroData = /\{\{(?:HOJE|HOJE_ISO|ONTEM|ONTEM_ISO|DATA_EXECUCAO|DATA_EXECUCAO_ISO|INICIO_SEMANA|INICIO_SEMANA_ISO|FIM_SEMANA|FIM_SEMANA_ISO|INICIO_SEMANA_ANTERIOR|INICIO_SEMANA_ANTERIOR_ISO|FIM_SEMANA_ANTERIOR|FIM_SEMANA_ANTERIOR_ISO|INICIO_PROXIMA_SEMANA|INICIO_PROXIMA_SEMANA_ISO|FIM_PROXIMA_SEMANA|FIM_PROXIMA_SEMANA_ISO|INICIO_MES|INICIO_MES_ISO|FIM_MES|FIM_MES_ISO|INICIO_MES_ANTERIOR|INICIO_MES_ANTERIOR_ISO|FIM_MES_ANTERIOR|FIM_MES_ANTERIOR_ISO|INICIO_ANO|INICIO_ANO_ISO|FIM_ANO|FIM_ANO_ISO|INICIO_ANO_ANTERIOR|INICIO_ANO_ANTERIOR_ISO|FIM_ANO_ANTERIOR|FIM_ANO_ANTERIOR_ISO)(?::[-+]?\d+)?\}\}/g;
  return String(sql || '').replace(new RegExp(`(^|[^'])(${macroData.source})(?!')`, 'g'), "$1'$2'");
}

function datasPeriodoHint(periodoHint) {
  const p = periodoHint && typeof periodoHint === 'object' ? periodoHint : {};
  const dataInicio = String(p.dataInicio || p.data_inicio || p.start || p.inicio || '').replace(/\D/g, '');
  const dataFim = String(p.dataFim || p.data_fim || p.end || p.fim || '').replace(/\D/g, '');
  if (/^\d{8}$/.test(dataInicio) && /^\d{8}$/.test(dataFim)) return { dataInicio, dataFim };
  return null;
}

function sqlFavoritoComMacrosAgendamento(sqlFinal, sqlTemplate, perguntaTexto, referencia = new Date(), periodoHint = null) {
  const periodo = periodoDeMacro(perguntaTexto, periodoHint);
  const macros = macroPeriodoAgendamento(perguntaTexto, periodoHint);
  if (!macros) return macrosDataComoTexto(sqlFinal);

  const template = String(sqlTemplate || '');
  if (template.includes('{{iac:period:start}}') || template.includes('{{iac:period:end}}')) {
    const convertido = template
      .split('{{iac:period:start}}').join(macros.start)
      .split('{{iac:period:end}}').join(macros.end);
    if (!/\{\{\s*iac:/i.test(convertido)) return macrosDataComoTexto(convertido);
  }

  const resolvido = datasPeriodoHint(periodoHint) || periodResolver.resolverPeriodo(periodo, { hoje: referencia });
  let out = String(sqlFinal || '');
  if (macros.start !== macros.end && /\bBETWEEN\b/i.test(out)) {
    out = substituirBetweenDatasPorMacros(out, macros);
  }
  out = substituirLiteralData(out, resolvido?.dataInicio, macros.start);
  out = substituirLiteralData(out, resolvido?.dataFim, macros.end);
  return macrosDataComoTexto(out);
}

function periodoFavoritoHint(...fontesJson) {
  for (const fonte of fontesJson) {
    const obj = parseJsonSeguro(fonte);
    const candidatos = [
      obj?.periodo,
      obj?.intent?.periodo,
      obj?.contrato?.periodo,
      obj?.contrato_orquestrador?.periodo,
    ];
    const periodo = candidatos.find(p => p && typeof p === 'object' && p.tipo);
    if (periodo) return periodo;
  }
  return null;
}

function decryptFavoritoRow(row) {
  if (!row) return row;
  return {
    ...row,
    pergunta_texto: row.pergunta_texto ? textoClaro(row.pergunta_texto) : row.pergunta_texto,
    sql_final_executado: row.sql_final_executado ? textoClaro(row.sql_final_executado) : row.sql_final_executado,
    sql_template: row.sql_template ? textoClaro(row.sql_template) : row.sql_template,
    intent_json: row.intent_json ? JSON.stringify(parseJsonSeguro(row.intent_json) || {}) : row.intent_json,
    grid_config_json: row.grid_config_json ? JSON.stringify(parseJsonSeguro(row.grid_config_json) || {}) : row.grid_config_json,
    rows_preview_json: row.rows_preview_json ? JSON.stringify(parseJsonSeguro(row.rows_preview_json) || []) : row.rows_preview_json,
  };
}

function mapFavoritoRow(row, { incluirSql = false } = {}) {
  row = decryptFavoritoRow(row);
  const favorito = {
    id: row.id,
    empresaId: Number(row.empresa_id),
    titulo: row.titulo,
    perguntaTexto: row.pergunta_texto,
    respostaMensagemId: row.resposta_mensagem_id || null,
    interpretationLogId: row.interpretation_log_id || null,
    modulo: row.modulo || null,
    gridConfig: parseJsonSeguro(row.grid_config_json),
    ultimoUsoEm: row.ultimo_uso_em || null,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
  if (incluirSql) favorito.sqlFinalExecutado = row.sql_final_executado || '';
  return favorito;
}

function listarFavoritos({ empresaId, celular, limite = 80, incluirSql = false }) {
  const sqlFinalCol = incluirSql ? ', sql_final_executado' : '';
  const rows = getDB().prepare(`
    SELECT id, empresa_id, titulo, pergunta_texto, resposta_mensagem_id,
           interpretation_log_id, modulo, grid_config_json, ultimo_uso_em,
           criado_em, atualizado_em${sqlFinalCol}
    FROM protheus_chat_favorites
    WHERE empresa_id = ? AND celular = ? AND ativo = 1
    ORDER BY COALESCE(ultimo_uso_em, atualizado_em, criado_em) DESC
    LIMIT ?
  `).all(empresaId, celular, limite);
  return rows.map(row => mapFavoritoRow(row, { incluirSql }));
}

function obterFavorito({ favoritoId, empresaId, celular }) {
  const row = getDB().prepare(`
    SELECT *
    FROM protheus_chat_favorites
    WHERE id = ? AND empresa_id = ? AND celular = ? AND ativo = 1
    LIMIT 1
  `).get(favoritoId, empresaId, celular) || null;
  return decryptFavoritoRow(row);
}

function favoritarMensagem({ sessaoId, empresaId, celular, mensagemId, titulo = null }) {
  const db = getDB();
  const sessao = buscarSessao({ id: sessaoId, empresaId, celular });
  if (!sessao) return null;

  const mensagem = db.prepare(`
    SELECT id, sessao_id, texto, rows_json, tipo_resultado, intent_json,
           grid_config_json, interpretation_log_id, criado_em
    FROM protheus_chat_messages
    WHERE id = ? AND sessao_id = ? AND direcao = 'in'
    LIMIT 1
  `).get(mensagemId, sessaoId);
  if (!mensagem) return null;

  const pergunta = db.prepare(`
    SELECT texto
    FROM protheus_chat_messages
    WHERE sessao_id = ? AND direcao = 'out' AND criado_em <= ?
    ORDER BY criado_em DESC
    LIMIT 1
  `).get(sessaoId, mensagem.criado_em);
  const perguntaTexto = String(pergunta?.texto ? textoClaro(pergunta.texto) : '').trim();
  if (!perguntaTexto) {
    throw Object.assign(new Error('Nao encontrei a pergunta original desta resposta.'), { statusCode: 400 });
  }

  const log = buscarLogParaFavorito({ empresaId, celular, mensagem, perguntaTexto });
  const sqlFinalOriginal = String(log?.sql_final_executado || log?.sql_gerado || '').trim();
  const periodoHint = periodoFavoritoHint(
    mensagem.intent_json,
    log?.intent_json,
    log?.intent_canonico_json,
    log?.intent_canonico_estrutural_json,
  );
  const sqlFinal = sqlFavoritoComMacrosAgendamento(sqlFinalOriginal, log?.sql_template || null, perguntaTexto, new Date(), periodoHint).trim();
  if (!sqlFinal) {
    throw Object.assign(new Error('Esta resposta ainda nao possui SQL auditado para favoritar.'), { statusCode: 400 });
  }

  const modulo = String(log?.modulo || moduloDoIntentJson(mensagem.intent_json) || '').trim().toLowerCase();
  if (!modulo) {
    throw Object.assign(new Error('Nao foi possivel identificar o modulo desta pergunta.'), { statusCode: 400 });
  }

  const existente = db.prepare(`
    SELECT id
    FROM protheus_chat_favorites
    WHERE empresa_id = ? AND celular = ? AND resposta_mensagem_id = ? AND ativo = 1
    LIMIT 1
  `).get(empresaId, celular, mensagemId);
  const agora = new Date().toISOString();
  const nome = tituloFavorito(titulo || perguntaTexto);
  let preview = null;
  try {
    const rowsPreview = parseRowsMeta(mensagem.rows_json).rows;
    preview = Array.isArray(rowsPreview) ? JSON.stringify(rowsPreview.slice(0, 20)) : null;
  } catch (_) {
    preview = null;
  }

  if (existente?.id) {
    db.prepare(`
      UPDATE protheus_chat_favorites
         SET titulo = ?, pergunta_texto = ?, interpretation_log_id = ?,
             modulo = ?, sql_final_executado = ?, sql_template = ?,
             intent_json = ?, grid_config_json = ?, rows_preview_json = ?,
             atualizado_em = ?
       WHERE id = ?
    `).run(
      nome, secureFields.encryptText(perguntaTexto), log?.id || mensagem.interpretation_log_id || null,
      modulo,
      secureFields.encryptText(sqlFinal),
      log?.sql_template ? secureFields.encryptText(log.sql_template) : null,
      jsonParaSalvar(parseJsonSeguro(mensagem.intent_json) || parseJsonSeguro(log?.intent_json)),
      jsonParaSalvar(parseJsonSeguro(mensagem.grid_config_json)),
      jsonParaSalvar(preview ? JSON.parse(preview) : null),
      agora, existente.id,
    );
    return obterFavorito({ favoritoId: existente.id, empresaId, celular });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO protheus_chat_favorites
      (id, empresa_id, celular, titulo, pergunta_texto, resposta_mensagem_id,
       interpretation_log_id, modulo, sql_final_executado, sql_template,
       intent_json, grid_config_json, rows_preview_json, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, empresaId, celular, nome, secureFields.encryptText(perguntaTexto), mensagemId,
    log?.id || mensagem.interpretation_log_id || null,
    modulo,
    secureFields.encryptText(sqlFinal),
    log?.sql_template ? secureFields.encryptText(log.sql_template) : null,
    jsonParaSalvar(parseJsonSeguro(mensagem.intent_json) || parseJsonSeguro(log?.intent_json)),
    jsonParaSalvar(parseJsonSeguro(mensagem.grid_config_json)),
    jsonParaSalvar(preview ? JSON.parse(preview) : null),
    agora, agora,
  );
  return obterFavorito({ favoritoId: id, empresaId, celular });
}

function removerFavorito({ favoritoId, empresaId, celular }) {
  const info = getDB().prepare(`
    UPDATE protheus_chat_favorites
       SET ativo = 0, atualizado_em = ?
     WHERE id = ? AND empresa_id = ? AND celular = ? AND ativo = 1
  `).run(new Date().toISOString(), favoritoId, empresaId, celular);
  return info.changes > 0;
}

function renomearFavorito({ favoritoId, empresaId, celular, titulo }) {
  const tituloLimpo = String(titulo || '').trim();
  if (!tituloLimpo) return null;
  const atualizaPerguntaTexto = tabelaTemColuna('protheus_chat_favorites', 'pergunta_texto');
  const info = getDB().prepare(`
    UPDATE protheus_chat_favorites
       SET titulo = ?,
           ${atualizaPerguntaTexto ? 'pergunta_texto = ?,' : ''}
           atualizado_em = ?
     WHERE id = ? AND empresa_id = ? AND celular = ? AND ativo = 1
  `).run(
    ...(atualizaPerguntaTexto
      ? [tituloLimpo, secureFields.encryptText(tituloLimpo), new Date().toISOString(), favoritoId, empresaId, celular]
      : [tituloLimpo, new Date().toISOString(), favoritoId, empresaId, celular])
  );
  if (!info.changes) return null;
  return obterFavorito({ favoritoId, empresaId, celular });
}

function atualizarSqlFavorito({ favoritoId, empresaId, celular, sqlFinal }) {
  const sqlLimpo = macrosDataComoTexto(String(sqlFinal || '').trim());
  if (!sqlLimpo) return null;
  const info = getDB().prepare(`
    UPDATE protheus_chat_favorites
       SET sql_final_executado = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ? AND celular = ? AND ativo = 1
  `).run(secureFields.encryptText(sqlLimpo), new Date().toISOString(), favoritoId, empresaId, celular);
  if (!info.changes) return null;
  return obterFavorito({ favoritoId, empresaId, celular });
}

function marcarFavoritoUsado({ favoritoId, empresaId, celular }) {
  getDB().prepare(`
    UPDATE protheus_chat_favorites
       SET ultimo_uso_em = ?, atualizado_em = ?
     WHERE id = ? AND empresa_id = ? AND celular = ? AND ativo = 1
  `).run(new Date().toISOString(), new Date().toISOString(), favoritoId, empresaId, celular);
}

// Le o ultimo intent da sessao para servir de contexto ao intent-merger.
// Respeita memoria_resetada_em: mensagens anteriores ao reset sao ignoradas,
// mesmo que continuem visiveis no historico (resetarMemoria() nao apaga nada).
function ultimoIntent({ sessaoId }) {
  const db = getDB();
  const sessao = db.prepare(`SELECT memoria_resetada_em FROM protheus_chat_sessions WHERE id = ?`).get(sessaoId);
  const corte = sessao?.memoria_resetada_em || null;

  const row = corte
    ? db.prepare(`
        SELECT intent_json FROM protheus_chat_messages
        WHERE sessao_id = ? AND direcao = 'in' AND intent_json IS NOT NULL AND criado_em > ?
        ORDER BY criado_em DESC LIMIT 1
      `).get(sessaoId, corte)
    : db.prepare(`
        SELECT intent_json FROM protheus_chat_messages
        WHERE sessao_id = ? AND direcao = 'in' AND intent_json IS NOT NULL
        ORDER BY criado_em DESC LIMIT 1
      `).get(sessaoId);

  return row ? parseJsonSeguro(row.intent_json) : null;
}

// Marca o momento atual como fronteira de memoria da sessao — ultimoIntent()
// passa a ignorar tudo antes disso. Nao apaga mensagens; o historico visual
// (listarMensagens) continua mostrando a conversa completa.
function resetarMemoria({ sessaoId }) {
  const agora = new Date().toISOString();
  getDB().prepare(`UPDATE protheus_chat_sessions SET memoria_resetada_em = ? WHERE id = ?`)
    .run(agora, sessaoId);
  return agora;
}

// Apaga permanentemente uma conversa (sessao + todas as mensagens). Escopada
// por empresaId/celular — mesmo padrao de buscarSessao/listarSessoes — para
// que um usuario nao consiga apagar sessao de outro celular/empresa so
// adivinhando o id. Mensagens sao apagadas primeiro por causa da FK
// (protheus_chat_messages.sessao_id -> protheus_chat_sessions.id).
function excluirSessao({ sessaoId, empresaId, celular }) {
  const db = getDB();
  const sessao = buscarSessao({ id: sessaoId, empresaId, celular });
  if (!sessao) return false;
  db.prepare(`DELETE FROM protheus_chat_messages WHERE sessao_id = ?`).run(sessaoId);
  const info = db.prepare(`DELETE FROM protheus_chat_sessions WHERE id = ?`).run(sessaoId);
  return info.changes > 0;
}

// Renomeia uma conversa (titulo customizado pelo usuario). Mesmo escopo de
// posse de excluirSessao/resetarMemoria — so renomeia se a sessao pertencer
// a empresaId/celular informados. truncarTitulo() reaproveita o mesmo limite
// (60 chars) ja usado no titulo automatico gerado por salvarTurno.
function renomearSessao({ sessaoId, empresaId, celular, titulo }) {
  const tituloLimpo = truncarTitulo(titulo);
  if (!tituloLimpo) return false;
  const db = getDB();
  const sessao = buscarSessao({ id: sessaoId, empresaId, celular });
  if (!sessao) return false;
  const agora = new Date().toISOString();
  const tx = db.transaction(() => {
    const info = db.prepare(`UPDATE protheus_chat_sessions SET titulo = ?, atualizado_em = ? WHERE id = ?`)
      .run(tituloLimpo, agora, sessaoId);
    if (!info.changes) return 0;
    db.prepare(`
      UPDATE protheus_chat_favorites
         SET titulo = ?,
             atualizado_em = ?
       WHERE empresa_id = ?
         AND celular = ?
         AND ativo = 1
         AND resposta_mensagem_id IN (
           SELECT id
           FROM protheus_chat_messages
           WHERE sessao_id = ? AND direcao = 'in'
         )
    `).run(tituloLimpo, agora, empresaId, celular, sessaoId);
    return info.changes;
  });
  return tx() > 0;
}

// Apaga uma ou mais mensagens especificas de uma conversa (selecao multipla,
// estilo WhatsApp Web) — nao apaga a sessao. Valida a posse da sessao
// (empresaId/celular) antes de apagar, mesmo padrao de excluirSessao; o
// WHERE sessao_id = ? garante que so mensagens DAQUELA sessao sao afetadas,
// mesmo que mensagemIds contenha ids de outra sessao/empresa por engano.
function excluirMensagens({ sessaoId, empresaId, celular, mensagemIds }) {
  if (!Array.isArray(mensagemIds) || !mensagemIds.length) return 0;
  const db = getDB();
  const sessao = buscarSessao({ id: sessaoId, empresaId, celular });
  if (!sessao) return 0;
  const placeholders = mensagemIds.map(() => '?').join(',');
  const info = db.prepare(
    `DELETE FROM protheus_chat_messages WHERE sessao_id = ? AND id IN (${placeholders})`
  ).run(sessaoId, ...mensagemIds);
  return info.changes || 0;
}

// "Limpar Chat" — apaga TODAS as mensagens da conversa, mas mantem a sessao
// (continua na sidebar, so fica vazia). Diferente de excluirSessao (que
// apaga a conversa inteira) e de excluirMensagens (que exige lista de ids
// especificos vinda do modo selecao) — aqui o escopo e sempre "tudo desta
// sessao", sem precisar que o frontend descubra os ids primeiro.
function limparMensagens({ sessaoId, empresaId, celular }) {
  const db = getDB();
  const sessao = buscarSessao({ id: sessaoId, empresaId, celular });
  if (!sessao) return 0;
  const info = db.prepare(`DELETE FROM protheus_chat_messages WHERE sessao_id = ?`).run(sessaoId);
  return info.changes || 0;
}

module.exports = {
  criarSessao,
  buscarSessao,
  listarSessoes,
  salvarTurno,
  listarMensagens,
  ultimoIntent,
  resetarMemoria,
  excluirSessao,
  renomearSessao,
  excluirMensagens,
  limparMensagens,
  ultimaMensagemTabular,
  mensagemTabular,
  salvarGridConfig,
  vincularInterpretacao,
  sqlDaMensagem,
  listarFavoritos,
  obterFavorito,
  favoritarMensagem,
  removerFavorito,
  renomearFavorito,
  atualizarSqlFavorito,
  marcarFavoritoUsado,
};
