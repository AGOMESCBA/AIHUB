'use strict';

/**
 * Reconhece conceitos analiticos nomeados (ex: "analise horizontal", "indice de liquidez")
 * numa pergunta e garante que o sistema NUNCA gera SQL para um conceito que nao entende, nem
 * assume sozinho a qual domínio de dado (financeiro, compras, faturamento...) aplicar esse
 * conceito quando a pergunta nao especifica.
 *
 * Duas camadas resolvidas separadamente:
 * - Conceito (o que "analise vertical" significa, matematicamente): definido uma vez por IA
 *   auxiliar (sem gerar SQL), gravado no glossario, reaproveitado depois sem custo de IA.
 * - Dominio de dado (a quais tabelas/modulo aplicar o conceito): NUNCA inferido pelo sistema.
 *   Se a propria pergunta ja diz o dominio, seguimos; se nao diz, o sistema pergunta ao
 *   usuario ANTES de gerar SQL, reaproveitando o mecanismo de confirmacao ja existente
 *   (intent.precisa_confirmacao, tratado em intent-router.js).
 *
 * A definicao tecnica resolvida e injetada como texto no prompt do gerador de SQL principal
 * (runner.js) — a traducao conceito->SQL continua inteiramente a cargo dessa IA, que ja
 * demonstrou competencia nisso via specs/fragmentos. Este modulo nunca prescreve tabela,
 * join ou estrutura de SQL.
 */

const aiProviderClient = require('../erp/core/ai-provider-client');
const glossaryStore = require('./analytic-glossary-store');

// Padroes deliberadamente restritos: so dispara a checagem (e o eventual custo de chamada de
// IA) quando a pergunta nomeia um conceito analitico explicito, nunca em perguntas comuns de
// dado ("faturamento de hoje", "compras do mes"). Aplicados sobre o texto JA normalizado.
const PADROES_CONCEITO = [
  /\banalise\s+(horizontal|vertical|de\s+tendencia|de\s+sazonalidade|swot|de\s+desempenho)\b/i,
  /\bindice\s+de\s+\w+/i,
  /\bindicador(?:es)?\s+de\s+\w+/i,
];

// Mesmo vocabulario de dominio ja usado em cross-module-detector.js (PADROES_MODULO) e
// intent-router.js (_PALAVRAS_ERP) — nao inventa taxonomia nova. Cada dominio e uma chave
// estavel usada para particionar o glossario (mesmo termo, dominios diferentes = definicoes
// tecnicas potencialmente diferentes, ex: "analise vertical" de financeiro vs de compras).
const PADROES_DOMINIO = [
  { chave: 'faturamento', re: /\b(faturamento|vendas?|receita)\b/i, label: 'Faturamento/Vendas' },
  { chave: 'compras', re: /\b(compras?)\b/i, label: 'Compras' },
  { chave: 'financeiro', re: /\b(financeiro|contas?\s+a\s+pagar|contas?\s+a\s+receber)\b/i, label: 'Financeiro (contas a pagar/receber)' },
  { chave: 'fluxo_caixa', re: /\bfluxo\s+de\s+caixa\b/i, label: 'Fluxo de Caixa' },
  { chave: 'comissao', re: /\b(comissao|comissoes)\b/i, label: 'Comissão' },
  { chave: 'estoque', re: /\b(estoque)\b/i, label: 'Estoque' },
];

function _normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Retorna o trecho original (com acentuacao preservada) correspondente ao match encontrado
// no texto normalizado, para manter a definicao/aviso legivel em portugues correto.
function detectarConceitoDesconhecido(mensagem) {
  const original = String(mensagem || '');
  const normalizado = _normalizarTexto(original);
  for (const re of PADROES_CONCEITO) {
    const m = normalizado.match(re);
    if (m) return original.slice(m.index, m.index + m[0].length).trim();
  }
  return null;
}

