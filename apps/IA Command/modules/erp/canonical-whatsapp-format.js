'use strict';

const presentation = require('./presentation-contract');

const RE_METRICA = /valor|total|saldo|salatua|juros|multa|desconto|vlr|vl_|brut|liquido|comiss|qtd|quantidade|qt_|fatura|receita|fat_|compra|pedido|custo|preco|venda|entrada|saida|receb|pag|previst|projet|fluxo|crescimento|variacao|varia[cç][aã]o/i;
const RE_MEDIA = /media|medio|ticket|avg|pct|percent|taxa|indice|proporcao/i;
const RE_SKIP = /percentual|percent|crescimento|variacao|taxa|indice|id$|^id_|codigo|cod_/i;
const RE_QTD = /qtd|quantidade|qt_|volume/i;
const RE_TEMPORAL = /^(ano_mes|aaaamm|aaaa_mm|competencia|referencia|ano|mes|mes_ano|periodo|data|data_.*|dt_.*|.*_data|dia|trimestre|semestre|vencimento|vencto|vencrea|emissao|baixa|.*_(vencimento|vencto|vencrea|emissao|baixa))$/i;
const RE_ENTIDADE = /^(vendedor|fornecedor|cliente|produto|servico|funcionario|unidade|empresa|filial|grupo|categoria|depto|departamento|cc|centro|nome|descri)/i;
const RE_DOCUMENTO = /^(documento|doc|nota|nota_fiscal|nf|nfe|titulo|duplicata|f2_doc|d2_doc|e1_num|e2_num)$/i;
const RE_BANCARIO = /^(banco|bancos|e8_banco|a6_cod|banco_nome|agencia|e8_agencia|a6_agencia|conta|conta_corrente|e8_conta|a6_numcon|conta_bancaria)$/i;
const RE_CATEGORIA_SEMANTICA = /^(carteira|tipo_carteira|origem_carteira|tipo|categoria|natureza|operacao|movimento|tipo_movimento|sentido|fluxo|origem|classe)$/i;

const LABELS = {
  valor_recebido: 'Recebido',
  valor_pago: 'Pago',
  valor_recebido_total: 'Recebido',
  valor_pago_total: 'Pago',
  saldo_a_receber: 'A receber',
  saldo_a_pagar: 'A pagar',
  total_a_receber: 'Total A Receber',
  total_a_pagar: 'Total A Pagar',
  e1_saldo: 'A receber',
  e2_saldo: 'A pagar',
  e1_valor: 'A receber',
  e2_valor: 'A pagar',
  valor: 'Valor',
  entrada: 'Entradas',
  entradas: 'Entradas',
  valor_entrada: 'Entradas',
  total_entrada: 'Entradas',
  saida: 'Saidas',
  saidas: 'Saidas',
  valor_saida: 'Saidas',
  total_saida: 'Saidas',
  a_receber: 'A receber',
  a_pagar: 'A pagar',
  receber: 'A receber',
  pagar: 'A pagar',
  previsto_receber: 'A receber',
  previsto_pagar: 'A pagar',
  projetado_receber: 'A receber',
  projetado_pagar: 'A pagar',
  total_faturamento: 'Faturamento',
  faturamento: 'Faturamento',
  faturamento_anterior: 'Faturamento Anterior',
  crescimento_valor: 'Crescimento Valor',
  crescimento_percentual: 'Crescimento %',
  crescimento_pct: 'Crescimento %',
  variacao_valor: 'Crescimento Valor',
  variacao_percentual: 'Crescimento %',
  variacao_pct: 'Crescimento %',
  receita: 'Receita',
  compra: 'Compras',
  valor_compra: 'Compras',
  valor_compras: 'Compras',
  total_compra: 'Compras',
  total_compras: 'Compras',
  compras: 'Compras',
  total_comissao: 'Comissao',
  valor_comissao: 'Comissao',
  quantidade: 'Quantidade',
  qtd: 'Quantidade',
};

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

function toNumber(v) {
  const n = parseNumber(v);
  return n === null ? 0 : n;
}

function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return null;
  let limpo = s.replace(/\s|\u00a0/g, '').replace(/R\$/i, '');
  if (limpo.includes(',') && limpo.lastIndexOf(',') > limpo.lastIndexOf('.')) {
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  } else {
    limpo = limpo.replace(/,/g, '');
  }
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

