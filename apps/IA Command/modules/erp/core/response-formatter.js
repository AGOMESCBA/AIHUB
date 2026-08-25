// Formata resultados das consultas ERP em mensagens WhatsApp (pt-BR)

const BRL = (v) => {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const NUM = (v) => {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

const PCT = (v) => {
  const n = parseFloat(v) || 0;
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
};

const LIMITE_PADRAO_AGRUPAMENTO = 20;
const LIMITE_ROWS_RESUMO_HUMANO = 5000;
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function _normalizarNome(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function _tipoMetrica(col) {
  const nome = _normalizarNome(col);
  const tokens = nome.split('_').filter(Boolean);
  if (tokens.some(t => ['quantidade', 'qtd', 'qtde', 'qte', 'volume', 'unidade', 'unidades', 'item', 'itens', 'peca', 'pecas', 'peso', 'kg', 'quilo', 'quilos', 'kilo', 'kilos', 'ton', 'tn', 'tonelada', 'toneladas', 'litro', 'litros', 'metro', 'metros', 'caixa', 'caixas', 'saca', 'sacas'].includes(t))) {
    return 'quantidade';
  }
  if (tokens.some(t => ['percentual', 'porcentagem', 'percent', 'perc', 'pct'].includes(t)) || nome.endsWith('_pct')) {
    return 'percentual';
  }
  if (tokens.some(t => ['faturamento', 'valor', 'vlr', 'receita', 'custo', 'preco', 'precos', 'bruto', 'liquido', 'saldo', 'total'].includes(t))) {
    return 'moeda';
  }
  return 'numero';
}

function _formatarValorMetrica(col, valor) {
  const tipo = _tipoMetrica(col);
  if (tipo === 'moeda') return BRL(valor);
  if (tipo === 'percentual') return PCT(valor);
  return NUM(valor);
}

function _iconeMetrica(col) {
  return '';
}

// Detecta colunas com sufixo de ano (ex: FATURAMENTO_2025, FATURAMENTO_2026).
// Retorna [anoMenor, anoMaior] se exatamente 2 anos forem encontrados; null caso contrário.
function _detectarColunasAnoPivotadas(rows) {
  if (!rows.length) return null;
  const firstRow = rows[0];
  const re = /^(.+?)_((?:19|20)\d{2})$/i;
  const anoSet = new Set();
  for (const k of Object.keys(firstRow)) {
    const m = k.match(re);
    if (!m) continue;
    const v = firstRow[k];
    if (typeof v !== 'number' && (typeof v !== 'string' || isNaN(parseFloat(v)))) continue;
    anoSet.add(parseInt(m[2], 10));
  }
  const anos = [...anoSet].sort((a, b) => a - b);
  return anos.length === 2 ? anos : null;
}

// Remove colunas pivotadas por ano (xxx_2025, xxx_2026) e substitui pelo valor do ano
// correspondente à data da linha, preservando a coluna original sem sufixo de ano.
function _normalizarRowsPivotadas(rows, anoBase, anoComparacao) {
  const re = /^(.+?)_((?:19|20)\d{2})$/i;
  return rows.map(row => {
    const ym = _extrairMes(row);
    const rowAno = ym ? parseInt(ym.split('-')[0], 10) : null;
    if (!rowAno || ![anoBase, anoComparacao].includes(rowAno)) return row;
    const toRemove = new Set();
    const additions = {};
    for (const k of Object.keys(row)) {
      const m = k.match(re);
      if (!m) continue;
      const colAno = parseInt(m[2], 10);
      if (![anoBase, anoComparacao].includes(colAno)) continue;
      toRemove.add(k);
      if (colAno === rowAno && !(m[1] in additions)) {
        additions[m[1]] = parseFloat(row[k]) || 0;
      }
    }
    if (!toRemove.size) return row;
    const newRow = {};
    for (const [k, v] of Object.entries(row)) {
      if (!toRemove.has(k)) newRow[k] = v;
    }
    return Object.assign(newRow, additions);
  });
}

function _metricasPedidas(intent) {
  const metricas = new Set();
  for (const m of intent?._metricasDetectadas || []) metricas.add(_normalizarNome(m));
  const ordem = String(intent?.ordenar_por || '').split(':')[0];
  if (ordem) metricas.add(_normalizarNome(ordem));
  const nomeIntencao = _normalizarNome(intent?.intencao || '');
  if (nomeIntencao.includes('quantidade')) metricas.add('quantidade');
  return [...metricas].filter(Boolean);
}

function _textoIntentNormalizado(intent) {
  return _normalizarNome([
    intent?._mensagemOriginal,
    intent?.intencao,
    intent?.acao,
    intent?.tipo,
  ].filter(Boolean).join(' '));
}

function _pediuValorEQuantidade(intent) {
  const texto = _textoIntentNormalizado(intent);
  if (!texto) return false;
  const tokens = texto.split('_').filter(Boolean);
  const pediuQuantidade = tokens.some(t => ['quantidade', 'qtd', 'qtde', 'volume', 'peca', 'pecas', 'item', 'itens'].includes(t));
  const pediuValor = tokens.some(t => ['faturamento', 'faturado', 'faturada', 'valor', 'vlr', 'receita', 'total'].includes(t));
  return pediuValor && pediuQuantidade;
}

function _filtrarMetricasSolicitadas(cols, intent) {
  const pedidas = _metricasPedidas(intent);
  if (!pedidas.length) return cols;
  const manterValorComQuantidade = _pediuValorEQuantidade(intent) && pedidas.some(m => (
    m.includes('quantidade') || m.includes('qtd') || m.includes('qtde') || m.includes('volume')
  ));
  const filtradas = cols.filter(col => {
    const nome = _normalizarNome(col);
    if (pedidas.some(m => nome === m || nome.includes(m) || m.includes(nome))) return true;
    return manterValorComQuantidade && _tipoMetrica(col) === 'moeda';
  });
  return filtradas.length ? filtradas : cols;
}

function formatarPeriodo(periodo) {
  if (!periodo?.dataInicio) return '';
  return `\nPeriodo: ${_fmtData(periodo.dataInicio)} a ${_fmtData(periodo.dataFim)}`;
}

function formatarFiltros(filtros) {
  if (!filtros || typeof filtros !== 'object') return '';
  const LABELS = { produto: 'Produto', cliente: 'Cliente', vendedor: 'Vendedor', fornecedor: 'Fornecedor', empresa: 'Empresa', filial: 'Filial', unidade: 'Unidade', status: 'Status' };
  const ativos = Object.entries(filtros)
    .filter(([, v]) => v && typeof v === 'string' && v.trim())
    .map(([k, v]) => `${LABELS[k] || k}: *${v.trim()}*`);
  return ativos.length ? `\nFiltros: ${ativos.join(' | ')}` : '';
}

function _mediaDiaria(periodo, total) {
  if (!periodo?.dataInicio || !periodo?.dataFim) return null;
  const d1 = new Date(periodo.dataInicio.slice(0,4), +periodo.dataInicio.slice(4,6)-1, +periodo.dataInicio.slice(6,8));
  const d2 = new Date(periodo.dataFim.slice(0,4),   +periodo.dataFim.slice(4,6)-1,   +periodo.dataFim.slice(6,8));
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  if (dias < 8) return null;
  return { media: total / dias, dias };
}

function _divisorPeriodo(periodo, granularidade) {
  if (!periodo?.dataInicio || !periodo?.dataFim) return null;
  const d1 = new Date(periodo.dataInicio.slice(0,4), +periodo.dataInicio.slice(4,6)-1, +periodo.dataInicio.slice(6,8));
  const d2 = new Date(periodo.dataFim.slice(0,4),   +periodo.dataFim.slice(4,6)-1,   +periodo.dataFim.slice(6,8));
  if (granularidade === 'dia') return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
  if (granularidade === 'mes') {
    return Math.max(1, (d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth() + 1);
  }
  if (granularidade === 'ano') return Math.max(1, d2.getFullYear() - d1.getFullYear() + 1);
  return null;
}

function _fmtData(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || '';
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

// Detectores de colunas por semântica — mesma ideia do campo_data, mas para dimensões
const _DETECTORES = {
  data:     k => /^data$/i.test(k) || /^dt_/i.test(k) || /^data_/i.test(k) || /^_data$/i.test(k)
             || /^vencimento$/i.test(k) || /^vencto/i.test(k)
             || /^emissao$/i.test(k) || /^emissão$/i.test(k),
  // Protheus: F2_CLIENTE, A1_COD, D2_CLIENTE, E1_CLIENTE, etc. — aliases comuns: cliente, cod_cliente
  cliente:  k => /^cliente$/i.test(k) || /^nm_cli/i.test(k) || /^ds_cli/i.test(k) || /^nome_cli/i.test(k)
             || /^cod_cliente/i.test(k) || /^[a-z]\d_cliente$/i.test(k) || /^[a-z]\d_cod$/i.test(k)
             || /^a1_cod$/i.test(k) || /^a1_nome$/i.test(k) || /^a1_nreduz$/i.test(k),
  // Protheus: B1_COD, D2_COD, B1_DESC — aliases: produto, cod_produto
  produto:  k => /^produto$/i.test(k) || /^negocio$/i.test(k) || /^ds_prod/i.test(k) || /^nm_prod/i.test(k) || /^descr/i.test(k)
             || /^cod_produto/i.test(k) || /^b1_cod$/i.test(k) || /^b1_desc$/i.test(k) || /^d2_cod$/i.test(k),
  // Protheus: A3_COD, A3_NOME — aliases: vendedor, cod_vendedor
  vendedor:    k => /^vendedor$/i.test(k) || /^nm_vend/i.test(k) || /^ds_vend/i.test(k) || /^cod_vend/i.test(k)
               || /^a3_cod$/i.test(k) || /^a3_nome$/i.test(k) || /^[a-z]\d_vend\d?$/i.test(k),
  // Protheus: A2_COD, A2_NOME — aliases: fornecedor
  fornecedor:  k => /^fornecedor$/i.test(k) || /^nm_forn/i.test(k) || /^ds_forn/i.test(k) || /^nome_forn/i.test(k) || /^razao/i.test(k)
               || /^a2_cod$/i.test(k) || /^a2_nome$/i.test(k) || /^[a-z]\d_fornece$/i.test(k),
  documento:       k => /^documento$/i.test(k) || /^doc$/i.test(k) || /^nota$/i.test(k) || /^nota_fiscal$/i.test(k)
               || /^nf$/i.test(k) || /^nfe$/i.test(k) || /^titulo$/i.test(k) || /^duplicata$/i.test(k)
               || /^f2_doc$/i.test(k) || /^d2_doc$/i.test(k) || /^e1_num$/i.test(k) || /^e2_num$/i.test(k),
  empresa:          k => /^empresa$/i.test(k),
  // Protheus: F2_FILIAL, D2_FILIAL, E2_FILIAL, etc.
  filial:           k => /^filial$/i.test(k) || /^loja$/i.test(k) || /^[a-z]\d_filial$/i.test(k),
  unidade:          k => /^unidade$/i.test(k) || /^unidade_negocio$/i.test(k) || /^unidade_de_negocio$/i.test(k),
  grupo_produto:    k => /^grupo_produto$/i.test(k) || /^grupo$/i.test(k) || /^bm_grupo/i.test(k) || /^b1_grupo$/i.test(k),
  grupo_de_produto: k => /^grupo_produto$/i.test(k) || /^grupo$/i.test(k) || /^bm_grupo/i.test(k) || /^b1_grupo$/i.test(k),
  // Protheus: F4_CODIGO — aliases: tes
  tes:              k => /^tes$/i.test(k) || /^f4_codigo$/i.test(k) || /^d2_tes$/i.test(k),
  // Protheus: CTT_CUSTO — aliases: centro_custo
  centro_custo:     k => /^centro_custo$/i.test(k) || /^ctt_custo$/i.test(k) || /^ccusto/i.test(k) || /^d2_ccusto$/i.test(k),
};

function _detectarColuna(row, dimensao) {
  const detector = _DETECTORES[dimensao];
  if (!detector) return null;
  return Object.keys(row).find(detector) || null;
}

function _extrairAno(row) {
  const anoKey = Object.keys(row).find(k => /^ano$/i.test(k) || /^year$/i.test(k));
  if (anoKey && /^\d{4}$/.test(String(row[anoKey]))) return String(row[anoKey]);
  // Se a linha tem coluna AAAAMM, extrai apenas o ano (evita retornar null quando nao ha coluna "ano" separada)
  const aaaamm = _extrairAaaamm(row);
  if (aaaamm) return aaaamm.slice(0, 4);
  const dk = Object.keys(row).find(_DETECTORES.data);
  if (!dk) return null;
  const v = row[dk];
  if (v instanceof Date) return String(v.getUTCFullYear());
  const s = String(v);
  if (/^\d{8}$/.test(s))              return s.slice(0, 4);
  if (/^\d{4}-\d{2}-\d{2}/.test(s))  return s.slice(0, 4);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(6, 10);
  return null;
}

// Detecta formato AAAAMM (6 dígitos, ex: 202501) gerado por YEAR()*100+MONTH() no Protheus.
// Procura primeiro em colunas com nome temporal; evita falsos positivos com IDs numéricos.
const _NOMES_COLUNA_TEMPORAL = /^(mes|month|competencia|competência|aaaa_mm|ano_mes|periodo|período|referencia|referência|aaaamm)$/i;
function _extrairAaaamm(row) {
  for (const k of Object.keys(row)) {
    if (!_NOMES_COLUNA_TEMPORAL.test(k)) continue;
    const v = String(row[k] || '');
    if (/^\d{6}$/.test(v) && parseInt(v.slice(0, 4), 10) >= 2000) return `${v.slice(0, 4)}-${v.slice(4, 6)}`;
    if (/^\d{4}-\d{2}$/.test(v)) return v;
  }
  return null;
}

function _extrairMes(row) {
  const anoKey = Object.keys(row).find(k => /^ano$/i.test(k) || /^year$/i.test(k));
  const mesKey = Object.keys(row).find(k => /^mes$/i.test(k) || /^month$/i.test(k));
  if (anoKey && mesKey) {
    const ano = String(row[anoKey]);
    const mes = String(parseInt(row[mesKey], 10)).padStart(2, '0');
    if (/^\d{4}$/.test(ano) && /^\d{2}$/.test(mes)) return `${ano}-${mes}`;
  }
  // AAAAMM (6-digit) gerado por YEAR()*100+MONTH() no Protheus
  const aaaamm = _extrairAaaamm(row);
  if (aaaamm) return aaaamm;
  const dk = Object.keys(row).find(_DETECTORES.data);
  if (!dk) return null;
  const v = row[dk];
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`;
  const s = String(v);
  if (/^\d{8}$/.test(s))              return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s))  return s.slice(0, 7);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return `${s.slice(6, 10)}-${s.slice(3, 5)}`;
  return null;
}

function _extrairDia(row) {
  const dk = Object.keys(row).find(_DETECTORES.data);
  if (!dk) return null;
  const v = row[dk];
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  const s = String(v);
  if (/^\d{8}$/.test(s))              return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s))  return s.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  return null;
}

function _somarNumericos(rows) {
  // Retorna { coluna: total } para todas as colunas numéricas do resultado
  const SKIP = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
  const firstRow = rows[0] || {};
  const cols = Object.keys(firstRow).filter(k => {
    const kl = k.toLowerCase();
    if (SKIP.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)) && !/^\d{4}-\d{2}/.test(v));
  });
  const totais = {};
  for (const col of cols) totais[col] = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
  return totais;
}

function _formatarComparacao(rows, periodo, filtrosStr, intent) {
  if (periodo.tipo === 'comparacao_mensal_entre_anos') {
    return _formatarComparacaoMensalEntreAnosLimpo(rows, periodo, filtrosStr, intent);
  }

  const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const anual        = periodo.tipo === 'comparacao_anual';
  const mesmoMes     = periodo.tipo === 'comparacao_mesmo_mes';
  const acumulado    = periodo.tipo === 'comparacao_acumulado_mes';
  const mesAlvo      = (mesmoMes || acumulado)
    ? String(periodo.mes || (new Date().getMonth() + 1)).padStart(2, '0')
    : null;

  // Agrupa linhas por ano (comparacao_anual/acumulado) ou por ano-mês (demais)
  const grupos = {};
  for (const r of rows) {
    // Para acumulado e anual agrupa por ano; para os demais por ano-mês
    const chave = (anual || acumulado) ? _extrairAno(r) : _extrairMes(r);
    if (!chave) continue;

    // comparacao_mesmo_mes: só o mês alvo
    if (mesmoMes && mesAlvo && !_extrairMes(r)?.endsWith(`-${mesAlvo}`)) continue;

    // comparacao_acumulado_mes: só meses de 01 até mesAlvo dentro de cada ano
    if (acumulado && mesAlvo) {
      const ym = _extrairMes(r);
      if (!ym) continue;
      const mo = ym.split('-')[1];
      if (parseInt(mo, 10) > parseInt(mesAlvo, 10)) continue;
    }

    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(r);
  }

  const chaves = Object.keys(grupos).sort();
  if (chaves.length === 0) {
    // Sem coluna de data detectável — soma tudo como único bloco
    const totais = _somarNumericos(rows);
    const linhas = Object.entries(totais).map(([k, v]) => `💰 *${k.replace(/_/g, ' ')}*: ${BRL(v)}`);
    return `📊 *Resultado*${filtrosStr}\n\n${linhas.join('\n')}\n\n_${rows.length} registro(s) consolidados_`;
  }

  // Soma as colunas numéricas de cada grupo
  const totalPorGrupo = {};
  for (const chave of chaves) totalPorGrupo[chave] = _somarNumericos(grupos[chave]);

  // Descobre quais colunas numéricas existem
  const cols = _filtrarMetricasSolicitadas(Object.keys(totalPorGrupo[chaves[0]] || {}), intent);
  if (cols.length === 0) {
    return `✅ Consulta retornou ${rows.length} registro(s).${filtrosStr}`;
  }

  // Formata cada coluna como um bloco de comparação
  const blocos = cols.map(col => {
    const label = col.replace(/_/g, ' ').toLowerCase();
    const linhas = chaves.map(chave => {
      const valor = totalPorGrupo[chave][col] || 0;
      let chaveLabel = chave;
      if (!anual && /^\d{4}-\d{2}$/.test(chave)) {
        const [y, mo] = chave.split('-');
        chaveLabel = `${MESES_PT[parseInt(mo, 10) - 1]}/${y}`;
      }
      return `📅 *${chaveLabel}*: ${BRL(valor)}`;
    });

    let tendencia = '';
    if (chaves.length === 2) {
      const [ant, atu] = chaves;
      const vAnt = totalPorGrupo[ant][col] || 0;
      const vAtu = totalPorGrupo[atu][col] || 0;
      const diff = vAnt ? ((vAtu - vAnt) / vAnt * 100) : null;
      if (diff !== null) {
        tendencia = diff >= 0
          ? `\n📈 Crescimento: *+${diff.toFixed(1)}%*`
          : `\n📉 Retração: *${diff.toFixed(1)}%*`;
      }
    }
    return `*${label}*\n${linhas.join('\n')}${tendencia}`;
  });

  let titulo = 'Comparativo Mensal';
  if (anual)     titulo = 'Comparativo Anual';
  if (mesmoMes && mesAlvo)  titulo = `Comparativo — ${MESES_PT[parseInt(mesAlvo, 10) - 1]} (ano a ano)`;
  if (acumulado && mesAlvo) titulo = `Comparativo Acumulado — Jan a ${MESES_PT[parseInt(mesAlvo, 10) - 1]} (ano a ano)`;
  return `📊 *${titulo}*${filtrosStr}\n\n${blocos.join('\n\n')}`;
}

function _formatarComparacaoMensalEntreAnos(rows, periodo, filtrosStr, intent) {
  const anoBase = parseInt(periodo.ano_base, 10);
  const anoComparacao = parseInt(periodo.ano_comparacao, 10);
  if (!anoBase || !anoComparacao || anoBase === anoComparacao) {
    return _formatarComparacao(rows, { ...periodo, tipo: 'comparacao_mensal' }, filtrosStr, intent);
  }

  const grupos = {};
  for (const row of rows) {
    const ym = _extrairMes(row);
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) continue;
    const [anoStr, mesStr] = ym.split('-');
    const ano = parseInt(anoStr, 10);
    const mes = parseInt(mesStr, 10);
    if (![anoBase, anoComparacao].includes(ano)) continue;
    if (!grupos[mes]) grupos[mes] = {};
    if (!grupos[mes][ano]) grupos[mes][ano] = [];
    grupos[mes][ano].push(row);
  }

  const meses = Object.keys(grupos).map(Number).sort((a, b) => a - b);
  if (!meses.length) {
    return `âš ï¸ Nao encontrei coluna de data/competencia para comparar ${anoBase} x ${anoComparacao} mes a mes. Verifique o alias DATA, ano+mes ou campo_data do dataset.`;
  }

  const totalPorMesAno = {};
  for (const mes of meses) {
    totalPorMesAno[mes] = {};
    for (const ano of [anoBase, anoComparacao]) {
      totalPorMesAno[mes][ano] = _somarNumericos(grupos[mes][ano] || []);
    }
  }

  const cols = new Set();
  for (const mes of meses) {
    for (const ano of [anoBase, anoComparacao]) {
      for (const col of Object.keys(totalPorMesAno[mes][ano] || {})) cols.add(col);
    }
  }
  const numCols = _filtrarMetricasSolicitadas([...cols], intent);
  if (!numCols.length) return `âœ… Consulta retornou ${rows.length} registro(s).${filtrosStr}`;

  const blocos = numCols.map(col => {
    const label = col.replace(/_/g, ' ').toLowerCase();
    const linhas = meses.map(mes => {
      const valorBase = totalPorMesAno[mes][anoBase]?.[col] || 0;
      const valorComparacao = totalPorMesAno[mes][anoComparacao]?.[col] || 0;
      const variacao = valorBase ? ((valorComparacao - valorBase) / valorBase) * 100 : null;
      const variacaoStr = variacao === null
        ? 'sem base'
        : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(1)}%`;
      return `ðŸ“… *${MESES_PT[mes - 1]}*: ${anoBase} ${_formatarValorMetrica(col, valorBase)} | ${anoComparacao} ${_formatarValorMetrica(col, valorComparacao)} | ${variacaoStr}`;
    });
    return `*${label}*\n${linhas.join('\n')}`;
  });

  return `ðŸ“Š *Comparativo Mensal ${anoBase} x ${anoComparacao}*${filtrosStr}\n\n${blocos.join('\n\n')}`;
}

function _formatarComparacaoMensalEntreAnosLimpo(rows, periodo, filtrosStr, intent) {
  const anoBase = parseInt(periodo.ano_base, 10);
  const anoComparacao = parseInt(periodo.ano_comparacao, 10);
  if (!anoBase || !anoComparacao || anoBase === anoComparacao) {
    return _formatarComparacao(rows, { ...periodo, tipo: 'comparacao_mensal' }, filtrosStr, intent);
  }

  // Normaliza colunas pivotadas (ex: faturamento_2025 / faturamento_2026 → faturamento)
  const pivotAnos = _detectarColunasAnoPivotadas(rows);
  const rowsProcessados = (pivotAnos &&
    pivotAnos[0] === Math.min(anoBase, anoComparacao) &&
    pivotAnos[1] === Math.max(anoBase, anoComparacao))
    ? _normalizarRowsPivotadas(rows, anoBase, anoComparacao)
    : rows;

  const grupos = {};
  for (const row of rowsProcessados) {
    const ym = _extrairMes(row);
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) continue;
    const [anoStr, mesStr] = ym.split('-');
    const ano = parseInt(anoStr, 10);
    const mes = parseInt(mesStr, 10);
    if (![anoBase, anoComparacao].includes(ano)) continue;
    if (!grupos[mes]) grupos[mes] = {};
    if (!grupos[mes][ano]) grupos[mes][ano] = [];
    grupos[mes][ano].push(row);
  }

  const meses = Object.keys(grupos).map(Number).sort((a, b) => a - b);
  if (!meses.length) {
    return `Atencao: nao encontrei coluna de data/competencia para comparar ${anoBase} x ${anoComparacao} mes a mes. Verifique o alias DATA, ano+mes ou campo_data do dataset.`;
  }

  const totalPorMesAno = {};
  for (const mes of meses) {
    totalPorMesAno[mes] = {};
    for (const ano of [anoBase, anoComparacao]) {
      totalPorMesAno[mes][ano] = _somarNumericos(grupos[mes][ano] || []);
    }
  }

  const cols = new Set();
  for (const mes of meses) {
    for (const ano of [anoBase, anoComparacao]) {
      for (const col of Object.keys(totalPorMesAno[mes][ano] || {})) cols.add(col);
    }
  }
  const numCols = _filtrarMetricasSolicitadas([...cols], intent);
  if (!numCols.length) return `Consulta retornou ${rows.length} registro(s).${filtrosStr}`;

  const blocos = numCols.map(col => {
    const label = col.replace(/_/g, ' ').toLowerCase();
    const linhas = meses.map(mes => {
      const valorBase = totalPorMesAno[mes][anoBase]?.[col] || 0;
      const valorComparacao = totalPorMesAno[mes][anoComparacao]?.[col] || 0;
      const variacao = valorBase ? ((valorComparacao - valorBase) / valorBase) * 100 : null;
      const variacaoStr = variacao === null
        ? 'sem base'
        : `${variacao >= 0 ? '+' : ''}${variacao.toFixed(1)}%`;
      return `- *${MESES_PT[mes - 1]}*: ${anoBase} ${_formatarValorMetrica(col, valorBase)} | ${anoComparacao} ${_formatarValorMetrica(col, valorComparacao)} | ${variacaoStr}`;
    });
    return `*${label}*\n${linhas.join('\n')}`;
  });

  return `*Comparativo Mensal ${anoBase} x ${anoComparacao}*${filtrosStr}\n\n${blocos.join('\n\n')}`;
}

