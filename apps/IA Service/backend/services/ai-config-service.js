// Resolução de chaves de IA por empresa, com cascata: ai_config da empresa →
// variáveis de ambiente (fallback de desenvolvimento). Diferente do IA
// Command (Etapa 0, seção 9.2), NÃO cai para "qualquer empresa cadastrada"
// como último fallback — isso vazaria a chave de uma empresa para outra, algo
// que a Etapa 0 já sinalizou como "fail-open" a não repetir sem necessidade.

const aiConfigRepo = require('../repositories/ai-config-repository');
const { PROVIDER_CONFIGS } = require('./ai-provider-client');
const platformStore = require('../../../IAHUB/backend/platform-store');

function permitirConfigLegada() {
  return process.env.SVC_ALLOW_LEGACY_CONFIG === '1';
}

function resolverKeysEOrdem(empresaId) {
  const legado = aiConfigRepo.getConfig(empresaId);
  const platform = platformStore.getAiConfig(empresaId);
  const config = platform || (permitirConfigLegada() ? legado : null);

  const keys = {
    groq: config?.groqApiKey || process.env.SVC_GROQ_API_KEY || process.env.GROQ_API_KEY || null,
    openai: config?.openaiApiKey || process.env.SVC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null,
    deepseek: config?.deepseekApiKey || process.env.SVC_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || null,
    claude: config?.claudeApiKey || process.env.SVC_CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || null,
    gemini: config?.geminiApiKey || process.env.SVC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || null,
  };

  // Modelo específico por provedor (2026-09) — diferente do IA Command
  // (onde 3 dos 5 provedores nunca aplicam o modelo salvo em produção,
  // falha real confirmada em intent-service.js), aqui os 4 SEMPRE resolvem
  // para um valor: coluna salva → default de PROVIDER_CONFIGS (nunca null).
  const modelos = {
    groq: config?.groqModelo || PROVIDER_CONFIGS.groq.model,
    openai: config?.openaiModelo || PROVIDER_CONFIGS.openai.model,
    deepseek: config?.deepseekModelo || PROVIDER_CONFIGS.deepseek.model,
    claude: config?.claudeModelo || PROVIDER_CONFIGS.claude.model,
    gemini: config?.geminiModelo || PROVIDER_CONFIGS.gemini.model,
  };

  const cfg = {
    provedorPrimario: config?.provedorPrimario || 'groq',
    fallbackOrdem: config?.fallbackOrdem || 'groq,deepseek,openai,claude,gemini',
    modelos,
  };

  return { keys, cfg };
}

function salvarConfig(empresaId, dados) {
  if (process.env.SVC_ALLOW_LEGACY_CONFIG_WRITE !== '1') {
    throw new Error('Configuração de IA isolada. Use IAHub Platform > Configurar IA.');
  }
  return aiConfigRepo.salvarConfig(empresaId, dados);
}

function getConfig(empresaId) {
  const legado = aiConfigRepo.getConfig(empresaId);
  const platform = platformStore.getAiConfig(empresaId);
  const config = platform || (permitirConfigLegada() ? legado : null);
  if (!config) return null;
  // Nunca retorna as chaves para o frontend — só indica se estão configuradas.
  // loginExternoApelido não é segredo (é a própria URL pública de acesso),
  // volta em claro.
  return {
    empresaId: config.empresaId,
    provedorPrimario: config.provedorPrimario,
    fallbackOrdem: config.fallbackOrdem,
    temGroq: !!config.groqApiKey,
    temOpenai: !!config.openaiApiKey,
    temDeepseek: !!config.deepseekApiKey,
    temClaude: !!config.claudeApiKey,
    temGemini: !!config.geminiApiKey,
    groqModelo: config.groqModelo || PROVIDER_CONFIGS.groq.model,
    openaiModelo: config.openaiModelo || PROVIDER_CONFIGS.openai.model,
    deepseekModelo: config.deepseekModelo || PROVIDER_CONFIGS.deepseek.model,
    claudeModelo: config.claudeModelo || PROVIDER_CONFIGS.claude.model,
    geminiModelo: config.geminiModelo || PROVIDER_CONFIGS.gemini.model,
    loginExternoApelido: legado?.loginExternoApelido || null,
    origemConfig: platform ? 'iahub-platform' : 'ia-service-legado',
    atualizadoEm: config.atualizadoEm,
  };
}

module.exports = { resolverKeysEOrdem, salvarConfig, getConfig };