function brl(v) {
  return toNumber(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function num(v) {
  return toNumber(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function isPercentual(col) {
  const k = keyNorm(col);
  if (presentation.metricType(col) === 'percent') return true;
  return /percentual|percent|pct|taxa|indice|proporcao/.test(k);
}

function isMetricaCrescimento(col) {
  const k = keyNorm(col);
  return /crescimento|variacao|varia[cç][aã]o/.test(k);
}

function isCrescimentoValor(col) {
  const k = keyNorm(col);
  return isMetricaCrescimento(col) && /valor|vlr|total/.test(k) && !isPercentual(col);
}

function pct(v) {
  const n = parseNumber(v);
  if (n === null) return 'N/A';
  const abs = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n > 0 ? `+${abs}%` : n < 0 ? `-${abs}%` : '0,00%';
}

function fmt(col, v) {
  if (isPercentual(col)) return pct(v);
  if (isMetricaCrescimento(col) && parseNumber(v) === null) return 'N/A';
  return presentation.metricType(col) === 'quantity' || RE_QTD.test(col) ? num(v) : brl(v);
}

function labelMetrica(col) {
  const k = keyNorm(col);
  return LABELS[k] || presentation.labelMetric(col) || labelSx3(col) || String(col || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function infoComparativoAno(col) {
  const raw = String(col || '');
  const m = raw.match(/^(.*?)[_\s-]+(20\d{2})$/);
  if (!m) return null;
  return { base: m[1], ano: m[2] };
}

function anoPeriodoAtual(opts = {}) {
  const texto = String(opts.contextoConsulta || opts.mensagem || '');
  const anos = [...texto.matchAll(/\b(20\d{2})\b/g)].map(m => m[1]);
  return anos.length ? anos[0] : null;
}

function mesPeriodoAtual(opts = {}) {
  const texto = norm(opts.contextoConsulta || opts.mensagem || '');
  const meses = [
    ['janeiro', 1], ['jan', 1],
    ['fevereiro', 2], ['fev', 2],
    ['marco', 3], ['mar', 3],
    ['abril', 4], ['abr', 4],
    ['maio', 5], ['mai', 5],
    ['junho', 6], ['jun', 6],
    ['julho', 7], ['jul', 7],
    ['agosto', 8], ['ago', 8],
    ['setembro', 9], ['set', 9],
    ['outubro', 10], ['out', 10],
    ['novembro', 11], ['nov', 11],
    ['dezembro', 12], ['dez', 12],
  ];
  const found = meses.find(([nome]) => new RegExp(`\\b${nome}\\b`).test(texto));
  return found ? found[1] : null;
}

function labelPeriodoAno(ano, opts = {}) {
  const mes = mesPeriodoAtual(opts);
  if (mes >= 1 && mes <= 12) return `${MESES[mes - 1]}/${ano}`;
  return String(ano || 'Periodo');
}

function comparativoAnoMetricas(metricas = [], opts = {}) {
  const atualAno = anoPeriodoAtual(opts);
  const grupos = new Map();
  for (const col of metricas || []) {
    const info = infoComparativoAno(col);
    const base = info ? info.base : col;
    const k = keyNorm(base);
    if (!grupos.has(k)) grupos.set(k, { base, atual: null, anos: new Map() });
    const grupo = grupos.get(k);
    if (info) grupo.anos.set(info.ano, col);
    else grupo.atual = col;
  }
  const itens = [...grupos.values()].filter(g => g.atual && g.anos.size);
  if (!itens.length || !atualAno) return null;
  const anosComparados = [...new Set(itens.flatMap(g => [...g.anos.keys()]))].sort((a, b) => Number(b) - Number(a));
  if (!anosComparados.length) return null;
  return { atualAno, anosComparados, itens };
}

function valorItemComparativo(totais, item, anoAtual, ano) {
  const col = String(ano) === String(anoAtual) ? item.atual : item.anos.get(String(ano));
  return col ? toNumber(totais[col]) : 0;
}

function resultadoComparativoPeriodo(totais, itens, anoAtual, ano) {
  const cols = itens.map(item => item.base);
  const parcial = {};
  for (const item of itens) parcial[item.base] = valorItemComparativo(totais, item, anoAtual, ano);
  return formulaResultado(cols, parcial);
}

function renderComparativoAnoMetricas(linhas, totais, metricas, opts = {}) {
  const comp = comparativoAnoMetricas(metricas, opts);
  if (!comp) return false;

  linhas.push('\u{1F4CA} *Comparativo*');
  const anos = [comp.atualAno, ...comp.anosComparados.filter(ano => ano !== comp.atualAno)];
  for (const ano of anos) {
    linhas.push(`\u{1F4C5} *${labelPeriodoAno(ano, opts)}*`);
    comp.itens.forEach((item, idx) => {
      linhas.push(`  ${idx + 1}. ${labelMetrica(item.base)}: *${brl(valorItemComparativo(totais, item, comp.atualAno, ano))}*`);
    });
    const resultado = resultadoComparativoPeriodo(totais, comp.itens, comp.atualAno, ano);
    if (resultado) linhas.push(`  \u{1F9FE} *${resultado.label}*: *${brl(resultado.valor)}*`);
    linhas.push('');
  }

  const anoBase = comp.anosComparados.find(ano => ano !== comp.atualAno) || comp.anosComparados[0];
  if (anoBase) {
    linhas.push(`\u{1F4C8} *Variacao ${comp.atualAno} x ${anoBase}*`);
    comp.itens.forEach((item, idx) => {
      const atual = valorItemComparativo(totais, item, comp.atualAno, comp.atualAno);
      const anterior = valorItemComparativo(totais, item, comp.atualAno, anoBase);
      const diff = atual - anterior;
      const percentual = anterior !== 0 ? (diff / anterior) * 100 : null;
      linhas.push(`  ${idx + 1}. ${labelMetrica(item.base)}: *${brl(diff)}* | *${pct(percentual)}*`);
    });
    linhas.push('');
  }

  const totaisPeriodos = anos
    .map(ano => {
      const resultado = resultadoComparativoPeriodo(totais, comp.itens, comp.atualAno, ano);
      return resultado ? `${labelPeriodoAno(ano, opts)}: *${brl(resultado.valor)}*` : null;
    })
    .filter(Boolean);
  if (totaisPeriodos.length) linhas.push(`*Total Geral*: ${totaisPeriodos.join(' | ')}`);
  return true;
}

function perguntaComparativaTemporal(opts = {}) {
  const texto = norm(opts.contextoConsulta || opts.mensagem || '');
  const anos = [...String(opts.contextoConsulta || opts.mensagem || '').matchAll(/\b(20\d{2})\b/g)].map(m => m[1]);
  return /\b(compar|comparando|comparativo|versus|vs)\b/.test(texto) && new Set(anos).size >= 2;
}

function metricasPedemResultado(metricas = []) {
  const ks = new Set((metricas || []).map(keyNorm));
  const has = (...aliases) => aliases.some(alias => ks.has(alias));
  return (has('total_faturamento', 'faturamento', 'receita') && has('total_compras', 'compras'))
    || (has('valor_recebido', 'recebido', 'a_receber', 'saldo_a_receber', 'total_a_receber') && has('valor_pago', 'pago', 'a_pagar', 'saldo_a_pagar', 'total_a_pagar'))
    || (has('entrada', 'entradas', 'valor_entrada', 'total_entrada') && has('saida', 'saidas', 'valor_saida', 'total_saida'))
    || (has('receita', 'receitas', 'valor_receita', 'total_receita') && has('despesa', 'despesas', 'valor_despesa', 'total_despesa', 'custo', 'custos', 'total_custo'));
}

function renderAvisoComparativoSemPeriodo(linhas, opts = {}, metricas = []) {
  if (!perguntaComparativaTemporal(opts)) return false;
  if (!metricasPedemResultado(metricas)) return false;
  if ((metricas || []).some(infoComparativoAno)) return false;
  linhas.push('\u{26A0}\u{FE0F} *Nao consegui formatar o comparativo por periodo.*');
  linhas.push('O retorno chegou sem coluna de competencia/ano e sem colunas separadas por ano.');
  linhas.push('Para comparar periodos, o resultado precisa trazer cada mes/ano separado, por exemplo `competencia` + `categoria`, ou colunas como `total_compras_2025` e `total_faturamento_2025`.');
  return true;
}

// Mapa de rotulos vindo do SX3 do tenant (campo fisico Protheus -> titulo cadastrado).
// Setado por setLabelsSx3() antes de formatar; permite que labelMetrica/labelDimensao
// resolvam campos fisicos (ex: E2_VENCREA) sem depender de heuristica regex ou hardcode.
let _labelsSx3 = null;

function setLabelsSx3(mapa) {
  _labelsSx3 = mapa && typeof mapa === 'object' ? mapa : null;
}

function labelSx3(col) {
  if (!_labelsSx3) return null;
  const k = String(col || '').toUpperCase().trim();
  const titulo = _labelsSx3[k];
  if (!titulo) return null;
  const limpo = String(titulo).trim();
  return limpo
    ? limpo.replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null;
}

function labelDimensao(col) {
  const k = keyNorm(col);
  const doSx3 = labelSx3(col);
  if (doSx3) return doSx3;
  const doContrato = presentation.labelDimension(col);
  if (doContrato) return doContrato;
  if (/^vendedor/.test(k)) return 'Vendedor';
  if (/^fornecedor/.test(k)) return 'Fornecedor';
  if (/^cliente/.test(k)) return 'Cliente';
  if (RE_DOCUMENTO.test(k)) return 'Documento';
  if (RE_CATEGORIA_SEMANTICA.test(k)) return 'Categoria';
  if (/^(banco|bancos|e8_banco|a6_cod|banco_nome)$/.test(k)) return 'Banco';
  if (/^(agencia|e8_agencia|a6_agencia)$/.test(k)) return 'Agencia';
  if (/^(conta|conta_corrente|e8_conta|a6_numcon|conta_bancaria)$/.test(k)) return 'Conta Corrente';
  if (/^produto/.test(k)) return 'Produto';
  if (/^servico/.test(k)) return 'Servico';
  if (/^funcionario/.test(k)) return 'Funcionario';
  if (/^empresa/.test(k)) return 'Empresa';
  if (/^grupo/.test(k)) return 'Grupo';
  if (/^categoria/.test(k)) return 'Categoria';
  if (/^filial/.test(k)) return 'Filial';
  if (/^mes/.test(k)) return 'Mes';
  if (/^ano/.test(k)) return 'Ano';
  return String(col || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const MESES = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function labelValorDimensao(col, valor) {
  const k = keyNorm(col);
  const s = String(valor ?? '').trim();
  if (/^mes$/.test(k)) {
    const n = parseInt(s, 10);
    if (n >= 1 && n <= 12) return MESES[n - 1];
  }
  if (/^\d{6}$/.test(s)) {
    const ano = s.slice(0, 4);
    const mes = parseInt(s.slice(4, 6), 10);
    if (mes >= 1 && mes <= 12) return `${MESES[mes - 1]}/${ano}`;
  }
  if (/^\d{8}$/.test(s)) return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const mes = parseInt(s.slice(5, 7), 10);
    if (mes >= 1 && mes <= 12) return `${MESES[mes - 1]}/${s.slice(0, 4)}`;
  }
  return s || '(sem identificacao)';
}

function sortValorDimensao(col, valor) {
  const k = keyNorm(col);
  const s = String(valor ?? '').trim();
  if (/^mes$/.test(k)) {
    const n = parseInt(s, 10);
    return n >= 1 && n <= 12 ? String(n).padStart(2, '0') : s;
  }
  if (/^\d{6}$/.test(s) || /^\d{8}$/.test(s)) return s;
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  return s;
}

function isDocumento(col) {
  return RE_DOCUMENTO.test(keyNorm(col));
}

function isTemporal(col) {
  return RE_TEMPORAL.test(keyNorm(col));
}

function isBancario(col) {
  return RE_BANCARIO.test(keyNorm(col));
}

function isCategoriaSemantica(col) {
  return RE_CATEGORIA_SEMANTICA.test(keyNorm(col));
}

const CATEGORIAS_SEMANTICAS = [
  { match: /^(faturamento)$/i, label: 'Faturamento', ordem: 5 },
  { match: /^(compra|compras)$/i, label: 'Compras', ordem: 6 },
  { match: /^(pagar|pagamento|pago|contas?_?a?_?pagar)$/i, aberto: 'A pagar', realizado: 'Pago', ordem: 10 },
  { match: /^(receber|recebimento|recebido|contas?_?a?_?receber)$/i, aberto: 'A receber', realizado: 'Recebido', ordem: 20 },
  { match: /^(entrada|entradas|in|credito|creditos|cr[eé]dito)$/i, label: 'Entrada', ordem: 30 },
  { match: /^(saida|saidas|out|debito|debitos|d[eé]bito)$/i, label: 'Saida', ordem: 40 },
  { match: /^(venda|vendas|faturamento|receita|receitas)$/i, label: 'Receita', ordem: 50 },
  { match: /^(compra|compras|despesa|despesas|custo|custos)$/i, label: 'Despesa', ordem: 60 },
  { match: /^(comissao|comissoes|comiss[aã]o|comiss[oõ]es)$/i, label: 'Comissao', ordem: 70 },
];

function categoriaSemantica(valor) {
  const v = norm(valor).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!v) return null;
  for (const cat of CATEGORIAS_SEMANTICAS) {
    if (cat.match.test(v)) return cat;
  }
  return null;
}

function labelDocumento(doc) {
  const s = String(doc ?? '').trim();
  return s ? `Doc. ${s}` : 'Doc. (sem identificacao)';
}

function isNumericValue(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && parseNumber(v) !== null;
}

function isTemporalDimensionValue(col, v) {
  const k = keyNorm(col);
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (/^(mes)$/.test(k)) {
    const n = parseInt(s, 10);
    return (n >= 1 && n <= 12) || /^[a-z]/i.test(s);
  }
  if (/^(ano)$/.test(k)) return /^\d{4}$/.test(s);
  return /^\d{6}$/.test(s) || /^\d{8}$/.test(s) || /^\d{4}-\d{2}/.test(s) || /^\d{2}\/\d{2}\/\d{4}$/.test(s);
}

function sampleRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 20);
}

function devePularMetrica(col, keys) {
  const nk = keyNorm(col);
  if (isMetricaCrescimento(nk)) return false;
  if (RE_SKIP.test(nk)) return true;
  if (/_anterior$/.test(nk)) {
    const atual = nk.replace(/_anterior$/, '_atual');
    return !keys.map(keyNorm).includes(atual);
  }
  return false;
}

function detectarShape(rows, opts = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = Object.keys(rows[0] || {});
  const amostra = sampleRows(rows);
  const metricas = keys.filter(k => {
    const nk = keyNorm(k);
    if (presentation.dimension(k)) return false;
    const metric = presentation.metric(k, opts);
    if (metric) return amostra.some(r => isNumericValue(r[k]) || (metric.type === 'percent' && parseNumber(r[k]) === null));
    if (RE_TEMPORAL.test(nk) || RE_ENTIDADE.test(nk) || RE_DOCUMENTO.test(nk) || RE_BANCARIO.test(nk) || RE_CATEGORIA_SEMANTICA.test(nk)) return false;
    if (isMetricaCrescimento(nk)) return amostra.some(r => isNumericValue(r[k]) || parseNumber(r[k]) === null);
    if (RE_MEDIA.test(nk) || devePularMetrica(k, keys)) return false;
    if (!RE_METRICA.test(nk)) return false;
    return amostra.some(r => isNumericValue(r[k]));
  });
  if (!metricas.length) return null;

  const dimensoes = keys.filter(k => {
    const nk = keyNorm(k);
    if (metricas.includes(k)) return false;
    if (presentation.dimension(k)) return amostra.some(r => String(r[k] ?? '').trim() !== '');
    if (!RE_TEMPORAL.test(nk) && !RE_ENTIDADE.test(nk) && !RE_DOCUMENTO.test(nk) && !RE_BANCARIO.test(nk) && !RE_CATEGORIA_SEMANTICA.test(nk)) return false;
    if (RE_TEMPORAL.test(nk)) return amostra.some(r => isTemporalDimensionValue(k, r[k]));
    if (RE_CATEGORIA_SEMANTICA.test(nk)) return amostra.some(r => categoriaSemantica(r[k]));
    if (RE_DOCUMENTO.test(nk) || RE_BANCARIO.test(nk)) return amostra.some(r => String(r[k] ?? '').trim() !== '');
    return amostra.some(r => String(r[k] ?? '').trim() !== '') && !amostra.every(r => isNumericValue(r[k]));
  });

  const dimensoesNormalizadas = compactarDimensoesBancarias(dimensoes);

  if (dimensoesNormalizadas.length > 3) return null;
  if (dimensoesNormalizadas.length === 0) return { tipo: 'metricas_simples', dimensao: null, dimensoes: [], metricas };
  if (dimensoesNormalizadas.length === 1 && metricas.length === 1 && isCategoriaSemantica(dimensoesNormalizadas[0])) {
    return { tipo: 'categoria_metrica_unica', dimensao: dimensoesNormalizadas[0], dimensoes: dimensoesNormalizadas, metricas };
  }
  if (dimensoesNormalizadas.length === 1) return { tipo: 'uma_dimensao', dimensao: dimensoesNormalizadas[0], dimensoes: dimensoesNormalizadas, metricas };
  if (dimensoesNormalizadas.length === 3) {
    const ordenadas = ordenarMultiplasDimensoes(dimensoesNormalizadas);
    return { tipo: 'multiplas_dimensoes', dimensao: ordenadas[0], dimensoes: ordenadas, metricas };
  }

  const docDim = dimensoesNormalizadas.find(isDocumento);
  const entDim = docDim ? dimensoesNormalizadas.find(d => d !== docDim) : null;
  if (docDim && entDim && !isTemporal(entDim)) {
    return { tipo: 'detalhe_documento', dimensao: entDim, dimensoes: [entDim, docDim], documento: docDim, metricas };
  }

  const ordenadas = ordenarDuasDimensoes(dimensoesNormalizadas);
  return { tipo: 'duas_dimensoes', dimensao: ordenadas[0], dimensoes: ordenadas, metricas };
}

function ordenarDuasDimensoes(dimensoes) {
  const mes = dimensoes.find(d => keyNorm(d) === 'mes');
  const ano = dimensoes.find(d => keyNorm(d) === 'ano');
  if (mes && ano) return [mes, ano];
  const temporal = dimensoes.find(isTemporal);
  if (temporal) return [temporal, dimensoes.find(d => d !== temporal)];
  return dimensoes.slice(0, 2);
}

function ordemBancoDimensao(dim) {
  const k = keyNorm(dim);
  if (/^(banco|bancos|e8_banco|a6_cod|banco_nome)$/.test(k)) return 1;
  if (/^(agencia|e8_agencia|a6_agencia)$/.test(k)) return 2;
  if (/^(conta|conta_corrente|e8_conta|a6_numcon|conta_bancaria)$/.test(k)) return 3;
  return 99;
}

function compactarDimensoesBancarias(dimensoes) {
  if (!dimensoes.length || !dimensoes.every(isBancario)) return dimensoes;
  const temBancoAmigavel = dimensoes.some(dim => /^(banco|bancos|banco_nome)$/.test(keyNorm(dim)));
  const dims = temBancoAmigavel
    ? dimensoes.filter(dim => !/^(e8_banco|a6_cod)$/.test(keyNorm(dim)))
    : dimensoes.slice();
  return ordenarMultiplasDimensoes(dims).slice(0, 3);
}

function ordenarMultiplasDimensoes(dimensoes) {
  if (dimensoes.every(isBancario)) {
    return dimensoes.slice().sort((a, b) => ordemBancoDimensao(a) - ordemBancoDimensao(b));
  }
  const temporal = dimensoes.filter(isTemporal);
  const outras = dimensoes.filter(d => !isTemporal(d));
  return [...temporal, ...outras].slice(0, 3);
}

function somarMetricas(rows, metricas) {
  const out = {};
  const vistos = {};
  for (const col of metricas) out[col] = 0;
  for (const row of rows || []) {
    for (const col of metricas) {
      const n = parseNumber(row[col]);
      if (n === null) continue;
      vistos[col] = true;
      out[col] += n;
    }
  }
  for (const col of metricas) {
    if (isMetricaCrescimento(col) && !vistos[col]) out[col] = null;
  }
  return out;
}

function formulaResultado(metricas, totais) {
  const byNorm = new Map(metricas.map(col => [keyNorm(col), col]));
  const keys = [...byNorm.keys()];
  if (keys.some(k => /saldo.*base|base.*saldo|saldo_bancario|bancario_base|fluxo.*liquido|liquido.*fluxo|saldo.*final|final.*saldo/.test(k))) return null;
  const pares = [
    { a: ['valor_recebido', 'valor_recebido_total'], b: ['valor_pago', 'valor_pago_total'], label: 'Resultado' },
    { a: ['total_faturamento', 'faturamento', 'receita'], b: ['total_compras', 'compras'], label: 'Resultado' },
    { a: ['a_receber', 'saldo_a_receber', 'total_a_receber'], b: ['a_pagar', 'saldo_a_pagar', 'total_a_pagar'], label: 'Resultado' },
    { a: ['entrada', 'entradas', 'valor_entrada', 'total_entrada'], b: ['saida', 'saidas', 'valor_saida', 'total_saida'], label: 'Resultado' },
    { a: ['receita', 'receitas', 'valor_receita', 'total_receita'], b: ['despesa', 'despesas', 'valor_despesa', 'total_despesa', 'custo', 'custos', 'total_custo'], label: 'Resultado' },
  ];
  for (const par of pares) {
    const colA = par.a.map(k => byNorm.get(k)).find(Boolean);
    const colB = par.b.map(k => byNorm.get(k)).find(Boolean);
    if (colA && colB) return { label: par.label, valor: (totais[colA] || 0) - (totais[colB] || 0) };
  }
  return null;
}

function header({ contextoConsulta, nomeModulo, titulo = null }) {
  const partes = [nomeModulo, titulo || contextoConsulta].filter(Boolean);
  if (!partes.length) return null;
  return `\u{1F4CA} *${partes.join(' --> ')}*`;
}

function renderMetricas(totais, metricas, indent = '  ') {
  return metricas.map((col, idx) => `${indent}${idx + 1}. ${labelMetrica(col)}: *${fmt(col, totais[col])}*`);
}

function addTotais(dest, src, metricas) {
  for (const col of metricas) dest[col] = (dest[col] || 0) + (src[col] || 0);
}

function totalVazio(metricas) {
  const out = {};
  for (const col of metricas) out[col] = 0;
  return out;
}

function metricasTotalizaveis(metricas = []) {
  return metricas.filter(col => presentation.totalRule(col) !== 'ignore' && !isMetricaCrescimento(col) && !/_anterior$/i.test(keyNorm(col)));
}

function valsMetricas(totais, metricas) {
  return metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ');
}

function valsMetricasPorCategoria(totais, metricas, categoria) {
  return metricas.map(col => `${labelMetricaCategoria(col, categoria)}: *${fmt(col, totais[col])}*`).join(' | ');
}

function totaisPorCategoria(grupos, metricas) {
  const out = new Map();
  for (const [categoria, grupo] of grupos.entries()) {
    for (const col of metricas) {
      const label = labelMetricaCategoria(col, categoria);
      out.set(label, (out.get(label) || 0) + toNumber(grupo.total?.[col]));
    }
  }
  return [...out.entries()]
    .sort(([a], [b]) => ordemCategoriaLabel(a) - ordemCategoriaLabel(b) || a.localeCompare(b));
}

function valsTotaisPorCategoria(entradas) {
  return entradas.map(([label, valor]) => `${label}: *${brl(valor)}*`).join(' | ');
}

function totaisPorCategoriaItens(itens, metricas) {
  const out = new Map();
  for (const [categoria, totais] of itens.entries()) {
    for (const col of metricas) {
      const label = labelMetricaCategoria(col, categoria);
      out.set(label, (out.get(label) || 0) + toNumber(totais?.[col]));
    }
  }
  return [...out.entries()]
    .sort(([a], [b]) => ordemCategoriaLabel(a) - ordemCategoriaLabel(b) || a.localeCompare(b));
}

function resultadoCategorias(entradas) {
  const mapa = new Map((entradas || []).map(([label, valor]) => [keyNorm(label), toNumber(valor)]));
  const pares = [
    { a: ['faturamento', 'receita'], b: ['compras'], label: 'Resultado' },
    { a: ['a_receber', 'recebido'], b: ['a_pagar', 'pago'], label: 'Resultado' },
    { a: ['receita'], b: ['despesa', 'despesas', 'custo', 'custos'], label: 'Resultado' },
    { a: ['entrada', 'entradas'], b: ['saida', 'saidas'], label: 'Resultado' },
  ];
  for (const par of pares) {
    const keyA = par.a.find(k => mapa.has(k));
    const keyB = par.b.find(k => mapa.has(k));
    if (keyA && keyB) return { label: par.label, valor: mapa.get(keyA) - mapa.get(keyB) };
  }
  return null;
}

function colBaseCrescimento(metricas = []) {
  const prioridade = ['faturamento', 'total_faturamento', 'receita', 'valor_faturamento', 'total_receita'];
  const byNorm = new Map(metricas.map(col => [keyNorm(col), col]));
  return prioridade.map(k => byNorm.get(k)).find(Boolean)
    || metricas.find(col => /fatur|receita|venda/.test(keyNorm(col)) && !isMetricaCrescimento(col) && !/_anterior$/i.test(keyNorm(col)))
    || metricas.find(col => !isMetricaCrescimento(col) && !/_anterior$/i.test(keyNorm(col)));
}

function recalcularCrescimentoTemporal(entradas, metricas) {
  const crescimentoValor = metricas.filter(isCrescimentoValor);
  const crescimentoPct = metricas.filter(col => isMetricaCrescimento(col) && isPercentual(col));
  if (!entradas.length || (!crescimentoValor.length && !crescimentoPct.length)) return entradas;
  const base = colBaseCrescimento(metricas);
  if (!base) return entradas;

  let anterior = null;
  for (const [, totais] of entradas) {
    const atual = parseNumber(totais?.[base]);
    const temAtual = atual !== null;
    const temAnterior = anterior !== null;
    const diff = temAtual && temAnterior ? atual - anterior : null;
    for (const col of crescimentoValor) totais[col] = diff;
    for (const col of crescimentoPct) totais[col] = diff !== null && anterior !== 0 ? (diff / anterior) * 100 : null;
    if (temAtual) anterior = atual;
  }
  return entradas;
}

function resumoEmpresaTemporal(rows, dim, metricas, metricasTotal) {
  const totais = somarMetricas(rows, metricasTotal);
  const crescimentoValor = metricas.filter(isCrescimentoValor);
  const crescimentoPct = metricas.filter(col => isMetricaCrescimento(col) && isPercentual(col));
  if (!crescimentoValor.length && !crescimentoPct.length) return { totais, metricas: metricasTotal };

  const base = colBaseCrescimento(metricas);
  if (!base) return { totais, metricas: metricasTotal };

  const porDim = new Map();
  for (const row of rows || []) {
    const label = String(row[dim] ?? '').trim() || '(sem identificacao)';
    if (!porDim.has(label)) porDim.set(label, totalVazio(metricas));
    const grupo = porDim.get(label);
    for (const col of metricas) grupo[col] += toNumber(row[col]);
  }

  const entradas = [...porDim.entries()]
    .sort(([a], [b]) => sortValorDimensao(dim, a).localeCompare(sortValorDimensao(dim, b)));
  const first = entradas.find(([, vals]) => parseNumber(vals?.[base]) !== null);
  const last = entradas.slice().reverse().find(([, vals]) => parseNumber(vals?.[base]) !== null);
  const inicial = first ? parseNumber(first[1][base]) : null;
  const final = last ? parseNumber(last[1][base]) : null;
  const diff = inicial !== null && final !== null && first !== last ? final - inicial : null;

  for (const col of crescimentoValor) totais[col] = diff;
  for (const col of crescimentoPct) totais[col] = diff !== null && inicial !== 0 ? (diff / inicial) * 100 : null;

  return {
    totais,
    metricas: [...metricasTotal, ...crescimentoValor, ...crescimentoPct],
  };
}

function temCrescimento(metricas = []) {
  return metricas.some(isMetricaCrescimento);
}

function observacaoCrescimentoPorEmpresa() {
  return '_Obs.: no Por Empresa, o Crescimento Valor e o Crescimento % comparam a primeira e a ultima competencia exibidas para cada empresa; percentuais nao sao somados._';
}

function chaveMetricaCanonica(col) {
  const k = keyNorm(col);
  const doContrato = presentation.canonicalMetric(col);
  if (doContrato) return doContrato;
  if (/^(total_)?faturamento$|^valor_faturamento$|^receita$|^valor_receita$|^total_receita$/.test(k)) return 'faturamento';
  if (/^(total_)?compras?$|^valor_compras?$/.test(k)) return 'compras';
  if (/^valor_recebido(_total)?$|^total_recebido$|^recebido$/.test(k)) return 'recebido';
  if (/^valor_pago(_total)?$|^total_pago$|^pago$/.test(k)) return 'pago';
  if (/^saldo_a_receber$|^a_receber$|^total_a_receber$|^valor_a_receber$|^e1_saldo$/.test(k)) return 'a_receber';
  if (/^saldo_a_pagar$|^a_pagar$|^total_a_pagar$|^valor_a_pagar$|^e2_saldo$/.test(k)) return 'a_pagar';
  if (/^(valor|valor_total|total_valor|e1_valor|e2_valor)$/.test(k)) return 'valor';
  if (/^total_comissao$|^valor_comissao$|^comissao$/.test(k)) return 'comissao';
  return keyNorm(labelMetrica(col));
}

function chaveDimensaoCanonica(col) {
  const k = keyNorm(col);
  const doContrato = presentation.canonicalDimension(col);
  if (doContrato) return doContrato;
  if (/^(vencimento|vencto|vencrea|data_vencimento|dt_vencimento|e1_vencto|e2_vencto|e1_vencrea|e2_vencrea)$/.test(k)) return 'vencimento';
  if (/^(emissao|data_emissao|dt_emissao|e1_emissao|e2_emissao)$/.test(k)) return 'emissao';
  if (/^(baixa|data_baixa|dt_baixa|e1_baixa|e2_baixa)$/.test(k)) return 'baixa';
  if (/^(documento|doc|titulo|duplicata|nota|nota_fiscal|nf|nfe|e1_num|e2_num)$/.test(k)) return 'documento';
  if (/^(fornecedor|fornec|nome_fornecedor|e2_fornece|a2_nome)$/.test(k)) return 'fornecedor';
  if (/^(cliente|nome_cliente|e1_cliente|a1_nome)$/.test(k)) return 'cliente';
  if (/^(vendedor|nome_vendedor)$/.test(k)) return 'vendedor';
  if (/^(produto|nome_produto|descricao_produto)$/.test(k)) return 'produto';
  if (/^(competencia|ano_mes|aaaamm|aaaa_mm|referencia|periodo)$/.test(k)) return 'competencia';
  return keyNorm(labelDimensao(col));
}

function chaveMetricaCanonicaContextual(col, opts = {}) {
  const canon = chaveMetricaCanonica(col);
  const msg = norm(opts.mensagem || opts.contextoConsulta || '');
  if (canon === 'valor' && /\b(contas?\s+a\s+pagar|a\s+pagar|pagar)\b/.test(msg)) return 'a_pagar';
  if (canon === 'valor' && /\b(contas?\s+a\s+receber|a\s+receber|receber)\b/.test(msg)) return 'a_receber';
  return canon;
}

function labelDimensaoCanonica(canon, col) {
  const doContrato = presentation.labelDimension(col || canon);
  if (doContrato) return doContrato;
  if (canon === 'vencimento') return 'Vencimento';
  if (canon === 'emissao') return 'Emissao';
  if (canon === 'baixa') return 'Baixa';
  if (canon === 'competencia') return 'Competencia';
  return labelDimensao(col || canon);
}

function alinharMetricasSucessos(sucessos, shapes, opts = {}) {
  if (!Array.isArray(shapes) || shapes.some(shape => !shape)) return { sucessos, shapes };
  const metricasBase = shapes[0]?.metricas || [];
  const canonBase = metricasBase.map(col => chaveMetricaCanonicaContextual(col, opts));
  const mapaBase = new Map(canonBase.map((canon, idx) => [canon, metricasBase[idx]]));

  if (!shapes.every(shape => {
    const atuais = new Set((shape?.metricas || []).map(col => chaveMetricaCanonicaContextual(col, opts)));
    return atuais.size === canonBase.length && canonBase.every(canon => atuais.has(canon));
  })) {
    return { sucessos, shapes };
  }

  const alinhados = sucessos.map((s, idx) => {
    const shape = shapes[idx];
    const mapaAtual = new Map((shape.metricas || []).map(col => [chaveMetricaCanonicaContextual(col, opts), col]));
    const rows = (s.rows || []).map(row => {
      const out = { ...row };
      for (const canon of canonBase) {
        const colBase = mapaBase.get(canon);
        const colAtual = mapaAtual.get(canon);
        if (colBase && colAtual && colBase !== colAtual && Object.prototype.hasOwnProperty.call(row, colAtual)) {
          out[colBase] = toNumber(out[colBase]) + toNumber(row[colAtual]);
        }
      }
      return out;
    });
    return { ...s, rows };
  });

  return {
    sucessos: alinhados,
    shapes: shapes.map(shape => ({ ...shape, metricas: metricasBase.slice() })),
  };
}

function metricasCanonicasPorShape(shape, opts = {}) {
  const out = new Map();
  for (const col of shape?.metricas || []) {
    const canon = chaveMetricaCanonicaContextual(col, opts);
    if (!out.has(canon)) out.set(canon, { canon, col });
  }
  return out;
}

function dimensoesCanonicasPorShape(shape) {
  const out = new Map();
  for (const col of shape?.dimensoes || []) {
    const canon = chaveDimensaoCanonica(col);
    if (!out.has(canon)) out.set(canon, { canon, col });
  }
  return out;
}

function valorCanonicoRow(row, cols) {
  const vals = [...new Set(cols || [])]
    .filter(col => Object.prototype.hasOwnProperty.call(row || {}, col))
    .map(col => toNumber(row[col]))
    .filter(v => Number.isFinite(v));
  if (!vals.length) return 0;
  const nonZero = vals.find(v => v !== 0);
  return nonZero ?? vals[0];
}

function somarMetricasCanonicas(rows, metricasCanonicas, shape) {
  const porCanon = new Map();
  for (const col of shape?.metricas || []) {
    const canon = chaveMetricaCanonicaContextual(col, shape?._opts || {});
    if (!porCanon.has(canon)) porCanon.set(canon, []);
    porCanon.get(canon).push(col);
  }

  const out = {};
  for (const met of metricasCanonicas) out[met.canon] = 0;
  for (const row of rows || []) {
    for (const met of metricasCanonicas) {
      out[met.canon] += valorCanonicoRow(row, porCanon.get(met.canon) || [met.col]);
    }
  }
  return out;
}

function valsMetricasCanonicas(totais, metricasCanonicas, opts = {}) {
  return metricasCanonicas
    .map(met => {
      const label = labelMetricaContextual(met.col, opts, met.canon);
      return `${label}: *${fmt(met.col, totais[met.canon])}*`;
    })
    .join(' | ');
}

function isMetricaCanonicaCrescimento(met) {
  return isMetricaCrescimento(met?.canon) || isMetricaCrescimento(met?.col);
}

function metricasCanonicasTotalizaveis(metricasCanonicas = []) {
  return metricasCanonicas.filter(met => presentation.totalRule(met.col) !== 'ignore' && !isMetricaCanonicaCrescimento(met));
}

function colBaseCrescimentoCanonica(metricasCanonicas = []) {
  const prioridade = ['faturamento', 'receita', 'vendas', 'compras', 'comissao', 'valor'];
  return prioridade
    .map(canon => metricasCanonicas.find(met => met.canon === canon))
    .find(Boolean)
    || metricasCanonicas.find(met => !isMetricaCanonicaCrescimento(met));
}

function recalcularCrescimentoTemporalCanonico(entradas, metricasCanonicas) {
  const crescimentoValor = metricasCanonicas.filter(met => isMetricaCanonicaCrescimento(met) && !isPercentual(met.col));
  const crescimentoPct = metricasCanonicas.filter(met => isMetricaCanonicaCrescimento(met) && isPercentual(met.col));
  if (!entradas.length || (!crescimentoValor.length && !crescimentoPct.length)) return entradas;
  const base = colBaseCrescimentoCanonica(metricasCanonicas);
  if (!base) return entradas;

  let anterior = null;
  for (const [, totais] of entradas) {
    const atual = parseNumber(totais?.[base.canon]);
    const temAtual = atual !== null;
    const temAnterior = anterior !== null;
    const diff = temAtual && temAnterior ? atual - anterior : null;
    for (const met of crescimentoValor) totais[met.canon] = diff;
    for (const met of crescimentoPct) totais[met.canon] = diff !== null && anterior !== 0 ? (diff / anterior) * 100 : null;
    if (temAtual) anterior = atual;
  }
  return entradas;
}

function totalCanonicoOrdenado(entries, metricasCanonicas) {
  const out = {};
  for (const met of metricasCanonicas) {
    const tipo = tipoMetricaTemporal(met.col);
    if (tipo === 'primeiro') {
      const first = entries.find(([, totais]) => totais && Object.prototype.hasOwnProperty.call(totais, met.canon));
      out[met.canon] = first ? toNumber(first[1][met.canon]) : 0;
    } else if (tipo === 'ultimo') {
      const last = entries.slice().reverse().find(([, totais]) => totais && Object.prototype.hasOwnProperty.call(totais, met.canon));
      out[met.canon] = last ? toNumber(last[1][met.canon]) : 0;
    } else {
      out[met.canon] = entries.reduce((acc, [, totais]) => acc + toNumber(totais?.[met.canon]), 0);
    }
  }
  return out;
}

function resumoCanonicoEmpresa(rows, shape, metricasCanonicas) {
  const temporal = (shape?.dimensoes || []).find(isTemporal);
  if (!temporal) return somarMetricasCanonicas(rows, metricasCanonicas, shape);

  const porDim = new Map();
  for (const row of rows || []) {
    const label = String(row[temporal] ?? '').trim() || '(sem identificacao)';
    if (!porDim.has(label)) {
      const init = {};
      for (const met of metricasCanonicas) init[met.canon] = 0;
      porDim.set(label, init);
    }
    const grupo = porDim.get(label);
    const totaisRow = somarMetricasCanonicas([row], metricasCanonicas, shape);
    for (const met of metricasCanonicas) grupo[met.canon] += totaisRow[met.canon] || 0;
  }

  const entries = [...porDim.entries()]
    .sort(([a], [b]) => sortValorDimensao(temporal, a).localeCompare(sortValorDimensao(temporal, b)));
  return totalCanonicoOrdenado(entries, metricasCanonicas);
}

function labelMetricaContextual(col, opts = {}, canon = null) {
  const msg = norm(opts.mensagem || opts.contextoConsulta || '');
  const doContrato = presentation.labelMetric(col, opts);
  if (doContrato && (!canon || canon === presentation.canonicalMetric(col, opts))) return doContrato;
  if (canon === 'a_pagar') return 'A pagar';
  if (canon === 'a_receber') return 'A receber';
  if (canon === 'valor' && /\b(contas?\s+a\s+pagar|a\s+pagar|pagar)\b/.test(msg)) return 'A pagar';
  if (canon === 'valor' && /\b(contas?\s+a\s+receber|a\s+receber|receber)\b/.test(msg)) return 'A receber';
  return labelMetrica(col);
}

function renderAllShapesMistos(sucessos, shapes, opts = {}) {
  if (!shapes.length || shapes.some(s => !s)) return null;
  shapes = shapes.map(shape => ({ ...shape, _opts: opts }));

  const metricasCanon = [];
  const metricasSeen = new Set();
  for (const shape of shapes) {
    for (const met of metricasCanonicasPorShape(shape, opts).values()) {
      if (!metricasSeen.has(met.canon)) {
        metricasSeen.add(met.canon);
        metricasCanon.push(met);
      }
    }
  }
  if (!metricasCanon.length) return null;
  const metricasCanonTotal = metricasCanonicasTotalizaveis(metricasCanon);

  const dimsPorShape = shapes.map(dimensoesCanonicasPorShape);
  const comuns = [...dimsPorShape[0].keys()].filter(canon => dimsPorShape.every(mapa => mapa.has(canon)));
  const dimCanon = comuns.find(canon => canon === 'vencimento' || canon === 'competencia' || canon === 'emissao' || canon === 'baixa') || comuns[0] || null;

  const linhas = ['*Consolidado - Todas as empresas*'];
  if (opts.contextoConsulta || opts.mensagem) linhas.push(`_${opts.contextoConsulta || opts.mensagem}_`);
  linhas.push('');

  const totalGeral = {};
  for (const met of metricasCanon) totalGeral[met.canon] = isMetricaCanonicaCrescimento(met) ? null : 0;

  if (dimCanon) {
    const grupos = new Map();
    const dimBase = dimsPorShape[0].get(dimCanon)?.col || dimCanon;
    for (let i = 0; i < sucessos.length; i++) {
      const s = sucessos[i];
      const shape = shapes[i];
      const dimCol = dimsPorShape[i].get(dimCanon)?.col;
      if (!dimCol) continue;
      for (const row of s.rows || []) {
        const label = String(row[dimCol] ?? '').trim() || '(sem identificacao)';
        if (!grupos.has(label)) {
          const init = {};
          for (const met of metricasCanon) init[met.canon] = 0;
          grupos.set(label, init);
        }
        const grupo = grupos.get(label);
        const totaisRow = somarMetricasCanonicas([row], metricasCanon, shape);
        for (const met of metricasCanon) {
          grupo[met.canon] += totaisRow[met.canon] || 0;
        }
      }
    }

    linhas.push(`\u{1F4CB} *Por ${labelDimensaoCanonica(dimCanon, dimBase)}*`);
    let entradas = [...grupos.entries()].sort(([a], [b]) => sortValorDimensao(dimBase, a).localeCompare(sortValorDimensao(dimBase, b)));
    if (['vencimento', 'competencia', 'emissao', 'baixa', 'dia'].includes(dimCanon)) {
      entradas = recalcularCrescimentoTemporalCanonico(entradas, metricasCanon);
    }
    Object.assign(totalGeral, totalCanonicoOrdenado(entradas, metricasCanonTotal));
    entradas.slice(0, 50).forEach(([label, totais], idx) => {
      linhas.push(`  ${idx + 1}. ${labelValorDimensao(dimBase, label)}: ${valsMetricasCanonicas(totais, metricasCanon, opts)}`);
    });
    if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);
  }

  if (!dimCanon) linhas.push('\u{1F4CA} *Resumo*');
  const porEmpresa = [];
  for (let i = 0; i < sucessos.length; i++) {
    const s = sucessos[i];
    const totais = resumoCanonicoEmpresa(s.rows, shapes[i], metricasCanonTotal);
    porEmpresa.push([s.nomeEmpresa, totais, (s.rows || []).length]);
    if (!dimCanon) {
      for (const met of metricasCanonTotal) totalGeral[met.canon] += totais[met.canon] || 0;
    }
  }

  linhas.push('');
  linhas.push(`\u{1F9FE} *Subtotal*: ${valsMetricasCanonicas(totalGeral, metricasCanonTotal, opts)}`);
  linhas.push('');
  linhas.push('\u{1F3E2} *Por Empresa*');
  for (const [nome, totais, count] of porEmpresa) {
    linhas.push(`  - ${nome}: ${valsMetricasCanonicas(totais, metricasCanonTotal, opts)} (${count} reg.)`);
  }
  linhas.push('');
  linhas.push(`*Total Geral*: ${valsMetricasCanonicas(totalGeral, metricasCanonTotal, opts)}`);
  return linhas.join('\n');
}

function tipoMetricaTemporal(col) {
  const k = keyNorm(col);
  const regra = presentation.totalRule(col);
  if (regra === 'first') return 'primeiro';
  if (regra === 'last') return 'ultimo';
  if (/saldo.*base|base.*saldo|saldo_bancario|bancario_base/.test(k)) return 'primeiro';
  if (/fluxo.*liquido|liquido.*fluxo|saldo.*final|final.*saldo|saldo_projetado|projetado.*saldo/.test(k)) return 'ultimo';
  return 'soma';
}

function temMetricaPosicional(metricas = []) {
  return metricas.some(col => tipoMetricaTemporal(col) !== 'soma');
}

function totalTemporalOrdenado(entries, metricas) {
  const out = totalVazio(metricas);
  for (const col of metricas) {
    const tipo = tipoMetricaTemporal(col);
    if (tipo === 'primeiro') {
      const first = entries.find(([, totais]) => totais && Object.prototype.hasOwnProperty.call(totais, col));
      out[col] = first ? toNumber(first[1][col]) : 0;
    } else if (tipo === 'ultimo') {
      const last = entries.slice().reverse().find(([, totais]) => totais && Object.prototype.hasOwnProperty.call(totais, col));
      out[col] = last ? toNumber(last[1][col]) : 0;
    } else {
      out[col] = entries.reduce((acc, [, totais]) => acc + toNumber(totais?.[col]), 0);
    }
  }
  return out;
}

function totalTemporalRows(rows, dim, metricas) {
  const porDim = new Map();
  for (const row of rows || []) {
    const label = String(row[dim] ?? '').trim() || '(sem identificacao)';
    if (!porDim.has(label)) porDim.set(label, totalVazio(metricas));
    const totais = porDim.get(label);
    for (const col of metricas) totais[col] += toNumber(row[col]);
  }
  const entries = [...porDim.entries()].sort(([a], [b]) => sortValorDimensao(dim, a).localeCompare(sortValorDimensao(dim, b)));
  return totalTemporalOrdenado(entries, metricas);
}

function isDimensaoDiaria(dim) {
  const k = keyNorm(dim);
  return /^(dia|data|data_.*|dt_.*|.*_data)$/.test(k);
}

function ajustarSaldoBaseDiario(entries, dim, metricas) {
  if (!isDimensaoDiaria(dim) || !temMetricaPosicional(metricas)) return entries;
  const baseCol = metricas.find(col => tipoMetricaTemporal(col) === 'primeiro');
  const finalCol = metricas.find(col => tipoMetricaTemporal(col) === 'ultimo');
  if (!baseCol || !finalCol) return entries;

  let saldoAnterior = null;
  return entries.map(([label, totais]) => {
    const ajustado = { ...totais };
    if (saldoAnterior !== null) ajustado[baseCol] = saldoAnterior;
    const finalAtual = parseNumber(ajustado[finalCol]);
    if (finalAtual !== null) saldoAnterior = finalAtual;
    return [label, ajustado];
  });
}

function posicaoInicialTemporal(porPeriodo, dim, metricas) {
  const entries = [...porPeriodo.entries()]
    .sort(([a], [b]) => sortValorDimensao(dim, a).localeCompare(sortValorDimensao(dim, b)));
  const out = totalVazio(metricas);
  if (!entries.length) return { totais: out, temPosicao: false };

  const primeira = entries[0][1] || {};
  const baseCol = metricas.find(col => tipoMetricaTemporal(col) === 'primeiro');
  for (const col of metricas) {
    const tipo = tipoMetricaTemporal(col);
    if (tipo === 'soma') continue;
    out[col] = tipo === 'ultimo' && baseCol ? toNumber(primeira[baseCol]) : toNumber(primeira[col]);
  }
  return { totais: out, temPosicao: true };
}

function labelMetricaCategoria(col, categoria) {
  const cat = categoriaSemantica(categoria);
  if (!cat) return labelMetrica(col);
  const metrica = keyNorm(col);
  if (cat.aberto || cat.realizado) return /saldo|aberto|a_receber|a_pagar/.test(metrica) ? cat.aberto : cat.realizado;
  return cat.label || labelMetrica(col);
}

function ordemCategoriaLabel(label) {
  const k = norm(label);
  for (const cat of CATEGORIAS_SEMANTICAS) {
    const labels = [cat.label, cat.aberto, cat.realizado].filter(Boolean).map(norm);
    if (labels.includes(k)) return cat.ordem;
  }
  return 999;
}

function montarCategoriaMetricaUnica(rows, shape) {
  const dim = shape.dimensao;
  const grupos = new Map();
  for (const row of rows || []) {
    const categoria = String(row[dim] ?? '').trim();
    for (const col of shape.metricas) {
      const label = labelMetricaCategoria(col, categoria);
      grupos.set(label, (grupos.get(label) || 0) + toNumber(row[col]));
    }
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => ordemCategoriaLabel(a) - ordemCategoriaLabel(b) || a.localeCompare(b));
}

function valsCategoriaMetricaUnica(entradas) {
  return entradas.map(([label, valor]) => `${label}: *${brl(valor)}*`).join(' | ');
}

function renderCategoriaMetricaUnica(rows, shape, linhas) {
  const entradas = montarCategoriaMetricaUnica(rows, shape);
  const resultado = resultadoCategorias(entradas);
  linhas.push('\u{1F4CA} *Resumo*');
  entradas.forEach(([label, valor], idx) => {
    linhas.push(`  ${idx + 1}. ${label}: *${brl(valor)}*`);
  });
  linhas.push('');
  if (resultado) linhas.push(`*Total Geral*: ${resultado.label}: *${brl(resultado.valor)}*`);
  else linhas.push(`*Total Geral*: ${valsCategoriaMetricaUnica(entradas)}`);
}

function montarDuasDimensoes(rows, shape) {
  const [outerDim, innerDim] = shape.dimensoes;
  const grupos = new Map();
  const totalGeral = totalVazio(shape.metricas);

  for (const row of rows || []) {
    const outer = String(row[outerDim] ?? '').trim() || '(sem identificacao)';
    const inner = String(row[innerDim] ?? '').trim() || '(sem identificacao)';
    if (!grupos.has(outer)) grupos.set(outer, { total: totalVazio(shape.metricas), itens: new Map() });
    const grupo = grupos.get(outer);
    if (!grupo.itens.has(inner)) grupo.itens.set(inner, totalVazio(shape.metricas));
    const item = grupo.itens.get(inner);
    for (const col of shape.metricas) {
      const v = toNumber(row[col]);
      item[col] += v;
      grupo.total[col] += v;
      totalGeral[col] += v;
    }
  }

  return { outerDim, innerDim, grupos, totalGeral };
}

function ordenarEntradasDimensao(entries, dim, primary) {
  const temporal = isTemporal(dim);
  return entries.sort(([a, ga], [b, gb]) => temporal
    ? sortValorDimensao(dim, a).localeCompare(sortValorDimensao(dim, b))
    : (gb[primary] || gb.total?.[primary] || 0) - (ga[primary] || ga.total?.[primary] || 0));
}

function renderDuasDimensoes(rows, shape, linhas) {
  const { outerDim, innerDim, grupos, totalGeral } = montarDuasDimensoes(rows, shape);
  const primary = shape.metricas[0];
  const detalheDoc = shape.tipo === 'detalhe_documento';
  const outerEhCategoria = isCategoriaSemantica(outerDim);
  const innerEhCategoria = isCategoriaSemantica(innerDim);
  const titulo = detalheDoc
    ? `Detalhamento por ${labelDimensao(outerDim)} e Documento`
    : `Por ${labelDimensao(outerDim)} e ${labelDimensao(innerDim)}`;

  linhas.push(`\u{1F4CB} *${titulo}*`);
  const gruposOrdenados = ordenarEntradasDimensao([...grupos.entries()], outerDim, primary);
  gruposOrdenados.slice(0, 50).forEach(([outer, grupo], idxGrupo) => {
    const resultadoGrupo = innerEhCategoria ? resultadoCategorias(totaisPorCategoriaItens(grupo.itens, shape.metricas)) : null;
    const valsGrupo = resultadoGrupo
      ? `${resultadoGrupo.label}: *${brl(resultadoGrupo.valor)}*`
      : outerEhCategoria ? valsMetricasPorCategoria(grupo.total, shape.metricas, outer) : valsMetricas(grupo.total, shape.metricas);
    linhas.push('');
    linhas.push(`${idxGrupo + 1}. *${labelValorDimensao(outerDim, outer)}*: ${valsGrupo}`);

    const itensOrdenados = ordenarEntradasDimensao([...grupo.itens.entries()], innerDim, primary);
    itensOrdenados.slice(0, 50).forEach(([inner, totais], idxItem) => {
      const label = detalheDoc ? labelDocumento(inner) : labelValorDimensao(innerDim, inner);
      const valsItem = outerEhCategoria
        ? valsMetricasPorCategoria(totais, shape.metricas, outer)
        : innerEhCategoria ? valsMetricasPorCategoria(totais, shape.metricas, inner) : valsMetricas(totais, shape.metricas);
      linhas.push(`   ${idxItem + 1}. ${label}: ${valsItem}`);
    });
    if (itensOrdenados.length > 50) linhas.push(`   ... e mais ${itensOrdenados.length - 50}`);
    linhas.push(`   \u{1F9FE} Subtotal: ${valsGrupo}`);
  });
  if (gruposOrdenados.length > 50) linhas.push(`... e mais ${gruposOrdenados.length - 50}`);

  linhas.push('');
  const totaisCategoria = outerEhCategoria
    ? totaisPorCategoria(grupos, shape.metricas)
    : innerEhCategoria
      ? [...grupos.values()].reduce((acc, grupo) => {
          for (const [label, valor] of totaisPorCategoriaItens(grupo.itens, shape.metricas)) {
            acc.set(label, (acc.get(label) || 0) + valor);
          }
          return acc;
        }, new Map())
      : null;
  const entradasTotaisCategoria = totaisCategoria
    ? (Array.isArray(totaisCategoria) ? totaisCategoria : [...totaisCategoria.entries()])
    : null;
  const resultadoTotal = entradasTotaisCategoria ? resultadoCategorias(entradasTotaisCategoria) : null;
  const totalStr = resultadoTotal
    ? `${resultadoTotal.label}: *${brl(resultadoTotal.valor)}*`
    : outerEhCategoria
      ? valsTotaisPorCategoria(entradasTotaisCategoria || [])
      : valsMetricas(totalGeral, shape.metricas);
  linhas.push(`*Total Geral*: ${totalStr}`);
}

function montarMultiplasDimensoes(rows, shape) {
  const grupos = new Map();
  const totalGeral = totalVazio(shape.metricas);

  for (const row of rows || []) {
    const chave = shape.dimensoes.map(dim => String(row[dim] ?? '').trim() || '(sem identificacao)');
    const key = JSON.stringify(chave);
    if (!grupos.has(key)) grupos.set(key, { chave, total: totalVazio(shape.metricas) });
    const grupo = grupos.get(key);
    for (const col of shape.metricas) {
      const v = toNumber(row[col]);
      grupo.total[col] += v;
      totalGeral[col] += v;
    }
  }

  return { grupos, totalGeral };
}

function renderMultiplasDimensoes(rows, shape, linhas) {
  const { grupos, totalGeral } = montarMultiplasDimensoes(rows, shape);
  const primary = shape.metricas[0];
  const titulo = `Por ${shape.dimensoes.map(labelDimensao).join(', ')}`;
  const ordenarPorChave = shape.dimensoes.every(isBancario) || shape.dimensoes.some(isTemporal);

  linhas.push(`\u{1F4CB} *${titulo}*`);
  const entradas = [...grupos.values()].sort((a, b) => {
    if (ordenarPorChave) return a.chave.join('|').localeCompare(b.chave.join('|'));
    const diff = (b.total[primary] || 0) - (a.total[primary] || 0);
    if (diff) return diff;
    return a.chave.join('|').localeCompare(b.chave.join('|'));
  });

  entradas.slice(0, 80).forEach((grupo, idx) => {
    const dims = shape.dimensoes
      .map((dim, i) => `${labelDimensao(dim)} ${labelValorDimensao(dim, grupo.chave[i])}`)
      .join(' | ');
    linhas.push(`  ${idx + 1}. ${dims}: ${valsMetricas(grupo.total, shape.metricas)}`);
  });
  if (entradas.length > 80) linhas.push(`  ... e mais ${entradas.length - 80}`);

  linhas.push('');
  linhas.push(`\u{1F9FE} *Subtotal*: ${valsMetricas(totalGeral, shape.metricas)}`);
  linhas.push(`*Total Geral*: ${valsMetricas(totalGeral, shape.metricas)}`);
}

function competenciaMensalInfo(valor) {
  const s = String(valor ?? '').trim();
  if (!/^\d{6}$/.test(s)) return null;
  const ano = s.slice(0, 4);
  const mes = parseInt(s.slice(4, 6), 10);
  if (mes < 1 || mes > 12) return null;
  return { ano, mes };
}

function deveAgruparMensalPorAno(dim, entradas, metricas) {
  if (!RE_TEMPORAL.test(keyNorm(dim))) return false;
  if (temMetricaPosicional(metricas) || temCrescimento(metricas)) return false;
  const infos = (entradas || []).map(([label]) => competenciaMensalInfo(label));
  if (!infos.length || infos.some(info => !info)) return false;
  return new Set(infos.map(info => info.ano)).size > 1;
}

function renderMensalPorAno(linhas, dim, entradas, metricas, metricasTotal) {
  if (!deveAgruparMensalPorAno(dim, entradas, metricas)) return false;

  const porAno = new Map();
  const porMes = new Map();
  for (const [label, totais] of entradas) {
    const info = competenciaMensalInfo(label);
    if (!porAno.has(info.ano)) porAno.set(info.ano, []);
    porAno.get(info.ano).push({ ...info, totais });
    if (!porMes.has(info.mes)) porMes.set(info.mes, totalVazio(metricasTotal));
    const totalMes = porMes.get(info.mes);
    for (const col of metricasTotal) totalMes[col] += toNumber(totais[col]);
  }

  linhas.push('\u{1F4CB} *Por Ano e Mes*');
  [...porAno.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([ano, itens]) => {
      const subtotal = totalVazio(metricasTotal);
      linhas.push('');
      linhas.push(`\u{1F4C5} *${ano}*`);
      itens
        .sort((a, b) => a.mes - b.mes)
        .forEach((item, idx) => {
          for (const col of metricasTotal) subtotal[col] += toNumber(item.totais[col]);
          const vals = metricas.map(col => `${labelMetrica(col)}: *${fmt(col, item.totais[col])}*`).join(' | ');
          linhas.push(`  ${idx + 1}. ${MESES[item.mes - 1]}: ${vals}`);
        });
      linhas.push(`\u{1F9FE} *Subtotal ${ano}*: ${metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, subtotal[col])}*`).join(' | ')}`);
    });

  linhas.push('');
  linhas.push('\u{1F4CA} *Consolidado por Mes*');
  [...porMes.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([mes, totais], idx) => {
      const vals = metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ');
      linhas.push(`  ${idx + 1}. ${MESES[mes - 1]}: ${vals}`);
    });
  return true;
}

function renderSingle(rows, opts = {}) {
  const shape = detectarShape(rows, opts);
  if (!shape) return null;

  const linhas = [];
  const cab = header(opts);
  if (cab) {
    linhas.push(cab);
    linhas.push('');
  }

  if (shape.tipo === 'metricas_simples') {
    const totais = somarMetricas(rows, shape.metricas);
    if (renderComparativoAnoMetricas(linhas, totais, shape.metricas, opts)) return linhas.join('\n');
    if (renderAvisoComparativoSemPeriodo(linhas, opts, shape.metricas)) return linhas.join('\n');
    const metricasTotal = metricasTotalizaveis(shape.metricas);
    linhas.push('\u{1F4CA} *Resumo*');
    linhas.push(...renderMetricas(totais, shape.metricas));
    const resultado = formulaResultado(shape.metricas, totais);
    if (resultado) linhas.push(`\u{1F9FE} *${resultado.label}*: *${brl(resultado.valor)}*`);
    linhas.push('');
    const totalStr = resultado
      ? brl(resultado.valor)
      : metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ');
    linhas.push(`*Total Geral*: ${totalStr}`);
    return linhas.join('\n');
  }

  if (shape.tipo === 'categoria_metrica_unica') {
    renderCategoriaMetricaUnica(rows, shape, linhas);
    return linhas.join('\n');
  }

  if (shape.tipo === 'duas_dimensoes' || shape.tipo === 'detalhe_documento') {
    renderDuasDimensoes(rows, shape, linhas);
    return linhas.join('\n');
  }

  if (shape.tipo === 'multiplas_dimensoes') {
    renderMultiplasDimensoes(rows, shape, linhas);
    return linhas.join('\n');
  }

  const dim = shape.dimensao;
  const dimTemporal = RE_TEMPORAL.test(keyNorm(dim));
  const porDim = new Map();
  for (const row of rows) {
    const label = String(row[dim] ?? '').trim() || '(sem identificacao)';
    if (!porDim.has(label)) porDim.set(label, []);
    porDim.get(label).push(row);
  }
  const primary = shape.metricas[0];
  let entradas = [...porDim.entries()].map(([label, rowsDim]) => [label, somarMetricas(rowsDim, shape.metricas)])
    .sort(([labelA, a], [labelB, b]) => dimTemporal
      ? sortValorDimensao(dim, labelA).localeCompare(sortValorDimensao(dim, labelB))
      : (b[primary] || 0) - (a[primary] || 0));
  if (dimTemporal) entradas = recalcularCrescimentoTemporal(entradas, shape.metricas);
  entradas = ajustarSaldoBaseDiario(entradas, dim, shape.metricas);

  const metricasTotal = metricasTotalizaveis(shape.metricas);
  const agrupouAnoMes = renderMensalPorAno(linhas, dim, entradas, shape.metricas, metricasTotal);
  if (!agrupouAnoMes) {
    linhas.push(`\u{1F4CB} *Por ${labelDimensao(dim)}*`);
    entradas.slice(0, 50).forEach(([label, totais], idx) => {
      const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ');
      linhas.push(`  ${idx + 1}. ${labelValorDimensao(dim, label)}: ${vals}`);
    });
    if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);
  }

  const totais = dimTemporal && temMetricaPosicional(shape.metricas)
    ? totalTemporalOrdenado(entradas, metricasTotal)
    : somarMetricas(rows, metricasTotal);
  linhas.push('');
  linhas.push(`\u{1F9FE} *Subtotal*: ${metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ')}`);
  const resultado = formulaResultado(metricasTotal, totais);
  if (resultado) linhas.push(`*Total Geral*: ${brl(resultado.valor)}`);
  else linhas.push(`*Total Geral*: ${metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ')}`);
  return linhas.join('\n');
}

function shapesCompativeis(shapes) {
  if (!shapes.length || shapes.some(s => !s)) return false;
  const first = shapes[0];
  const dim = first.dimensao || null;
  const dims = (first.dimensoes || []).join('|');
  const mets = first.metricas.slice().sort().join('|');
  return shapes.every(s =>
    s.tipo === first.tipo &&
    (s.dimensao || null) === dim &&
    (s.dimensoes || []).join('|') === dims &&
    s.metricas.slice().sort().join('|') === mets
  );
}

function renderAll(sucessos, opts = {}) {
  if (!Array.isArray(sucessos) || !sucessos.length) return null;
  if (sucessos.some(s => !Array.isArray(s.rows) || !s.rows.length)) return null;
  let shapes = sucessos.map(s => detectarShape(s.rows, opts));
  const alinhado = alinharMetricasSucessos(sucessos, shapes, opts);
  sucessos = alinhado.sucessos;
  shapes = alinhado.shapes;
  if (!shapesCompativeis(shapes)) return renderAllShapesMistos(sucessos, shapes, opts);

  const shape = shapes[0];
  const linhas = ['*Consolidado - Todas as empresas*'];
  if (opts.contextoConsulta || opts.mensagem) linhas.push(`_${opts.contextoConsulta || opts.mensagem}_`);
  linhas.push('');

  if (shape.tipo === 'metricas_simples') {
    const totalGeral = {};
    const metricasTotal = metricasTotalizaveis(shape.metricas);
    for (const col of shape.metricas) totalGeral[col] = isMetricaCrescimento(col) ? null : 0;

    const comp = comparativoAnoMetricas(shape.metricas, opts);
    if (comp) {
      linhas.push('\u{1F4CA} *Resumo por Empresa*');
      for (const s of sucessos) {
        const totais = somarMetricas(s.rows, shape.metricas);
        for (const col of metricasTotal) totalGeral[col] += totais[col] || 0;
        const anos = [comp.atualAno, ...comp.anosComparados.filter(ano => ano !== comp.atualAno)];
        const partes = anos.map(ano => {
          const vals = comp.itens.map(item => `${labelMetrica(item.base)}: *${brl(valorItemComparativo(totais, item, comp.atualAno, ano))}*`).join(' | ');
          return `${labelPeriodoAno(ano, opts)}: ${vals}`;
        });
        linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${partes.join(' || ')}`);
      }
      linhas.push('');
      renderComparativoAnoMetricas(linhas, totalGeral, shape.metricas, opts);
      return linhas.join('\n');
    }
    if (renderAvisoComparativoSemPeriodo(linhas, opts, shape.metricas)) return linhas.join('\n');

    linhas.push('\u{1F4CA} *Resumo*');
    for (const s of sucessos) {
      const totais = somarMetricas(s.rows, shape.metricas);
      for (const col of metricasTotal) totalGeral[col] += totais[col] || 0;
      const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ');
      const resultado = formulaResultado(shape.metricas, totais);
      linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${vals}${resultado ? ` | Resultado: *${brl(resultado.valor)}*` : ''}`);
    }
    linhas.push('');
    linhas.push(...renderMetricas(totalGeral, metricasTotal));
    const resultado = formulaResultado(metricasTotal, totalGeral);
    if (resultado) linhas.push(`\u{1F9FE} *Resultado*: *${brl(resultado.valor)}*`);
    const totalStr = resultado
      ? brl(resultado.valor)
      : metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col])}*`).join(' | ');
    linhas.push(`*Total Geral*: ${totalStr}`);
    return linhas.join('\n');
  }

  if (shape.tipo === 'categoria_metrica_unica') {
    const totalGeral = new Map();

    linhas.push('\u{1F4CA} *Resumo*');
    for (const s of sucessos) {
      const entradas = montarCategoriaMetricaUnica(s.rows, shape);
      for (const [label, valor] of entradas) totalGeral.set(label, (totalGeral.get(label) || 0) + valor);
      const resultado = resultadoCategorias(entradas);
      linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${valsCategoriaMetricaUnica(entradas)}${resultado ? ` | Resultado: *${brl(resultado.valor)}*` : ''}`);
    }
    linhas.push('');
    const entradasTotal = [...totalGeral.entries()]
      .sort(([a], [b]) => ordemCategoriaLabel(a) - ordemCategoriaLabel(b) || a.localeCompare(b));
    entradasTotal.forEach(([label, valor], idx) => {
      linhas.push(`  ${idx + 1}. ${label}: *${brl(valor)}*`);
    });
    const resultadoTotal = resultadoCategorias(entradasTotal);
    if (resultadoTotal) linhas.push(`\u{1F9FE} *Resultado*: *${brl(resultadoTotal.valor)}*`);
    linhas.push(`*Total Geral*: ${resultadoTotal ? brl(resultadoTotal.valor) : valsCategoriaMetricaUnica(entradasTotal)}`);
    return linhas.join('\n');
  }

  if (shape.tipo === 'duas_dimensoes' || shape.tipo === 'detalhe_documento') {
    const rows = sucessos.flatMap(s => s.rows || []);
    renderDuasDimensoes(rows, shape, linhas);
    return linhas.join('\n');
  }

  if (shape.tipo === 'multiplas_dimensoes') {
    const rows = sucessos.flatMap(s => s.rows || []);
    renderMultiplasDimensoes(rows, shape, linhas);
    return linhas.join('\n');
  }

  const dim = shape.dimensao;
  const dimTemporal = RE_TEMPORAL.test(keyNorm(dim));
  if (dimTemporal && temMetricaPosicional(shape.metricas)) {
    const labels = [...new Set(sucessos.flatMap(s => (s.rows || []).map(row => String(row[dim] ?? '').trim() || '(sem identificacao)')))]
      .sort((a, b) => sortValorDimensao(dim, a).localeCompare(sortValorDimensao(dim, b)));
    const porEmpresa = sucessos.map(s => {
      const porPeriodo = new Map();
      for (const row of s.rows || []) {
        const label = String(row[dim] ?? '').trim() || '(sem identificacao)';
        if (!porPeriodo.has(label)) porPeriodo.set(label, totalVazio(shape.metricas));
        const totais = porPeriodo.get(label);
        for (const col of shape.metricas) totais[col] += toNumber(row[col]);
      }
      const inicial = posicaoInicialTemporal(porPeriodo, dim, shape.metricas);
      return { ...s, porPeriodo, ultimaPosicao: inicial.totais, temUltima: inicial.temPosicao };
    });

    let entradas = labels.map(label => {
      const totais = totalVazio(shape.metricas);
      for (const empresa of porEmpresa) {
        const atual = empresa.porPeriodo.get(label);
        if (atual) {
          for (const col of shape.metricas) {
            if (tipoMetricaTemporal(col) === 'soma') totais[col] += toNumber(atual[col]);
            else {
              empresa.ultimaPosicao[col] = toNumber(atual[col]);
              totais[col] += empresa.ultimaPosicao[col];
            }
          }
          empresa.temUltima = true;
        } else if (empresa.temUltima) {
          for (const col of shape.metricas) {
            if (tipoMetricaTemporal(col) !== 'soma') totais[col] += empresa.ultimaPosicao[col] || 0;
          }
        }
      }
      return [label, totais];
    });
    entradas = ajustarSaldoBaseDiario(entradas, dim, shape.metricas);

    const totalGeral = totalVazio(shape.metricas);
    for (const col of shape.metricas) {
      const tipo = tipoMetricaTemporal(col);
      if (tipo === 'soma') {
        totalGeral[col] = sucessos.reduce((acc, s) => acc + somarMetricas(s.rows, [col])[col], 0);
      } else {
        totalGeral[col] = sucessos.reduce((acc, s) => acc + totalTemporalRows(s.rows, dim, [col])[col], 0);
      }
    }

    linhas.push(`\u{1F4CB} *Por ${labelDimensao(dim)}*`);
    entradas.slice(0, 50).forEach(([label, totais], idx) => {
      const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ');
      linhas.push(`  ${idx + 1}. ${labelValorDimensao(dim, label)}: ${vals}`);
    });
    if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);
    linhas.push('');
    linhas.push(`\u{1F9FE} *Subtotal*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col] || 0)}*`).join(' | ')}`);
    linhas.push('');
    linhas.push('\u{1F3E2} *Por Empresa*');
    for (const s of sucessos) {
      const totaisEmpresa = totalTemporalRows(s.rows, dim, shape.metricas);
      linhas.push(`  - ${s.nomeEmpresa}: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totaisEmpresa[col] || 0)}*`).join(' | ')}`);
    }
    linhas.push('');
    linhas.push(`*Total Geral*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col] || 0)}*`).join(' | ')}`);
    return linhas.join('\n');
  }

  const porDim = new Map();
  const totalGeral = {};
  for (const col of shape.metricas) totalGeral[col] = 0;

  for (const s of sucessos) {
    for (const row of s.rows) {
      const label = String(row[dim] ?? '').trim() || '(sem identificacao)';
      if (!porDim.has(label)) porDim.set(label, {});
      const grupo = porDim.get(label);
      for (const col of shape.metricas) {
        const v = toNumber(row[col]);
        grupo[col] = (grupo[col] || 0) + v;
        totalGeral[col] += v;
      }
    }
  }

  const primary = shape.metricas[0];
  let entradas = [...porDim.entries()].sort(([labelA, a], [labelB, b]) => dimTemporal
    ? sortValorDimensao(dim, labelA).localeCompare(sortValorDimensao(dim, labelB))
    : (b[primary] || 0) - (a[primary] || 0));
  if (dimTemporal) entradas = recalcularCrescimentoTemporal(entradas, shape.metricas);
  linhas.push('');
  const metricasTotal = metricasTotalizaveis(shape.metricas);
  const agrupouAnoMes = renderMensalPorAno(linhas, dim, entradas, shape.metricas, metricasTotal);
  if (!agrupouAnoMes) {
    linhas.push(`\u{1F4CB} *Por ${labelDimensao(dim)}*`);
    entradas.slice(0, 50).forEach(([label, totais], idx) => {
      const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col])}*`).join(' | ');
      linhas.push(`  ${idx + 1}. ${labelValorDimensao(dim, label)}: ${vals}`);
    });
    if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);
  }
  linhas.push('');
  const totalGeralExibicao = {};
  for (const col of metricasTotal) totalGeralExibicao[col] = totalGeral[col] || 0;
  linhas.push(`\u{1F9FE} *Subtotal*: ${metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeralExibicao[col])}*`).join(' | ')}`);
  const resultado = formulaResultado(metricasTotal, totalGeralExibicao);
  const totalGeralLinha = resultado
    ? `*Total Geral*: ${brl(resultado.valor)}`
    : `*Total Geral*: ${metricasTotal.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeralExibicao[col])}*`).join(' | ')}`;

  if (dimTemporal) {
    linhas.push('');
    linhas.push('\u{1F3E2} *Por Empresa*');
    for (const s of sucessos) {
      const resumo = resumoEmpresaTemporal(s.rows, dim, shape.metricas, metricasTotal);
      linhas.push(`  - ${s.nomeEmpresa}: ${resumo.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, resumo.totais[col])}*`).join(' | ')}`);
    }
    if (temCrescimento(shape.metricas)) {
      linhas.push('');
      linhas.push(observacaoCrescimentoPorEmpresa());
    }
    linhas.push('');
    linhas.push(totalGeralLinha);
  } else {
    linhas.push(totalGeralLinha);
  }
  return linhas.join('\n');
}

module.exports = {
  detectarShape,
  renderSingle,
  renderAll,
  setLabelsSx3,
  labelMetrica,
  _test: { keyNorm, somarMetricas, formulaResultado, toNumber },
};
