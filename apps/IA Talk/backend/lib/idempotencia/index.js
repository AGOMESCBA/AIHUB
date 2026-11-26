'use strict';

// G8 (Antigravity) — biblioteca pura de idempotência para a API v1 (sem banco).
// Contrato: docs/contratos.md §6.
//   - impressaoDoPedido(corpo): SHA-256 do JSON canônico com chaves ordenadas
//   - avaliar({ registro, impressao, agora }): 'novo' | 'repetido' | 'conflito'
//   - validarChave(chave): obrigatória, 8–128 chars [A-Za-z0-9_-]

const crypto = require('crypto');
const { erro } = require('../../erros');

const JANELA_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;
const REGEX_CHAVE = /^[A-Za-z0-9_-]{8,128}$/;

function serializarCanonico(valor) {
  if (valor === null || valor === undefined) return 'null';
  if (typeof valor === 'object' && typeof valor.toJSON === 'function') {
    return serializarCanonico(valor.toJSON());
  }
  if (typeof valor !== 'object') {
    const s = JSON.stringify(valor);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(valor)) {
    return `[${valor.map((item) => serializarCanonico(item)).join(',')}]`;
  }
  const chaves = Object.keys(valor).sort();
  const pares = [];
  for (const chave of chaves) {
    const v = valor[chave];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    pares.push(`${JSON.stringify(chave)}:${serializarCanonico(v)}`);
  }
  return `{${pares.join(',')}}`;
}

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
  throw new TypeError(`${nomeCampo} deve ser uma data válida.`);
}

function compararConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Calcula o hash SHA-256 (hex minúsculo) do JSON com as chaves ordenadas de
 * forma estável. A ordem das chaves de objetos não altera o resultado; a ordem
 * dos itens de arrays altera.
 *
 * @param {unknown} corpo
 * @returns {string} 64 caracteres hexadecimais minúsculos
 */
function impressaoDoPedido(corpo) {
  const canonico = serializarCanonico(corpo);
  return crypto.createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * Avalia um pedido contra um registro de idempotência existente (ou null).
 *
 * @param {{ registro: { impressao: string, criado_em: string|number|Date } | null,
 *           impressao: string, agora?: string|number|Date }} p
 * @returns {'novo' | 'repetido' | 'conflito'}
 */
function avaliar(p) {
  const { registro, impressao, agora } = p || {};
  if (!registro) return 'novo';

  const criadoMs = parseDataMs(registro.criado_em, 'registro.criado_em');
  const agoraMs = agora === undefined ? Date.now() : parseDataMs(agora, 'agora');

  if (agoraMs - criadoMs > JANELA_IDEMPOTENCIA_MS) {
    return 'novo';
  }

  return compararConstante(registro.impressao, impressao) ? 'repetido' : 'conflito';
}

/**
 * Valida a chave de idempotência (`Idempotency-Key`): obrigatória, 8 a 128
 * caracteres contendo apenas letras ASCII, dígitos, hífen ou underscore.
 * Lança ErroTalk com `codigo: 'validacao'` (HTTP 400) se inválida.
 *
 * @param {unknown} chave
 * @returns {string}
 */
function validarChave(chave) {
  if (typeof chave !== 'string' || !chave) {
    throw erro('validacao', 'Informe o cabeçalho Idempotency-Key.', {
      status: 400,
      campos: { 'Idempotency-Key': 'Obrigatório.' },
    });
  }
  if (!REGEX_CHAVE.test(chave)) {
    throw erro(
      'validacao',
      'Idempotency-Key deve ter entre 8 e 128 caracteres, usando apenas letras, números, hífen (-) ou underscore (_).',
      {
        status: 400,
        campos: { 'Idempotency-Key': 'Use de 8 a 128 caracteres [A-Za-z0-9_-].' },
      },
    );
  }
  return chave;
}

module.exports = {
  JANELA_IDEMPOTENCIA_MS,
  impressaoDoPedido,
  avaliar,
  validarChave,
};