// Nao tenta adivinhar o dominio — so reconhece quando a PROPRIA pergunta ja contem uma
// palavra de dominio conhecida. Pode reconhecer mais de um (ex: "vendas x compras" ->
// dominio combinado, ordenado de forma estavel para nao depender da ordem de mencao no texto).
function extrairDominioExplicito(mensagem) {
  const normalizado = _normalizarTexto(String(mensagem || ''));
  const encontrados = PADROES_DOMINIO.filter(d => d.re.test(normalizado));
  if (!encontrados.length) return null;
  return {
    chave: encontrados.map(d => d.chave).sort().join('_x_'),
    labels: encontrados.map(d => d.label),
  };
}

function buildSystemPrompt() {
  return [
    'Voce e um especialista tecnico em analise financeira e contabil.',
    'Sua unica tarefa: definir com precisao tecnica um conceito analitico nomeado pelo usuario, de forma OPERACIONAL — nao basta explicar o conceito em teoria, a definicao precisa dizer exatamente COMO estruturar o calculo, para que outra IA (que ja sabe gerar SQL Protheus, mas nao conhece este conceito) consiga aplicar sem reinterpretar do zero.',
    'Voce NAO gera SQL, NAO menciona tabelas de banco de dados, NAO tem acesso a dados do ERP. Fale de estrutura de calculo (quais valores compor, de quais periodos, e a formula), nunca de sintaxe SQL.',
    '',
    'IMPORTANTE — nao confunda analise horizontal com analise vertical:',
    '- Analise horizontal = MESMO indicador, comparado ao longo do TEMPO. Precisa de DOIS valores do MESMO indicador vindos de DOIS periodos distintos (periodo atual e periodo base/anterior) — a definicao deve deixar explicito que sao necessarias duas consultas/somas separadas, uma por periodo, antes de calcular variacao absoluta (atual - base) e percentual ((atual - base) / base × 100).',
    '- Analise vertical = cada componente expresso como percentual de um valor de referencia do MESMO periodo (sem comparacao temporal, um unico periodo, uma soma total e as partes que a compoem).',
    '',
    'Retorne SOMENTE JSON valido, sem markdown, no formato:',
    '{ "definicao_tecnica": string }',
    '- "definicao_tecnica" deve ser um texto direto e tecnico (3-6 frases): o que o conceito significa, QUANTOS periodos/agrupamentos sao necessarios e de onde vem cada valor, e a formula exata de calculo — o suficiente para outra IA montar a estrutura da consulta corretamente sem ambiguidade sobre quantos "blocos" de dado ela precisa buscar. Nao mencione tabelas de banco de dados nem sintaxe SQL.',
  ].join('\n');
}

function buildUserPrompt(termo, dominioLabels, mensagemOriginal) {
  return [
    `Termo/conceito a definir: "${termo}"`,
    `Domínio de dado informado pelo usuário: ${dominioLabels.join(' e ')}`,
    `Pergunta original onde o termo apareceu: "${mensagemOriginal}"`,
  ].join('\n');
}

async function _consultarIA(termo, dominioLabels, mensagemOriginal, empresaId) {
  const { keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(termo, dominioLabels, mensagemOriginal);
  const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
    json: true,
    maxTokens: 500,
    temperature: 0.1,
    logPrefix: 'AnalyticGlossary',
  });
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  const obj = JSON.parse(match ? match[0] : raw);
  if (typeof obj.definicao_tecnica !== 'string' || !obj.definicao_tecnica.trim()) {
    throw new Error('Resposta da IA sem definicao_tecnica valida.');
  }
  return obj.definicao_tecnica.trim();
}

function _perguntaEsclarecimentoDominio(termo) {
  const opcoes = PADROES_DOMINIO.map(d => d.label).join(', ');
  return `Para fazer a "${termo}" preciso saber sobre qual dado — ${opcoes}? Me diga qual (ou quais) para eu montar a consulta corretamente.`;
}

