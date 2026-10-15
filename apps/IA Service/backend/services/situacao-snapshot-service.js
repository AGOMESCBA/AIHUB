'use strict';

/**
 * Snapshot compartilhado da situação dos chamados ABERTOS na origem (2026-10).
 *
 * Um único serviço, reutilizado pelo Refresh (detectar o que mudou) e pelo
 * gate de pesquisa externa (situação mais recente antes de decidir) — nunca
 * duplicar essa consulta em outro lugar.
 *
 *  - Cache por empresa + fonte, TTL ~60 s.
 *  - Single-flight: N chamadas concorrentes compartilham UMA consulta.
 *  - Falha/timeout: devolve o último snapshot bom (até 5 min) marcado como
 *    `cache_antigo`; sem snapshot utilizável, devolve { ok:false }.
 *  - Truncamento (limite de linhas): `truncado:true`. Ausência no snapshot
 *    NUNCA é prova de encerramento — quem consome decide por ID.
 *  - Somente leitura; não grava nada no banco local.
 */

const agenteRepo = require('../repositories/agente-local-repository');
const { resolverAdapter } = require('./import/adapters');

const TTL_PADRAO_MS = 60 * 1000;
const MAX_IDADE_FALLBACK_MS = 5 * 60 * 1000;
const LIMITE_LINHAS_PADRAO = 3000;
const TIMEOUT_PADRAO_MS = 20 * 1000;

const cache = new Map(); // `${empresaId}:${fonteId}` -> { snapshot, promise }
const metricas = { consultasOrigem: 0, acertosCache: 0, falhas: 0, totalMsOrigem: 0 };

function _chave(empresaId, fonteId) {
  return `${Number(empresaId)}:${fonteId}`;
}

function _normalizarLinhas(linhas) {
  const mapa = new Map();
  for (const l of linhas || []) {
    const numero = String(l.NUM ?? '').trim();
    if (!numero) continue;
    const temAnexos = l.N_ANEXOS_GRID != null || l.N_ANEXOS_POS != null || l.N_ANEXO_CHAMADO != null;
    const nGrid = Number(l.N_ANEXOS_GRID || 0);
    const nPosAnexo = Number(l.N_ANEXOS_POS || 0);
    const nChamado = Number(l.N_ANEXO_CHAMADO || 0);
    mapa.set(numero, {
      numero,
      aguardando: l.AGUARDANDO ?? null,
      responsavel: l.RESPONSAVEL ?? null,
      ultTransicao: l.ULT_TRANSICAO ?? null,
      nPos: l.N_POS != null ? Number(l.N_POS) : null,
      ultPos: l.ULT_POS != null ? Number(l.ULT_POS) : null,
      // Metadados de anexos (sem binário). null = origem não informou.
      nAnexos: temAnexos ? nGrid + nPosAnexo + nChamado : null,
      anexosSig: temAnexos ? [nGrid, l.ULT_ANEXO_GRID ?? '', nPosAnexo, nChamado].join('|') : null,
    });
  }
  return mapa;
}

/** Marca de mudança: qualquer diferença indica que o chamado precisa ser relido. */
function marcaDe(item) {
  if (!item) return null;
  return [item.aguardando ?? '', item.responsavel ?? '', item.ultTransicao ?? '', item.nPos ?? '', item.ultPos ?? ''].join('|');
}

function _comTimeout(promise, ms) {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout de ${ms}ms ao consultar o snapshot na origem`)), ms);
  });
  return Promise.race([promise, limite]).finally(() => clearTimeout(timer));
}

async function _carregar(empresaId, fonteId, { limite, timeoutMs, carregar, agora }) {
  const t0 = Date.now();
  metricas.consultasOrigem++;
  try {
    let bruto;
    if (carregar) {
      bruto = await _comTimeout(Promise.resolve(carregar()), timeoutMs);
    } else {
      const fonte = agenteRepo.getFonte(empresaId, fonteId);
      if (!fonte) throw new Error('Fonte não encontrada para o snapshot.');
      const adapter = resolverAdapter(fonte.adapter);
      if (typeof adapter.listarSnapshotAbertos !== 'function') throw new Error('Adapter sem suporte a snapshot.');
      bruto = await _comTimeout(adapter.listarSnapshotAbertos(empresaId, fonte, { limite }), timeoutMs);
    }
    const ms = Date.now() - t0;
    metricas.totalMsOrigem += ms;
    return {
      ok: true,
      mapa: _normalizarLinhas(bruto.linhas),
      truncado: !!bruto.truncado,
      carregadoEm: agora(),
      duracaoMs: ms,
    };
  } catch (err) {
    metricas.falhas++;
    metricas.totalMsOrigem += Date.now() - t0;
    throw err;
  }
}

/**
 * @returns {Promise<{ok:boolean, mapa?:Map, truncado?:boolean, carregadoEm?:number,
 *   idadeMs?:number, origem?:'fresco'|'cache'|'cache_antigo', erro?:string}>}
 */
async function obterSnapshot(empresaId, fonteId, opts = {}) {
  if (!empresaId || !fonteId) return { ok: false, erro: 'empresaId e fonteId são obrigatórios.' };
  const {
    force = false, ttlMs = TTL_PADRAO_MS, limite = LIMITE_LINHAS_PADRAO,
    timeoutMs = TIMEOUT_PADRAO_MS, carregar, agora = Date.now,
  } = opts;
  const chave = _chave(empresaId, fonteId);
  const entrada = cache.get(chave) || { snapshot: null, promise: null };
  cache.set(chave, entrada);

  const idade = entrada.snapshot ? agora() - entrada.snapshot.carregadoEm : Infinity;
  if (!force && entrada.snapshot && idade < ttlMs) {
    metricas.acertosCache++;
    return { ...entrada.snapshot, idadeMs: idade, origem: 'cache' };
  }

  if (!entrada.promise) {
    entrada.promise = _carregar(empresaId, fonteId, { limite, timeoutMs, carregar, agora })
      .then((snap) => { entrada.snapshot = snap; return snap; })
      .finally(() => { entrada.promise = null; });
  }

  try {
    const snap = await entrada.promise;
    return { ...snap, idadeMs: agora() - snap.carregadoEm, origem: 'fresco' };
  } catch (err) {
    const anterior = entrada.snapshot;
    const idadeAnterior = anterior ? agora() - anterior.carregadoEm : Infinity;
    if (anterior && idadeAnterior < MAX_IDADE_FALLBACK_MS) {
      return { ...anterior, idadeMs: idadeAnterior, origem: 'cache_antigo', erro: err.message };
    }
    return { ok: false, erro: err.message };
  }
}

/** Fonte SoftExpert ativa padrão da empresa (mesmo critério do radar-refresh). */
function fontesElegiveis(empresaId) {
  return agenteRepo
    .listarFontes(empresaId, { ativo: true })
    .filter(f => !f.sistemaOrigem || String(f.sistemaOrigem).toLowerCase() === 'softexpert');
}

function lerMetricas() { return { ...metricas }; }
function _resetarParaTeste() {
  cache.clear();
  metricas.consultasOrigem = 0; metricas.acertosCache = 0; metricas.falhas = 0; metricas.totalMsOrigem = 0;
}

module.exports = {
  obterSnapshot, marcaDe, fontesElegiveis, lerMetricas,
  TTL_PADRAO_MS, MAX_IDADE_FALLBACK_MS, LIMITE_LINHAS_PADRAO,
  _resetarParaTeste,
};
