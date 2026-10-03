const repo = require('../repositories/investigacao-dossie-repository');
const { getDB } = require('../database');

const TIPOS_ITEM = new Set(['FATO', 'HIPOTESE', 'TESTE', 'RESULTADO']);
const STATUS_DOSSIE = new Set([
  'COLETANDO_EVIDENCIAS',
  'INVESTIGANDO',
  'AGUARDANDO_TESTE',
  'CORRECAO_PROPOSTA',
  'AGUARDANDO_VALIDACAO',
  'RESOLVIDO',
  'INCONCLUSIVO',
]);
const STATUS_ITEM = {
  FATO: new Set(['REGISTRADO', 'INVALIDADO']),
  HIPOTESE: new Set(['ABERTA', 'EM_TESTE', 'CONFIRMADA', 'DESCARTADA']),
  TESTE: new Set(['SOLICITADO', 'AGUARDANDO_EXECUCAO', 'EXECUTADO', 'INCONCLUSIVO', 'CANCELADO']),
  RESULTADO: new Set(['REGISTRADO', 'INCONCLUSIVO', 'INVALIDADO']),
};
const STATUS_PADRAO = {
  FATO: 'REGISTRADO',
  HIPOTESE: 'ABERTA',
  TESTE: 'SOLICITADO',
  RESULTADO: 'REGISTRADO',
};
const CONFIANCAS = new Set(['BAIXA', 'MEDIA', 'ALTA']);
const ALVOS = new Set(['mensagem', 'anexo', 'execucao', 'chamado_historico', 'posicionamento', 'fonte_externa', 'versao_anexo', 'item']);

function _erroConflito(mensagem) {
  const err = new Error(mensagem || 'Conflito de versao do dossie.');
  err.code = 'CONFLITO_VERSAO_DOSSIE';
  err.status = 409;
  return err;
}

function _obrigatorio(valor, nome) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    throw new Error(`${nome} e obrigatorio.`);
  }
}

function _validarStatusDossie(status) {
  if (status && !STATUS_DOSSIE.has(status)) throw new Error(`status de dossie invalido: ${status}.`);
}

function _validarItem(tipo, dados = {}) {
  if (!TIPOS_ITEM.has(tipo)) throw new Error(`tipo de item invalido: ${tipo}.`);
  const status = dados.status || STATUS_PADRAO[tipo];
  if (!STATUS_ITEM[tipo].has(status)) throw new Error(`status invalido para ${tipo}: ${status}.`);
  if (dados.confianca && !CONFIANCAS.has(dados.confianca)) throw new Error(`confianca invalida: ${dados.confianca}.`);
  _obrigatorio(dados.descricao, 'descricao');
  return { status };
}

function _validarDossiePertence(empresaId, atendimentoId, dossie) {
  if (!dossie || dossie.empresaId !== Number(empresaId) || dossie.atendimentoId !== atendimentoId) {
    throw new Error('Dossie nao encontrado nesta empresa/atendimento.');
  }
}

function _validarAlvo(empresaId, atendimentoId, relacao, db = getDB()) {
  if (!relacao?.alvoTipo || !ALVOS.has(relacao.alvoTipo)) throw new Error(`alvo_tipo invalido: ${relacao?.alvoTipo}.`);
  _obrigatorio(relacao.alvoId, 'alvoId');
  _obrigatorio(relacao.papel, 'papel');

  const empresa = Number(empresaId);
  const alvoId = relacao.alvoId;
  let row = null;
  if (relacao.alvoTipo === 'mensagem') {
    row = db.prepare('SELECT 1 FROM mensagens WHERE id = ? AND empresa_id = ? AND atendimento_id = ?').get(alvoId, empresa, atendimentoId);
  } else if (relacao.alvoTipo === 'anexo' || relacao.alvoTipo === 'versao_anexo') {
    row = db.prepare('SELECT 1 FROM anexos WHERE id = ? AND empresa_id = ? AND atendimento_id = ?').get(alvoId, empresa, atendimentoId);
  } else if (relacao.alvoTipo === 'execucao') {
    row = db.prepare('SELECT 1 FROM investigacao_execucoes WHERE id = ? AND empresa_id = ? AND atendimento_id = ?').get(alvoId, empresa, atendimentoId);
  } else if (relacao.alvoTipo === 'item') {
    row = db.prepare('SELECT 1 FROM investigacao_itens WHERE id = ? AND empresa_id = ? AND atendimento_id = ?').get(alvoId, empresa, atendimentoId);
  } else if (relacao.alvoTipo === 'chamado_historico') {
    row = db.prepare('SELECT 1 FROM chamados WHERE id = ? AND empresa_id = ?').get(alvoId, empresa);
  } else if (relacao.alvoTipo === 'posicionamento') {
    row = db.prepare('SELECT 1 FROM posicionamentos WHERE id = ? AND empresa_id = ?').get(alvoId, empresa);
  } else if (relacao.alvoTipo === 'fonte_externa') {
    row = { ok: 1 };
  }

  if (!row) throw new Error(`Alvo de proveniencia nao encontrado nesta empresa/atendimento: ${relacao.alvoTipo}.`);
}

