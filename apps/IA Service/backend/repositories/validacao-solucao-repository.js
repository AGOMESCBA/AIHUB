// Unico ponto de acesso SQL a tabela `validacoes_solucao` (Fase 3).
// Append-only por design: nenhuma funcao aqui faz UPDATE/DELETE de um evento
// ja gravado — toda mudanca de resultado e uma linha NOVA. O "estado atual"
// de uma orientacao e derivado em obterEstadoAtual/obterEstadoAtualPorMensagens,
// nunca armazenado como coluna mutavel.

const crypto = require('crypto');
const { getDB } = require('../database');

const ORIGENS_VALIDAS = new Set(['confirmacao_analista', 'evidencia_externa']);
const RESULTADOS_CONFIRMACAO = new Set(['RESOLVEU', 'NAO_RESOLVEU', 'PARCIALMENTE', 'NAO_TESTADO']);
const RESULTADOS_EVIDENCIA = new Set(['EVIDENCIA_EXTERNA']);

function _rowParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    mensagemAssistenteId: row.mensagem_assistente_id,
    anexoVersaoId: row.anexo_versao_id,
    dossieId: row.dossie_id,
    origem: row.origem,
    resultado: row.resultado,
    comentario: row.comentario,
    evidenciaFonte: row.evidencia_fonte,
    evidenciaDetalhe: row.evidencia_detalhe_json ? JSON.parse(row.evidencia_detalhe_json) : null,
    chaveIdempotencia: row.chave_idempotencia,
    usuarioId: row.usuario_id,
    criadoEm: row.criado_em,
  };
}

function _validarMensagemAssistente(empresaId, atendimentoId, mensagemAssistenteId, db) {
  const row = db.prepare(`
    SELECT id FROM mensagens
     WHERE id = ? AND empresa_id = ? AND atendimento_id = ? AND papel = 'assistant'
  `).get(mensagemAssistenteId, Number(empresaId), atendimentoId);
  if (!row) throw new Error('Mensagem do assistente não encontrada neste atendimento/empresa.');
}

function _validarAnexoVersao(empresaId, atendimentoId, anexoVersaoId, db) {
  if (!anexoVersaoId) return;
  const row = db.prepare(`
    SELECT id FROM anexos WHERE id = ? AND empresa_id = ? AND atendimento_id = ?
  `).get(anexoVersaoId, Number(empresaId), atendimentoId);
  if (!row) throw new Error('Versão de fonte corrigido não encontrada neste atendimento/empresa.');
}

/**
 * Registra confirmação explícita do analista (seção 3/4 da Fase 3). Sempre
 * INSERT — nunca sobrescreve um evento anterior. `usuarioId` identifica quem
 * confirmou (nunca confiar em origem anônima para este tipo de evento).
 */
