'use strict';

// Diagnostico incremental do travamento de processarTurno com monkey-patch
// de resolverKeysEOrdem. NAO altera codigo de producao — so instrumenta via
// logs e watchdog externo (process.exit forcado).

require('dotenv').config({ path: 'c:/Apps/iahub/.env' });

const WATCHDOG_MS = 230000;
const watchdog = setTimeout(() => {
  console.error(`\n### WATCHDOG disparado apos ${WATCHDOG_MS}ms — forcando saida. ###`);
  console.error('Stack dump do event loop (best effort):');
  try {
    // eslint-disable-next-line no-undef
    console.error(process._getActiveHandles ? process._getActiveHandles().length + ' handles ativos' : 'sem _getActiveHandles');
    console.error(process._getActiveRequests ? process._getActiveRequests().length + ' requests ativos' : 'sem _getActiveRequests');
  } catch (e) { console.error('erro ao inspecionar handles:', e.message); }
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref || null; // nao usar unref -- queremos que o watchdog PREVALEÇA

const DB_PATH = 'C:/tmp/ia-service-auditoria-independente-10casos.db';
const EMPRESA_ID = 1;
const ATENDIMENTO_ID = 'e7d7a4a2-fd29-4f14-9f59-f6265d2849e6';

function log(...args) {
  console.log(`[+${Date.now() - T0}ms]`, ...args);
}
const T0 = Date.now();

async function main() {
  log('iniciando...');

  const database = require('c:/Apps/iahub/apps/IA Service/backend/database');
  database.inicializarDB(DB_PATH);
  log('DB inicializado');

  const aiConfigService = require('c:/Apps/iahub/apps/IA Service/backend/services/ai-config-service');
  const originalResolver = aiConfigService.resolverKeysEOrdem;

  let chamadasPatch = 0;
  aiConfigService.resolverKeysEOrdem = (empresaId) => {
    chamadasPatch += 1;
    log(`>>> resolverKeysEOrdem (PATCHED) chamada #${chamadasPatch} para empresaId=${empresaId}`);
    const resolved = originalResolver(empresaId);
    const out = {
      keys: resolved.keys,
      cfg: {
        ...resolved.cfg,
        provedorPrimario: 'groq',
        fallbackOrdem: 'groq',
        modelos: { ...(resolved.cfg?.modelos || {}) },
      },
    };
    log(`<<< resolverKeysEOrdem (PATCHED) retornou #${chamadasPatch}:`, JSON.stringify({ provedorPrimario: out.cfg.provedorPrimario, fallbackOrdem: out.cfg.fallbackOrdem, keysPresentes: Object.keys(out.keys).filter(k => out.keys[k]) }));
    return out;
  };

  const aiProviderClient = require('c:/Apps/iahub/apps/IA Service/backend/services/ai-provider-client');
  const originalChamarIA = aiProviderClient.chamarIA;
  let chamadasIA = 0;
  aiProviderClient.chamarIA = async (...args) => {
    const id = ++chamadasIA;
    const [keys, cfg, systemPrompt, userPrompt, imagens, opts] = args;
    log(`>>> chamarIA #${id} iniciando — provedorPrimario=${cfg?.provedorPrimario} fallbackOrdem=${cfg?.fallbackOrdem} imagens=${(imagens || []).length} timeoutMs=${opts?.timeoutMs} maxTokens=${opts?.maxTokens} userPromptLen=${typeof userPrompt === 'string' ? userPrompt.length : JSON.stringify(userPrompt).length}`);
    const t0 = Date.now();
    try {
      const r = await originalChamarIA(...args);
      log(`<<< chamarIA #${id} OK em ${Date.now() - t0}ms — provider=${r.provider} model=${r.model}`);
      return r;
    } catch (err) {
      log(`<<< chamarIA #${id} ERRO em ${Date.now() - t0}ms — ${err.message}`);
      throw err;
    }
  };

  const technicalResearchService = require('c:/Apps/iahub/apps/IA Service/backend/services/technical-research-service');
  const originalPesquisar = technicalResearchService.pesquisar;
  technicalResearchService.pesquisar = async (...args) => {
    log('>>> technicalResearchService.pesquisar iniciando');
    const t0 = Date.now();
    try {
      const r = await originalPesquisar(...args);
      log(`<<< technicalResearchService.pesquisar OK em ${Date.now() - t0}ms`);
      return r;
    } catch (err) {
      log(`<<< technicalResearchService.pesquisar ERRO em ${Date.now() - t0}ms — ${err.message}`);
      throw err;
    }
  };

  const contextEngine = require('c:/Apps/iahub/apps/IA Service/backend/services/context-engine');
  const originalMontar = contextEngine.montarContextoInvestigacao;
  contextEngine.montarContextoInvestigacao = (...args) => {
    log('>>> contextEngine.montarContextoInvestigacao iniciando');
    const t0 = Date.now();
    const r = originalMontar(...args);
    log(`<<< contextEngine.montarContextoInvestigacao OK em ${Date.now() - t0}ms`);
    return r;
  };

  const investigacaoService = require('c:/Apps/iahub/apps/IA Service/backend/services/investigacao-service');
  const anexoRepo = require('c:/Apps/iahub/apps/IA Service/backend/repositories/anexo-repository');

  const anexos = anexoRepo.listarAnexos(EMPRESA_ID, ATENDIMENTO_ID).map(a => a.id);
  log(`${anexos.length} anexos encontrados`);

  log('chamando processarTurno...');
  const t0 = Date.now();
  try {
    const msg = await investigacaoService.processarTurno(EMPRESA_ID, ATENDIMENTO_ID, {
      texto: 'Faca a investigacao tecnica completa deste chamado com base no historico e nos anexos disponiveis.',
      usuarioId: null,
      anexoIds: anexos,
      anexosComoContexto: true,
      forcarPesquisa: true,
      analistaAtualNome: 'Diagnostico Incremental',
    });
    log(`processarTurno OK em ${Date.now() - t0}ms — provider=${msg.provider} model=${msg.model}`);
  } catch (err) {
    log(`processarTurno ERRO em ${Date.now() - t0}ms — ${err.stack || err.message}`);
  }

  clearTimeout(watchdog);
  aiConfigService.resolverKeysEOrdem = originalResolver;
  database.fecharDB();
  log('FIM — saindo normalmente.');
  process.exit(0);
}

main().catch(err => {
  console.error('ERRO FATAL:', err.stack || err);
  clearTimeout(watchdog);
  process.exit(1);
});
