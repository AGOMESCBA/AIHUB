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

function _fmtData(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || '';
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`;
}

function formatar(resultado, intent) {
  if (resultado.tipo === 'desconhecido') {
    return (
      `❓ ${resultado.mensagem}\n\n` +
      `Tente perguntar, por exemplo:\n` +
      `• "Qual o faturamento deste mês?"\n` +
      `• "Top 10 clientes do mês passado"\n` +
      `• "Títulos em aberto"\n` +
      `• "Pedidos abertos esta semana"\n` +
      `• "Produtos mais vendidos do trimestre"`
    );
  }

  if (resultado.tipo === 'erro') {
    return `❌ Ocorreu um erro ao consultar o ERP:\n${resultado.mensagem}`;
  }

  const { rows, intencao, periodo } = resultado;
  const periodoStr = formatarPeriodo(periodo);

  if (!rows || rows.length === 0) {
    return `ℹ️ Nenhum dado encontrado para sua consulta.${periodoStr}`;
  }

  switch (intencao) {

    case 'consultar_faturamento': {
      const r = rows[0];
      return (
        `📊 *Faturamento*${periodoStr}\n\n` +
        `💰 Total: *${BRL(r.faturamento_total)}*\n` +
        `📄 Notas emitidas: ${r.total_notas}\n` +
        `🎯 Ticket médio: ${BRL(r.ticket_medio)}`
      );
    }

    case 'consultar_faturamento_por_cliente': {
      const linhas = rows.slice(0, 15).map((r, i) =>
        `${i + 1}. *${r.cliente || r.cod_cliente}* — ${BRL(r.faturamento_total)} (${r.total_notas} NF)`
      );
      return `📊 *Faturamento por Cliente*${periodoStr}\n\n${linhas.join('\n')}`;
    }

    case 'consultar_faturamento_por_vendedor': {
      const linhas = rows.slice(0, 15).map((r, i) =>
        `${i + 1}. Vendedor ${r.cod_vendedor} — ${BRL(r.faturamento_total)} (${r.total_clientes ?? 0} clientes)`
      );
      return `📊 *Faturamento por Vendedor*${periodoStr}\n\n${linhas.join('\n')}`;
    }

    case 'consultar_top_clientes': {
      const linhas = rows.map((r, i) =>
        `${i + 1}. *${r.cliente || r.cod_cliente}* — ${BRL(r.faturamento_total)}`
      );
      return `🏆 *Top ${rows.length} Clientes*${periodoStr}\n\n${linhas.join('\n')}`;
    }

    case 'consultar_ticket_medio': {
      const r = rows[0];
      return (
        `🎯 *Ticket Médio*${periodoStr}\n\n` +
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
        `📊 *Comparativo de Faturamento*\n\n` +
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
        `💳 *Títulos em Aberto* (${rows.length} títulos)\n` +
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
        `📦 *Pedidos em Aberto* (${rows.length} pedidos)\n` +
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
        `😴 *Clientes Inativos* (${rows.length} clientes)\n\n` +
        linhas.join('\n') +
        (rows.length > 10 ? `\n... e mais ${rows.length - 10}` : '')
      );
    }

    case 'consultar_produtos_mais_vendidos': {
      const linhas = rows.map((r, i) =>
        `${i + 1}. *${r.produto || r.cod_produto}* — ${BRL(r.faturamento_total)} — ${NUM(r.quantidade_vendida)} ${r.unidade || 'un'}`
      );
      return `📦 *Produtos Mais Vendidos*${periodoStr}\n\n${linhas.join('\n')}`;
    }

    default: {
      return `✅ Consulta retornou ${rows.length} registro(s).${periodoStr}`;
    }
  }
}

module.exports = { formatar };
