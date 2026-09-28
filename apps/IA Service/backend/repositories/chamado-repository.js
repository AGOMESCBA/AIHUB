// Repository de `chamados` e `posicionamentos` — entidades centrais da base
// histórica. Idempotência via chave natural (empresa, fonte, oid_origem) +
// hash_conteudo para decidir se um UPDATE é necessário (seção 21 do prompt).

const crypto = require('crypto');
const { getDB } = require('../database');

function hashConteudo(objeto) {
  const json = JSON.stringify(objeto, Object.keys(objeto).sort());
  return crypto.createHash('sha256').update(json).digest('hex');
}

function _chamadoParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, fonteId: row.fonte_id, sistemaOrigem: row.sistema_origem,
    oidOrigem: row.oid_origem, numero: row.numero, clienteId: row.cliente_id,
    solicitanteId: row.solicitante_id, tecnicoResponsavelId: row.tecnico_responsavel_id,
    dataAbertura: row.data_abertura,
    produto: row.produto, familia: row.familia, modulo: row.modulo, servico: row.servico,
    tipoChamado: row.tipo_chamado, tipoChamadoSe: row.tipo_chamado_se, tipoChamadoFinal: row.tipo_chamado_final,
    natureza: row.natureza, nivel: row.nivel,
    titulo: row.titulo, assunto: row.assunto, breveDescricao: row.breve_descricao, descricao: row.descricao,
    informacoesAdicionais: row.informacoes_adicionais, observacoes: row.observacoes,
    sla: row.sla, slaHoras: row.sla_horas, slaStatus: row.sla_status, slaStatusFinal: row.sla_status_final,
    slaInicial: row.sla_inicial, slaAnterior: row.sla_anterior,
    solucaoAplicada: row.solucao_aplicada, avaliacao: row.avaliacao, totalHoras: row.total_horas,
    chamadoReferencia: row.chamado_referencia, statusEncerramento: row.status_encerramento, slaPrazo: row.sla_prazo,
    hashConteudo: row.hash_conteudo, precisaIndexacao: !!row.precisa_indexacao, indexadoEm: row.indexado_em,
    atualizadoOrigemEm: row.atualizado_origem_em, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

const CAMPOS_CHAMADO = [
  'produto', 'familia', 'modulo', 'servico', 'tipoChamado', 'tipoChamadoSe', 'tipoChamadoFinal',
  'natureza', 'nivel', 'titulo', 'assunto', 'breveDescricao', 'descricao', 'informacoesAdicionais',
  'observacoes', 'sla', 'slaHoras', 'slaStatus', 'slaStatusFinal', 'slaInicial', 'slaAnterior',
  'solucaoAplicada', 'avaliacao', 'totalHoras', 'chamadoReferencia', 'statusEncerramento', 'slaPrazo',
];

const COLUNA_POR_CAMPO = {
  produto: 'produto', familia: 'familia', modulo: 'modulo', servico: 'servico',
  tipoChamado: 'tipo_chamado', tipoChamadoSe: 'tipo_chamado_se', tipoChamadoFinal: 'tipo_chamado_final',
  natureza: 'natureza', nivel: 'nivel', titulo: 'titulo', assunto: 'assunto',
  breveDescricao: 'breve_descricao', descricao: 'descricao', informacoesAdicionais: 'informacoes_adicionais',
  observacoes: 'observacoes', sla: 'sla', slaHoras: 'sla_horas', slaStatus: 'sla_status',
  slaStatusFinal: 'sla_status_final', slaInicial: 'sla_inicial', slaAnterior: 'sla_anterior',
  solucaoAplicada: 'solucao_aplicada', avaliacao: 'avaliacao', totalHoras: 'total_horas',
  chamadoReferencia: 'chamado_referencia', statusEncerramento: 'status_encerramento', slaPrazo: 'sla_prazo',
};

