'use strict';

const MODELOS_CONTEXTO = [
  { padrao: /gpt-4o|gpt-4\.1|gpt-5/i, janela: 128000 },
  { padrao: /gemini/i, janela: 100000 },
  { padrao: /claude/i, janela: 200000 },
  { padrao: /deepseek/i, janela: 64000 },
  // Groq on-demand para openai/gpt-oss-20b tem limite pratico de TPM menor
  // que a janela nominal do modelo. Usar a janela nominal fazia o Context
  // Engine montar prompts que cabiam no modelo, mas eram recusados pela API
  // por "tokens per minute". O orcamento aqui reflete o envelope operacional
  // observado e deixa o fallback intacto.
  { padrao: /gpt-oss|groq/i, janela: 12000 },
  { padrao: /llama|mixtral/i, janela: 32000 },
];

function estimarTokens(texto) {
  const s = String(texto || '');
  if (!s) return 0;
  const porChars = Math.ceil(s.length / 4);
  const porPalavras = Math.ceil(s.split(/\s+/).filter(Boolean).length * 1.35);
  return Math.max(porChars, porPalavras);
}

function estimarTokensImagem() {
  return 1200;
}

function capacidadeModelo(modelo) {
  const m = String(modelo || '');
  const encontrado = MODELOS_CONTEXTO.find(x => x.padrao.test(m));
  return encontrado?.janela || 24000;
}

function criarOrcamento({ modelo, systemPrompt = '', respostaReservada = 6000, margemSeguranca = 0.18 } = {}) {
  const janela = capacidadeModelo(modelo);
  const sistema = estimarTokens(systemPrompt);
  const margem = Math.ceil(janela * margemSeguranca);
  const disponivel = Math.max(3000, janela - sistema - respostaReservada - margem);
  return {
    tipo: 'estimado',
    modelo: modelo || null,
    janela,
    systemTokensEstimados: sistema,
    respostaReservada,
    margem,
    entradaDisponivel: disponivel,
  };
}

module.exports = { estimarTokens, estimarTokensImagem, capacidadeModelo, criarOrcamento };
