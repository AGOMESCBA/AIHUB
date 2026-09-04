'use strict';

// Monta uma estrutura tabular intermediaria (neutra em formato de saida) a partir
// de rows brutas + intent, reaproveitando a MESMA logica de agrupamento/deteccao de
// metrica que o texto do WhatsApp ja usa (response-formatter.js), para que o Excel/PDF
// gerado bata exatamente com o que o usuario ja recebeu como texto.
//
// Consumida por whatsapp-excel-builder.js e whatsapp-pdf-builder.js.

const responseFormatter = require('../erp/core/response-formatter');

const {
  _groupByIntent,
  _labelDimensao,
  _resolverDimensao,
  _chaveDimensao,
  _somarNumericos,
  _tipoMetrica,
} = responseFormatter;

const _DETECTOR_EMPRESA = k => /^empresa$/i.test(k) || /^nome_empresa$/i.test(k) || /^razao_social_empresa$/i.test(k);

function _detectarColunaEmpresa(row) {
  return Object.keys(row).find(_DETECTOR_EMPRESA) || null;
}

function _colunasMetrica(rows, intent, colunasDimensaoFisicas = []) {
  const totais = _somarNumericos(rows);
  // Colunas ja resolvidas como dimensao (ex.: "aprovador", "numero_pedido") nunca podem
  // tambem virar metrica somada — bug real: codigo de aprovador ('000002') e numero de
  // pedido, ambos numericos, eram somados como se fossem valor monetario, gerando um
  // "Total Geral" sem sentido (soma de todos os numeros de pedido do periodo).
  const excluidas = new Set(colunasDimensaoFisicas.map(c => String(c).toLowerCase()));
  const cols = Object.keys(totais).filter(c => !excluidas.has(c.toLowerCase()));
  const pedidas = Array.isArray(intent?.metricas) && intent.metricas.length
    ? cols.filter(c => intent.metricas.some(m => String(m).toLowerCase() === c.toLowerCase()))
    : [];
  const colsFinais = pedidas.length ? pedidas : cols;
  const totaisFinais = {};
  for (const c of colsFinais) totaisFinais[c] = totais[c];
  return { cols: colsFinais, totais: totaisFinais };
}

function _periodoLabel(periodo) {
  if (!periodo) return '';
  if (periodo.label) return periodo.label;
  if (periodo.inicio && periodo.fim) return `${periodo.inicio} a ${periodo.fim}`;
  if (periodo.tipo) return String(periodo.tipo).replace(/_/g, ' ');
  return '';
}

/**
 * Prepara a estrutura tabular intermediaria usada pelos builders de Excel/PDF.
 * @param {Array<Object>} rows - linhas brutas da consulta (mesmas que geraram o texto)
 * @param {Object} intent - intent resolvido da consulta (agrupar_por/group_by, periodo, filtros)
 * @param {Object} [opts]
 * @param {string} [opts.tituloConsulta] - titulo/pergunta original
 * @returns {Object} estrutura neutra { colunasDimensao, colunasMetrica, linhas, subtotais, totalGeral, multiEmpresa, resumoPorEmpresa, tituloConsulta, periodoLabel }
 */
function prepararEstruturaTabular(rows, intent = {}, opts = {}) {
  const linhasBrutas = Array.isArray(rows) ? rows : [];
  const firstRow = linhasBrutas[0] || {};

  const dims = _groupByIntent(intent);
  const resolversTodos = dims.map(dim => _resolverDimensao(firstRow, dim));
  const resolvers = resolversTodos.filter(Boolean);
  const dimsValidas = dims.filter((_, idx) => resolvers[idx]);
  const colunasDimensaoFisicas = resolversTodos.filter(r => r?.tipo === 'coluna').map(r => r.coluna);

  const { cols: colunasMetrica, totais: totalGeral } = _colunasMetrica(linhasBrutas, intent, colunasDimensaoFisicas);

  const colEmpresa = _detectarColunaEmpresa(firstRow);
  const nomesEmpresa = colEmpresa
    ? Array.from(new Set(linhasBrutas.map(r => String(r[colEmpresa] || '').trim()).filter(Boolean)))
    : [];
  const multiEmpresa = nomesEmpresa.length > 1;

  const linhas = linhasBrutas.map(row => {
    const valores = {};
    for (const col of colunasMetrica) valores[col] = parseFloat(row[col]) || 0;
    const dimensoes = resolvers.map((resolver, idx) => _chaveDimensao(row, resolver, dimsValidas[idx]) || '—');
    return {
      dimensoes,
      valores,
      empresaNome: colEmpresa ? String(row[colEmpresa] || '').trim() : null,
      _raw: row,
    };
  });

  // Subtotais: só quando há 1+ dimensão de agrupamento válida — agrupa pela concatenação
  // das chaves de dimensão (mesmo critério de agrupamento usado no texto).
  let subtotais = [];
  if (dimsValidas.length) {
    const grupos = new Map();
    for (const linha of linhas) {
      const chaveGrupo = linha.dimensoes.join(' » ');
      if (!grupos.has(chaveGrupo)) {
        const valoresIniciais = {};
        for (const col of colunasMetrica) valoresIniciais[col] = 0;
        grupos.set(chaveGrupo, { chaveGrupo, valores: valoresIniciais });
      }
      const g = grupos.get(chaveGrupo);
      for (const col of colunasMetrica) g.valores[col] += linha.valores[col] || 0;
    }
    subtotais = Array.from(grupos.values());
  }

  let resumoPorEmpresa = null;
  if (multiEmpresa) {
    const porEmpresa = new Map();
    for (const linha of linhas) {
      const nome = linha.empresaNome || '—';
      if (!porEmpresa.has(nome)) {
        const valoresIniciais = {};
        for (const col of colunasMetrica) valoresIniciais[col] = 0;
        porEmpresa.set(nome, { empresaNome: nome, valores: valoresIniciais, registros: 0 });
      }
      const e = porEmpresa.get(nome);
      for (const col of colunasMetrica) e.valores[col] += linha.valores[col] || 0;
      e.registros++;
    }
    resumoPorEmpresa = Array.from(porEmpresa.values());
  }

  return {
    colunasDimensao: dimsValidas.map(d => _labelDimensao(d)),
    colunasMetrica,
    tiposMetrica: Object.fromEntries(colunasMetrica.map(c => [c, _tipoMetrica(c)])),
    linhas,
    subtotais,
    totalGeral,
    multiEmpresa,
    resumoPorEmpresa,
    tituloConsulta: opts.tituloConsulta || intent?._mensagemOriginal || 'Consulta',
    periodoLabel: _periodoLabel(intent?.periodo),
  };
}

module.exports = { prepararEstruturaTabular };
