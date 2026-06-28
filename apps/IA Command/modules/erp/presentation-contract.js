'use strict';

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function keyNorm(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const DIMENSIONS = [
  { canon: 'vencimento', label: 'Vencimento', aliases: ['vencimento', 'vencto', 'vencrea', 'data_vencimento', 'dt_vencimento', 'e1_vencto', 'e1_vencrea', 'e2_vencto', 'e2_vencrea'] },
  { canon: 'emissao', label: 'Emissao', aliases: ['emissao', 'data_emissao', 'dt_emissao', 'e1_emissao', 'e2_emissao', 'f1_emissao', 'f2_emissao'] },
  { canon: 'baixa', label: 'Baixa', aliases: ['baixa', 'data_baixa', 'dt_baixa', 'e1_baixa', 'e2_baixa'] },
  { canon: 'competencia', label: 'Competencia', aliases: ['competencia', 'ano_mes', 'aaaamm', 'aaaa_mm', 'referencia', 'periodo'] },
  { canon: 'dia', label: 'Dia', aliases: ['dia', 'data_ref', 'dt_ref'] },
  { canon: 'documento', label: 'Documento', aliases: ['documento', 'doc', 'titulo', 'duplicata', 'nota', 'nota_fiscal', 'nf', 'nfe', 'e1_num', 'e2_num', 'f1_doc', 'f2_doc', 'd1_doc', 'd2_doc'] },
  { canon: 'fornecedor', label: 'Fornecedor', aliases: ['fornecedor', 'fornec', 'nome_fornecedor', 'e2_fornece', 'a2_nome'] },
  { canon: 'cliente', label: 'Cliente', aliases: ['cliente', 'nome_cliente', 'e1_cliente', 'a1_nome'] },
  { canon: 'vendedor', label: 'Vendedor', aliases: ['vendedor', 'nome_vendedor', 'a3_nome'] },
  { canon: 'produto', label: 'Produto', aliases: ['produto', 'nome_produto', 'descricao_produto', 'b1_desc'] },
  { canon: 'banco', label: 'Banco', aliases: ['banco', 'bancos', 'e8_banco', 'a6_cod', 'banco_nome'] },
  { canon: 'agencia', label: 'Agencia', aliases: ['agencia', 'e8_agencia', 'a6_agencia'] },
  { canon: 'conta_corrente', label: 'Conta Corrente', aliases: ['conta', 'conta_corrente', 'e8_conta', 'a6_numcon', 'conta_bancaria'] },
];

const METRICS = [
  { canon: 'a_pagar', label: 'A pagar', type: 'money', totalRule: 'sum', aliases: ['saldo_a_pagar', 'a_pagar', 'total_a_pagar', 'valor_a_pagar', 'e2_saldo'] },
  { canon: 'a_receber', label: 'A receber', type: 'money', totalRule: 'sum', aliases: ['saldo_a_receber', 'a_receber', 'total_a_receber', 'valor_a_receber', 'e1_saldo'] },
  { canon: 'pago', label: 'Pago', type: 'money', totalRule: 'sum', aliases: ['valor_pago', 'valor_pago_total', 'total_pago', 'pago'] },
  { canon: 'recebido', label: 'Recebido', type: 'money', totalRule: 'sum', aliases: ['valor_recebido', 'valor_recebido_total', 'total_recebido', 'recebido'] },
  { canon: 'faturamento', label: 'Faturamento', type: 'money', totalRule: 'sum', aliases: ['faturamento', 'total_faturamento', 'valor_faturamento', 'receita', 'valor_receita', 'total_receita'] },
  { canon: 'faturamento_anterior', label: 'Faturamento Anterior', type: 'money', totalRule: 'ignore', aliases: ['faturamento_anterior', 'valor_faturamento_anterior', 'receita_anterior'] },
  { canon: 'compras', label: 'Compras', type: 'money', totalRule: 'sum', aliases: ['compra', 'compras', 'valor_compra', 'valor_compras', 'total_compra', 'total_compras', 'd1_total', 'f1_valbrut'] },
  { canon: 'comissao', label: 'Comissao', type: 'money', totalRule: 'sum', aliases: ['comissao', 'total_comissao', 'valor_comissao', 'e3_comis'] },
  { canon: 'entradas', label: 'Entradas', type: 'money', totalRule: 'sum', aliases: ['entrada', 'entradas', 'valor_entrada', 'total_entrada', 'valor_receber', 'total_receber'] },
  { canon: 'saidas', label: 'Saidas', type: 'money', totalRule: 'sum', aliases: ['saida', 'saidas', 'valor_saida', 'total_saida', 'valor_pagar', 'total_pagar'] },
  { canon: 'saldo', label: 'Saldo', type: 'money', totalRule: 'sum', aliases: ['saldo', 'saldo_atual', 'salatua', 'e8_salatua'] },
  { canon: 'saldo_bancario_base', label: 'Saldo Bancario Base', type: 'money', totalRule: 'first', aliases: ['saldo_bancario_base', 'saldo_base', 'base_saldo_bancario'] },
  { canon: 'fluxo_liquido', label: 'Fluxo Liquido', type: 'money', totalRule: 'last', aliases: ['fluxo_liquido', 'saldo_projetado', 'saldo_final', 'saldo_final_projetado'] },
  { canon: 'crescimento_valor', label: 'Crescimento Valor', type: 'money', totalRule: 'ignore', aliases: ['crescimento_valor', 'variacao_valor', 'valor_crescimento', 'valor_variacao'] },
  { canon: 'crescimento_percentual', label: 'Crescimento %', type: 'percent', totalRule: 'ignore', aliases: ['crescimento_percentual', 'crescimento_pct', 'variacao_percentual', 'variacao_pct', 'percentual_crescimento', 'percentual_variacao'] },
  { canon: 'quantidade', label: 'Quantidade', type: 'quantity', totalRule: 'sum', aliases: ['quantidade', 'qtd', 'qtde', 'd1_quant', 'd2_quant'] },
  { canon: 'valor', label: 'Valor', type: 'money', totalRule: 'sum', aliases: ['valor', 'e1_valor', 'e2_valor'] },
];

const DIMENSION_BY_ALIAS = new Map();
const METRIC_BY_ALIAS = new Map();
for (const dim of DIMENSIONS) {
  for (const alias of dim.aliases) DIMENSION_BY_ALIAS.set(keyNorm(alias), dim);
}
for (const metric of METRICS) {
  for (const alias of metric.aliases) METRIC_BY_ALIAS.set(keyNorm(alias), metric);
}

function dimension(col) {
  return DIMENSION_BY_ALIAS.get(keyNorm(col)) || null;
}

function metric(col, opts = {}) {
  const found = METRIC_BY_ALIAS.get(keyNorm(col));
  if (!found) return null;
  if (found.canon !== 'valor') return found;

  const msg = norm(opts.mensagem || opts.contextoConsulta || '');
  if (/\b(contas?\s+a\s+pagar|a\s+pagar|pagar)\b/.test(msg)) {
    return METRIC_BY_ALIAS.get('a_pagar') || found;
  }
  if (/\b(contas?\s+a\s+receber|a\s+receber|receber)\b/.test(msg)) {
    return METRIC_BY_ALIAS.get('a_receber') || found;
  }
  return found;
}

function labelMetric(col, opts = {}) {
  return metric(col, opts)?.label || null;
}

function labelDimension(col) {
  return dimension(col)?.label || null;
}

function canonicalMetric(col, opts = {}) {
  return metric(col, opts)?.canon || null;
}

function canonicalDimension(col) {
  return dimension(col)?.canon || null;
}

function metricType(col, opts = {}) {
  return metric(col, opts)?.type || null;
}

function totalRule(col, opts = {}) {
  return metric(col, opts)?.totalRule || null;
}

module.exports = {
  dimension,
  metric,
  labelMetric,
  labelDimension,
  canonicalMetric,
  canonicalDimension,
  metricType,
  totalRule,
  _test: { keyNorm },
};
