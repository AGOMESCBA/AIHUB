// Unico ponto de acesso SQL a tabela `avaliacoes_investigacao`.
// Append-only por design: nenhuma funcao aqui faz UPDATE/DELETE de uma
// avaliacao ja gravada -- toda mudanca de nota e uma linha NOVA. Diferente de
// validacoes_solucao (estado por mensagem inteira), aqui o "estado atual" e
// por (mensagem, usuario): cada consultor avalia de forma independente e
// pode reavaliar a propria nota sem apagar o historico.

const crypto = require('crypto');
const { getDB } = require('../database');
const investigacaoExecucaoRepo = require('./investigacao-execucao-repository');

const NOTA_MIN = 0;
const NOTA_MAX = 5;

const FAIXAS = [
  { chave: 'EXCELENTE', rotulo: 'Excelente', min: 22, max: 25 },
  { chave: 'BOA', rotulo: 'Boa', min: 18, max: 21 },
  { chave: 'PARCIAL', rotulo: 'Parcial', min: 13, max: 17 },
  { chave: 'INSATISFATORIA', rotulo: 'Insatisfatória', min: 0, max: 12 },
];

/**
 * Faixa de qualidade a partir da soma das 5 notas (0-25). Unico lugar de
 * verdade para os limites -- repository e frontend devem usar esta funcao
 * (via rota de relatorio) em vez de redefinir os limites em outro lugar.
 */
function faixaDeNota(notaTotal) {
  return FAIXAS.find(f => notaTotal >= f.min && notaTotal <= f.max)?.chave || 'INSATISFATORIA';
}

function _notaTotal(row) {
  return row.nota_compreensao_problema + row.nota_aproveitamento_evidencias
    + row.nota_profundidade_tecnica + row.nota_orientacao_pratica + row.nota_confiabilidade_tecnica;
}

function _rowParaDominio(row, nomeAvaliador = null) {
  if (!row) return null;
  const notaTotal = _notaTotal(row);
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    mensagemAssistenteId: row.mensagem_assistente_id,
    execucaoId: row.execucao_id,
    notas: {
      compreensaoProblema: row.nota_compreensao_problema,
      aproveitamentoEvidencias: row.nota_aproveitamento_evidencias,
      profundidadeTecnica: row.nota_profundidade_tecnica,
      orientacaoPratica: row.nota_orientacao_pratica,
      confiabilidadeTecnica: row.nota_confiabilidade_tecnica,
    },
    notaTotal,
    faixa: faixaDeNota(notaTotal),
    observacoes: row.observacoes,
    erroTecnicoCritico: !!row.erro_tecnico_critico,
    usuarioId: row.usuario_id,
    origemIdentidade: row.origem_identidade,
    nomeAvaliador,
    criadoEm: row.criado_em,
  };
}

function _validarNotas(notas) {
  const campos = ['compreensaoProblema', 'aproveitamentoEvidencias', 'profundidadeTecnica', 'orientacaoPratica', 'confiabilidadeTecnica'];
  for (const campo of campos) {
    const valor = notas?.[campo];
    if (!Number.isInteger(valor) || valor < NOTA_MIN || valor > NOTA_MAX) {
      throw new Error(`Nota "${campo}" inválida: deve ser um inteiro entre ${NOTA_MIN} e ${NOTA_MAX}.`);
    }
  }
}

function _resolverExecucaoId(empresaId, mensagemAssistenteId, db) {
  const row = db.prepare(`
    SELECT id FROM investigacao_execucoes
     WHERE empresa_id = ? AND mensagem_id = ?
     ORDER BY criado_em DESC LIMIT 1
  `).get(Number(empresaId), mensagemAssistenteId);
  return row?.id || null;
}

function _validarMensagemAssistente(empresaId, atendimentoId, mensagemAssistenteId, db) {
  const row = db.prepare(`
    SELECT id FROM mensagens
     WHERE id = ? AND empresa_id = ? AND atendimento_id = ? AND papel = 'assistant'
  `).get(mensagemAssistenteId, Number(empresaId), atendimentoId);
  if (!row) throw new Error('Mensagem do assistente não encontrada neste atendimento/empresa.');
}

/**
 * Registra uma avaliação de consultor (sempre INSERT -- "atualizar a própria
 * avaliação" é registrar um evento novo; o estado atual é derivado como o
 * mais recente por (mensagemAssistenteId, usuarioId) em obterAvaliacaoAtualDoUsuario).
 * usuarioId é sempre obrigatório -- avaliação é sempre evento humano
 * explícito, nunca inferido ou atribuído ao próprio modelo.
 */