function _formatarAgrupamento(rows, agruparPor, periodoStr, filtrosStr, limite, intent) {
  const groupBy = _groupByIntent(intent);
  if (groupBy.length >= 2) {
    return _formatarAgrupamentoComposto(rows, groupBy, periodoStr, filtrosStr, limite, intent);
  }

  if (['mes', 'ano', 'dia'].includes(String(agruparPor || '').toLowerCase())) {
    return _formatarAgrupamentoTemporal(rows, agruparPor, periodoStr, filtrosStr, limite, intent);
  }

  const firstRow = rows[0] || {};

  // Detecta a coluna de agrupamento pela semântica ou pelo nome exato
  const colunaGrupo = _detectarColuna(firstRow, agruparPor)
    || Object.keys(firstRow).find(k => k.toLowerCase() === agruparPor.toLowerCase())
    || null;

  if (!colunaGrupo) {
    return `⚠️ Não foi possível agrupar por "${agruparPor}". Tente reformular a pergunta.`;
  }

  // Detecta colunas numéricas para somar (ignora IDs, datas e a própria coluna de grupo)
  const SKIP = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
  const numColsTodas = Object.keys(firstRow).filter(k => {
    if (k === colunaGrupo) return false;
    if (_DETECTORES.data(k)) return false;
    const kl = k.toLowerCase();
    if (SKIP.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
  });
  const numCols = _filtrarMetricasSolicitadas(numColsTodas, intent);

  // Agrupa e soma
  const grupos = {};
  for (const r of rows) {
    const chave = String(r[colunaGrupo] || '—').trim() || '—';
    if (!grupos[chave]) grupos[chave] = {};
    for (const col of numCols) {
      grupos[chave][col] = (grupos[chave][col] || 0) + (parseFloat(r[col]) || 0);
    }
  }

  // Ordena pelo primeiro campo numérico (geralmente faturamento/quantidade)
  const colOrdem = numCols[0];
  const limitePadrao = String(agruparPor || '').toLowerCase() === 'empresa'
    ? Object.keys(grupos).length
    : LIMITE_PADRAO_AGRUPAMENTO;
  const top = Object.entries(grupos)
    .sort(([, a], [, b]) => (b[colOrdem] || 0) - (a[colOrdem] || 0))
    .slice(0, limite || limitePadrao);

  // Totais gerais
  const totais = {};
  for (const col of numCols) totais[col] = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);

  // Monta label do agrupamento sem depender de emoji no cliente WhatsApp.
  const labelGrupo = agruparPor.charAt(0).toUpperCase() + agruparPor.slice(1).toLowerCase();

  const linhas = top.map(([nome, vals], i) => {
    const partes = numCols.map(col => {
      const pct = totais[col] ? ` (${(vals[col] / totais[col] * 100).toFixed(1)}%)` : '';
      const label = col.replace(/_/g, ' ').toLowerCase();
      return `${label}: ${_formatarValorMetrica(col, vals[col])}${pct}`;
    }).join(' | ');
    return `${i + 1}. *${nome}* — ${partes}`;
  });

  const totalStr = numCols.map(col => `${col.replace(/_/g, ' ')}: *${_formatarValorMetrica(col, totais[col])}*`).join(' | ');
  const maisStr  = Object.keys(grupos).length > top.length
    ? `\n_... e mais ${Object.keys(grupos).length - top.length}_`
    : '';

  return (
    `*Por ${labelGrupo}*${periodoStr}${filtrosStr}\n\n` +
    linhas.join('\n') +
    maisStr +
    `\n\nTotal: ${totalStr}`
  );
}

