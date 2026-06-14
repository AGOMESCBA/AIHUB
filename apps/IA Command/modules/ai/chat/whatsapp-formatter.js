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
    if (_RE_CAMPO_MEDIA.test(campo)) continue;
    if (!_RE_CAMPO_SOMAVEL.test(campo) && !_RE_CAMPO_QUANTIDADE.test(campo)) continue;
    const soma = rows.reduce((acc, row) => {
      const v = parseFloat(row[campo]);
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
    if (soma !== 0) totais[campo] = soma;
  }
  return totais;
}

function _num(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function _normalizarCampo(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function _findCol(keys, pred) {
  return keys.find(k => pred(_normalizarCampo(k))) || null;
}

function _formatarDetalhamentoClienteDocumento(rows, mensagemOriginal) {
  if (!rows || !rows.length) return null;

  const keys = Object.keys(rows[0] || {});
  const clienteKey = _findCol(keys, k => ['cliente', 'nome_cliente', 'nm_cli', 'razao_social'].includes(k));
  const documentoKey = _findCol(keys, k =>
    ['documento', 'doc', 'nota', 'nota_fiscal', 'nf', 'nfe', 'titulo', 'duplicata'].includes(k)
    || /^f2_doc$|^d2_doc$|^e1_num$|^e2_num$/.test(k)
  );
  if (!clienteKey || !documentoKey) return null;

  const valorKey = keys.find(k => {
    if (k === clienteKey || k === documentoKey) return false;
    const nk = _normalizarCampo(k);
    if (/^(id|cod|codigo|num|seq|ano|mes|dia|data|serie|loja|filial)/.test(nk)) return false;
    if (!_RE_CAMPO_SOMAVEL.test(k) || _RE_CAMPO_MEDIA.test(k) || _RE_CAMPO_QUANTIDADE.test(k)) return false;
    return rows.some(r => {
      const v = r[k];
      return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(parseFloat(v)));
    });
  });
  if (!valorKey) return null;

  const porCliente = new Map();
  let totalGeral = 0;

  for (const row of rows) {
    const cliente = String(row[clienteKey] || '').trim() || '(sem cliente)';
    const doc = String(row[documentoKey] || '').trim() || '(sem documento)';
    const valor = parseFloat(row[valorKey]) || 0;
    totalGeral += valor;

    if (!porCliente.has(cliente)) porCliente.set(cliente, { total: 0, docs: new Map() });
    const grupo = porCliente.get(cliente);
    grupo.total += valor;
    grupo.docs.set(doc, (grupo.docs.get(doc) || 0) + valor);
  }

  const titulo = /nota|nf|nfe/i.test(documentoKey) || /\bnota\s+fiscal\b/i.test(mensagemOriginal || '')
    ? 'Detalhamento por cliente e nota fiscal'
    : 'Detalhamento por cliente e documento';

  const linhas = [`*${titulo}*`];
  let idxCliente = 1;
  for (const [cliente, grupo] of porCliente.entries()) {
    linhas.push('');
    linhas.push(`${idxCliente}. *${cliente}*: ${_brl(grupo.total)}`);
    let idxDoc = 1;
    for (const [doc, valor] of grupo.docs.entries()) {
      linhas.push(`   ${idxDoc}. Doc. ${doc}: ${_brl(valor)}`);
      idxDoc++;
    }
    idxCliente++;
  }

  linhas.push('');
  linhas.push(`*Total Geral*: ${_brl(totalGeral)}`);
  return linhas.join('\n');
}

function _formatarFallback(rows, mensagemOriginal) {
  if (!rows || !rows.length) return 'Nenhum registro encontrado para essa consulta.';

  const detalhamento = _formatarDetalhamentoClienteDocumento(rows, mensagemOriginal);
  if (detalhamento) return detalhamento;

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

  const linhasTotais = Object.entries(totais).map(([k, v]) => {
    const valor = _RE_CAMPO_QUANTIDADE.test(k) ? _num(v) : _brl(v);
    return `*${k}: ${valor}*`;
  });
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

  const detalhamento = _formatarDetalhamentoClienteDocumento(rows, mensagemOriginal);
  if (detalhamento) return detalhamento;

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

module.exports = { formatar, _formatarFallback, _formatarDetalhamentoClienteDocumento };