function registrarAvaliacao(empresaId, {
  atendimentoId, mensagemAssistenteId, notas, observacoes = null, erroTecnicoCritico = false, usuarioId,
  origemIdentidade = null,
}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!atendimentoId) throw new Error('atendimentoId é obrigatório.');
  if (!mensagemAssistenteId) throw new Error('mensagemAssistenteId é obrigatório.');
  if (!usuarioId) throw new Error('usuarioId é obrigatório para registrar avaliação.');
  _validarNotas(notas);

  const db = getDB();
  const pertence = db.prepare(`SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?`).get(atendimentoId, Number(empresaId));
  if (!pertence) throw new Error('Atendimento não encontrado nesta empresa.');
  _validarMensagemAssistente(empresaId, atendimentoId, mensagemAssistenteId, db);

  const execucaoId = _resolverExecucaoId(empresaId, mensagemAssistenteId, db);
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO avaliacoes_investigacao (
      id, empresa_id, atendimento_id, mensagem_assistente_id, execucao_id,
      nota_compreensao_problema, nota_aproveitamento_evidencias, nota_profundidade_tecnica,
      nota_orientacao_pratica, nota_confiabilidade_tecnica,
      observacoes, erro_tecnico_critico, usuario_id, criado_em, origem_identidade
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, Number(empresaId), atendimentoId, mensagemAssistenteId, execucaoId,
    notas.compreensaoProblema, notas.aproveitamentoEvidencias, notas.profundidadeTecnica,
    notas.orientacaoPratica, notas.confiabilidadeTecnica,
    observacoes, erroTecnicoCritico ? 1 : 0, usuarioId, agora, origemIdentidade
  );

  return _rowParaDominio(db.prepare(`SELECT * FROM avaliacoes_investigacao WHERE id = ?`).get(id));
}

function obterAvaliacaoAtualDoUsuario(empresaId, mensagemAssistenteId, usuarioId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!usuarioId) return null;
  const db = getDB();
  const row = db.prepare(`
    SELECT * FROM avaliacoes_investigacao
     WHERE empresa_id = ? AND mensagem_assistente_id = ? AND usuario_id = ?
     ORDER BY criado_em DESC, rowid DESC LIMIT 1
  `).get(Number(empresaId), mensagemAssistenteId, usuarioId);
  return _rowParaDominio(row);
}

function listarHistoricoDoUsuario(empresaId, mensagemAssistenteId, usuarioId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!usuarioId) throw new Error('usuarioId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM avaliacoes_investigacao
     WHERE empresa_id = ? AND mensagem_assistente_id = ? AND usuario_id = ?
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId), mensagemAssistenteId, usuarioId);
  return rows.map(r => _rowParaDominio(r));
}

/**
 * Uma avaliação atual por usuário distinto que avaliou a mensagem (nunca
 * duplica reavaliação do mesmo consultor). Resolvido em JS, não em SQL,
 * mesmo padrão de obterEstadoAtual em validacao-solucao-repository.
 * `resolverNomeAvaliador` é injetado pelo caller (service) para evitar
 * acoplar este repository ao módulo de usuários do IAHub.
 */
function listarAvaliacoesAtuaisDaMensagem(empresaId, mensagemAssistenteId, resolverNomeAvaliador = null) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM avaliacoes_investigacao
     WHERE empresa_id = ? AND mensagem_assistente_id = ?
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId), mensagemAssistenteId);

  const porUsuario = new Map();
  for (const row of rows) porUsuario.set(row.usuario_id, row);

  return Array.from(porUsuario.values()).map(row => _rowParaDominio(row, resolverNomeAvaliador?.(row.usuario_id, row.origem_identidade) || null));
}

/**
 * Versão em lote de listarAvaliacoesAtuaisDaMensagem -- evita N round-trips
 * ao montar a ficha operacional de uma listagem inteira de mensagens.
 */
function listarAvaliacoesAtuaisPorMensagens(empresaId, mensagemAssistenteIds, resolverNomeAvaliador = null) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const ids = Array.from(new Set((mensagemAssistenteIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM avaliacoes_investigacao
     WHERE empresa_id = ? AND mensagem_assistente_id IN (${placeholders})
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId), ...ids);

  const porMensagem = new Map();
  for (const row of rows) {
    const porUsuario = porMensagem.get(row.mensagem_assistente_id) || new Map();
    porUsuario.set(row.usuario_id, row);
    porMensagem.set(row.mensagem_assistente_id, porUsuario);
  }

  const resultado = {};
  for (const id of ids) {
    const porUsuario = porMensagem.get(id);
    resultado[id] = porUsuario
      ? Array.from(porUsuario.values()).map(row => _rowParaDominio(row, resolverNomeAvaliador?.(row.usuario_id, row.origem_identidade) || null))
      : [];
  }
  return resultado;
}

/**
 * Relatório agregado de homologação. Considera só a avaliação ATUAL de cada
 * (mensagem, usuário) -- resolvido primeiro em JS (mesmo padrão do resto do
 * arquivo) e só então agregado. Cruza com investigacao_execucoes (provider/
 * model/quality_gate) via execucao_id, e com chamados.produto via
 * atendimentos.referencia_externa -> chamados.numero (mesmo join usado na
 * auditoria do #035988).
 */