function registrarConfirmacaoAnalista(empresaId, {
  atendimentoId, mensagemAssistenteId, anexoVersaoId = null, dossieId = null,
  resultado, comentario = null, usuarioId,
}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!mensagemAssistenteId) throw new Error('mensagemAssistenteId é obrigatório.');
  if (!RESULTADOS_CONFIRMACAO.has(resultado)) {
    throw new Error(`resultado inválido para confirmação do analista: ${resultado}.`);
  }
  if (!usuarioId) throw new Error('usuarioId é obrigatório para confirmação explícita do analista.');

  const db = getDB();
  const pertenceAtendimento = db.prepare(`SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?`).get(atendimentoId, Number(empresaId));
  if (!pertenceAtendimento) throw new Error('Atendimento não encontrado nesta empresa.');
  _validarMensagemAssistente(empresaId, atendimentoId, mensagemAssistenteId, db);
  _validarAnexoVersao(empresaId, atendimentoId, anexoVersaoId, db);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  db.prepare(`
    INSERT INTO validacoes_solucao (
      id, empresa_id, atendimento_id, mensagem_assistente_id, anexo_versao_id, dossie_id,
      origem, resultado, comentario, evidencia_fonte, evidencia_detalhe_json,
      chave_idempotencia, usuario_id, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, 'confirmacao_analista', ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    id, Number(empresaId), atendimentoId, mensagemAssistenteId, anexoVersaoId, dossieId,
    resultado, comentario, usuarioId, agora
  );

  return _rowParaDominio(db.prepare(`SELECT * FROM validacoes_solucao WHERE id = ?`).get(id));
}

/**
 * Registra evidência externa do SoftExpert (seção 5) — NUNCA interpretada
 * como confirmação de sucesso/falha, apenas "algo aconteceu no ciclo de vida
 * do chamado". Idempotente por (empresaId, chaveIdempotencia): uma
 * re-sincronização do mesmo evento não duplica a linha (retorna a existente).
 */
function registrarEvidenciaExterna(empresaId, {
  atendimentoId, mensagemAssistenteId, dossieId = null,
  evidenciaFonte, evidenciaDetalhe = null, chaveIdempotencia,
}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!mensagemAssistenteId) throw new Error('mensagemAssistenteId é obrigatório.');
  if (!evidenciaFonte) throw new Error('evidenciaFonte é obrigatória para evidência externa.');
  if (!chaveIdempotencia) throw new Error('chaveIdempotencia é obrigatória para evidência externa.');

  const db = getDB();
  const existente = db.prepare(`
    SELECT * FROM validacoes_solucao WHERE empresa_id = ? AND chave_idempotencia = ?
  `).get(Number(empresaId), chaveIdempotencia);
  if (existente) return { registro: _rowParaDominio(existente), duplicado: true };

  const pertenceAtendimento = db.prepare(`SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?`).get(atendimentoId, Number(empresaId));
  if (!pertenceAtendimento) throw new Error('Atendimento não encontrado nesta empresa.');
  _validarMensagemAssistente(empresaId, atendimentoId, mensagemAssistenteId, db);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO validacoes_solucao (
        id, empresa_id, atendimento_id, mensagem_assistente_id, anexo_versao_id, dossie_id,
        origem, resultado, comentario, evidencia_fonte, evidencia_detalhe_json,
        chave_idempotencia, usuario_id, criado_em
      ) VALUES (?, ?, ?, ?, NULL, ?, 'evidencia_externa', 'EVIDENCIA_EXTERNA', NULL, ?, ?, ?, NULL, ?)
    `).run(
      id, Number(empresaId), atendimentoId, mensagemAssistenteId, dossieId,
      evidenciaFonte, evidenciaDetalhe ? JSON.stringify(evidenciaDetalhe) : null,
      chaveIdempotencia, agora
    );
  } catch (err) {
    // Corrida entre duas sincronizações concorrentes: o índice único parcial
    // (empresa_id, chave_idempotencia) rejeita a segunda — trata como
    // duplicado em vez de propagar erro de constraint ao chamador.
    if (String(err.message || '').includes('UNIQUE')) {
      const concorrente = db.prepare(`
        SELECT * FROM validacoes_solucao WHERE empresa_id = ? AND chave_idempotencia = ?
      `).get(Number(empresaId), chaveIdempotencia);
      return { registro: _rowParaDominio(concorrente), duplicado: true };
    }
    throw err;
  }

  return { registro: _rowParaDominio(db.prepare(`SELECT * FROM validacoes_solucao WHERE id = ?`).get(id)), duplicado: false };
}

function listarEventosPorMensagem(empresaId, mensagemAssistenteId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM validacoes_solucao
     WHERE empresa_id = ? AND mensagem_assistente_id = ?
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId), mensagemAssistenteId);
  return rows.map(_rowParaDominio);
}

function listarEventosPorAtendimento(empresaId, atendimentoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM validacoes_solucao
     WHERE empresa_id = ? AND atendimento_id = ?
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId), atendimentoId);
  return rows.map(_rowParaDominio);
}

/**
 * Estado atual de uma orientação específica (uma mensagem do assistente).
 *
 * Regra de precedência (orientação explícita do usuário, 2026-10): uma
 * confirmação explícita do analista NUNCA é sobrescrita por um evento de
 * evidência externa posterior. "Estado atual" = o último evento de
 * confirmacao_analista, se existir algum; só cai para evidência externa (ou
 * AGUARDANDO_VALIDACAO) quando não há nenhuma confirmação explícita ainda.
 * Resolvido em JS (não em SQL) para manter a regra legível e testável
 * isoladamente.
 */
function obterEstadoAtual(empresaId, mensagemAssistenteId) {
  const eventos = listarEventosPorMensagem(empresaId, mensagemAssistenteId);
  if (!eventos.length) return { status: 'AGUARDANDO_VALIDACAO', ultimaConfirmacao: null, ultimaEvidencia: null, historico: [] };

  const confirmacoes = eventos.filter(e => e.origem === 'confirmacao_analista');
  const evidencias = eventos.filter(e => e.origem === 'evidencia_externa');
  const ultimaConfirmacao = confirmacoes.length ? confirmacoes[confirmacoes.length - 1] : null;
  const ultimaEvidencia = evidencias.length ? evidencias[evidencias.length - 1] : null;

  const status = ultimaConfirmacao ? ultimaConfirmacao.resultado
    : (ultimaEvidencia ? 'EVIDENCIA_EXTERNA' : 'AGUARDANDO_VALIDACAO');

  return { status, ultimaConfirmacao, ultimaEvidencia, historico: eventos };
}

/**
 * Estado atual em lote para N mensagens (evita N round-trips ao montar a
 * ficha operacional de uma listagem inteira de mensagens).
 */
