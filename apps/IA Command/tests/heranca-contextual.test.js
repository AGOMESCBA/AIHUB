'use strict';

/**
 * Testes de herança contextual — IA Command
 * Cobre: context-pre-check, intent-merger e simulação de pipeline multi-turno.
 * Dados completamente fictícios, sem conexão com banco ou IA externa.
 */

const path = require('path');
const ROOT  = path.resolve(__dirname, '..');

const preCheck     = require(path.join(ROOT, 'modules/ai/context-pre-check'));
const merger       = require(path.join(ROOT, 'modules/ai/intent-merger'));

// ─── Utilitários de teste ────────────────────────────────────────────────────

let passou = 0;
let falhou = 0;

function assert(descricao, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ✅ ${descricao}`);
    passou++;
  } else {
    console.log(`  ❌ FALHOU: ${descricao}${detalhe ? ' — ' + detalhe : ''}`);
    falhou++;
  }
}

function secao(titulo) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${titulo}`);
  console.log('─'.repeat(60));
}

// ─── Fixtures de intent por módulo ──────────────────────────────────────────

function intentFaturamento(overrides = {}) {
  return {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    confianca: 0.95,
    precisa_confirmacao: false,
    _provedor: 'groq',
    _nivel_contexto: 1,
    ...overrides,
  };
}

function intentCompras(overrides = {}) {
  return {
    intencao: 'compras_dinamico',
    periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    confianca: 0.92,
    precisa_confirmacao: false,
    _provedor: 'groq',
    _nivel_contexto: 1,
    ...overrides,
  };
}

function intentFinanceiro(overrides = {}) {
  return {
    intencao: 'financeiro_dinamico',
    periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    confianca: 0.91,
    precisa_confirmacao: false,
    _provedor: 'groq',
    _nivel_contexto: 1,
    ...overrides,
  };
}

