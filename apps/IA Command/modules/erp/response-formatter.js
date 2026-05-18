// Formata resultados das consultas ERP em mensagens WhatsApp (pt-BR)

const BRL = (v) => {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const NUM = (v) => {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

function formatarPeriodo(periodo) {
  if (!periodo?.dataInicio) return '';
  return `\n📅 Período: ${_fmtData(periodo.dataInicio)} a ${_fmtData(periodo.dataFim)}`;
}

function formatarFiltros(filtros) {
  if (!filtros || typeof filtros !== 'object') return '';
  const LABELS = { produto: 'Produto', cliente: 'Cliente', vendedor: 'Vendedor', fornecedor: 'Fornecedor', filial: 'Filial', status: 'Status' };
  const ativos = Object.entries(filtros)
    .filter(([, v]) => v && typeof v === 'string' && v.trim())
    .map(([k, v]) => `${LABELS[k] || k}: *${v.trim()}*`);
  return ativos.length ? `\n🔍 ${ativos.join(' | ')}` : '';
}

function _mediaDiaria(periodo, total) {
  if (!periodo?.dataInicio || !periodo?.dataFim) return null;
  const d1 = new Date(periodo.dataInicio.slice(0,4), +periodo.dataInicio.slice(4,6)-1, +periodo.dataInicio.slice(6,8));
  const d2 = new Date(periodo.dataFim.slice(0,4),   +periodo.dataFim.slice(4,6)-1,   +periodo.dataFim.slice(6,8));
  const dias = Math.round((d2 - d1) / 86400000) + 1;
  if (dias < 8) return null;
  return { media: total / dias, dias };
}

function _fmtData(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || '';
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

// Detectores de colunas por semântica — mesma ideia do campo_data, mas para dimensões
const _DETECTORES = {
  data:     k => /^data$/i.test(k) || /^dt_/i.test(k) || /^data_/i.test(k) || /^_data$/i.test(k),
  cliente:  k => /^cliente$/i.test(k) || /^nm_cli/i.test(k) || /^ds_cli/i.test(k) || /^nome_cli/i.test(k),
  produto:  k => /^produto$/i.test(k) || /^negocio$/i.test(k) || /^ds_prod/i.test(k) || /^nm_prod/i.test(k) || /^descr/i.test(k),
  vendedor:    k => /^vendedor$/i.test(k) || /^nm_vend/i.test(k) || /^ds_vend/i.test(k) || /^cod_vend/i.test(k),
  fornecedor:  k => /^fornecedor$/i.test(k) || /^nm_forn/i.test(k) || /^ds_forn/i.test(k) || /^nome_forn/i.test(k) || /^razao/i.test(k),
  empresa:     k => /^empresa$/i.test(k) || /^filial$/i.test(k) || /^unidade$/i.test(k),
};

function _detectarColuna(row, dimensao) {
  const detector = _DETECTORES[dimensao];
  if (!detector) return null;
  return Object.keys(row).find(detector) || null;
}

function _extrairAno(row) {
  const dk = Object.keys(row).find(_DETECTORES.data);
  if (!dk) return null;
  const v = row[dk];
  if (v instanceof Date) return String(v.getFullYear());
  const s = String(v);
  if (/^\d{8}$/.test(s))              return s.slice(0, 4);
  if (/^\d{4}-\d{2}-\d{2}/.test(s))  return s.slice(0, 4);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(6, 10);
  return null;
}

function _extrairMes(row) {
  const dk = Object.keys(row).find(_DETECTORES.data);
  if (!dk) return null;
  const v = row[dk];
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  const s = String(v);
  if (/^\d{8}$/.test(s))              return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s))  return s.slice(0, 7);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return `${s.slice(6, 10)}-${s.slice(3, 5)}`;
  return null;
}

function _somarNumericos(rows) {
  // Retorna { coluna: total } para todas as colunas numéricas do resultado
  const SKIP = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia'];
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

function _formatarComparacao(rows, periodo, filtrosStr) {
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
  const cols = Object.keys(totalPorGrupo[chaves[0]] || {});
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

function _formatarAgrupamento(rows, agruparPor, periodoStr, filtrosStr, limite) {
  const firstRow = rows[0] || {};

  // Detecta a coluna de agrupamento pela semântica ou pelo nome exato
  const colunaGrupo = _detectarColuna(firstRow, agruparPor)
    || Object.keys(firstRow).find(k => k.toLowerCase() === agruparPor.toLowerCase())
    || null;

  if (!colunaGrupo) {
    return `⚠️ Coluna "${agruparPor}" não encontrada no resultado. Verifique o alias no SQL do dataset.`;
  }

  // Detecta colunas numéricas para somar (ignora IDs, datas e a própria coluna de grupo)
  const SKIP = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia'];
  const numCols = Object.keys(firstRow).filter(k => {
    if (k === colunaGrupo) return false;
    if (_DETECTORES.data(k)) return false;
    const kl = k.toLowerCase();
    if (SKIP.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
    const v = firstRow[k];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
  });

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
  const top = Object.entries(grupos)
    .sort(([, a], [, b]) => (b[colOrdem] || 0) - (a[colOrdem] || 0))
    .slice(0, limite || 15);

  // Totais gerais
  const totais = {};
  for (const col of numCols) totais[col] = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);

  // Monta emoji e label do agrupamento
  const EMOJIS = { cliente: '🏢', produto: '📦', vendedor: '👤', fornecedor: '🏪', empresa: '🏭' };
  const emoji = EMOJIS[agruparPor.toLowerCase()] || '📋';
  const labelGrupo = agruparPor.charAt(0).toUpperCase() + agruparPor.slice(1).toLowerCase();

  const linhas = top.map(([nome, vals], i) => {
    const partes = numCols.map(col => {
      const pct = totais[col] ? ` (${(vals[col] / totais[col] * 100).toFixed(1)}%)` : '';
      return `${BRL(vals[col])}${pct}`;
    }).join(' | ');
    return `${i + 1}. *${nome}* — ${partes}`;
  });

  const totalStr = numCols.map(col => `${col.replace(/_/g, ' ')}: *${BRL(totais[col])}*`).join(' | ');
  const maisStr  = Object.keys(grupos).length > top.length
    ? `\n_... e mais ${Object.keys(grupos).length - top.length}_`
    : '';

  return (
    `${emoji} *Por ${labelGrupo}*${periodoStr}${filtrosStr}\n\n` +
    linhas.join('\n') +
    maisStr +
    `\n\n💰 Total: ${totalStr}`
  );
}

function formatar(resultado, intent, opts = {}) {
  if (resultado.tipo === 'desconhecido') {
    if (opts.messageTemplates && opts.empresaId) {
      if (intent?._erroTipo === 'cota_esgotada') {
        const provedores = intent._erros?.map(e => e.provedor).join(' e ') || 'IA';
        return opts.messageTemplates.render(opts.empresaId, 'ia_cota_esgotada', { provedores });
      }
      return opts.messageTemplates.render(opts.empresaId, 'intencao_desconhecida', {
        mensagem: resultado.mensagem,
      });
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
  if (['comparacao_anual', 'comparacao_mensal', 'comparacao_mesmo_mes', 'comparacao_acumulado_mes'].includes(periodo?.tipo)) {
    return _formatarComparacao(rows, periodo, filtrosStr);
  }

  // Agrupamento dinâmico: "por cliente", "por produto", "por vendedor"
  const agruparPor = intent?.agrupar_por;
  if (agruparPor) {
    return _formatarAgrupamento(rows, agruparPor, periodoStr, filtrosStr, intent?.limite);
  }

  switch (intencao) {

    case 'consultar_faturamento': {
      const _col = (row, ...names) => {
        for (const k of Object.keys(row)) {
          if (names.includes(k.toLowerCase())) return parseFloat(row[k]) || 0;
        }
        return 0;
      };
      const total  = rows.reduce((s, r) => s + _col(r, 'faturamento_total', 'faturamento', 'valor_total', 'total'), 0);
      const notas  = rows[0] ? (_col(rows[0], 'total_notas', 'qtd_notas', 'notas') || rows.length) : rows.length;
      const ticket = rows[0] ? _col(rows[0], 'ticket_medio', 'ticket') || (notas ? total / notas : 0) : 0;
      const md = _mediaDiaria(periodo, total);
      return (
        `📊 *Faturamento*${periodoStr}${filtrosStr}\n\n` +
        `💰 Total: *${BRL(total)}*\n` +
        (md ? `📆 Média diária: ${BRL(md.media)} (${md.dias} dias)\n` : '') +
        `📄 Notas emitidas: ${notas}\n` +
        `🎯 Ticket médio: ${BRL(ticket)}`
      );
    }

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
        `🔢 Total: *${NUM(total)} unidades*`
      );
    }

    case 'consultar_faturamento_por_cliente': {
      const linhas = rows.slice(0, 15).map((r, i) =>
        `${i + 1}. *${r.cliente || r.cod_cliente}* — ${BRL(r.faturamento_total)} (${r.total_notas} NF)`
      );
      return `📊 *Faturamento por Cliente*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}`;
    }

    case 'consultar_faturamento_por_vendedor': {
      const linhas = rows.slice(0, 15).map((r, i) =>
        `${i + 1}. Vendedor ${r.cod_vendedor} — ${BRL(r.faturamento_total)} (${r.total_clientes ?? 0} clientes)`
      );
      return `📊 *Faturamento por Vendedor*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}`;
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

    case 'comparar_faturamento': {
      const r = rows[0];
      const atual    = parseFloat(r.periodo_atual)    || 0;
      const anterior = parseFloat(r.periodo_anterior) || 0;
      const diff     = anterior ? ((atual - anterior) / anterior * 100) : null;
      const tendencia = diff === null ? '' : diff >= 0
        ? `📈 Alta de ${diff.toFixed(1)}%`
        : `📉 Queda de ${Math.abs(diff).toFixed(1)}%`;

      return (
        `📊 *Comparativo de Faturamento*${filtrosStr}\n\n` +
        `Período atual:    *${BRL(atual)}* (${r.notas_periodo_atual ?? '—'} NF)\n` +
        (anterior ? `Período anterior: ${BRL(anterior)} (${r.notas_periodo_anterior ?? '—'} NF)\n` : '') +
        (tendencia ? `\n${tendencia}` : '')
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

    case 'consultar_produtos_mais_vendidos': {
      const linhas = rows.map((r, i) =>
        `${i + 1}. *${r.produto || r.cod_produto}* — ${BRL(r.faturamento_total)} — ${NUM(r.quantidade_vendida)} ${r.unidade || 'un'}`
      );
      return `📦 *Produtos Mais Vendidos*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}`;
    }

    default: {
      const SKIP_PREFIXES = ['id', 'cod', 'codigo', 'num', 'seq', 'ano', 'mes', 'dia'];
      const firstRow = rows[0] || {};
      const numCols = Object.keys(firstRow).filter(k => {
        const kl = k.toLowerCase();
        if (SKIP_PREFIXES.some(p => kl === p || kl.startsWith(p + '_') || kl.endsWith('_' + p))) return false;
        const v = firstRow[k];
        return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)) && !/^\d{4}-\d{2}/.test(v));
      });

      if (numCols.length > 0) {
        const linhas = numCols.map(col => {
          const total = rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);
          const label = col.replace(/_/g, ' ').toLowerCase();
          const md = _mediaDiaria(periodo, total);
          return `💰 *${label}*: ${BRL(total)}` + (md ? ` _(${BRL(md.media)}/dia)_` : '');
        });
        return `📊 *Resultado*${periodoStr}${filtrosStr}\n\n${linhas.join('\n')}\n\n_${rows.length} registro(s) consolidados_`;
      }

      return `✅ Consulta retornou ${rows.length} registro(s).${periodoStr}${filtrosStr}`;
    }
  }
}

module.exports = { formatar };
