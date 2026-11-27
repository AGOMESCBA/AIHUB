'use strict';

// L2 — biblioteca pura de indicadores do painel de atendimento (etapa C12).
// Sem banco, sem IO e sem relógio global: o instante de referência entra por parâmetro.
//
// Regra de primeira resposta (docs/contratos.md §2 e §8.4):
//   Conta apenas a primeira mensagem de saída enviada por um atendente
//   (`categoria: 'mensagem'`, `direcao: 'saida'`, `autor.tipo: 'atendente'`)
//   com envio comprovado (`estado` em `['enviada', 'entregue', 'lida']`).
//   Mensagens com `estado: 'falhou'`, `'desconhecida'` ou ainda na fila/trânsito
//   (`'aceita'`, `'aguardando'`, `'encaminhada'`) NÃO contam, pois no §2
//   `aceita` não é entrega e `desconhecida` não tem comprovação.
//   Compatibilidade: se o chamador omitir a propriedade `estado` (`undefined`),
//   o item ainda é aceito para manter compatibilidade com entradas reduzidas;
//   sempre que `estado` vier informado (inclusive `null`), precisa estar em
//   `ESTADOS_RESPOSTA_COMPROVADA`.
//
// Nota de integração (etapa C12):
//   `tempoPrimeiraResposta` e `resumir` leem `conversa.itens`. Como na API REST
//   `conversaResumo` não inclui `itens` (que ficam em rota paginada separada),
//   o consumidor no servidor deve fornecer as conversas já enriquecidas com os
//   itens relevantes (ou a primeira resposta carregada do banco).
//
// Método de percentil (p90):
//   Nearest-rank (posto mais próximo): ordena as `n` amostras válidas em ordem crescente
//   e escolhe o índice 0-based `Math.ceil((p / 100) * n) - 1`.
//   Exemplos: n = 1 -> índice 0; n = 2 -> índice 1; n = 10 -> índice 8 (9º valor).
//   Com 0 amostras, devolve `null`.
//
// Mediana:
//   Ordena em ordem crescente; para `n` ímpar usa o elemento central;
//   para `n` par usa a média aritmética dos dois elementos centrais. Com 0 amostras, `null`.

const AGRUPAMENTOS_VALIDOS = Object.freeze(['setor', 'responsavel']);
const ESTADOS_RESPOSTA_COMPROVADA = Object.freeze(['enviada', 'entregue', 'lida']);
const SET_ESTADOS_COMPROVADOS = new Set(ESTADOS_RESPOSTA_COMPROVADA);

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

function parseDataOpcionalMs(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    const ms = valor.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : null;
  }
  if (typeof valor === 'string' && valor.trim()) {
    const ms = Date.parse(valor);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function mediana(valores) {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  if (ord.length % 2 === 1) return ord[meio];
  return (ord[meio - 1] + ord[meio]) / 2;
}

// Percentil pelo método nearest-rank: índice 0-based = ceil((p / 100) * n) - 1.
function percentilNearestRank(valores, p) {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ord.length - 1, Math.max(0, Math.ceil((p / 100) * ord.length) - 1));
  return ord[idx];
}

function maiorValor(valores) {
  if (!valores.length) return null;
  let max = valores[0];
  for (let i = 1; i < valores.length; i++) {
    if (valores[i] > max) max = valores[i];
  }
  return max;
}

function itemContaComoResposta(item) {
  if (!item || item.categoria !== 'mensagem' || item.direcao !== 'saida') return false;
  if (item.autor?.tipo !== 'atendente') return false;
  if (item.estado === undefined) return true;
  return SET_ESTADOS_COMPROVADOS.has(item.estado);
}

/**
 * Calcula o tempo (em ms) entre `aberta_em` e o primeiro item de mensagem
 * enviada por um atendente com envio comprovado (`enviada`, `entregue` ou `lida`).
 * Mensagens automáticas do sistema, falhas (`falhou`), incertas (`desconhecida`)
 * e mensagens ainda na fila (`aceita`, `aguardando`, `encaminhada`) não contam.
 *
 * @param {object} conversa
 * @returns {number|null}
 */
function tempoPrimeiraResposta(conversa) {
  if (!conversa || typeof conversa !== 'object') return null;
  const abertaMs = parseDataOpcionalMs(conversa.aberta_em);
  if (abertaMs === null || !Array.isArray(conversa.itens)) return null;

  let primeiroMs = null;
  for (const item of conversa.itens) {
    if (!itemContaComoResposta(item)) continue;
    const itemMs = parseDataOpcionalMs(item.em);
    if (itemMs === null) continue;
    if (primeiroMs === null || itemMs < primeiroMs) {
      primeiroMs = itemMs;
    }
  }

  if (primeiroMs === null) return null;
  return Math.max(0, primeiroMs - abertaMs);
}