function intentComissao(overrides = {}) {
  return {
    intencao: 'comissao_dinamico',
    periodo: { tipo: 'trimestre_atual', dataInicio: '20260401', dataFim: '20260630' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    confianca: 0.90,
    precisa_confirmacao: false,
    _provedor: 'groq',
    _nivel_contexto: 1,
    ...overrides,
  };
}

// Intent vago retornado pela IA para perguntas complementares sem contexto
function intentVago(mensagem, overrides = {}) {
  return {
    intencao: 'desconhecido',
    periodo: { tipo: 'nenhum' },
    filtros: {},
    agrupar_por: null,
    ordenar_por: null,
    limite: null,
    confianca: 0,
    precisa_confirmacao: true,
    _provedor: 'groq',
    _mensagemOriginal: mensagem,
    ...overrides,
  };
}

const TS_RECENTE = Date.now() - 30_000; // 30 segundos atrás

// ─── BLOCO 1: context-pre-check ─────────────────────────────────────────────

secao('BLOCO 1 — context-pre-check: isNewSubject');

assert('"cancelar" ao início → novo assunto',
  preCheck.isNewSubject('cancelar'));

assert('"esquece isso" → novo assunto',
  preCheck.isNewSubject('esquece isso'));

assert('"nova consulta de faturamento" → novo assunto',
  preCheck.isNewSubject('nova consulta de faturamento'));

assert('"pode cancelar automaticamente" NÃO é novo assunto',
  !preCheck.isNewSubject('pode cancelar automaticamente'));

assert('"por cliente" NÃO é novo assunto',
  !preCheck.isNewSubject('por cliente'));

assert('"recomecar" → novo assunto',
  preCheck.isNewSubject('recomecar'));

secao('BLOCO 1 — context-pre-check: isContextualQuestion');

assert('"detalhe por mes" → continuação',
  preCheck.isContextualQuestion('Detalhe por mes'));

assert('"por cliente" → continuação',
  preCheck.isContextualQuestion('por cliente'));

assert('"agora por fornecedor" → continuação',
  preCheck.isContextualQuestion('agora por fornecedor'));

// "somente acima de 10 mil" não tem dimensão de agrupamento → pré-check retorna false.
// O merger ainda herda corretamente via sameEmpresa/sameChannel (sem necessidade de fallback cross-scope).
assert('"somente acima de 10 mil" NÃO é continuação via pré-check (sem dimensão, sem conector)',
  !preCheck.isContextualQuestion('somente acima de 10 mil'));

assert('"faturamento do ano" NÃO é continuação (tem domínio explícito)',
  !preCheck.isContextualQuestion('faturamento do ano'));

assert('"compras de janeiro" NÃO é continuação (tem domínio explícito)',
  !preCheck.isContextualQuestion('compras de janeiro'));

// ─── BLOCO 2: intent-merger — nível de contexto ──────────────────────────────

secao('BLOCO 2 — intent-merger: nivel_contexto');

{
  // Primeiro turno: sem contexto anterior
  const primeiroIntent = intentFaturamento();
  const resultado = merger.mesclar(primeiroIntent, null);
  assert('Primeiro turno sem contexto: nivel_contexto = 1',
    resultado._nivel_contexto === 1);
}

{
  // Segundo turno: herança → nivel 2
  const anterior = intentFaturamento({ _nivel_contexto: 1 });
  const novo = intentVago('detalhe por mes');
  const resultado = merger.mesclar(novo, anterior, TS_RECENTE, 'detalhe por mes');
  assert('Segundo turno (continuação): nivel_contexto = 2',
    resultado._nivel_contexto === 2,
    `obtido: ${resultado._nivel_contexto}`);
}

{
  // Turno 5: deve chegar em 5 e parar
  const anterior = intentFaturamento({ _nivel_contexto: 4 });
  const novo = intentVago('top 5');
  const resultado = merger.mesclar(novo, anterior, TS_RECENTE, 'top 5');
  assert('Turno 5: nivel_contexto cappado em 5',
    resultado._nivel_contexto === 5,
    `obtido: ${resultado._nivel_contexto}`);
}

{
  // Nova intenção com alta confiança → reset para 1
  const anterior = intentFaturamento({ _nivel_contexto: 3 });
  const novo = intentCompras({ confianca: 0.93, intencao: 'compras_dinamico' });
  const resultado = merger.mesclar(novo, anterior, TS_RECENTE, 'compras de maio');
  assert('Nova intenção com confiança ≥ 0.85: nivel_contexto resetado para 1',
    resultado._nivel_contexto === 1,
    `obtido: ${resultado._nivel_contexto}`);
}

{
  // Threshold 0.85: confiança 0.84 NÃO deve resetar (herda contexto)
  const anterior = intentFaturamento({ _nivel_contexto: 2 });
  const novo = { ...intentCompras({ confianca: 0.84 }) };
  const resultado = merger.mesclar(novo, anterior, TS_RECENTE, 'compras');
  assert('Confiança 0.84 (< 0.85): contexto herdado, nivel não reseta',
    resultado._contextoAplicado === true,
    `_contextoAplicado=${resultado._contextoAplicado}`);
}

// ─── BLOCO 3: FATURAMENTO — 4 perguntas herdadas ────────────────────────────

secao('BLOCO 3 — FATURAMENTO: 4 perguntas herdadas');

{
  // T1: "faturamento do ano de 2026"
  const t1 = intentFaturamento({
    periodo: { tipo: 'ano', ano: 2026, dataInicio: '20260101', dataFim: '20261231' },
    _nivel_contexto: 1,
  });

  // T2: "detalhe por mês"
  const vago2 = intentVago('detalhe por mes');
  const t2 = merger.mesclar(vago2, t1, TS_RECENTE, 'detalhe por mes');
  assert('[FAT T2] Herda intenção faturamento_dinamico',
    t2.intencao === 'faturamento_dinamico', `obtido: ${t2.intencao}`);
  assert('[FAT T2] Herda período 2026',
    t2.periodo?.dataInicio === '20260101', `obtido: ${t2.periodo?.dataInicio}`);
  assert('[FAT T2] nivel_contexto = 2',
    t2._nivel_contexto === 2);

  // T3: "somente cliente Alpha Ltda"
  const vago3 = intentVago('somente cliente Alpha Ltda', {
    filtros: { cliente: 'Alpha Ltda' },
    confianca: 0.55,
  });
  const t3 = merger.mesclar(vago3, t2, TS_RECENTE, 'somente cliente Alpha Ltda');
  assert('[FAT T3] Herda período 2026',
    t3.periodo?.dataInicio === '20260101');
  assert('[FAT T3] Filtro cliente aplicado',
    t3.filtros?.cliente === 'Alpha Ltda', `obtido: ${t3.filtros?.cliente}`);
  assert('[FAT T3] nivel_contexto = 3',
    t3._nivel_contexto === 3);

  // T4: "top 5"
  const vago4 = intentVago('top 5', { limite: 5, confianca: 0.50 });
  const t4 = merger.mesclar(vago4, t3, TS_RECENTE, 'top 5');
  assert('[FAT T4] Herda filtro cliente',
    t4.filtros?.cliente === 'Alpha Ltda');
  assert('[FAT T4] Limite 5 aplicado',
    t4.limite === 5);
  assert('[FAT T4] nivel_contexto = 4',
    t4._nivel_contexto === 4);
}

// ─── BLOCO 4: COMPRAS — 4 perguntas herdadas ────────────────────────────────

secao('BLOCO 4 — COMPRAS: 4 perguntas herdadas');

{
  // T1: "compras de janeiro de 2026"
  const t1 = intentCompras({
    periodo: { tipo: 'mes', mes: 1, ano: 2026, dataInicio: '20260101', dataFim: '20260131' },
    _nivel_contexto: 1,
  });

  // T2: "por fornecedor"
  const vago2 = intentVago('por fornecedor');
  const t2 = merger.mesclar(vago2, t1, TS_RECENTE, 'por fornecedor');
  assert('[COM T2] Herda intenção compras_dinamico',
    t2.intencao === 'compras_dinamico', `obtido: ${t2.intencao}`);
  assert('[COM T2] Herda período janeiro 2026',
    t2.periodo?.dataInicio === '20260101');
  assert('[COM T2] nivel_contexto = 2',
    t2._nivel_contexto === 2);

  // T3: "somente acima de 50 mil"
  const vago3 = intentVago('somente acima de 50 mil', { confianca: 0.40 });
  const t3 = merger.mesclar(vago3, t2, TS_RECENTE, 'somente acima de 50 mil');
  assert('[COM T3] Herda intenção compras_dinamico',
    t3.intencao === 'compras_dinamico');
  assert('[COM T3] Herda período',
    t3.periodo?.dataInicio === '20260101');
  assert('[COM T3] nivel_contexto = 3',
    t3._nivel_contexto === 3);

  // T4: "ordenar do maior para o menor"
  const vago4 = intentVago('ordenar do maior para o menor', {
    ordenar_por: 'valor:desc',
    confianca: 0.60,
  });
  const t4 = merger.mesclar(vago4, t3, TS_RECENTE, 'ordenar do maior para o menor');
  assert('[COM T4] Herda intenção compras_dinamico',
    t4.intencao === 'compras_dinamico');
  assert('[COM T4] Ordenação aplicada',
    t4.ordenar_por === 'valor:desc', `obtido: ${t4.ordenar_por}`);
  assert('[COM T4] nivel_contexto = 4',
    t4._nivel_contexto === 4);
}

// ─── BLOCO 5: FINANCEIRO — 4 perguntas herdadas ─────────────────────────────

secao('BLOCO 5 — FINANCEIRO: 4 perguntas herdadas');

{
  // T1: "contas a pagar do mês"
  const t1 = intentFinanceiro({
    periodo: { tipo: 'mes_atual', dataInicio: '20260501', dataFim: '20260531' },
    _nivel_contexto: 1,
  });

  // T2: "somente em aberto"
  const vago2 = intentVago('somente em aberto', { filtros: { status: 'aberto' }, confianca: 0.55 });
  const t2 = merger.mesclar(vago2, t1, TS_RECENTE, 'somente em aberto');
  assert('[FIN T2] Herda intenção financeiro_dinamico',
    t2.intencao === 'financeiro_dinamico');
  assert('[FIN T2] Herda período maio 2026',
    t2.periodo?.dataInicio === '20260501');
  assert('[FIN T2] nivel_contexto = 2',
    t2._nivel_contexto === 2);

  // T3: "por fornecedor"
  const vago3 = intentVago('por fornecedor');
  const t3 = merger.mesclar(vago3, t2, TS_RECENTE, 'por fornecedor');
  assert('[FIN T3] Herda filtro status aberto',
    t3.filtros?.status === 'aberto', `obtido: ${t3.filtros?.status}`);
  assert('[FIN T3] nivel_contexto = 3',
    t3._nivel_contexto === 3);

  // T4: "somente vencidas"
  const vago4 = intentVago('somente vencidas', { filtros: { status: 'vencido' }, confianca: 0.45 });
  const t4 = merger.mesclar(vago4, t3, TS_RECENTE, 'somente vencidas');
  assert('[FIN T4] Herda intenção financeiro_dinamico',
    t4.intencao === 'financeiro_dinamico');
  assert('[FIN T4] Filtro status atualizado para vencido',
    t4.filtros?.status === 'vencido', `obtido: ${t4.filtros?.status}`);
  assert('[FIN T4] nivel_contexto = 4',
    t4._nivel_contexto === 4);
}

// ─── BLOCO 6: COMISSÃO — 4 perguntas herdadas ────────────────────────────────

secao('BLOCO 6 — COMISSÃO: 4 perguntas herdadas');

{
  // T1: "comissão do trimestre"
  const t1 = intentComissao({ _nivel_contexto: 1 });

  // T2: "por vendedor"
  const vago2 = intentVago('por vendedor');
  const t2 = merger.mesclar(vago2, t1, TS_RECENTE, 'por vendedor');
  assert('[CMI T2] Herda intenção comissao_dinamico',
    t2.intencao === 'comissao_dinamico');
  assert('[CMI T2] Herda período trimestre',
    t2.periodo?.dataInicio === '20260401');
  assert('[CMI T2] nivel_contexto = 2',
    t2._nivel_contexto === 2);

  // T3: "da filial 01"
  const vago3 = intentVago('da filial 01', { filtros: { filial: '01' }, confianca: 0.50 });
  const t3 = merger.mesclar(vago3, t2, TS_RECENTE, 'da filial 01');
  assert('[CMI T3] Herda intenção comissao_dinamico',
    t3.intencao === 'comissao_dinamico');
  assert('[CMI T3] Filtro filial aplicado',
    t3.filtros?.filial === '01', `obtido: ${t3.filtros?.filial}`);
  assert('[CMI T3] nivel_contexto = 3',
    t3._nivel_contexto === 3);

  // T4: "top 10"
  const vago4 = intentVago('top 10', { limite: 10, confianca: 0.50 });
  const t4 = merger.mesclar(vago4, t3, TS_RECENTE, 'top 10');
  assert('[CMI T4] Herda filtro filial',
    t4.filtros?.filial === '01');
  assert('[CMI T4] Limite 10 aplicado',
    t4.limite === 10);
  assert('[CMI T4] nivel_contexto = 4',
    t4._nivel_contexto === 4);
}

// ─── BLOCO 7: Segurança — reset de contexto ──────────────────────────────────

secao('BLOCO 7 — Segurança: reset de contexto');

{
  // Expiração por TTL (10 min)
  const anterior = intentFaturamento({ _nivel_contexto: 3 });
  const vago = intentVago('detalhe por mes');
  const tsExpirado = Date.now() - 11 * 60 * 1000;
  const resultado = merger.mesclar(vago, anterior, tsExpirado, 'detalhe por mes');
  assert('TTL expirado: intenção NÃO herdada',
    resultado.intencao !== 'faturamento_dinamico',
    `obtido: ${resultado.intencao}`);
  assert('TTL expirado: nivel_contexto resetado para 1',
    resultado._nivel_contexto === 1);
}

{
  // Troca explícita de domínio com alta confiança
  const anterior = intentFaturamento({ _nivel_contexto: 3 });
  const novoCompras = intentCompras({ confianca: 0.93, intencao: 'compras_dinamico' });
  const resultado = merger.mesclar(novoCompras, anterior, TS_RECENTE, 'compras do mes');
  assert('Nova intenção (confiança 0.93): contexto NÃO aplicado',
    resultado._contextoAplicado !== true,
    `_contextoAplicado=${resultado._contextoAplicado}`);
  assert('Intenção nova mantida: compras_dinamico',
    resultado.intencao === 'compras_dinamico');
}

{
  // isNewSubject detectado antes da IA
  assert('isNewSubject "cancelar" → contexto deve ser descartado',
    preCheck.isNewSubject('cancelar'));
  assert('isNewSubject "Detalhe por mes" → NÃO descarta contexto',
    !preCheck.isNewSubject('Detalhe por mes'));
}

// ─── Resultado final ──────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTADO: ${passou} passou | ${falhou} falhou | ${passou + falhou} total`);
console.log('═'.repeat(60));
if (falhou > 0) process.exit(1);
