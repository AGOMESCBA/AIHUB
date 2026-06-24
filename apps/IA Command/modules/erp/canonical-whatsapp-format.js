'use strict';

const RE_METRICA = /valor|total|saldo|salatua|juros|multa|desconto|vlr|vl_|brut|liquido|comiss|qtd|quantidade|qt_|fatura|receita|fat_|compra|pedido|custo|preco|venda|entrada|saida|receb|pag|previst|projet|fluxo/i;
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
  receita: 'Receita',
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

function fmt(col, v) {
  return RE_QTD.test(col) ? num(v) : brl(v);
}

function labelMetrica(col) {
  const k = keyNorm(col);
  return LABELS[k] || labelSx3(col) || String(col || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
  if (RE_SKIP.test(nk)) return true;
  if (/_anterior$/.test(nk)) {
    const atual = nk.replace(/_anterior$/, '_atual');
    return !keys.map(keyNorm).includes(atual);
  }
  return false;
}

function detectarShape(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const keys = Object.keys(rows[0] || {});
  const amostra = sampleRows(rows);
  const metricas = keys.filter(k => {
    const nk = keyNorm(k);
    if (RE_TEMPORAL.test(nk) || RE_ENTIDADE.test(nk) || RE_DOCUMENTO.test(nk) || RE_BANCARIO.test(nk) || RE_CATEGORIA_SEMANTICA.test(nk)) return false;
    if (RE_MEDIA.test(nk) || devePularMetrica(k, keys)) return false;
    if (!RE_METRICA.test(nk)) return false;
    return amostra.some(r => isNumericValue(r[k]));
  });
  if (!metricas.length) return null;

  const dimensoes = keys.filter(k => {
    const nk = keyNorm(k);
    if (metricas.includes(k)) return false;
    if (!RE_TEMPORAL.test(nk) && !RE_ENTIDADE.test(nk) && !RE_DOCUMENTO.test(nk) && !RE_BANCARIO.test(nk) && !RE_CATEGORIA_SEMANTICA.test(nk)) return false;
    if (RE_TEMPORAL.test(nk)) return amostra.some(r => isTemporalDimensionValue(k, r[k]));
    if (RE_CATEGORIA_SEMANTICA.test(nk)) return amostra.some(r => categoriaSemantica(r[k]));
    if (RE_DOCUMENTO.test(nk) || RE_BANCARIO.test(nk)) return amostra.some(r => String(r[k] ?? '').trim() !== '');
    return amostra.some(r => String(r[k] ?? '').trim() !== '') && !amostra.every(r => isNumericValue(r[k]));
  });

  if (dimensoes.length > 3) return null;
  if (dimensoes.length === 0) return { tipo: 'metricas_simples', dimensao: null, dimensoes: [], metricas };
  if (dimensoes.length === 1 && metricas.length === 1 && isCategoriaSemantica(dimensoes[0])) {
    return { tipo: 'categoria_metrica_unica', dimensao: dimensoes[0], dimensoes, metricas };
  }
  if (dimensoes.length === 1) return { tipo: 'uma_dimensao', dimensao: dimensoes[0], dimensoes, metricas };
  if (dimensoes.length === 3) {
    const ordenadas = ordenarMultiplasDimensoes(dimensoes);
    return { tipo: 'multiplas_dimensoes', dimensao: ordenadas[0], dimensoes: ordenadas, metricas };
  }

  const docDim = dimensoes.find(isDocumento);
  const entDim = docDim ? dimensoes.find(d => d !== docDim) : null;
  if (docDim && entDim && !isTemporal(entDim)) {
    return { tipo: 'detalhe_documento', dimensao: entDim, dimensoes: [entDim, docDim], documento: docDim, metricas };
  }

  const ordenadas = ordenarDuasDimensoes(dimensoes);
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
  for (const col of metricas) out[col] = 0;
  for (const row of rows || []) {
    for (const col of metricas) out[col] += toNumber(row[col]);
  }
  return out;
}

function formulaResultado(metricas, totais) {
  const byNorm = new Map(metricas.map(col => [keyNorm(col), col]));
  const pares = [
    { a: ['valor_recebido', 'valor_recebido_total'], b: ['valor_pago', 'valor_pago_total'], label: 'Resultado' },
    { a: ['total_faturamento', 'faturamento', 'receita'], b: ['total_compras', 'compras'], label: 'Resultado' },
    { a: ['receita'], b: ['custo', 'total_custo'], label: 'Resultado' },
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
  return metricas.map((col, idx) => `${indent}${idx + 1}. ${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`);
}

function addTotais(dest, src, metricas) {
  for (const col of metricas) dest[col] = (dest[col] || 0) + (src[col] || 0);
}

function totalVazio(metricas) {
  const out = {};
  for (const col of metricas) out[col] = 0;
  return out;
}

function valsMetricas(totais, metricas) {
  return metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ');
}

function tipoMetricaTemporal(col) {
  const k = keyNorm(col);
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
  linhas.push('\u{1F4CA} *Resumo*');
  entradas.forEach(([label, valor], idx) => {
    linhas.push(`  ${idx + 1}. ${label}: *${brl(valor)}*`);
  });
  linhas.push('');
  linhas.push(`*Total Geral*: ${valsCategoriaMetricaUnica(entradas)}`);
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
  const titulo = detalheDoc
    ? `Detalhamento por ${labelDimensao(outerDim)} e Documento`
    : `Por ${labelDimensao(outerDim)} e ${labelDimensao(innerDim)}`;

  linhas.push(`\u{1F4CB} *${titulo}*`);
  const gruposOrdenados = ordenarEntradasDimensao([...grupos.entries()], outerDim, primary);
  gruposOrdenados.slice(0, 50).forEach(([outer, grupo], idxGrupo) => {
    linhas.push('');
    linhas.push(`${idxGrupo + 1}. *${labelValorDimensao(outerDim, outer)}*: ${valsMetricas(grupo.total, shape.metricas)}`);

    const itensOrdenados = ordenarEntradasDimensao([...grupo.itens.entries()], innerDim, primary);
    itensOrdenados.slice(0, 50).forEach(([inner, totais], idxItem) => {
      const label = detalheDoc ? labelDocumento(inner) : labelValorDimensao(innerDim, inner);
      linhas.push(`   ${idxItem + 1}. ${label}: ${valsMetricas(totais, shape.metricas)}`);
    });
    if (itensOrdenados.length > 50) linhas.push(`   ... e mais ${itensOrdenados.length - 50}`);
    linhas.push(`   \u{1F9FE} Subtotal: ${valsMetricas(grupo.total, shape.metricas)}`);
  });
  if (gruposOrdenados.length > 50) linhas.push(`... e mais ${gruposOrdenados.length - 50}`);

  linhas.push('');
  linhas.push(`*Total Geral*: ${valsMetricas(totalGeral, shape.metricas)}`);
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

function renderSingle(rows, opts = {}) {
  const shape = detectarShape(rows);
  if (!shape) return null;

  const linhas = [];
  const cab = header(opts);
  if (cab) {
    linhas.push(cab);
    linhas.push('');
  }

  if (shape.tipo === 'metricas_simples') {
    const totais = somarMetricas(rows, shape.metricas);
    linhas.push('\u{1F4CA} *Resumo*');
    linhas.push(...renderMetricas(totais, shape.metricas));
    const resultado = formulaResultado(shape.metricas, totais);
    if (resultado) linhas.push(`\u{1F9FE} *${resultado.label}*: *${brl(resultado.valor)}*`);
    linhas.push('');
    const totalStr = resultado
      ? brl(resultado.valor)
      : shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ');
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
  const entradas = [...porDim.entries()].map(([label, rowsDim]) => [label, somarMetricas(rowsDim, shape.metricas)])
    .sort(([labelA, a], [labelB, b]) => dimTemporal
      ? sortValorDimensao(dim, labelA).localeCompare(sortValorDimensao(dim, labelB))
      : (b[primary] || 0) - (a[primary] || 0));

  linhas.push(`\u{1F4CB} *Por ${labelDimensao(dim)}*`);
  entradas.slice(0, 50).forEach(([label, totais], idx) => {
    const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ');
    linhas.push(`  ${idx + 1}. ${labelValorDimensao(dim, label)}: ${vals}`);
  });
  if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);

  const totais = dimTemporal && temMetricaPosicional(shape.metricas)
    ? totalTemporalOrdenado(entradas, shape.metricas)
    : somarMetricas(rows, shape.metricas);
  linhas.push('');
  linhas.push(`\u{1F9FE} *Subtotal*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ')}`);
  const resultado = formulaResultado(shape.metricas, totais);
  if (resultado) linhas.push(`*Total Geral*: ${brl(resultado.valor)}`);
  else linhas.push(`*Total Geral*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ')}`);
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
  const shapes = sucessos.map(s => detectarShape(s.rows));
  if (!shapesCompativeis(shapes)) return null;

  const shape = shapes[0];
  const linhas = ['*Consolidado - Todas as empresas*'];
  if (opts.contextoConsulta || opts.mensagem) linhas.push(`_${opts.contextoConsulta || opts.mensagem}_`);
  linhas.push('');

  if (shape.tipo === 'metricas_simples') {
    const totalGeral = {};
    for (const col of shape.metricas) totalGeral[col] = 0;

    linhas.push('\u{1F4CA} *Resumo*');
    for (const s of sucessos) {
      const totais = somarMetricas(s.rows, shape.metricas);
      for (const col of shape.metricas) totalGeral[col] += totais[col] || 0;
      const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ');
      const resultado = formulaResultado(shape.metricas, totais);
      linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${vals}${resultado ? ` | Resultado: *${brl(resultado.valor)}*` : ''}`);
    }
    linhas.push('');
    linhas.push(...renderMetricas(totalGeral, shape.metricas));
    const resultado = formulaResultado(shape.metricas, totalGeral);
    if (resultado) linhas.push(`\u{1F9FE} *Resultado*: *${brl(resultado.valor)}*`);
    const totalStr = resultado
      ? brl(resultado.valor)
      : shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col] || 0)}*`).join(' | ');
    linhas.push(`*Total Geral*: ${totalStr}`);
    return linhas.join('\n');
  }

  if (shape.tipo === 'categoria_metrica_unica') {
    const totalGeral = new Map();

    linhas.push('\u{1F4CA} *Resumo*');
    for (const s of sucessos) {
      const entradas = montarCategoriaMetricaUnica(s.rows, shape);
      for (const [label, valor] of entradas) totalGeral.set(label, (totalGeral.get(label) || 0) + valor);
      linhas.push(`\u{1F3E2} ${s.nomeEmpresa}: ${valsCategoriaMetricaUnica(entradas)}`);
    }
    linhas.push('');
    const entradasTotal = [...totalGeral.entries()]
      .sort(([a], [b]) => ordemCategoriaLabel(a) - ordemCategoriaLabel(b) || a.localeCompare(b));
    entradasTotal.forEach(([label, valor], idx) => {
      linhas.push(`  ${idx + 1}. ${label}: *${brl(valor)}*`);
    });
    linhas.push(`*Total Geral*: ${valsCategoriaMetricaUnica(entradasTotal)}`);
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
      return { ...s, porPeriodo, ultimaPosicao: totalVazio(shape.metricas), temUltima: false };
    });

    const entradas = labels.map(label => {
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
    linhas.push(`*Total Geral*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col] || 0)}*`).join(' | ')}`);
    linhas.push('');
    linhas.push('\u{1F3E2} *Por Empresa*');
    for (const s of sucessos) {
      const totaisEmpresa = totalTemporalRows(s.rows, dim, shape.metricas);
      linhas.push(`  - ${s.nomeEmpresa}: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totaisEmpresa[col] || 0)}*`).join(' | ')}`);
    }
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
  const entradas = [...porDim.entries()].sort(([labelA, a], [labelB, b]) => dimTemporal
    ? sortValorDimensao(dim, labelA).localeCompare(sortValorDimensao(dim, labelB))
    : (b[primary] || 0) - (a[primary] || 0));
  linhas.push(`\u{1F4CB} *Por ${labelDimensao(dim)}*`);
  entradas.slice(0, 50).forEach(([label, totais], idx) => {
    const vals = shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totais[col] || 0)}*`).join(' | ');
    linhas.push(`  ${idx + 1}. ${labelValorDimensao(dim, label)}: ${vals}`);
  });
  if (entradas.length > 50) linhas.push(`  ... e mais ${entradas.length - 50}`);
  linhas.push('');
  linhas.push(`\u{1F9FE} *Subtotal*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col] || 0)}*`).join(' | ')}`);
  const resultado = formulaResultado(shape.metricas, totalGeral);
  if (resultado) linhas.push(`*Total Geral*: ${brl(resultado.valor)}`);
  else linhas.push(`*Total Geral*: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totalGeral[col] || 0)}*`).join(' | ')}`);

  if (dimTemporal) {
    linhas.push('');
    linhas.push('\u{1F3E2} *Por Empresa*');
    for (const s of sucessos) {
      const totaisEmpresa = somarMetricas(s.rows, shape.metricas);
      linhas.push(`  - ${s.nomeEmpresa}: ${shape.metricas.map(col => `${labelMetrica(col)}: *${fmt(col, totaisEmpresa[col] || 0)}*`).join(' | ')}`);
    }
  }
  return linhas.join('\n');
}

module.exports = {
  detectarShape,
  renderSingle,
  renderAll,
  setLabelsSx3,
  _test: { keyNorm, somarMetricas, formulaResultado, toNumber },
};