function _groupByIntent(intent) {
  const raw = Array.isArray(intent?.group_by) && intent.group_by.length
    ? intent.group_by
    : Array.isArray(intent?.agrupar_por_composto) && intent.agrupar_por_composto.length
      ? intent.agrupar_por_composto
      : intent?.agrupar_por ? [intent.agrupar_por] : [];
  return raw
    .map(d => String(d || '').toLowerCase())
    .filter(Boolean)
    .filter((d, idx, arr) => arr.indexOf(d) === idx);
}

function _labelDimensao(dimensao) {
  const d = String(dimensao || '').toLowerCase();
  if (d === 'mes') return 'Mes';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function _resolverDimensao(row, dimensao) {
  const dim = String(dimensao || '').toLowerCase();
  if (dim === 'ano') return { tipo: 'temporal', extrair: _extrairAno };
  if (dim === 'mes') return { tipo: 'temporal', extrair: _extrairMes };
  if (dim === 'dia') return { tipo: 'temporal', extrair: _extrairDia };

  const coluna = _detectarColuna(row, dim)
    || Object.keys(row).find(k => k.toLowerCase() === dim)
    || null;
  return coluna ? { tipo: 'coluna', coluna } : null;
}

function _chaveDimensao(row, resolver, dimensao) {
  if (!resolver) return null;
  if (resolver.tipo === 'temporal') return resolver.extrair(row);
  return String(row[resolver.coluna] || '—').trim() || '—';
}

function _formatarAgrupamentoComposto(rows, dimensoes, periodoStr, filtrosStr, limite, intent) {
  const dims = (dimensoes || []).map(d => String(d || '').toLowerCase()).filter(Boolean);
  if (dims.length < 2) return _formatarAgrupamento(rows, dims[0] || intent?.agrupar_por, periodoStr, filtrosStr, limite, { ...intent, group_by: null, agrupar_por_composto: null });
  const firstRow = rows[0] || {};
  const resolvers = dims.map(dim => _resolverDimensao(firstRow, dim));
  const faltanteIdx = resolvers.findIndex(r => !r);

  if (faltanteIdx >= 0) {
    return `Atenção: não foi possível agrupar por "${dims[faltanteIdx]}". Tente reformular a pergunta.`;
  }

  const SKIP = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
  const colunasDimensao = new Set(resolvers.filter(r => r.tipo === 'coluna').map(r => r.coluna));
  const numColsTodas = Object.keys(firstRow).filter(k => {
    if (colunasDimensao.has(k)) return false;
    if (_DETECTORES.data(k)) return false;
    const kl = k.toLowerCase();
    if (SKIP.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
  });
  const numCols = _filtrarMetricasSolicitadas(numColsTodas, intent);
  if (!numCols.length) return `Consulta retornou ${rows.length} registro(s).${periodoStr}${filtrosStr}`;

  const root = { children: new Map(), totais: {} };
  const totais = {};
  for (const col of numCols) totais[col] = 0;

  for (const row of rows) {
    const chaves = resolvers.map((resolver, idx) => _chaveDimensao(row, resolver, dims[idx]));
    if (chaves.some(chave => !chave)) continue;

    let node = root;
    for (const chave of chaves) {
      if (!node.children.has(chave)) node.children.set(chave, { children: new Map(), totais: {} });
      node = node.children.get(chave);
      for (const col of numCols) {
        const valor = parseFloat(row[col]) || 0;
        node.totais[col] = (node.totais[col] || 0) + valor;
      }
    }

    for (const col of numCols) {
      const valor = parseFloat(row[col]) || 0;
      totais[col] += valor;
    }
  }

  if (!root.children.size) {
    return `Atenção: não encontrei dados suficientes para agrupar por ${dims.join(' e ')}.`;
  }

  const colOrdem = numCols[0];
  const temDimensaoTemporal = dims.some(dim => ['ano', 'mes', 'dia'].includes(dim));
  const limitePorNivel = limite
    ? Math.min(limite, 50)
    : temDimensaoTemporal
      ? Infinity
      : LIMITE_PADRAO_AGRUPAMENTO;

  const ordenarFilhos = (entries, nivel) => {
    const dim = dims[nivel];
    if (['ano', 'mes', 'dia'].includes(dim)) return entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return entries.sort(([, a], [, b]) => (b.totais[colOrdem] || 0) - (a.totais[colOrdem] || 0));
  };

  const renderNivel = (node, nivel, indent = '') => {
    const entries = ordenarFilhos([...node.children.entries()], nivel);
    const visiveis = entries.slice(0, limitePorNivel);
    const grupos = [];
    for (const [chave, child] of visiveis) {
      const label = ['ano', 'mes', 'dia'].includes(dims[nivel]) ? _labelTemporal(chave, dims[nivel]) : chave;
      const emoji = _emojiDimensao(dims[nivel]);
      if (nivel === dims.length - 1) {
        let itemStr;
        if (numCols.length === 1) {
          itemStr = `*${_formatarValorMetrica(numCols[0], child.totais[numCols[0]] || 0)}*`;
          grupos.push(`  ${grupos.length + 1}. *${label}*: ${itemStr}`);
        } else {
          const partes = numCols.map(col => {
            const nome = col.replace(/_/g, ' ').toLowerCase();
            return `${nome}: *${_formatarValorMetrica(col, child.totais[col] || 0)}*`;
          }).join(' | ');
          grupos.push(`  ${grupos.length + 1}. *${label}* — ${partes}`);
        }
      } else {
        const filhos = renderNivel(child, nivel + 1, indent + '  ');
        const ehPaiTemporal = ['ano', 'mes', 'dia'].includes(dims[nivel]);
        const temFilhosLeaf = nivel === dims.length - 2;
        let subtotalStr = '';
        if (ehPaiTemporal && temFilhosLeaf) {
          const subtotalPartes = numCols.map(col =>
            `*${_formatarValorMetrica(col, child.totais[col] || 0)}*`
          ).join(' | ');
          subtotalStr = `\n${indent}🧾 *Subtotal*: ${subtotalPartes}`;
        }
        grupos.push(`${indent}${emoji} *${label}*\n${filhos}${subtotalStr}`);
      }
    }
    if (entries.length > visiveis.length) grupos.push(`${indent}... e mais ${entries.length - visiveis.length}`);
    const sep = nivel < dims.length - 1 ? '\n\n' : '\n';
    return grupos.filter(Boolean).join(sep);
  };

  const titulo = dims.map(_labelDimensao).join(' e ');
  const totalStr = numCols
    .map(col => `${col.replace(/_/g, ' ')}: *${_formatarValorMetrica(col, totais[col])}*`)
    .join(' | ');

  return `*Por ${titulo}*${periodoStr}${filtrosStr}\n\n${renderNivel(root, 0)}\n\nTotal: ${totalStr}`;
}

function _formatarAgrupamentoTemporal(rows, agruparPor, periodoStr, filtrosStr, limite, intent) {
  const dimensao = String(agruparPor || '').toLowerCase();

  // Quando agrupando por mês e as colunas são pivotadas por ano (ex: faturamento_2025 / faturamento_2026),
  // redireciona para o comparador mensal entre anos que produz a saída correta.
  if (dimensao === 'mes') {
    const anosDetectados = _detectarColunasAnoPivotadas(rows);
    if (anosDetectados) {
      return _formatarComparacaoMensalEntreAnosLimpo(rows, {
        tipo: 'comparacao_mensal_entre_anos',
        ano_base: anosDetectados[0],
        ano_comparacao: anosDetectados[1],
      }, filtrosStr, intent);
    }
  }

  const extrairChave = dimensao === 'ano' ? _extrairAno : dimensao === 'dia' ? _extrairDia : _extrairMes;
  const firstRow = rows[0] || {};
  const SKIP_PREFIXES = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
  const numColsTodas = Object.keys(firstRow).filter(k => {
    if (_DETECTORES.data(k)) return false;
    const kl = k.toLowerCase();
    if (SKIP_PREFIXES.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
  });
  const numCols = _filtrarMetricasSolicitadas(numColsTodas, intent);
  if (!numCols.length) return `Consulta retornou ${rows.length} registro(s).${periodoStr}${filtrosStr}`;

  const grupos = {};
  for (const row of rows) {
    const chave = extrairChave(row);
    if (!chave) continue;
    if (!grupos[chave]) grupos[chave] = {};
    for (const col of numCols) {
      grupos[chave][col] = (grupos[chave][col] || 0) + (parseFloat(row[col]) || 0);
    }
  }

  const chaves = Object.keys(grupos);
  if (!chaves.length) {
    if (rows.length === 1 && numCols.length) {
      const totais = numCols.map(col => `${col.replace(/_/g, ' ')}: *${_formatarValorMetrica(col, parseFloat(rows[0][col]) || 0)}*`);
      return `*Resultado*${periodoStr}${filtrosStr}\n\n${totais.join('\n')}`;
    }
    return `Atencao: nao encontrei coluna de data/competencia para agrupar por ${dimensao}. Verifique o alias DATA, ano+mes ou campo_data do dataset.`;
  }

  const orderParts = String(intent?.ordenar_por || '').split(':');
  const orderCol = orderParts[0] && numCols.includes(orderParts[0]) ? orderParts[0] : numCols[0];
  const asc = String(orderParts[1] || 'desc').toLowerCase() === 'asc';
  const limitePadrao = dimensao === 'dia' ? 31 : LIMITE_PADRAO_AGRUPAMENTO;
  // Sem ranking/top/limite, agrupamentos temporais devem ser cronologicos.
  const ordenarPorValor = !!intent?.limite;
  const top = chaves
    .sort((a, b) => {
      if (!ordenarPorValor) return a < b ? -1 : a > b ? 1 : 0;
      return asc ? (grupos[a][orderCol] || 0) - (grupos[b][orderCol] || 0) : (grupos[b][orderCol] || 0) - (grupos[a][orderCol] || 0);
    })
    .slice(0, limite || limitePadrao);

  const titulo = dimensao === 'ano' ? 'Por Ano' : dimensao === 'dia' ? 'Por Dia' : 'Por Mes';
  const linhas = top.map((chave, idx) => {
    const vals = grupos[chave];
    const label = _labelTemporal(chave, dimensao);
    const partes = numCols.map(col => `${col.replace(/_/g, ' ')}: *${_formatarValorMetrica(col, vals[col] || 0)}*`).join(' | ');
    return `${idx + 1}. *${label}* — ${partes}`;
  });

  const totalStr = numCols
    .map(col => `${col.replace(/_/g, ' ')}: *${_formatarValorMetrica(col, rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0))}*`)
    .join(' | ');

  return `*${titulo}*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}\n\nTotal: ${totalStr}`;
}

function _emojiDimensao(dim) {
  const d = String(dim || '').toLowerCase();
  if (['ano', 'mes', 'dia'].includes(d)) return '🗓';
  if (['fornecedor', 'cliente', 'vendedor', 'representante'].includes(d)) return '👤';
  if (['filial', 'estado', 'uf', 'regiao'].includes(d)) return '📍';
  if (['grupo', 'categoria', 'produto', 'almoxarifado', 'natureza'].includes(d)) return '📦';
  if (['banco', 'conta'].includes(d)) return '🏦';
  return '📋';
}

function _labelTemporal(chave, dimensao) {
  if (dimensao === 'ano') return chave;
  if (dimensao === 'dia' && /^\d{4}-\d{2}-\d{2}$/.test(chave)) {
    const [ano, mes, dia] = chave.split('-');
    return `${dia}/${mes}/${ano}`;
  }
  if (/^\d{4}-\d{2}$/.test(chave)) {
    const [ano, mes] = chave.split('-');
    return `${MESES_PT[parseInt(mes, 10) - 1]}/${ano}`;
  }
  return chave;
}

function _divisorAnalitico(rows, granularidade, periodo) {
  const extrator = granularidade === 'ano' ? _extrairAno : granularidade === 'dia' ? _extrairDia : _extrairMes;
  const grupos = new Set(rows.map(extrator).filter(Boolean));
  if (grupos.size) return { valor: grupos.size, origem: 'dados' };
  const fallback = _divisorPeriodo(periodo, granularidade);
  return fallback ? { valor: fallback, origem: 'periodo' } : null;
}

function _labelGranularidade(granularidade) {
  if (granularidade === 'ano') return 'anual';
  if (granularidade === 'dia') return 'diaria';
  return 'mensal';
}

function _formatarOperacaoAnalitica(rows, intent, periodo, periodoStr, filtrosStr) {
  const op = intent?.operacao_analitica;
  if (!op || op.operacao !== 'media') return null;

  const granularidade = op.granularidade || 'mes';
  const divisor = _divisorAnalitico(rows, granularidade, periodo);
  if (!divisor?.valor) return null;

  const firstRow = rows[0] || {};
  const SKIP_PREFIXES = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
  const numColsTodas = Object.keys(firstRow).filter(k => {
    const kl = k.toLowerCase();
    if (SKIP_PREFIXES.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)) && !/^\d{4}-\d{2}/.test(v));
  });

  const filtroMetrica = op.metrica
    ? { ...intent, _metricasDetectadas: [op.metrica], ordenar_por: null }
    : intent;
  const numCols = _filtrarMetricasSolicitadas(numColsTodas, filtroMetrica);
  if (!numCols.length) return null;

  const labelGran = _labelGranularidade(granularidade);
  const unidade = granularidade === 'ano' ? 'ano(s)' : granularidade === 'dia' ? 'dia(s)' : 'mes(es)';
  const linhas = numCols.map(col => {
    const total = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
    const media = total / divisor.valor;
    const label = col.replace(/_/g, ' ').toLowerCase();
    return `${_iconeMetrica(col)} *Media ${labelGran} de ${label}*: ${_formatarValorMetrica(col, media)}\nTotal base: ${_formatarValorMetrica(col, total)} em ${divisor.valor} ${unidade}`;
  });

  const origem = divisor.origem === 'dados' ? 'periodos com dados' : 'periodo solicitado';
  return `ðŸ“Š *Media ${labelGran.charAt(0).toUpperCase() + labelGran.slice(1)}*${periodoStr}${filtrosStr}\n\n${linhas.join('\n\n')}\n\n_Base: ${origem}_`;
}

const _LINHA_PAI_MES = /^\s*\d+\.\s+\*?(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+\d{4}\*?\s*:/i;

function normalizarAgrupamentosPais(texto) {
  if (typeof texto !== 'string' || !texto.includes('\n')) return texto;
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const normalizadas = [];
  let ultimaNaoVazia = '';

  for (const linha of linhas) {
    const linhaAtualEhPaiMes = _LINHA_PAI_MES.test(linha);
    const anteriorEhPaiMes = _LINHA_PAI_MES.test(ultimaNaoVazia);
    const jaTemLinhaEmBranco = normalizadas.length > 0 && normalizadas[normalizadas.length - 1].trim() === '';

    if (linhaAtualEhPaiMes && ultimaNaoVazia && !anteriorEhPaiMes && !jaTemLinhaEmBranco) {
      normalizadas.push('');
    }

    normalizadas.push(linha);
    if (linha.trim()) ultimaNaoVazia = linha;
  }

  return normalizadas.join('\n');
}

function _optsHumanizar(opts) {
  return opts?.humanizarResposta === true || opts?.humanizar === true;
}

function _periodoEmLinha(periodo) {
  return formatarPeriodo(periodo).trim().replace(/\s+/g, ' ').replace(/^periodo:\s*/i, '').trim();
}

function _nomeAssuntoHumano(resultado, intent) {
  const fonte = [
    intent?.modulo,
    intent?.intencao,
    resultado?.intencao,
    intent?.acao,
    intent?.tipo,
  ].filter(Boolean).join(' ');
  const n = _normalizarNome(fonte);

  if (n.includes('fatur')) return 'o faturamento';
  if (n.includes('financeiro') || n.includes('titulo') || n.includes('saldo') || n.includes('receber') || n.includes('pagar')) return 'as informacoes financeiras';
  if (n.includes('compra') || n.includes('pedido_compra')) return 'as compras';
  if (n.includes('comissao')) return 'as comissoes';
  if (n.includes('estoque')) return 'o estoque';
  if (n.includes('quantidade')) return 'as quantidades';
  if (n.includes('ticket')) return 'o ticket medio';
  return 'as informacoes solicitadas';
}

function _labelResumo(col) {
  const nome = _normalizarNome(col);
  const tokens = nome.split('_').filter(Boolean);
  if (tokens.includes('saldo')) return 'saldo';
  if (tokens.includes('valor') || tokens.includes('vlr')) return 'valor';
  if (tokens.includes('total')) return 'total';
  if (tokens.includes('faturamento')) return 'faturamento';
  if (tokens.includes('receita')) return 'receita';
  if (tokens.includes('quantidade') || tokens.includes('qtd') || tokens.includes('qtde')) return 'quantidade';
  return String(col || '').replace(/_/g, ' ').toLowerCase();
}

function _pareceDataOuIdentificadorResumo(col, valor) {
  const nome = _normalizarNome(col);
  const tokens = nome.split('_').filter(Boolean);
  const skip = ['id', 'cod', 'codigo', 'num', 'numero', 'nota', 'nf', 'documento', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie', 'parcela', 'loja'];
  if (skip.some(p => tokens.includes(p) || nome === p || nome.startsWith(`${p}_`) || nome.endsWith(`_${p}`))) return true;
  if (_DETECTORES.data(col)) return true;
  if (tokens.some(t => ['data', 'dt', 'dtdigit', 'emissao', 'emissao1', 'venc', 'vencto', 'vencimento', 'baixa', 'competencia', 'periodo', 'referencia'].includes(t))) return true;

  const s = String(valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{2}\/\d{2}\/\d{4}/.test(s)) return true;
  if (/^(?:19|20)\d{6}$/.test(s) && tokens.some(t => ['data', 'dt', 'venc', 'vencto', 'vencimento', 'emissao'].includes(t))) return true;
  return false;
}

function _prioridadeResumo(col) {
  const nome = _normalizarNome(col);
  const tokens = nome.split('_').filter(Boolean);
  if (tokens.includes('saldo') || nome.includes('a_pagar') || nome.includes('a_receber') || nome.includes('em_aberto')) return 0;
  if (tokens.includes('valor') || tokens.includes('vlr') || tokens.includes('total') || tokens.includes('faturamento') || tokens.includes('receita')) return 1;
  if (tokens.includes('quantidade') || tokens.includes('qtd') || tokens.includes('qtde')) return 2;
  if (_tipoMetrica(col) === 'moeda') return 3;
  return 9;
}

function _labelDimensaoResumo(col) {
  const nome = _normalizarNome(col);
  if (nome.includes('fornecedor')) return 'fornecedor';
  if (nome.includes('cliente')) return 'cliente';
  if (nome.includes('produto')) return 'produto';
  if (nome.includes('vendedor')) return 'vendedor';
  if (nome.includes('representante')) return 'representante';
  if (nome.includes('empresa')) return 'empresa';
  if (nome.includes('filial')) return 'filial';
  return String(col || '').replace(/_/g, ' ').toLowerCase();
}

function _dimensaoResumoValida(col, row) {
  const valor = row?.[col];
  if (valor == null || valor === '') return false;
  if (_pareceDataOuIdentificadorResumo(col, valor)) return false;
  if (typeof valor === 'number') return false;
  if (typeof valor === 'string' && !isNaN(parseFloat(valor))) return false;
  return true;
}

function _colunasNumericasResumo(rows, intent) {
  const firstRow = rows?.[0] || {};
  const cols = Object.keys(firstRow).filter((k) => {
    const v = firstRow[k];
    if (_pareceDataOuIdentificadorResumo(k, v)) return false;
    if (typeof v !== 'number' && (typeof v !== 'string' || v === '' || isNaN(parseFloat(v)))) return false;
    return _prioridadeResumo(k) < 9;
  });
  return _filtrarMetricasSolicitadas(cols, intent)
    .sort((a, b) => _prioridadeResumo(a) - _prioridadeResumo(b))
    .slice(0, 2);
}

function _primeiraDimensaoResumo(rows, intent) {
  const firstRow = rows?.[0] || {};
  const keys = Object.keys(firstRow);
  const preferidas = _groupByIntent(intent).filter(Boolean);
  for (const dim of preferidas) {
    const col = _detectarColuna(firstRow, dim) || keys.find(k => _normalizarNome(k) === _normalizarNome(dim));
    if (col && _dimensaoResumoValida(col, firstRow)) return col;
  }

  const dimensoesNegocio = ['fornecedor', 'cliente', 'produto', 'vendedor', 'representante', 'empresa'];
  for (const dim of dimensoesNegocio) {
    const col = _detectarColuna(firstRow, dim);
    if (col && _dimensaoResumoValida(col, firstRow)) return col;
  }

  return keys.find((k) => {
    return _dimensaoResumoValida(k, firstRow);
  }) || null;
}

function _resumoHumanoRows(rows, intent) {
  if (!Array.isArray(rows) || !rows.length) return '';
  if (rows.length > LIMITE_ROWS_RESUMO_HUMANO) {
    return `Leitura rapida: a base retornou ${rows.length} registro(s); os detalhes estao na tabela.`;
  }
  const metricas = _colunasNumericasResumo(rows, intent);
  const partes = [`A base retornou ${rows.length} registro(s)`];

  if (metricas.length) {
    const totais = metricas.map((col) => {
      const total = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
      const label = _labelResumo(col);
      return `${label}: ${_formatarValorMetrica(col, total)}`;
    });
    partes.push(`com ${totais.join(' e ')}`);

    const dimCol = _primeiraDimensaoResumo(rows, intent);
    const metricaPrincipal = metricas[0];
    if (dimCol && metricaPrincipal && rows.length > 1) {
      const agrupados = new Map();
      for (const row of rows) {
        const chave = String(row[dimCol] ?? '').trim();
        if (!chave) continue;
        agrupados.set(chave, (agrupados.get(chave) || 0) + (parseFloat(row[metricaPrincipal]) || 0));
      }
      const maior = [...agrupados.entries()].sort((a, b) => b[1] - a[1])[0];
      if (maior && maior[0]) {
        const label = _labelDimensaoResumo(dimCol);
        partes.push(`maior ${label}: ${maior[0]} (${_formatarValorMetrica(metricaPrincipal, maior[1])})`);
      }
    }
  }

  return `Leitura rapida: ${partes.join('; ')}.`;
}

function _indicadoresHumanosRows(rows, intent) {
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMITE_ROWS_RESUMO_HUMANO) return [];
  return _colunasNumericasResumo(rows, intent).map((col) => {
    const total = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
    return {
      label: _labelResumo(col),
      valor: _formatarValorMetrica(col, total),
    };
  });
}

function _sugestaoComparacaoHumana(resultado, intent, opts) {
  if (opts?.sugerirComparacao === false) return '';
  const periodo = resultado?.periodo || intent?.periodo;
  if (!periodo?.dataInicio || !periodo?.dataFim) return '';
  if (String(periodo?.tipo || '').includes('comparacao')) return '';
  const textoIntent = _normalizarNome([intent?.intencao, intent?.acao, intent?.tipo, intent?.comparativo].filter(Boolean).join(' '));
  if (/compar|evolu|variac|aumento|queda/.test(textoIntent)) return '';
  return 'Posso comparar com o periodo anterior. Se preferir, peca "comparar com o mesmo periodo do ano passado".';
}

function montarApresentacaoResposta(texto, resultado, intent, opts = {}) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  const rows = Array.isArray(resultado?.rows) ? resultado.rows : [];
  if (resultado?.tipo !== 'sucesso_ai_sql' || !rows.length) return null;

  const jaHumanizado = /^\s*(entendi|consultei|verifiquei|analisei)\b/i.test(texto);
  const periodo = _periodoEmLinha(resultado?.periodo || intent?.periodo);
  const assunto = _nomeAssuntoHumano(resultado, intent);
  const intro = `Entendi. Consultei ${assunto}${periodo ? ` no periodo de ${periodo.toLowerCase()}` : ''} e encontrei ${rows.length} registro(s).`;
  const resumo = _resumoHumanoRows(rows, intent);
  const sugestao = _sugestaoComparacaoHumana(resultado, intent, opts);
  const indicadores = _indicadoresHumanosRows(rows, intent);

  return {
    versao: 1,
    introducao: jaHumanizado ? '' : intro,
    detalhe: texto.trim(),
    resumo,
    sugestao,
    indicadores,
    rowsCount: rows.length,
  };
}

function textoApresentacao(apresentacao, fallbackTexto = '') {
  if (!apresentacao || typeof apresentacao !== 'object') return fallbackTexto;
  return [
    apresentacao.introducao,
    apresentacao.detalhe,
    apresentacao.resumo,
    apresentacao.sugestao,
  ].filter(Boolean).join('\n\n') || fallbackTexto;
}

function humanizarResposta(texto, resultado, intent, opts = {}) {
  if (!_optsHumanizar(opts) || typeof texto !== 'string' || !texto.trim()) return texto;
  const apresentacao = montarApresentacaoResposta(texto, resultado, intent, opts);
  return textoApresentacao(apresentacao, texto);
}

function formatar(resultado, intent, opts = {}) {
  // Resultado do motor Text-to-SQL dinâmico (ex: módulo de Compras)
  // A resposta já vem formatada pela IA ou pelo fallback interno do handler.
  if (resultado.tipo === 'sucesso_ai_sql') {
    return humanizarResposta(resultado.resposta_direta || 'Não encontrei dados para essa consulta.', resultado, intent, opts);
  }

  if (resultado.tipo === 'erro' && resultado.resposta_direta) {
    return resultado.resposta_direta;
  }

  if (resultado.tipo === 'desconhecido') {
    if (opts.messageTemplates && opts.empresaId) {
      if (intent?._erroTipo === 'cota_esgotada') {
        const provedores = intent._erros?.map(e => e.provedor).join(' e ') || 'IA';
        return opts.messageTemplates.render(opts.empresaId, 'ia_cota_esgotada', { provedores });
      }
      if (intent?._erroTipo === 'dataset_sem_informacao') {
        return opts.messageTemplates.render(opts.empresaId, 'dataset_sem_informacao', {
          mensagem: intent._erro || resultado.mensagem,
          dimensao: intent._dimensaoIndisponivel || '',
        });
      }
      return opts.messageTemplates.render(opts.empresaId, 'intencao_desconhecida', {
        mensagem: resultado.mensagem,
      });
    }
    if (intent?._erroTipo === 'dataset_sem_informacao') {
      return `${intent._erro || resultado.mensagem}\n\nO dataset disponivel para esta consulta nao possui os campos ou o nivel de detalhe necessario para responder com seguranca.\n\nDeseja consultar outra informacao?`;
    }
    return `❓ ${resultado.mensagem}`;
  }

  if (resultado.tipo === 'erro') {
    return `❌ Ocorreu um erro ao consultar o ERP:\n${resultado.mensagem}`;
  }

  const { rows, intencao, periodo } = resultado;
  const periodoStr  = formatarPeriodo(periodo);
  const filtrosStr  = formatarFiltros(intent?.filtros);

  if (!rows || rows.length === 0) {
    return `ℹ️ Nenhum dado encontrado para sua consulta.${periodoStr}${filtrosStr}`;
  }

  // Comparação: detectada pelo tipo de período, vale para qualquer intenção
  if (['comparacao_anual', 'comparacao_mensal', 'comparacao_mensal_entre_anos', 'comparacao_mesmo_mes', 'comparacao_acumulado_mes'].includes(periodo?.tipo)) {
    return _formatarComparacao(rows, periodo, filtrosStr, intent);
  }

  // Agrupamento dinâmico: "por cliente", "por produto", "por vendedor"
  const respostaAnalitica = _formatarOperacaoAnalitica(rows, intent, periodo, periodoStr, filtrosStr);
  if (respostaAnalitica) return respostaAnalitica;

  const agruparPor = intent?.agrupar_por;
  if (agruparPor) {
    return _formatarAgrupamento(rows, agruparPor, periodoStr, filtrosStr, intent?.limite, intent);
  }

  switch (intencao) {

    case 'consultar_quantidade': {
      const _col = (row, ...names) => {
        for (const k of Object.keys(row)) {
          if (names.includes(k.toLowerCase())) return parseFloat(row[k]) || 0;
        }
        return 0;
      };
      const total = rows.reduce((s, r) => s + _col(r, 'quantidade_total', 'quantidade', 'qtd_total', 'qtd', 'volume', 'unidades'), 0);
      return (
        `📦 *Quantidade*${periodoStr}${filtrosStr}\n\n` +
        `🔢 Total: *${NUM(total)}*`
      );
    }

    case 'consultar_top_clientes': {
      const linhas = rows.map((r, i) =>
        `${i + 1}. *${r.cliente || r.cod_cliente}* — ${BRL(r.faturamento_total)}`
      );
      return `🏆 *Top ${rows.length} Clientes*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}`;
    }

    case 'consultar_ticket_medio': {
      const r = rows[0];
      return (
        `🎯 *Ticket Médio*${periodoStr}${filtrosStr}\n\n` +
        `Ticket médio: *${BRL(r.ticket_medio)}*\n` +
        `Faturamento total: ${BRL(r.faturamento_total)}\n` +
        `Total de notas: ${r.total_notas}`
      );
    }

    case 'consultar_titulos_abertos': {
      const total  = rows.reduce((s, r) => s + (parseFloat(r.saldo) || 0), 0);
      const vencidos = rows.filter(r => r.status_venc === 'Vencido');
      const vencidosTotal = vencidos.reduce((s, r) => s + (parseFloat(r.saldo) || 0), 0);

      const linhas = rows.slice(0, 10).map((r) =>
        `• ${r.cliente || r.cod_cliente} — Tít. ${r.titulo}/${r.parcela} — Venc. ${_fmtData(r.vencimento)} — ${BRL(r.saldo)}${r.status_venc === 'Vencido' ? ' ⚠️' : ''}`
      );
      return (
        `💳 *Títulos em Aberto* (${rows.length} títulos)${filtrosStr}\n` +
        `Total: *${BRL(total)}*` +
        (vencidos.length ? `\n⚠️ Vencidos: ${BRL(vencidosTotal)} (${vencidos.length})` : '') +
        `\n\n` +
        linhas.join('\n') +
        (rows.length > 10 ? `\n... e mais ${rows.length - 10} título(s)` : '')
      );
    }

    case 'consultar_pedidos_abertos': {
      const total = rows.reduce((s, r) => s + (parseFloat(r.valor_total) || 0), 0);
      const linhas = rows.slice(0, 10).map((r) =>
        `• Ped. ${r.pedido} — ${r.cliente || r.cod_cliente} — ${BRL(r.valor_total)} (${NUM(r.qtd_pendente)} pend.)`
      );
      return (
        `📦 *Pedidos em Aberto* (${rows.length} pedidos)${filtrosStr}\n` +
        `Total: *${BRL(total)}*\n\n` +
        linhas.join('\n') +
        (rows.length > 10 ? `\n... e mais ${rows.length - 10} pedido(s)` : '')
      );
    }

    case 'consultar_clientes_inativos': {
      const linhas = rows.slice(0, 10).map((r) =>
        `• *${r.cliente}* — Ult. compra: ${_fmtData(r.ultima_compra) || 'Nunca'} — ${r.estado || '—'}`
      );
      return (
        `😴 *Clientes Inativos* (${rows.length} clientes)${filtrosStr}\n\n` +
        linhas.join('\n') +
        (rows.length > 10 ? `\n... e mais ${rows.length - 10}` : '')
      );
    }

    default: {
      const SKIP_PREFIXES = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
      const firstRow = rows[0] || {};
      const numColsTodas = Object.keys(firstRow).filter(k => {
        const kl = k.toLowerCase();
        if (SKIP_PREFIXES.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
        const v = firstRow[k];
        return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)) && !/^\d{4}-\d{2}/.test(v));
      });
      const numCols = _filtrarMetricasSolicitadas(numColsTodas, intent);

      if (numCols.length > 0) {
        const linhas = numCols.map(col => {
          const total = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
          const label = col.replace(/_/g, ' ').toLowerCase();
          const md = _mediaDiaria(periodo, total);
          const valor = _formatarValorMetrica(col, total);
          const media = md ? _formatarValorMetrica(col, md.media) : null;
          return `${_iconeMetrica(col)} *${label}*: ${valor}` + (md ? ` _(${media}/dia)_` : '');
        });
        return `📊 *Resultado*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}\n\n_${rows.length} registro(s) consolidados_`;
      }

      return `✅ Consulta retornou ${rows.length} registro(s).${periodoStr}${filtrosStr}`;
    }
  }
}

