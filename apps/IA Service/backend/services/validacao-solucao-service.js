// Fase 3 - Confirmacao das Solucoes.
// A confirmacao e sempre individual por mensagem do assistente. O dossie
// continua sendo o estado investigativo global do atendimento e nao e encerrado
// automaticamente por uma validacao isolada.

const crypto = require('crypto');
const validacaoRepo = require('../repositories/validacao-solucao-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const mensagemRepo = require('../repositories/mensagem-repository');
const dossieRepo = require('../repositories/investigacao-dossie-repository');

const RESULTADOS_CONFIRMACAO = validacaoRepo.RESULTADOS_CONFIRMACAO;

// Mesmo limite usado como contrato entre backend e frontend (ver
// COMENTARIO_VALIDACAO_MAX_CHARS em atendimento.html/radar.html) — comentário
// de analista é um campo livre curto, não um laudo; 2000 chars é generoso
// para o uso real e protege contra abuso/payloads grandes no mesmo campo que
// hoje já preserva comentários legítimos sem truncar.
const COMENTARIO_MAX_CHARS = 2000;

function _naoEncontrado(mensagem) {
  const err = new Error(mensagem);
  err.status = 404;
  return err;
}

function _erroValidacao(mensagem) {
  const err = new Error(mensagem);
  err.status = 400;
  return err;
}

/**
 * Valida o campo `comentario` antes de qualquer persistência (seção 2 da
 * correção preventiva pré-publicação): aceita só string ou ausência
 * (null/undefined), nunca objeto/array/número/booleano — sem isso, o driver
 * SQLite falha o bind com uma mensagem de erro interna ("Too few parameter
 * values were provided"), vazada ao cliente como 500 genérico. Retorna o
 * comentário normalizado (string trimada, ou null se vazio/ausente) — nunca
 * lança para string vazia ou ausência, só para TIPO inválido ou excesso de
 * tamanho.
 */
function _validarComentario(comentario) {
  if (comentario === null || comentario === undefined) return null;
  if (typeof comentario !== 'string') {
    throw _erroValidacao('comentario deve ser texto (string) ou ausente.');
  }
  const normalizado = comentario.trim();
  if (!normalizado) return null;
  if (normalizado.length > COMENTARIO_MAX_CHARS) {
    throw _erroValidacao(`comentario excede o limite de ${COMENTARIO_MAX_CHARS} caracteres.`);
  }
  return normalizado;
}

function _descricaoResultado(resultado, comentario) {
  const base = {
    RESOLVEU: 'Analista confirmou explicitamente que a orientacao resolveu o problema.',
    NAO_RESOLVEU: 'Analista confirmou explicitamente que a orientacao nao resolveu o problema.',
    PARCIALMENTE: 'Analista confirmou que a orientacao resolveu parcialmente o problema; investigacao deve continuar a partir do ponto alcancado.',
    NAO_TESTADO: 'Analista informou que a orientacao ainda nao foi testada.',
  }[resultado] || 'Confirmacao registrada pelo analista.';
  return comentario ? `${base} Comentario do analista: ${comentario}` : base;
}

function _validarMensagemAssistenteDoAtendimento(empresaId, atendimentoId, mensagemAssistenteId) {
  const atendimento = atendimentoRepo.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw _naoEncontrado('Atendimento nao encontrado nesta empresa.');

  const mensagem = mensagemRepo.getMensagem(empresaId, mensagemAssistenteId);
  if (!mensagem || mensagem.atendimentoId !== atendimentoId || mensagem.papel !== 'assistant') {
    throw _naoEncontrado('Mensagem do assistente nao encontrada neste atendimento.');
  }

  return { atendimento, mensagem };
}

function _registrarValidacaoIndividualNoDossie(empresaId, atendimentoId, dossie, evento, mensagemAvaliada) {
  if (evento.resultado === 'NAO_TESTADO') return null;

  return dossieRepo.executarTransacao(db => {
    const seq = dossieRepo.proximoCodigoEOrdem(empresaId, atendimentoId, 'RESULTADO', db);
    const descricao = _descricaoResultado(evento.resultado, evento.comentario);
    const item = dossieRepo.criarItem(empresaId, dossie.id, {
      tipo: 'RESULTADO',
      codigo: seq.codigo,
      titulo: `Validacao da orientacao: ${evento.resultado}`,
      descricao,
      status: 'REGISTRADO',
      confianca: 'ALTA',
      dados: {
        natureza: 'VALIDACAO_SOLUCAO_INDIVIDUAL',
        resultado: evento.resultado,
        validacaoId: evento.id,
        mensagemAssistenteId: evento.mensagemAssistenteId,
        anexoVersaoId: evento.anexoVersaoId || null,
        comentario: evento.comentario || null,
        resumoOrientacao: mensagemAvaliada?.conteudo?.slice(0, 500) || null,
      },
      ordem: seq.ordem,
      criadoPorMensagemId: evento.mensagemAssistenteId,
      atualizadoPorMensagemId: evento.mensagemAssistenteId,
    }, db);

    dossieRepo.criarRelacao(empresaId, item.id, {
      alvoTipo: 'mensagem',
      alvoId: evento.mensagemAssistenteId,
      papel: 'orientacao_validada',
      detalhe: { validacaoId: evento.id, resultado: evento.resultado },
    }, db);

    if (evento.anexoVersaoId) {
      dossieRepo.criarRelacao(empresaId, item.id, {
        alvoTipo: 'versao_anexo',
        alvoId: evento.anexoVersaoId,
        papel: 'fonte_corrigido_validado',
        detalhe: { validacaoId: evento.id, resultado: evento.resultado },
      }, db);
    }

    return item;
  });
}

async function confirmarSolucao(empresaId, {
  atendimentoId, mensagemAssistenteId, anexoVersaoId = null, resultado, comentario = null, usuarioId,
}) {
  if (!RESULTADOS_CONFIRMACAO.has(resultado)) {
    const err = new Error(`resultado invalido: ${resultado}. Use RESOLVEU, NAO_RESOLVEU, PARCIALMENTE ou NAO_TESTADO.`);
    err.status = 400;
    throw err;
  }
  const comentarioValidado = _validarComentario(comentario);

  const { mensagem } = _validarMensagemAssistenteDoAtendimento(empresaId, atendimentoId, mensagemAssistenteId);
  const dossie = dossieRepo.getEstadoCompleto(empresaId, atendimentoId)?.dossie
    || dossieRepo.criarDossieSeNecessario(empresaId, atendimentoId);

  const evento = validacaoRepo.registrarConfirmacaoAnalista(empresaId, {
    atendimentoId, mensagemAssistenteId, anexoVersaoId, dossieId: dossie.id,
    resultado, comentario: comentarioValidado, usuarioId,
  });

  const itemValidacao = _registrarValidacaoIndividualNoDossie(empresaId, atendimentoId, dossie, evento, mensagem);
  const dossieAtualizacao = itemValidacao
    ? { status: 'validacao_individual_registrada', item: itemValidacao }
    : null;

  return { evento, estadoAtual: validacaoRepo.obterEstadoAtual(empresaId, mensagemAssistenteId), dossieAtualizacao };
}

function registrarEvidenciaExternaDeChamado(empresaId, {
  atendimentoId, mensagemAssistenteId, chamadoId, statusEncerramentoTransicao,
}) {
  if (!statusEncerramentoTransicao) return { registro: null, duplicado: false, motivo: 'sem_transicao' };

  const dossie = dossieRepo.getEstadoCompleto(empresaId, atendimentoId)?.dossie || null;
  const chaveBase = [
    chamadoId,
    statusEncerramentoTransicao.de,
    statusEncerramentoTransicao.para,
    mensagemAssistenteId,
    statusEncerramentoTransicao.eventoId || statusEncerramentoTransicao.idEvento || '',
    statusEncerramentoTransicao.ocorridoEm || statusEncerramentoTransicao.dataEvento || '',
  ].join(':');

  const chaveIdempotencia = crypto.createHash('sha256').update(chaveBase).digest('hex');

  return validacaoRepo.registrarEvidenciaExterna(empresaId, {
    atendimentoId,
    mensagemAssistenteId,
    dossieId: dossie?.id || null,
    evidenciaFonte: statusEncerramentoTransicao.reabertura
      ? 'softexpert_reabertura'
      : 'softexpert_status_encerramento',
    evidenciaDetalhe: {
      chamadoId,
      statusAnterior: statusEncerramentoTransicao.de,
      statusNovo: statusEncerramentoTransicao.para,
      reabertura: !!statusEncerramentoTransicao.reabertura,
      eventoId: statusEncerramentoTransicao.eventoId || statusEncerramentoTransicao.idEvento || null,
      ocorridoEm: statusEncerramentoTransicao.ocorridoEm || statusEncerramentoTransicao.dataEvento || null,
    },
    chaveIdempotencia,
  });
}

function obterEstadoValidacao(empresaId, mensagemAssistenteId, atendimentoId = null) {
  if (atendimentoId) _validarMensagemAssistenteDoAtendimento(empresaId, atendimentoId, mensagemAssistenteId);
  return validacaoRepo.obterEstadoAtual(empresaId, mensagemAssistenteId);
}

function obterEstadoValidacaoEmLote(empresaId, mensagemAssistenteIds) {
  return validacaoRepo.obterEstadoAtualPorMensagens(empresaId, mensagemAssistenteIds);
}

function obterResumoPendencias(empresaId) {
  return validacaoRepo.obterResumoPorEmpresa(empresaId);
}

module.exports = {
  confirmarSolucao,
  registrarEvidenciaExternaDeChamado,
  obterEstadoValidacao,
  obterEstadoValidacaoEmLote,
  obterResumoPendencias,
};