/**
 * Calcula o tempo de espera atual (em ms) desde `aguardando_desde`.
 * Retorna `null` se a conversa estiver encerrada ou não estiver aguardando resposta.
 *
 * @param {object} conversa
 * @param {string|number|Date} instanteIso
 * @returns {number|null}
 */
function tempoEsperaAtual(conversa, instanteIso) {
  const agoraMs = parseDataMs(instanteIso, 'instanteIso');
  if (!conversa || typeof conversa !== 'object') return null;
  if (conversa.situacao !== 'aberta') return null;
  const aguardandoMs = parseDataOpcionalMs(conversa.aguardando_desde);
  if (aguardandoMs === null) return null;
  return Math.max(0, agoraMs - aguardandoMs);
}

/**
 * Calcula a duração total (em ms) entre `aberta_em` e `encerrada_em`.
 * Retorna `null` se a conversa ainda estiver aberta ou sem datas válidas.
 *
 * @param {object} conversa
 * @returns {number|null}
 */
function duracaoAtendimento(conversa) {
  if (!conversa || typeof conversa !== 'object') return null;
  if (conversa.situacao !== 'encerrada') return null;
  const abertaMs = parseDataOpcionalMs(conversa.aberta_em);
  const encerradaMs = parseDataOpcionalMs(conversa.encerrada_em);
  if (abertaMs === null || encerradaMs === null) return null;
  return Math.max(0, encerradaMs - abertaMs);
}

function resumirLista(lista, instanteMs) {
  let abertas = 0;
  let naFila = 0;
  let encerradas = 0;
  const respostas = [];
  const esperas = [];
  const duracoes = [];

  for (const cv of lista) {
    if (!cv || typeof cv !== 'object') continue;
    if (cv.situacao === 'aberta') {
      abertas += 1;
      if (!cv.responsavel) naFila += 1;
    } else if (cv.situacao === 'encerrada') {
      encerradas += 1;
    }

    const tr = tempoPrimeiraResposta(cv);
    if (tr !== null) respostas.push(tr);

    const te = tempoEsperaAtual(cv, instanteMs);
    if (te !== null) esperas.push(te);

    const da = duracaoAtendimento(cv);
    if (da !== null) duracoes.push(da);
  }

  return {
    total: lista.length,
    abertas,
    na_fila: naFila,
    encerradas,
    primeira_resposta: {
      mediana_ms: mediana(respostas),
      p90_ms: percentilNearestRank(respostas, 90),
      amostras: respostas.length,
    },
    espera_atual: {
      maior_ms: maiorValor(esperas),
      mediana_ms: mediana(esperas),
    },
    duracao: {
      mediana_ms: mediana(duracoes),
      amostras: duracoes.length,
    },
  };
}

/**
 * Resume os indicadores de um conjunto de conversas, com agrupamento opcional
 * por `setor` ou `responsavel`.
 *
 * @param {Array<object>} conversas
 * @param {string|number|Date} instanteIso
 * @param {{ agruparPor?: 'setor'|'responsavel'|null }} [opcoes]
 */
function resumir(conversas, instanteIso, opcoes = {}) {
  if (!Array.isArray(conversas)) {
    throw new TypeError('conversas deve ser uma lista.');
  }
  const instanteMs = parseDataMs(instanteIso, 'instanteIso');
  const { agruparPor = null } = opcoes || {};

  if (agruparPor !== null && agruparPor !== undefined && !AGRUPAMENTOS_VALIDOS.includes(agruparPor)) {
    throw new TypeError("agruparPor deve ser 'setor', 'responsavel' ou null.");
  }

  const geral = resumirLista(conversas, instanteMs);
  if (!agruparPor) return geral;

  const mapa = new Map();
  for (const cv of conversas) {
    let id;
    let nome;
    if (agruparPor === 'setor') {
      id = cv?.setor?.id ?? null;
      nome = cv?.setor?.nome || 'Sem setor';
    } else {
      id = cv?.responsavel?.id ?? null;
      nome = cv?.responsavel?.nome || 'Sem responsável';
    }
    const chave = id === null ? '__sem__' : String(id);
    if (!mapa.has(chave)) {
      mapa.set(chave, { id, nome, itens: [] });
    }
    mapa.get(chave).itens.push(cv);
  }

  const grupos = [...mapa.values()]
    .sort((a, b) => {
      if (a.id === null && b.id !== null) return 1;
      if (a.id !== null && b.id === null) return -1;
      return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    })
    .map((g) => ({
      id: g.id,
      nome: g.nome,
      ...resumirLista(g.itens, instanteMs),
    }));

  return { ...geral, grupos };
}

module.exports = {
  ESTADOS_RESPOSTA_COMPROVADA,
  tempoPrimeiraResposta,
  tempoEsperaAtual,
  duracaoAtendimento,
  resumir,
};