function obterResumoAgregado(empresaId, { provider = null, model = null, produto = null } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();

  const rows = db.prepare(`
    SELECT * FROM avaliacoes_investigacao WHERE empresa_id = ?
     ORDER BY criado_em ASC, rowid ASC
  `).all(Number(empresaId));

  const atuaisPorChave = new Map();
  for (const row of rows) atuaisPorChave.set(`${row.mensagem_assistente_id}:${row.usuario_id}`, row);
  const atuais = Array.from(atuaisPorChave.values());

  const execucaoIds = Array.from(new Set(atuais.map(r => r.execucao_id).filter(Boolean)));
  const execucoesPorId = new Map();
  for (const execId of execucaoIds) {
    const exec = investigacaoExecucaoRepo.getExecucao(empresaId, execId);
    if (exec) execucoesPorId.set(execId, exec);
  }

  const atendimentoIds = Array.from(new Set(atuais.map(r => r.atendimento_id)));
  const produtoPorAtendimento = new Map();
  if (atendimentoIds.length) {
    const placeholders = atendimentoIds.map(() => '?').join(',');
    const linhas = db.prepare(`
      SELECT a.id AS atendimento_id, c.produto AS produto
        FROM atendimentos a
        LEFT JOIN chamados c ON c.empresa_id = a.empresa_id AND c.numero = a.referencia_externa
       WHERE a.id IN (${placeholders})
    `).all(...atendimentoIds);
    for (const l of linhas) produtoPorAtendimento.set(l.atendimento_id, l.produto || null);
  }

  const enriquecidos = atuais.map(row => {
    const exec = row.execucao_id ? execucoesPorId.get(row.execucao_id) : null;
    return {
      dominio: _rowParaDominio(row),
      provider: exec?.provider || null,
      model: exec?.model || null,
      produto: produtoPorAtendimento.get(row.atendimento_id) || null,
      qgAprovado: exec?.qualityGate?.aprovado === true,
    };
  }).filter(item => {
    if (provider && item.provider !== provider) return false;
    if (model && item.model !== model) return false;
    if (produto && item.produto !== produto) return false;
    return true;
  });

  const total = enriquecidos.length;
  const somaNotas = enriquecidos.reduce((acc, item) => acc + item.dominio.notaTotal, 0);
  const mediaGeral = total ? somaNotas / total : 0;

  const distribuicaoFaixas = { EXCELENTE: 0, BOA: 0, PARCIAL: 0, INSATISFATORIA: 0 };
  for (const item of enriquecidos) distribuicaoFaixas[item.dominio.faixa]++;

  function _agruparPor(chave) {
    const grupos = new Map();
    for (const item of enriquecidos) {
      const valor = item[chave] || 'NÃO_IDENTIFICADO';
      const grupo = grupos.get(valor) || { total: 0, somaNotas: 0 };
      grupo.total++;
      grupo.somaNotas += item.dominio.notaTotal;
      grupos.set(valor, grupo);
    }
    return Array.from(grupos.entries()).map(([valor, g]) => ({
      valor, total: g.total, media: g.total ? g.somaNotas / g.total : 0,
    }));
  }

  const qgAprovadoMasMalAvaliadas = enriquecidos
    .filter(item => item.qgAprovado && (item.dominio.faixa === 'PARCIAL' || item.dominio.faixa === 'INSATISFATORIA'))
    .map(item => ({
      atendimentoId: item.dominio.atendimentoId,
      mensagemAssistenteId: item.dominio.mensagemAssistenteId,
      notaTotal: item.dominio.notaTotal,
      faixa: item.dominio.faixa,
      provider: item.provider,
      model: item.model,
    }));

  const erroTecnicoCriticoSinalizado = enriquecidos
    .filter(item => item.dominio.erroTecnicoCritico)
    .map(item => ({
      atendimentoId: item.dominio.atendimentoId,
      mensagemAssistenteId: item.dominio.mensagemAssistenteId,
      notaTotal: item.dominio.notaTotal,
      observacoes: item.dominio.observacoes,
    }));

  return {
    total,
    mediaGeral,
    distribuicaoFaixas,
    porProvider: _agruparPor('provider'),
    porModel: _agruparPor('model'),
    porProduto: _agruparPor('produto'),
    qgAprovadoMasMalAvaliadas,
    erroTecnicoCriticoSinalizado,
  };
}

module.exports = {
  NOTA_MIN,
  NOTA_MAX,
  FAIXAS,
  faixaDeNota,
  registrarAvaliacao,
  obterAvaliacaoAtualDoUsuario,
  listarHistoricoDoUsuario,
  listarAvaliacoesAtuaisDaMensagem,
  listarAvaliacoesAtuaisPorMensagens,
  obterResumoAgregado,
};