/**
 * Upsert por (empresa, fonte, oid_origem). Compara hash_conteudo do payload
 * normalizado contra o hash já armazenado — só grava UPDATE se algo mudou de
 * fato (idempotência real, não apenas "não duplica linha").
 * Retorna { chamado, resultado: 'inserido'|'atualizado'|'sem_alteracao' }.
 */
function upsertChamado(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!dados.fonteId) throw new Error('fonteId é obrigatório.');
  if (!dados.oidOrigem) throw new Error('oidOrigem é obrigatório.');
  if (!dados.numero) throw new Error('numero (IDPROCESS) é obrigatório.');

  const db = getDB();
  const agora = new Date().toISOString();

  const hashAtual = hashConteudo(Object.fromEntries(CAMPOS_CHAMADO.map(c => [c, dados[c] ?? null])));

  const existente = db.prepare(`
    SELECT * FROM chamados WHERE empresa_id = ? AND fonte_id = ? AND oid_origem = ?
  `).get(Number(empresaId), dados.fonteId, dados.oidOrigem);

  if (existente) {
    if (existente.hash_conteudo === hashAtual) {
      return { chamado: _chamadoParaDominio(existente), resultado: 'sem_alteracao' };
    }

    const sets = CAMPOS_CHAMADO.map(c => `${COLUNA_POR_CAMPO[c]} = ?`).join(', ');
    const valores = CAMPOS_CHAMADO.map(c => dados[c] ?? null);
    db.prepare(`
      UPDATE chamados
         SET ${sets}, cliente_id = ?, solicitante_id = ?, tecnico_responsavel_id = ?,
             data_abertura = ?, hash_conteudo = ?, precisa_indexacao = 1,
             atualizado_origem_em = ?, atualizado_em = ?
       WHERE id = ?
    `).run(...valores, dados.clienteId ?? null, dados.solicitanteId ?? null, dados.tecnicoResponsavelId ?? null,
      dados.dataAbertura ?? null, hashAtual, dados.atualizadoOrigemEm ?? agora, agora, existente.id);

    return { chamado: _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE id = ?`).get(existente.id)), resultado: 'atualizado' };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO chamados (
      id, empresa_id, fonte_id, sistema_origem, oid_origem, numero,
      cliente_id, solicitante_id, tecnico_responsavel_id, data_abertura,
      produto, familia, modulo, servico, tipo_chamado, tipo_chamado_se, tipo_chamado_final, natureza, nivel,
      titulo, assunto, breve_descricao, descricao, informacoes_adicionais, observacoes,
      sla, sla_horas, sla_status, sla_status_final, sla_inicial, sla_anterior,
      solucao_aplicada, avaliacao, total_horas, chamado_referencia, status_encerramento, sla_prazo,
      hash_conteudo, precisa_indexacao, atualizado_origem_em, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, Number(empresaId), dados.fonteId, dados.sistemaOrigem, dados.oidOrigem, dados.numero,
    dados.clienteId ?? null, dados.solicitanteId ?? null, dados.tecnicoResponsavelId ?? null, dados.dataAbertura ?? null,
    dados.produto ?? null, dados.familia ?? null, dados.modulo ?? null, dados.servico ?? null,
    dados.tipoChamado ?? null, dados.tipoChamadoSe ?? null, dados.tipoChamadoFinal ?? null, dados.natureza ?? null, dados.nivel ?? null,
    dados.titulo ?? null, dados.assunto ?? null, dados.breveDescricao ?? null, dados.descricao ?? null,
    dados.informacoesAdicionais ?? null, dados.observacoes ?? null,
    dados.sla ?? null, dados.slaHoras ?? null, dados.slaStatus ?? null, dados.slaStatusFinal ?? null,
    dados.slaInicial ?? null, dados.slaAnterior ?? null,
    dados.solucaoAplicada ?? null, dados.avaliacao ?? null, dados.totalHoras ?? null, dados.chamadoReferencia ?? null,
    dados.statusEncerramento ?? null, dados.slaPrazo ?? null,
    hashAtual, dados.atualizadoOrigemEm ?? agora, agora, agora
  );

  return { chamado: _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE id = ?`).get(id)), resultado: 'inserido' };
}