function _validarReferenciasDeAtualizacao(empresaId, atendimentoId, dados = {}, db = getDB()) {
  const empresa = Number(empresaId);
  for (const campo of ['atualizadoPorMensagemId', 'criadoPorMensagemId']) {
    if (!dados[campo]) continue;
    const row = db.prepare('SELECT 1 FROM mensagens WHERE id = ? AND empresa_id = ? AND atendimento_id = ?').get(dados[campo], empresa, atendimentoId);
    if (!row) throw new Error(`${campo} nao pertence a esta empresa/atendimento.`);
  }
  for (const campo of ['atualizadoPorExecucaoId', 'criadoPorExecucaoId']) {
    if (!dados[campo]) continue;
    const row = db.prepare('SELECT 1 FROM investigacao_execucoes WHERE id = ? AND empresa_id = ? AND atendimento_id = ?').get(dados[campo], empresa, atendimentoId);
    if (!row) throw new Error(`${campo} nao pertence a esta empresa/atendimento.`);
  }
}

function obterOuCriarDossie(empresaId, atendimentoId, dados = {}) {
  _obrigatorio(empresaId, 'empresaId');
  _obrigatorio(atendimentoId, 'atendimentoId');
  _validarStatusDossie(dados.status);
  return repo.executarTransacao(() => repo.criarDossieSeNecessario(empresaId, atendimentoId, dados));
}

function obterEstadoCompleto(empresaId, atendimentoId) {
  _obrigatorio(empresaId, 'empresaId');
  _obrigatorio(atendimentoId, 'atendimentoId');
  const dossie = obterOuCriarDossie(empresaId, atendimentoId);
  const estado = repo.getEstadoCompleto(empresaId, atendimentoId);
  return estado || { dossie, fatos: [], hipoteses: [], testes: [], resultados: [], relacoes: [] };
}

function atualizarDossie(empresaId, atendimentoId, dados = {}, opcoes = {}) {
  _validarStatusDossie(dados.status);
  if (dados.nivelConfianca && !CONFIANCAS.has(dados.nivelConfianca)) throw new Error(`nivel de confianca invalido: ${dados.nivelConfianca}.`);

  return repo.executarTransacao(() => {
    const dossie = repo.criarDossieSeNecessario(empresaId, atendimentoId);
    _validarReferenciasDeAtualizacao(empresaId, atendimentoId, dados);
    const atualizado = repo.atualizarDossie(empresaId, dossie.id, dados, { versaoEsperada: opcoes.versaoEsperada });
    if (atualizado?.conflito) throw _erroConflito();
    return atualizado;
  });
}

function marcarStale(empresaId, atendimentoId, stale, opcoes = {}) {
  return atualizarDossie(empresaId, atendimentoId, {
    stale: !!stale,
    atualizadoPorMensagemId: opcoes.mensagemId ?? undefined,
    atualizadoPorExecucaoId: opcoes.execucaoId ?? undefined,
  }, opcoes);
}