// Retorna null quando o termo nao e reconhecido como conceito (segue fluxo normal).
// Retorna { precisaConfirmacao: true, perguntaEsclarecimento } quando o conceito e reconhecido
// mas o dominio de dado nao foi especificado — o chamador deve interromper o fluxo ANTES de
// gerar qualquer SQL (nunca adivinhar o dominio).
// Retorna { termo, definicaoTecnica } quando resolvido — pronto para injecao no prompt do
// gerador de SQL principal.
async function resolverConceito(mensagem, empresaId) {
  const termo = detectarConceitoDesconhecido(mensagem);
  if (!termo) return null;

  const dominio = extrairDominioExplicito(mensagem);
  if (!dominio) {
    return { precisaConfirmacao: true, perguntaEsclarecimento: _perguntaEsclarecimentoDominio(termo) };
  }

  const existente = glossaryStore.buscarPorTermo(termo, dominio.chave);
  if (existente) {
    return { termo, definicaoTecnica: existente.definicao_tecnica };
  }

  // Termo+dominio desconhecidos: consulta IA auxiliar (sem gerar SQL), grava no glossario.
  let definicaoTecnica;
  try {
    definicaoTecnica = await _consultarIA(termo, dominio.labels, mensagem, empresaId);
  } catch (e) {
    console.warn('[AnalyticGlossary] Falha ao consultar definicao do conceito:', e.message);
    return null; // fail-open: segue o fluxo normal (roteamento lexico existente)
  }

  glossaryStore.criar({
    termo,
    dominio: dominio.chave,
    definicaoTecnica,
    origem: 'ia_aprendido',
    perguntaOrigem: mensagem,
  });

  return { termo, definicaoTecnica };
}

// ── Periodo-base para "analise horizontal" sem periodo de comparacao explicito ──────────────
// A definicao textual sozinha nao bastou, em teste real, para fazer a IA geradora de SQL
// comparar dois periodos distintos: sem uma data concreta de "periodo base" no prompt, ela
// interpreta "esta semana" como o UNICO filtro da consulta (comportamento correto quando nao
// ha comparacao pedida) e gera so um bloco de dados. Por isso o periodo-base e calculado aqui,
// como datas EXATAS, e injetado junto da definicao — nao deixado como instrucao textual pura.
const RE_TERMO_HORIZONTAL = /horizontal/i;

function _paraDate(aaaammdd) {
  const s = String(aaaammdd || '');
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

function _paraAaaammdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Periodo imediatamente anterior, com a MESMA duracao em dias do periodo atual — ex: atual
// 01/09 a 07/09 (7 dias) -> base 25/08 a 31/08 (7 dias, terminando no dia anterior ao inicio
// do atual). Retorna null se o periodo atual nao tiver datas utilizaveis.
function calcularPeriodoBaseAnterior(periodoAtual) {
  const inicio = _paraDate(periodoAtual?.dataInicio);
  const fim = _paraDate(periodoAtual?.dataFim);
  if (!inicio || !fim || fim < inicio) return null;
  const duracaoDias = Math.round((fim - inicio) / 86400000) + 1;
  const fimBase = new Date(inicio);
  fimBase.setDate(fimBase.getDate() - 1);
  const inicioBase = new Date(fimBase);
  inicioBase.setDate(inicioBase.getDate() - (duracaoDias - 1));
  return { dataInicio: _paraAaaammdd(inicioBase), dataFim: _paraAaaammdd(fimBase) };
}

// So se aplica quando: (1) o termo detectado e uma variante de "horizontal" (nao vertical/
// outros — esses nao comparam periodos); (2) ja existe um periodo atual resolvido pelo
// classificador base; (3) a definicao/pergunta nao ja trouxe um segundo periodo explicito
// (nesse caso a propria IA geradora ja tem o suficiente, nao inventamos nada por cima).
function resolverPeriodoBaseSeHorizontal(termo, periodoAtual) {
  if (!RE_TERMO_HORIZONTAL.test(termo || '')) return null;
  const base = calcularPeriodoBaseAnterior(periodoAtual);
  if (!base) return null;
  return {
    periodoBase: base,
    avisoTexto: `Assumindo comparação com o período imediatamente anterior de mesma duração (${base.dataInicio}–${base.dataFim}). Se quiser comparar com outra base (ex: mesmo período do ano passado), me avise.`,
  };
}

module.exports = {
  detectarConceitoDesconhecido,
  extrairDominioExplicito,
  resolverConceito,
  calcularPeriodoBaseAnterior,
  resolverPeriodoBaseSeHorizontal,
};