function getChamadoPorOid(empresaId, fonteId, oidOrigem) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE empresa_id = ? AND fonte_id = ? AND oid_origem = ?`).get(Number(empresaId), fonteId, oidOrigem));
}

function getChamado(empresaId, chamadoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  return _chamadoParaDominio(db.prepare(`SELECT * FROM chamados WHERE id = ? AND empresa_id = ?`).get(chamadoId, Number(empresaId)));
}

function listarChamados(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.precisaIndexacao !== undefined) {
    condicoes.push('precisa_indexacao = ?');
    params.push(filtros.precisaIndexacao ? 1 : 0);
  }
  const limite = Math.min(Number(filtros.limite) || 100, 5000);
  const rows = db.prepare(`SELECT * FROM chamados WHERE ${condicoes.join(' AND ')} ORDER BY data_abertura DESC LIMIT ?`).all(...params, limite);
  return rows.map(_chamadoParaDominio);
}

function contarChamados(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.fonteId) { condicoes.push('fonte_id = ?'); params.push(filtros.fonteId); }
  return db.prepare(`SELECT COUNT(*) AS total FROM chamados WHERE ${condicoes.join(' AND ')}`).get(...params).total;
}

// ── Posicionamentos ─────────────────────────────────────────────────────

function _posicionamentoParaDominio(row) {
  if (!row) return null;
  return {
    id: row.id, empresaId: row.empresa_id, fonteId: row.fonte_id, oidOrigem: row.oid_origem,
    chamadoId: row.chamado_id, dataPosicionamento: row.data_posicionamento,
    tecnicoId: row.tecnico_id, tecnicoNomeOrigem: row.tecnico_nome_origem, usuarioClienteId: row.usuario_cliente_id,
    situacao: row.situacao, tipo: row.tipo, motivo: row.motivo,
    assunto: row.assunto, descricao: row.descricao, resultado: row.resultado,
    horaInicio: row.hora_inicio, horaFim: row.hora_fim, horaIntervalo: row.hora_intervalo, totalHoras: row.total_horas,
    aguardandoRetorno: row.aguardando_retorno === null ? null : !!row.aguardando_retorno,
    situacaoRetorno: row.situacao_retorno,
    oidArquivo1: row.oid_arquivo1, oidArquivo2: row.oid_arquivo2,
    hashConteudo: row.hash_conteudo, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
  };
}

const CAMPOS_POSICIONAMENTO = ['situacao', 'tipo', 'motivo', 'assunto', 'descricao', 'resultado', 'horaInicio', 'horaFim', 'horaIntervalo', 'totalHoras', 'aguardandoRetorno', 'situacaoRetorno'];
const COLUNA_POR_CAMPO_POS = {
  situacao: 'situacao', tipo: 'tipo', motivo: 'motivo', assunto: 'assunto', descricao: 'descricao',
  resultado: 'resultado', horaInicio: 'hora_inicio', horaFim: 'hora_fim', horaIntervalo: 'hora_intervalo',
  totalHoras: 'total_horas', aguardandoRetorno: 'aguardando_retorno', situacaoRetorno: 'situacao_retorno',
};

function upsertPosicionamento(empresaId, dados) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!dados.fonteId) throw new Error('fonteId é obrigatório.');
  if (!dados.oidOrigem) throw new Error('oidOrigem é obrigatório.');
  if (!dados.chamadoId) throw new Error('chamadoId é obrigatório.');

  const db = getDB();
  const agora = new Date().toISOString();
  const hashAtual = hashConteudo(Object.fromEntries(CAMPOS_POSICIONAMENTO.map(c => [c, dados[c] ?? null])));

  const existente = db.prepare(`
    SELECT * FROM posicionamentos WHERE empresa_id = ? AND fonte_id = ? AND oid_origem = ?
  `).get(Number(empresaId), dados.fonteId, dados.oidOrigem);

  if (existente) {
    if (existente.hash_conteudo === hashAtual) {
      return { posicionamento: _posicionamentoParaDominio(existente), resultado: 'sem_alteracao' };
    }
    const sets = CAMPOS_POSICIONAMENTO.map(c => `${COLUNA_POR_CAMPO_POS[c]} = ?`).join(', ');
    const valores = CAMPOS_POSICIONAMENTO.map(c => dados[c] === undefined ? null : (typeof dados[c] === 'boolean' ? (dados[c] ? 1 : 0) : dados[c]));
    db.prepare(`
      UPDATE posicionamentos SET ${sets}, tecnico_id = ?, tecnico_nome_origem = ?, usuario_cliente_id = ?,
        data_posicionamento = ?, hash_conteudo = ?, atualizado_em = ?
      WHERE id = ?
    `).run(...valores, dados.tecnicoId ?? null, dados.tecnicoNomeOrigem ?? null, dados.usuarioClienteId ?? null,
      dados.dataPosicionamento ?? null, hashAtual, agora, existente.id);

    // Posicionamento alterado → chamado-pai precisa reindexação (conteúdo mudou).
    db.prepare(`UPDATE chamados SET precisa_indexacao = 1, atualizado_em = ? WHERE id = ?`).run(agora, dados.chamadoId);

    return { posicionamento: _posicionamentoParaDominio(db.prepare(`SELECT * FROM posicionamentos WHERE id = ?`).get(existente.id)), resultado: 'atualizado' };
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO posicionamentos (
      id, empresa_id, fonte_id, oid_origem, chamado_id, data_posicionamento,
      tecnico_id, tecnico_nome_origem, usuario_cliente_id,
      situacao, tipo, motivo, assunto, descricao, resultado,
      hora_inicio, hora_fim, hora_intervalo, total_horas, aguardando_retorno, situacao_retorno,
      oid_arquivo1, oid_arquivo2, hash_conteudo, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, Number(empresaId), dados.fonteId, dados.oidOrigem, dados.chamadoId, dados.dataPosicionamento ?? null,
    dados.tecnicoId ?? null, dados.tecnicoNomeOrigem ?? null, dados.usuarioClienteId ?? null,
    dados.situacao ?? null, dados.tipo ?? null, dados.motivo ?? null, dados.assunto ?? null, dados.descricao ?? null, dados.resultado ?? null,
    dados.horaInicio ?? null, dados.horaFim ?? null, dados.horaIntervalo ?? null, dados.totalHoras ?? null,
    dados.aguardandoRetorno === undefined || dados.aguardandoRetorno === null ? null : (dados.aguardandoRetorno ? 1 : 0),
    dados.situacaoRetorno ?? null,
    dados.oidArquivo1 ?? null, dados.oidArquivo2 ?? null, hashAtual, agora, agora
  );

  db.prepare(`UPDATE chamados SET precisa_indexacao = 1, atualizado_em = ? WHERE id = ?`).run(agora, dados.chamadoId);

  return { posicionamento: _posicionamentoParaDominio(db.prepare(`SELECT * FROM posicionamentos WHERE id = ?`).get(id)), resultado: 'inserido' };
}

function listarPosicionamentosDoChamado(empresaId, chamadoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM posicionamentos WHERE empresa_id = ? AND chamado_id = ? ORDER BY data_posicionamento ASC
  `).all(Number(empresaId), chamadoId);
  return rows.map(_posicionamentoParaDominio);
}

function contarPosicionamentos(empresaId, filtros = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const db = getDB();
  const condicoes = ['empresa_id = ?'];
  const params = [Number(empresaId)];
  if (filtros.fonteId) { condicoes.push('fonte_id = ?'); params.push(filtros.fonteId); }
  return db.prepare(`SELECT COUNT(*) AS total FROM posicionamentos WHERE ${condicoes.join(' AND ')}`).get(...params).total;
}

module.exports = {
  hashConteudo,
  upsertChamado, getChamadoPorOid, getChamado, listarChamados, contarChamados,
  upsertPosicionamento, listarPosicionamentosDoChamado, contarPosicionamentos,
};
