'use strict';

// G7 (Antigravity) — biblioteca pura de agenda de reentrega e classificação de
// respostas de webhooks (sem banco, sem IO). Contrato: docs/contratos.md §6.
//
// Agenda de retentativas:
//   1 min, 5 min, 15 min, 1 h, 3 h, 6 h; depois, a cada 6 h até completar 24 h
//   desde a criação do evento. Passou de 24 h → esgotado.

const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;
const LIMITE_JANELA_MS = 24 * HORA_MS;
const LIMITE_RESPOSTA_MS = 10 * 1000;

const DEGRAUS_MS = Object.freeze([
  1 * MINUTO_MS,
  5 * MINUTO_MS,
  15 * MINUTO_MS,
  1 * HORA_MS,
  3 * HORA_MS,
  6 * HORA_MS,
]);
const INTERVALO_APOS_DEGRAUS_MS = 6 * HORA_MS;

function parseDataMs(valor, nomeCampo) {
  if (valor instanceof Date) {
    const ms = valor.getTime();
    if (!Number.isFinite(ms)) throw new TypeError(`${nomeCampo} inválido.`);
    return ms;
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new TypeError(`${nomeCampo} inválido.`);
    return valor;
  }
  if (typeof valor === 'string' && valor.trim()) {
    const ms = Date.parse(valor);
    if (!Number.isFinite(ms)) throw new TypeError(`${nomeCampo} inválido.`);
    return ms;
  }
  throw new TypeError(`${nomeCampo} é obrigatório e deve ser uma data válida.`);
}

/**
 * Calcula o instante da próxima tentativa de entrega de webhook ou informa que
 * a janela máxima de 24 h foi esgotada.
 *
 * @param {{ tentativa: number, criadoEm: string|number|Date, agora?: string|number|Date }} p
 *        `tentativa`: número de tentativas já feitas (inteiro >= 0).
 * @returns {{ em: string } | { esgotado: true }}
 */
function proximaTentativa(p) {
  const { tentativa, criadoEm, agora } = p || {};
  if (typeof tentativa !== 'number' || !Number.isInteger(tentativa) || tentativa < 0) {
    throw new TypeError('tentativa deve ser um inteiro maior ou igual a 0.');
  }

  const criadoMs = parseDataMs(criadoEm, 'criadoEm');
  const agoraMs = agora === undefined ? Date.now() : parseDataMs(agora, 'agora');
  const limiteMs = criadoMs + LIMITE_JANELA_MS;

  const atrasoMs = tentativa < DEGRAUS_MS.length
    ? DEGRAUS_MS[tentativa]
    : INTERVALO_APOS_DEGRAUS_MS;
  const proximaMs = agoraMs + atrasoMs;

  if (proximaMs > limiteMs) {
    return { esgotado: true };
  }
  return { em: new Date(proximaMs).toISOString() };
}

/**
 * Classifica o resultado de uma tentativa de entrega de webhook.
 * Resposta OK somente quando for HTTP 2xx recebida em até 10 s sem erro de rede.
 * HTTP 410 indica endpoint permanentemente indisponível (falha definitiva).
 *
 * @param {{ status?: number|null, duracaoMs?: number|null, erroRede?: boolean|Error|string }} p
 * @returns {'entregue' | 'repetir' | 'falha_definitiva'}
 */
function classificarResposta(p) {
  const { status, duracaoMs, erroRede } = p || {};

  if (erroRede) {
    return 'repetir';
  }

  const codigoHttp = typeof status === 'number' && Number.isInteger(status) ? status : null;
  if (codigoHttp === 410) {
    return 'falha_definitiva';
  }

  if (duracaoMs !== undefined && duracaoMs !== null) {
    if (typeof duracaoMs !== 'number' || !Number.isFinite(duracaoMs) || duracaoMs < 0 || duracaoMs > LIMITE_RESPOSTA_MS) {
      return 'repetir';
    }
  }

  if (codigoHttp !== null && codigoHttp >= 200 && codigoHttp <= 299) {
    return 'entregue';
  }

  return 'repetir';
}

module.exports = {
  DEGRAUS_MS,
  INTERVALO_APOS_DEGRAUS_MS,
  LIMITE_JANELA_MS,
  LIMITE_RESPOSTA_MS,
  proximaTentativa,
  classificarResposta,
};