function criarItem(empresaId, atendimentoId, dados = {}) {
  const tipo = dados.tipo;
  const { status } = _validarItem(tipo, dados);

  return repo.executarTransacao((db) => {
    const dossie = repo.criarDossieSeNecessario(empresaId, atendimentoId, {}, db);
    _validarReferenciasDeAtualizacao(empresaId, atendimentoId, dados, db);
    const seq = repo.proximoCodigoEOrdem(empresaId, atendimentoId, tipo, db);
    const item = repo.criarItem(empresaId, dossie.id, {
      tipo,
      codigo: dados.codigo || seq.codigo,
      titulo: dados.titulo,
      descricao: dados.descricao,
      status,
      confianca: dados.confianca,
      dados: dados.dados,
      ordem: dados.ordem || seq.ordem,
      criadoPorMensagemId: dados.criadoPorMensagemId,
      atualizadoPorMensagemId: dados.atualizadoPorMensagemId || dados.criadoPorMensagemId,
      criadoPorExecucaoId: dados.criadoPorExecucaoId,
      atualizadoPorExecucaoId: dados.atualizadoPorExecucaoId || dados.criadoPorExecucaoId,
    }, db);

    for (const relacao of dados.relacoes || []) {
      _validarAlvo(empresaId, atendimentoId, relacao, db);
      repo.criarRelacao(empresaId, item.id, relacao, db);
    }

    const bump = repo.atualizarDossie(empresaId, dossie.id, {
      stale: dossie.stale,
      atualizadoPorMensagemId: dados.atualizadoPorMensagemId || dados.criadoPorMensagemId,
      atualizadoPorExecucaoId: dados.atualizadoPorExecucaoId || dados.criadoPorExecucaoId,
    }, {}, db);
    if (bump?.conflito) throw _erroConflito();
    return repo.getItem(empresaId, item.id, db);
  });
}

function atualizarItem(empresaId, atendimentoId, itemId, dados = {}) {
  return repo.executarTransacao((db) => {
    const item = repo.getItem(empresaId, itemId, db);
    if (!item || item.atendimentoId !== atendimentoId) throw new Error('Item nao encontrado nesta empresa/atendimento.');
    _validarReferenciasDeAtualizacao(empresaId, atendimentoId, dados, db);
    const tipo = item.tipo;
    if (dados.status && !STATUS_ITEM[tipo].has(dados.status)) throw new Error(`status invalido para ${tipo}: ${dados.status}.`);
    if (dados.confianca && !CONFIANCAS.has(dados.confianca)) throw new Error(`confianca invalida: ${dados.confianca}.`);

    const atualizado = repo.atualizarItem(empresaId, itemId, dados, db);
    const dossie = repo.getDossie(empresaId, item.dossieId, db);
    repo.atualizarDossie(empresaId, dossie.id, {
      stale: dossie.stale,
      atualizadoPorMensagemId: dados.atualizadoPorMensagemId,
      atualizadoPorExecucaoId: dados.atualizadoPorExecucaoId,
    }, {}, db);
    return atualizado;
  });
}

function criarRelacao(empresaId, atendimentoId, itemId, dados = {}) {
  return repo.executarTransacao((db) => {
    const item = repo.getItem(empresaId, itemId, db);
    if (!item || item.atendimentoId !== atendimentoId) throw new Error('Item nao encontrado nesta empresa/atendimento.');
    _validarAlvo(empresaId, atendimentoId, dados, db);
    const relacao = repo.criarRelacao(empresaId, itemId, dados, db);
    const dossie = repo.getDossie(empresaId, item.dossieId, db);
    repo.atualizarDossie(empresaId, dossie.id, { stale: dossie.stale }, {}, db);
    return relacao;
  });
}

function listarItens(empresaId, atendimentoId, filtros = {}) {
  return repo.listarItens(empresaId, atendimentoId, filtros);
}

function listarRelacoes(empresaId, atendimentoId, filtros = {}) {
  return repo.listarRelacoes(empresaId, atendimentoId, filtros);
}

module.exports = {
  TIPOS_ITEM,
  STATUS_DOSSIE,
  STATUS_ITEM,
  ALVOS,
  obterOuCriarDossie,
  obterEstadoCompleto,
  atualizarDossie,
  marcarStale,
  criarItem,
  atualizarItem,
  criarRelacao,
  listarItens,
  listarRelacoes,
};
