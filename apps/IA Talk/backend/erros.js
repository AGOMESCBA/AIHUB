'use strict';

// Formato único de erro do IA Talk (API administrativa, pública e v1):
//   { "erro": { "codigo": "...", "mensagem": "...", "detalhe"?: ..., "campos"?: { campo: mensagem } } }
// "mensagem" é texto para a pessoa ler, em pt-BR. "codigo" é estável e é o
// que o código cliente deve comparar.

const STATUS_POR_CODIGO = Object.freeze({
  requisicao_invalida: 400,
  nao_autenticado: 401,
  sem_permissao: 403,
  nao_encontrado: 404,
  conflito: 409,
  idempotencia_conflito: 409,
  recurso_nao_suportado: 422,
  canal_desconectado: 422,
  envio_desligado: 422,
  canal_nao_autorizado: 403,
  fora_da_janela_24h: 422,
  limite_excedido: 429,
  erro_interno: 500,
  indisponivel: 503,
});

class ErroTalk extends Error {
  constructor(codigo, mensagem, { detalhe, campos, status } = {}) {
    super(mensagem);
    this.name = 'ErroTalk';
    this.codigo = codigo;
    this.status = status || STATUS_POR_CODIGO[codigo] || 500;
    if (detalhe !== undefined) this.detalhe = detalhe;
    if (campos !== undefined) this.campos = campos;
  }
}

function erro(codigo, mensagem, extra) {
  return new ErroTalk(codigo, mensagem, extra);
}

function corpoErro(err) {
  const corpo = { codigo: err.codigo, mensagem: err.message };
  if (err.detalhe !== undefined) corpo.detalhe = err.detalhe;
  if (err.campos !== undefined) corpo.campos = err.campos;
  return { erro: corpo };
}

// Último middleware das rotas de API. Erro não previsto vira 500 sem detalhe
// técnico na resposta (o detalhe vai só para o log, sem dado sensível).
function middlewareErros(log = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (err instanceof ErroTalk) return res.status(err.status).json(corpoErro(err));
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json(corpoErro(erro('requisicao_invalida', 'O corpo da requisição não é um JSON válido.')));
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json(corpoErro(erro('requisicao_invalida', 'O corpo da requisição passou do tamanho permitido.', { status: 413 })));
    }
    log.error?.(`[IA Talk] Erro não tratado em ${req.method} ${req.path}: ${err?.stack || err}`);
    return res.status(500).json(corpoErro(erro('erro_interno', 'Não foi possível concluir a operação. Tente de novo em instantes.')));
  };
}

module.exports = { ErroTalk, erro, corpoErro, middlewareErros, STATUS_POR_CODIGO };