function obterEstadoAtualPorMensagens(empresaId, mensagemAssistenteIds) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const ids = Array.from(new Set((mensagemAssistenteIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM validacoes_solucao
     WHERE empresa_id = ? AND mensagem_assistente_id IN (${placeholders})
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId), ...ids);

  const porMensagem = {};
  for (const row of rows) {
    const dom = _rowParaDominio(row);
    (porMensagem[dom.mensagemAssistenteId] ||= []).push(dom);
  }

  const resultado = {};
  for (const id of ids) {
    const eventos = porMensagem[id] || [];
    if (!eventos.length) {
      resultado[id] = { status: 'AGUARDANDO_VALIDACAO', ultimaConfirmacao: null, ultimaEvidencia: null, historico: [] };
      continue;
    }
    const confirmacoes = eventos.filter(e => e.origem === 'confirmacao_analista');
    const evidencias = eventos.filter(e => e.origem === 'evidencia_externa');
    const ultimaConfirmacao = confirmacoes.length ? confirmacoes[confirmacoes.length - 1] : null;
    const ultimaEvidencia = evidencias.length ? evidencias[evidencias.length - 1] : null;
    resultado[id] = {
      status: ultimaConfirmacao ? ultimaConfirmacao.resultado : (ultimaEvidencia ? 'EVIDENCIA_EXTERNA' : 'AGUARDANDO_VALIDACAO'),
      ultimaConfirmacao,
      ultimaEvidencia,
      historico: eventos,
    };
  }
  return resultado;
}

/**
 * Resumo agregado por empresa para o Radar (seção 6): quantas orientações
 * estão em cada estado atual. Reaproveita a mesma regra de precedência de
 * obterEstadoAtualPorMensagens (confirmação explícita nunca é sobrescrita por
 * evidência externa) — agregação é feita em JS sobre o resultado já correto,
 * nunca duplicando a regra em SQL.
 */
function obterResumoPorEmpresa(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const resumo = {
    AGUARDANDO_VALIDACAO: 0, RESOLVEU: 0, NAO_RESOLVEU: 0, PARCIALMENTE: 0,
    NAO_TESTADO: 0, EVIDENCIA_EXTERNA: 0,
  };
  const idsOrientacoes = db.prepare(`
    SELECT id
      FROM mensagens
     WHERE empresa_id = ?
       AND papel = 'assistant'
       AND TRIM(COALESCE(conteudo, '')) <> ''
  `).all(Number(empresaId)).map(r => r.id);
  if (!idsOrientacoes.length) return resumo;

  const estados = obterEstadoAtualPorMensagens(empresaId, idsOrientacoes);
  for (const estado of Object.values(estados)) {
    resumo[estado.status] = (resumo[estado.status] || 0) + 1;
  }
  return resumo;
}

/**
 * Para a listagem do Radar: dentre os atendimentos informados, quais têm
 * pelo menos uma orientação com validação EXPLICITAMENTE pendente (evento
 * NAO_TESTADO, ou evidência externa sem confirmação) — usado para destacar
 * "tem pendência relevante" sem forçar o analista a abrir cada atendimento
 * (seção 6). Atendimentos sem nenhum evento ainda (nunca avaliados) não
 * entram aqui por design: a ausência total de feedback é o estado mais
 * comum e não deve virar alerta visual constante (seção 6: "não implementar
 * notificações insistentes") — o resumo agregado (obterResumoPorEmpresa) já
 * mostra esse volume separadamente.
 */
function listarAtendimentosComPendenciaExplicita(empresaId, atendimentoIds) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const ids = Array.from(new Set((atendimentoIds || []).filter(Boolean)));
  if (!ids.length) return new Set();

  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT DISTINCT atendimento_id, mensagem_assistente_id FROM validacoes_solucao
     WHERE empresa_id = ? AND atendimento_id IN (${placeholders})
  `).all(Number(empresaId), ...ids);

  const mensagensPorAtendimento = {};
  for (const row of rows) (mensagensPorAtendimento[row.atendimento_id] ||= new Set()).add(row.mensagem_assistente_id);

  const pendentes = new Set();
  for (const [atendimentoId, mensagensSet] of Object.entries(mensagensPorAtendimento)) {
    const estados = obterEstadoAtualPorMensagens(empresaId, Array.from(mensagensSet));
    const temPendenciaExplicita = Object.values(estados).some(e => ['NAO_TESTADO', 'EVIDENCIA_EXTERNA'].includes(e.status));
    if (temPendenciaExplicita) pendentes.add(atendimentoId);
  }
  return pendentes;
}

module.exports = {
  ORIGENS_VALIDAS,
  RESULTADOS_CONFIRMACAO,
  RESULTADOS_EVIDENCIA,
  registrarConfirmacaoAnalista,
  registrarEvidenciaExterna,
  listarEventosPorMensagem,
  listarEventosPorAtendimento,
  obterEstadoAtual,
  obterEstadoAtualPorMensagens,
  obterResumoPorEmpresa,
  listarAtendimentosComPendenciaExplicita,
};