function formatarAiSqlLocal(rows, intent) {
  if (!rows || !rows.length) return 'Nenhum dado encontrado para sua consulta.';
  const periodo = intent?.periodo || {};
  const periodoStr = formatarPeriodo(periodo);
  const filtrosStr = formatarFiltros(intent?.filtros);
  const groupBy = _groupByIntent(intent);
  if (groupBy.length >= 2) {
    return _formatarAgrupamentoComposto(rows, groupBy, periodoStr, filtrosStr, intent?.limite, intent);
  }
  const agruparPor = groupBy[0] || null;
  if (agruparPor && ['mes', 'dia', 'ano'].includes(agruparPor)) {
    return _formatarAgrupamentoTemporal(rows, agruparPor, periodoStr, filtrosStr, intent?.limite, intent);
  }
  if (agruparPor) {
    return _formatarAgrupamento(rows, agruparPor, periodoStr, filtrosStr, intent?.limite, intent);
  }
  const firstRow = rows[0] || {};
  const SKIP = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia', 'titulo', 'prefixo', 'filial', 'serie'];
  const numColsTodas = Object.keys(firstRow).filter(k => {
    const kl = k.toLowerCase();
    if (SKIP.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
  });
  const numCols = _filtrarMetricasSolicitadas(numColsTodas, intent);
  if (!numCols.length) return `Consulta retornou ${rows.length} registro(s).${periodoStr}${filtrosStr}`;
  const linhas = numCols.map(col => {
    const total = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
    const label = col.replace(/_/g, ' ').toLowerCase();
    return `${_iconeMetrica(col)} *${label}*: ${_formatarValorMetrica(col, total)}`;
  });
  return `*Resultado*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}\n\n_${rows.length} registro(s) consolidados_`;
}

/**
 * Detecta a primeira dimensão categórica reconhecível em uma linha de resultado SQL.
 * Usado pelo Consolidado para saber como agrupar quando o SQL não tem coluna temporal.
 * Ordem de prioridade: vendedor > fornecedor > cliente > documento > produto > grupo > filial > unidade.
 */
function detectarDimensaoCategorica(firstRow) {
  if (!firstRow) return null;
  const keys = Object.keys(firstRow);
  const PRIORIDADE = ['vendedor', 'fornecedor', 'cliente', 'documento', 'produto', 'grupo', 'filial', 'unidade'];
  for (const dim of PRIORIDADE) {
    const detector = _DETECTORES[dim];
    if (detector && keys.find(detector)) return dim;
  }
  return null;
}

module.exports = {
  formatar, formatarAiSqlLocal, montarApresentacaoResposta, textoApresentacao,
  normalizarAgrupamentosPais, _extrairMes, _extrairAno, detectarDimensaoCategorica,
  // Usados tambem por modules/whatsapp/whatsapp-attachment-builder.js (geracao de PDF/Excel) —
  // nao alterar assinatura sem checar esse consumidor.
  _formatarValorMetrica, _groupByIntent, _labelDimensao, _resolverDimensao,
  _chaveDimensao, _tipoMetrica, _somarNumericos, _extrairDia,
};
