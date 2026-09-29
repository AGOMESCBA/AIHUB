// Resolução de chaves de IA por empresa, com cascata: ai_config da empresa →
// variáveis de ambiente (fallback de desenvolvimento). Diferente do IA
// Command (Etapa 0, seção 9.2), NÃO cai para "qualquer empresa cadastrada"
// como último fallback — isso vazaria a chave de uma empresa para outra, algo
// que a Etapa 0 já sinalizou como "fail-open" a não repetir sem necessidade.

const aiConfigRepo = require('../repositories/ai-config-repository');

function resolverKeysEOrdem(empresaId) {
  const config = aiConfigRepo.getConfig(empresaId);

  const keys = {
    groq: config?.groqApiKey || process.env.SVC_GROQ_API_KEY || process.env.GROQ_API_KEY || null,
    openai: config?.openaiApiKey || process.env.SVC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null,
    claude: config?.claudeApiKey || process.env.SVC_CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || null,
    gemini: config?.geminiApiKey || process.env.SVC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || null,
  };

  const cfg = {
    provedorPrimario: config?.provedorPrimario || 'groq',
    fallbackOrdem: config?.fallbackOrdem || 'groq,openai,claude,gemini',
  };

  return { keys, cfg };
}

function salvarConfig(empresaId, dados) {
  return aiConfigRepo.salvarConfig(empresaId, dados);
}

function getConfig(empresaId) {
  const config = aiConfigRepo.getConfig(empresaId);
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
    temClaude: !!config.claudeApiKey,
    temGemini: !!config.geminiApiKey,
    loginExternoApelido: config.loginExternoApelido,
    atualizadoEm: config.atualizadoEm,
  };
}

module.exports = { resolverKeysEOrdem, salvarConfig, getConfig };
