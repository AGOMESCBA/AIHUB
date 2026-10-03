const crypto = require('crypto');
const { getDB } = require('../database');
const { redigirValor } = require('../services/redaction-service');

function _json(valor) {
  return valor === undefined || valor === null ? null : JSON.stringify(redigirValor(valor));
}

function _parse(valor, fallback = null) {
  if (!valor) return fallback;
  try { return redigirValor(JSON.parse(valor)); } catch (_) { return fallback; }
}

function _texto(valor) {
  return valor === undefined || valor === null ? null : redigirValor(String(valor));
}

function _rowDossie(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    status: redigirValor(row.status),
    problemaAtual: redigirValor(row.problema_atual),
    resumoEstado: redigirValor(row.resumo_estado),
    diagnosticoAtual: redigirValor(row.diagnostico_atual),
    causaRaiz: redigirValor(row.causa_raiz),
    solucaoProposta: redigirValor(row.solucao_proposta),
    solucaoAplicada: redigirValor(row.solucao_aplicada),
    resultadoValidacao: redigirValor(row.resultado_validacao),
    nivelConfianca: redigirValor(row.nivel_confianca),
    perguntasPendentes: _parse(row.perguntas_pendentes_json, []),
    pendencias: _parse(row.pendencias_json, []),
    fontesUsadas: _parse(row.fontes_usadas_json, []),
    chamadosHistoricosUsados: _parse(row.chamados_historicos_usados_json, []),
    versao: row.versao,
    stale: !!row.stale,
    atualizadoPorMensagemId: row.atualizado_por_mensagem_id,
    atualizadoPorExecucaoId: row.atualizado_por_execucao_id,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function _rowItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    dossieId: row.dossie_id,
    tipo: redigirValor(row.tipo),
    codigo: redigirValor(row.codigo),
    titulo: redigirValor(row.titulo),
    descricao: redigirValor(row.descricao),
    status: redigirValor(row.status),
    confianca: redigirValor(row.confianca),
    dados: _parse(row.dados_json, null),
    ordem: row.ordem,
    criadoPorMensagemId: row.criado_por_mensagem_id,
    atualizadoPorMensagemId: row.atualizado_por_mensagem_id,
    criadoPorExecucaoId: row.criado_por_execucao_id,
    atualizadoPorExecucaoId: row.atualizado_por_execucao_id,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function _rowRelacao(row) {
  if (!row) return null;
  return {
    id: row.id,
    empresaId: row.empresa_id,
    atendimentoId: row.atendimento_id,
    itemId: row.item_id,
    alvoTipo: redigirValor(row.alvo_tipo),
    alvoId: redigirValor(row.alvo_id),
    papel: redigirValor(row.papel),
    detalhe: _parse(row.detalhe_json, null),
    criadoEm: row.criado_em,
  };
}

function executarTransacao(fn) {
  const db = getDB();
  return db.transaction(() => fn(db))();
}

function validarAtendimento(empresaId, atendimentoId, db = getDB()) {
  const row = db.prepare('SELECT 1 FROM atendimentos WHERE id = ? AND empresa_id = ?').get(atendimentoId, Number(empresaId));
  return !!row;
}

function getDossiePorAtendimento(empresaId, atendimentoId, db = getDB()) {
  const row = db.prepare(`
    SELECT * FROM investigacao_dossies
     WHERE empresa_id = ? AND atendimento_id = ?
  `).get(Number(empresaId), atendimentoId);
  return _rowDossie(row);
}

function getDossie(empresaId, dossieId, db = getDB()) {
  const row = db.prepare(`
    SELECT * FROM investigacao_dossies
     WHERE empresa_id = ? AND id = ?
  `).get(Number(empresaId), dossieId);
  return _rowDossie(row);
}

function criarDossieSeNecessario(empresaId, atendimentoId, dados = {}, db = getDB()) {
  if (!validarAtendimento(empresaId, atendimentoId, db)) throw new Error('Atendimento nao encontrado nesta empresa.');

  const existente = getDossiePorAtendimento(empresaId, atendimentoId, db);
  if (existente) return existente;

  const agora = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO investigacao_dossies (
      id, empresa_id, atendimento_id, status, problema_atual, resumo_estado,
      diagnostico_atual, causa_raiz, solucao_proposta, solucao_aplicada,
      resultado_validacao, nivel_confianca, perguntas_pendentes_json,
      pendencias_json, fontes_usadas_json, chamados_historicos_usados_json,
      versao, stale, atualizado_por_mensagem_id, atualizado_por_execucao_id,
      criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    atendimentoId,
    dados.status || 'INVESTIGANDO',
    _texto(dados.problemaAtual),
    _texto(dados.resumoEstado),
    _texto(dados.diagnosticoAtual),
    _texto(dados.causaRaiz),
    _texto(dados.solucaoProposta),
    _texto(dados.solucaoAplicada),
    _texto(dados.resultadoValidacao),
    dados.nivelConfianca ?? null,
    _json(dados.perguntasPendentes || []),
    _json(dados.pendencias || []),
    _json(dados.fontesUsadas || []),
    _json(dados.chamadosHistoricosUsados || []),
    dados.stale ? 1 : 0,
    dados.atualizadoPorMensagemId ?? null,
    dados.atualizadoPorExecucaoId ?? null,
    agora,
    agora
  );

  return getDossiePorAtendimento(empresaId, atendimentoId, db);
}

function atualizarDossie(empresaId, dossieId, dados, { versaoEsperada } = {}, db = getDB()) {
  const atual = getDossie(empresaId, dossieId, db);
  if (!atual) return null;

  const set = [];
  const params = [];
  const map = {
    status: ['status', v => v],
    problemaAtual: ['problema_atual', _texto],
    resumoEstado: ['resumo_estado', _texto],
    diagnosticoAtual: ['diagnostico_atual', _texto],
    causaRaiz: ['causa_raiz', _texto],
    solucaoProposta: ['solucao_proposta', _texto],
    solucaoAplicada: ['solucao_aplicada', _texto],
    resultadoValidacao: ['resultado_validacao', _texto],
    nivelConfianca: ['nivel_confianca', v => v],
    perguntasPendentes: ['perguntas_pendentes_json', _json],
    pendencias: ['pendencias_json', _json],
    fontesUsadas: ['fontes_usadas_json', _json],
    chamadosHistoricosUsados: ['chamados_historicos_usados_json', _json],
    stale: ['stale', v => v ? 1 : 0],
    atualizadoPorMensagemId: ['atualizado_por_mensagem_id', v => v ?? null],
    atualizadoPorExecucaoId: ['atualizado_por_execucao_id', v => v ?? null],
  };

  for (const [chave, [coluna, normalizar]] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(dados, chave)) {
      set.push(`${coluna} = ?`);
      params.push(normalizar(dados[chave]));
    }
  }

  set.push('versao = versao + 1');
  set.push('atualizado_em = ?');
  params.push(new Date().toISOString());

  params.push(dossieId, Number(empresaId));
  let whereVersao = '';
  if (versaoEsperada !== undefined && versaoEsperada !== null) {
    whereVersao = ' AND versao = ?';
    params.push(Number(versaoEsperada));
  }

  const info = db.prepare(`
    UPDATE investigacao_dossies
       SET ${set.join(', ')}
     WHERE id = ? AND empresa_id = ?${whereVersao}
  `).run(...params);

  if (info.changes === 0) return { conflito: true, atual };
  return getDossie(empresaId, dossieId, db);
}

