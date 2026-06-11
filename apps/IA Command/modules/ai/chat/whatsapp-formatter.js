'use strict';

const aiProviderClient    = require('../../erp/ai-provider-client');
const whatsappFormatPrompt = require('../../erp/whatsapp-format-prompt');

function _brl(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const _RE_CAMPO_SOMAVEL    = /valor|total|saldo|juros|multa|desconto|vlr|vl_|brut|liquido|comiss|fatura|receita|fat_|fat$|compra|pedido|nf_|receber|pagar|capital|giro/i;
const _RE_CAMPO_QUANTIDADE = /^qtd|^qt_|quantidade|^volume/i;
const _RE_CAMPO_MEDIA      = /media|medio|ticket|avg|average|pct|percent|percentual|taxa|indice|proporcao/i;
const _RE_CAMPO_PERCENTUAL = /crescimento|variacao|pct|percent|percentual|margem/i;

function _calcularTotais(rows) {
  if (!rows || !rows.length) return {};
  const totais = {};
  for (const campo of Object.keys(rows[0])) {
    if (!_RE_CAMPO_SOMAVEL.test(campo)) continue;
    if (_RE_CAMPO_MEDIA.test(campo)) continue;
    const soma = rows.reduce((acc, row) => {
      const v = parseFloat(row[campo]);
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
    if (soma !== 0) totais[campo] = soma;
  }
  return totais;
}

function _formatarFallback(rows, mensagemOriginal) {
  if (!rows || !rows.length) return 'Nenhum registro encontrado para essa consulta.';

  const totais = _calcularTotais(rows);
  const linhas = rows.slice(0, 30).map((row, i) => {
    const partes = Object.entries(row)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => {
        const isMonetario = _RE_CAMPO_SOMAVEL.test(k) && !_RE_CAMPO_MEDIA.test(k) && !_RE_CAMPO_QUANTIDADE.test(k);
        const isPercentual = _RE_CAMPO_PERCENTUAL.test(k);
        if (isMonetario) return `${k}: *${_brl(v)}*`;
        if (isPercentual) {
          const n = parseFloat(v);
          if (!isNaN(n)) return `${k}: ${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
        }
        return `${k}: ${v}`;
      });
    return `${i + 1}. ${partes.join(' | ')}`;
  });

  if (rows.length > 30) linhas.push(`_...e mais ${rows.length - 30} registros._`);

  const linhasTotais = Object.entries(totais).map(([k, v]) => `*${k}: ${_brl(v)}*`);
  linhasTotais.push(`*Total: ${rows.length} registros*`);

  return [...linhas, '', ...linhasTotais].join('\n');
}

/**
 * Formata rows da query em mensagem WhatsApp via IA.
 * Usa o engine universal de whatsapp-format-prompt para pré-estruturar os dados,
 * eliminando a ambiguidade entre colunas temporais e colunas de métrica.
 */
async function formatar(rows, mensagemOriginal, keys, cfg) {
  if (!rows || !rows.length) return 'Nenhum registro encontrado para essa consulta.';

  try {
    const systemPrompt = whatsappFormatPrompt.buildFormatSystemPrompt();
    const userPrompt   = whatsappFormatPrompt.buildFormatUserPrompt(mensagemOriginal, rows);
    const resposta = await aiProviderClient.chamarIA(
      keys, cfg,
      systemPrompt,
      userPrompt,
      { json: false, maxTokens: 2000, logPrefix: 'ChatFormatter' }
    );
    const texto = String(resposta || '').trim();
    return texto || _formatarFallback(rows, mensagemOriginal);
  } catch (e) {
    console.warn('[ChatFormatter] Formatação via IA falhou, usando fallback:', e.message);
    return _formatarFallback(rows, mensagemOriginal);
  }
}

module.exports = { formatar, _formatarFallback };
