'use strict';

const agenteRepo = require('../repositories/agente-local-repository');
const historicalSyncService = require('./import/historical-sync-service');

const INTERVALO_MINIMO_MS = 60 * 1000;
const AGUARDAR_PADRAO_MS = 8000;
const estadoPorEmpresa = new Map();

function _fontesElegiveis(empresaId) {
  return agenteRepo
    .listarFontes(empresaId, { ativo: true })
    .filter(f => !f.sistemaOrigem || String(f.sistemaOrigem).toLowerCase() === 'softexpert');
}

function _executar(empresaId, { janelaDias } = {}) {
  const promise = (async () => {
    const fontes = _fontesElegiveis(empresaId);
    const resultados = [];
    for (const fonte of fontes) {
      try {
        const importacao = await historicalSyncService.executarIncremental(empresaId, fonte.id, { janelaDias });
        resultados.push({ fonteId: fonte.id, ok: true, importacaoId: importacao?.id || null });
      } catch (err) {
        resultados.push({ fonteId: fonte.id, ok: false, erro: err.message });
        console.error(`[IA Service] Refresh do Radar falhou na fonte ${fonte.nome || fonte.id}:`, err.message);
      }
    }
    return { fontes: resultados, concluidoEm: new Date().toISOString() };
  })();

  const estado = {
    iniciadoEmMs: Date.now(),
    promise,
  };
  estadoPorEmpresa.set(Number(empresaId), estado);
  promise.then(() => {
    const atual = estadoPorEmpresa.get(Number(empresaId));
    if (atual === estado) {
      estadoPorEmpresa.set(Number(empresaId), { ...estado, promise: null, finalizadoEmMs: Date.now() });
    }
  }, () => {
    const atual = estadoPorEmpresa.get(Number(empresaId));
    if (atual === estado) {
      estadoPorEmpresa.set(Number(empresaId), { ...estado, promise: null, finalizadoEmMs: Date.now() });
    }
  });
  return promise;
}

async function sincronizarAntesDaFila(empresaId, { force = false, aguardarMs = AGUARDAR_PADRAO_MS, janelaDias } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const chave = Number(empresaId);
  const atual = estadoPorEmpresa.get(chave);
  const agora = Date.now();

  let promise = atual?.promise || null;
  const dentroDoIntervalo = atual?.iniciadoEmMs && (agora - atual.iniciadoEmMs) < INTERVALO_MINIMO_MS;

  if (!promise && (force || !dentroDoIntervalo)) {
    promise = _executar(empresaId, { janelaDias });
  }

  if (!promise) {
    return { status: 'recente', iniciadoEm: atual?.iniciadoEmMs ? new Date(atual.iniciadoEmMs).toISOString() : null };
  }

  if (!aguardarMs) {
    return { status: 'em_andamento' };
  }

  const timeout = new Promise(resolve => setTimeout(() => resolve({ _timeout: true }), aguardarMs));
  const resultado = await Promise.race([promise, timeout]);
  if (resultado?._timeout) return { status: 'em_andamento' };
  return { status: 'concluido', resultado };
}

module.exports = { sincronizarAntesDaFila };
