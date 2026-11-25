'use strict';

// G4 (Antigravity) — assinatura dos webhooks que o Talk envia aos sistemas e
// verificação do webhook da Meta (usada na G6). Assinaturas CONGELADAS na C0:
// C4 (webhooks) chama exatamente estas funções.
// Testes de contrato: apps/IA Talk/tests/g4-assinatura.test.js (tirar o `todo`).
//
// Webhook do Talk → consumidor:
//   X-Talk-Evento-Id: evt_...
//   X-Talk-Timestamp: 1764072000            (segundos, UTC)
//   X-Talk-Assinatura: sha256=<hex>         HMAC-SHA256(segredo, `${timestamp}.${corpo}`)

function _naoImplementado(nome) {
  const err = new Error(`${nome}: ainda não implementado (etapa G4).`);
  err.codigo = 'nao_implementado';
  return err;
}

/**
 * Segredo novo para o webhook de uma aplicação (mostrado uma única vez).
 * @returns {string} 32 bytes aleatórios em base64url, prefixo 'whsec_'
 */
function gerarSegredo() {
  throw _naoImplementado('gerarSegredo');
}

/**
 * @param {{ segredo: string, timestamp: number, corpo: string|Buffer }} p
 * @returns {string} 'sha256=<hex minúsculo>'
 */
function assinar(p) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('assinar');
}

/**
 * Verificação do lado do consumidor (e nos testes do Talk). Comparação em
 * tempo constante; tolerância de relógio em segundos.
 * @param {{ segredo: string, timestamp: number|string, corpo: string|Buffer,
 *           assinatura: string, toleranciaSeg?: number, agoraMs?: number }} p
 *        padrões: toleranciaSeg 300, agoraMs Date.now()
 * @returns {{ ok: true } | { ok: false, motivo: 'assinatura_ausente'|'formato_invalido'|'timestamp_invalido'|'timestamp_expirado'|'assinatura_invalida' }}
 */
function verificar(p) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('verificar');
}

/**
 * Webhook da Meta: X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(appSecret, rawBody).
 * Sempre sobre o corpo CRU (Buffer), antes de qualquer JSON.parse.
 * @param {{ appSecret: string, rawBody: Buffer, cabecalho: string|undefined }} p
 * @returns {boolean}
 */
function verificarAssinaturaMeta(p) { // eslint-disable-line no-unused-vars
  throw _naoImplementado('verificarAssinaturaMeta');
}

module.exports = { gerarSegredo, assinar, verificar, verificarAssinaturaMeta };
