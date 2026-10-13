// Avaliacao humana das respostas investigativas da IA -- medicao de
// utilidade tecnica real, externa ao motor (nunca altera Context Engine,
// PRR, Prompt Builder ou Quality Gate, nunca escreve no dossie).

const avaliacaoRepo = require('../repositories/avaliacao-investigacao-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const mensagemRepo = require('../repositories/mensagem-repository');
const investigacaoExecucaoRepo = require('../repositories/investigacao-execucao-repository');
const consultorService = require('./consultor-service');
const { NOTA_MIN, NOTA_MAX, CAMPOS_NOTA } = require('./avaliacao-criterios');

// Mesmo limite usado para comentario de validacao de solucao
// (COMENTARIO_MAX_CHARS em validacao-solucao-service.js) -- consistencia de
// contrato entre os dois campos de texto livre do operador.
const OBSERVACOES_MAX_CHARS = 2000;

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

function _validarNotas(notas) {
  if (!notas || typeof notas !== 'object') throw _erroValidacao('notas é obrigatório e deve ser um objeto com os 5 critérios.');
  for (const campo of CAMPOS_NOTA) {
    const valor = notas[campo];
    if (!Number.isInteger(valor) || valor < NOTA_MIN || valor > NOTA_MAX) {
      throw _erroValidacao(`Nota "${campo}" inválida: deve ser um inteiro entre ${NOTA_MIN} e ${NOTA_MAX}.`);
    }
  }
}

/**
 * Mesmo padrao de _validarComentario em validacao-solucao-service.js: aceita
 * so string ou ausencia, nunca objeto/array/numero/booleano.
 */
function _validarObservacoes(observacoes) {
  if (observacoes === null || observacoes === undefined) return null;
  if (typeof observacoes !== 'string') {
    throw _erroValidacao('observacoes deve ser texto (string) ou ausente.');
  }
  const normalizado = observacoes.trim();
  if (!normalizado) return null;
  if (normalizado.length > OBSERVACOES_MAX_CHARS) {
    throw _erroValidacao(`observacoes excede o limite de ${OBSERVACOES_MAX_CHARS} caracteres.`);
  }
  return normalizado;
}

function _validarMensagemAssistenteDoAtendimento(empresaId, atendimentoId, mensagemAssistenteId) {
  const atendimento = atendimentoRepo.getAtendimento(empresaId, atendimentoId);
  if (!atendimento) throw _naoEncontrado('Atendimento não encontrado nesta empresa.');

  const mensagem = mensagemRepo.getMensagem(empresaId, mensagemAssistenteId);
  if (!mensagem || mensagem.atendimentoId !== atendimentoId || mensagem.papel !== 'assistant') {
    throw _naoEncontrado('Mensagem do assistente não encontrada neste atendimento.');
  }
  return { atendimento, mensagem };
}

// origemIdentidade distingue de qual tabela usuarioId vem -- 'consultor_externo'
// (req.svcConsultorExterno, canal WhatsApp/J2A) usa a tabela consultores;
// qualquer outro valor (incluindo null/ausente, avaliacoes anteriores a esta
// migration) assume o caminho interno (req.session.user_id, tabela usuarios
// do IAHub) -- os dois IDs vem de tabelas diferentes e podem colidir
// numericamente, por isso nunca resolver nome sem saber a origem.
function _resolverNomeAvaliador(empresaId, usuarioId, origemIdentidade) {
  if (origemIdentidade === 'consultor_externo') {
    return consultorService.getNomeExibicao(empresaId, usuarioId);
  }
  return consultorService.getNomeExibicaoPorUsuarioIahub(usuarioId);
}

async function avaliarInvestigacao(empresaId, {
  atendimentoId, mensagemAssistenteId, notas, observacoes = null, erroTecnicoCritico = false, usuarioId,
  origemIdentidade = null,
}) {
  if (!usuarioId) throw _erroValidacao('Usuário não identificado para avaliar a investigação.');
  _validarNotas(notas);
  const observacoesValidadas = _validarObservacoes(observacoes);

  _validarMensagemAssistenteDoAtendimento(empresaId, atendimentoId, mensagemAssistenteId);

  // Defesa em profundidade (nao so esconder o botao no frontend): nunca
  // grava avaliacao numa resposta que o proprio Quality Gate ja marcou como
  // bloqueada para revisao -- pedido explicito do usuario, 2026-10.
  const statusExecucao = investigacaoExecucaoRepo.listarStatusPorMensagens(empresaId, [mensagemAssistenteId]);
  if (statusExecucao[mensagemAssistenteId] === 'revisao_necessaria_quality_gate') {
    throw _erroValidacao('Esta resposta foi bloqueada pelo Quality Gate e não pode ser avaliada como investigação.');
  }

  const evento = avaliacaoRepo.registrarAvaliacao(empresaId, {
    atendimentoId, mensagemAssistenteId, notas, observacoes: observacoesValidadas,
    erroTecnicoCritico: !!erroTecnicoCritico, usuarioId, origemIdentidade,
  });

  return { evento, avaliacaoAtual: { ...evento, nomeAvaliador: _resolverNomeAvaliador(empresaId, usuarioId, origemIdentidade) } };
}

function obterAvaliacaoAtual(empresaId, mensagemAssistenteId, usuarioId, atendimentoId = null) {
  if (atendimentoId) _validarMensagemAssistenteDoAtendimento(empresaId, atendimentoId, mensagemAssistenteId);
  const avaliacao = avaliacaoRepo.obterAvaliacaoAtualDoUsuario(empresaId, mensagemAssistenteId, usuarioId);
  if (!avaliacao) return null;
  return { ...avaliacao, nomeAvaliador: _resolverNomeAvaliador(empresaId, usuarioId, avaliacao.origemIdentidade) };
}

function obterAvaliacoesAtuaisDaMensagem(empresaId, mensagemAssistenteId) {
  return avaliacaoRepo.listarAvaliacoesAtuaisDaMensagem(
    empresaId, mensagemAssistenteId,
    (usuarioId, origemIdentidade) => _resolverNomeAvaliador(empresaId, usuarioId, origemIdentidade),
  );
}

function obterHistoricoDoUsuario(empresaId, mensagemAssistenteId, usuarioId) {
  const historico = avaliacaoRepo.listarHistoricoDoUsuario(empresaId, mensagemAssistenteId, usuarioId);
  return historico.map(evento => ({ ...evento, nomeAvaliador: _resolverNomeAvaliador(empresaId, usuarioId, evento.origemIdentidade) }));
}

function obterAvaliacoesEmLote(empresaId, mensagemAssistenteIds) {
  return avaliacaoRepo.listarAvaliacoesAtuaisPorMensagens(
    empresaId, mensagemAssistenteIds,
    (usuarioId, origemIdentidade) => _resolverNomeAvaliador(empresaId, usuarioId, origemIdentidade),
  );
}

module.exports = {
  NOTA_MIN,
  NOTA_MAX,
  avaliarInvestigacao,
  obterAvaliacaoAtual,
  obterAvaliacoesAtuaisDaMensagem,
  obterHistoricoDoUsuario,
  obterAvaliacoesEmLote,
};