function listarItens(empresaId, atendimentoId, filtros = {}, db = getDB()) {
  const params = [Number(empresaId), atendimentoId];
  const condicoes = ['empresa_id = ?', 'atendimento_id = ?'];
  if (filtros.tipo) {
    condicoes.push('tipo = ?');
    params.push(filtros.tipo);
  }
  const rows = db.prepare(`
    SELECT * FROM investigacao_itens
     WHERE ${condicoes.join(' AND ')}
     ORDER BY ordem ASC, criado_em ASC
  `).all(...params);
  return rows.map(_rowItem);
}

function getItem(empresaId, itemId, db = getDB()) {
  const row = db.prepare(`
    SELECT * FROM investigacao_itens WHERE id = ? AND empresa_id = ?
  `).get(itemId, Number(empresaId));
  return _rowItem(row);
}

function proximoCodigoEOrdem(empresaId, atendimentoId, tipo, db = getDB()) {
  const prefixo = { FATO: 'F', HIPOTESE: 'H', TESTE: 'T', RESULTADO: 'R' }[tipo];
  const rowSeq = db.prepare(`
    SELECT MAX(CAST(SUBSTR(codigo, 2) AS INTEGER)) AS seq
      FROM investigacao_itens
     WHERE empresa_id = ? AND atendimento_id = ? AND tipo = ?
  `).get(Number(empresaId), atendimentoId, tipo);
  const rowOrdem = db.prepare(`
    SELECT MAX(ordem) AS ordem
      FROM investigacao_itens
     WHERE empresa_id = ? AND atendimento_id = ?
  `).get(Number(empresaId), atendimentoId);
  return {
    codigo: `${prefixo}${String((rowSeq?.seq || 0) + 1).padStart(2, '0')}`,
    ordem: (rowOrdem?.ordem || 0) + 1,
  };
}

function criarItem(empresaId, dossieId, dados, db = getDB()) {
  const dossie = getDossie(empresaId, dossieId, db);
  if (!dossie) throw new Error('Dossie nao encontrado nesta empresa.');
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO investigacao_itens (
      id, empresa_id, atendimento_id, dossie_id, tipo, codigo, titulo, descricao,
      status, confianca, dados_json, ordem, criado_por_mensagem_id,
      atualizado_por_mensagem_id, criado_por_execucao_id,
      atualizado_por_execucao_id, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    dossie.atendimentoId,
    dossieId,
    dados.tipo,
    dados.codigo,
    _texto(dados.titulo),
    _texto(dados.descricao),
    dados.status,
    dados.confianca ?? null,
    _json(dados.dados),
    dados.ordem,
    dados.criadoPorMensagemId ?? null,
    dados.atualizadoPorMensagemId ?? null,
    dados.criadoPorExecucaoId ?? null,
    dados.atualizadoPorExecucaoId ?? null,
    agora,
    agora
  );

  return getItem(empresaId, id, db);
}

function atualizarItem(empresaId, itemId, dados, db = getDB()) {
  const atual = getItem(empresaId, itemId, db);
  if (!atual) return null;

  const map = {
    titulo: ['titulo', _texto],
    descricao: ['descricao', _texto],
    status: ['status', v => v],
    confianca: ['confianca', v => v ?? null],
    dados: ['dados_json', _json],
    atualizadoPorMensagemId: ['atualizado_por_mensagem_id', v => v ?? null],
    atualizadoPorExecucaoId: ['atualizado_por_execucao_id', v => v ?? null],
  };
  const set = [];
  const params = [];
  for (const [chave, [coluna, normalizar]] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(dados, chave)) {
      set.push(`${coluna} = ?`);
      params.push(normalizar(dados[chave]));
    }
  }
  set.push('atualizado_em = ?');
  params.push(new Date().toISOString(), itemId, Number(empresaId));

  db.prepare(`
    UPDATE investigacao_itens SET ${set.join(', ')}
     WHERE id = ? AND empresa_id = ?
  `).run(...params);
  return getItem(empresaId, itemId, db);
}

function criarRelacao(empresaId, itemId, dados, db = getDB()) {
  const item = getItem(empresaId, itemId, db);
  if (!item) throw new Error('Item nao encontrado nesta empresa.');
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO investigacao_item_relacoes (
      id, empresa_id, atendimento_id, item_id, alvo_tipo, alvo_id, papel,
      detalhe_json, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(empresaId),
    item.atendimentoId,
    itemId,
    dados.alvoTipo,
    dados.alvoId,
    dados.papel,
    _json(dados.detalhe),
    agora
  );
  return getRelacao(empresaId, id, db);
}

function getRelacao(empresaId, relacaoId, db = getDB()) {
  const row = db.prepare(`
    SELECT * FROM investigacao_item_relacoes WHERE id = ? AND empresa_id = ?
  `).get(relacaoId, Number(empresaId));
  return _rowRelacao(row);
}

function listarRelacoes(empresaId, atendimentoId, filtros = {}, db = getDB()) {
  const condicoes = ['empresa_id = ?', 'atendimento_id = ?'];
  const params = [Number(empresaId), atendimentoId];
  if (filtros.itemId) {
    condicoes.push('item_id = ?');
    params.push(filtros.itemId);
  }
  const rows = db.prepare(`
    SELECT * FROM investigacao_item_relacoes
     WHERE ${condicoes.join(' AND ')}
     ORDER BY criado_em ASC
  `).all(...params);
  return rows.map(_rowRelacao);
}

function getEstadoCompleto(empresaId, atendimentoId, db = getDB()) {
  const dossie = getDossiePorAtendimento(empresaId, atendimentoId, db);
  if (!dossie) return null;
  const itens = listarItens(empresaId, atendimentoId, {}, db);
  const relacoes = listarRelacoes(empresaId, atendimentoId, {}, db);
  return {
    dossie,
    fatos: itens.filter(i => i.tipo === 'FATO'),
    hipoteses: itens.filter(i => i.tipo === 'HIPOTESE'),
    testes: itens.filter(i => i.tipo === 'TESTE'),
    resultados: itens.filter(i => i.tipo === 'RESULTADO'),
    relacoes,
  };
}

module.exports = {
  executarTransacao,
  validarAtendimento,
  criarDossieSeNecessario,
  getDossie,
  getDossiePorAtendimento,
  atualizarDossie,
  listarItens,
  getItem,
  proximoCodigoEOrdem,
  criarItem,
  atualizarItem,
  criarRelacao,
  listarRelacoes,
  getEstadoCompleto,
};
