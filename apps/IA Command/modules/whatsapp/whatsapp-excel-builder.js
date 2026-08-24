'use strict';

// Gera um Excel (.xlsx) formatado a partir da estrutura tabular intermediaria
// produzida por whatsapp-attachment-builder.js. Nao chama IA nem consulta o
// banco — trabalha 100% sobre a estrutura ja preparada.

const ExcelJS = require('exceljs');

const { _formatarValorMetrica } = require('../erp/core/response-formatter');

const COR_SUBTOTAL = 'FFEFF2FF';
const COR_TOTAL = 'FFDCE4FF';
const COR_HEADER = 'FF1F2937';

function _numFmt(tipoMetrica) {
  if (tipoMetrica === 'moeda') return '"R$" #,##0.00';
  if (tipoMetrica === 'percentual') return '0.00"%"';
  return '#,##0.00';
}

function _labelColuna(col) {
  return String(col || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function _montarCabecalho(estrutura) {
  return [...estrutura.colunasDimensao, ...estrutura.colunasMetrica.map(_labelColuna)];
}

function _escreverLinhasDetalhe(worksheet, estrutura) {
  const { colunasMetrica, tiposMetrica } = estrutura;
  for (const linha of estrutura.linhas) {
    const valoresFmt = colunasMetrica.map(col => linha.valores[col] ?? 0);
    const row = worksheet.addRow([...linha.dimensoes, ...valoresFmt]);
    colunasMetrica.forEach((col, idx) => {
      const cell = row.getCell(estrutura.colunasDimensao.length + idx + 1);
      cell.numFmt = _numFmt(tiposMetrica[col]);
    });
  }
}

function _escreverSubtotais(worksheet, estrutura) {
  if (!estrutura.subtotais.length || estrutura.colunasDimensao.length === 0) return;
  for (const sub of estrutura.subtotais) {
    const rotulo = [`Subtotal — ${sub.chaveGrupo}`, ...new Array(Math.max(estrutura.colunasDimensao.length - 1, 0)).fill('')];
    const valores = estrutura.colunasMetrica.map(col => sub.valores[col] ?? 0);
    const row = worksheet.addRow([...rotulo, ...valores]);
    row.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_SUBTOTAL } };
    });
    estrutura.colunasMetrica.forEach((col, idx) => {
      row.getCell(estrutura.colunasDimensao.length + idx + 1).numFmt = _numFmt(estrutura.tiposMetrica[col]);
    });
  }
}

function _escreverTotalGeral(worksheet, estrutura) {
  const rotulo = ['Total Geral', ...new Array(Math.max(estrutura.colunasDimensao.length - 1, 0)).fill('')];
  const valores = estrutura.colunasMetrica.map(col => estrutura.totalGeral[col] ?? 0);
  const row = worksheet.addRow([...rotulo, ...valores]);
  row.eachCell(cell => {
    cell.font = { bold: true, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_TOTAL } };
  });
  estrutura.colunasMetrica.forEach((col, idx) => {
    row.getCell(estrutura.colunasDimensao.length + idx + 1).numFmt = _numFmt(estrutura.tiposMetrica[col]);
  });
}

function _formatarCabecalhoEAjustes(worksheet, estrutura) {
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_HEADER } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: estrutura.colunasDimensao.length + estrutura.colunasMetrica.length },
  };

  worksheet.columns.forEach((column, idx) => {
    let maxLen = String(_montarCabecalho(estrutura)[idx] || '').length;
    worksheet.eachRow({ includeEmpty: false }, row => {
      const cell = row.getCell(idx + 1);
      const len = String(cell.value ?? '').length;
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.min(Math.max(maxLen + 3, 12), 45);
  });
}

function _adicionarAbaResumo(workbook, estrutura, opts) {
  const ws = workbook.addWorksheet('Resumo');
  ws.addRow(['Consulta', estrutura.tituloConsulta || opts.pergunta || '']);
  if (estrutura.periodoLabel) ws.addRow(['Período', estrutura.periodoLabel]);
  if (opts.empresaNome) ws.addRow(['Empresa', opts.empresaNome]);
  ws.addRow(['Gerado em', new Date().toLocaleString('pt-BR')]);
  ws.addRow([]);

  ws.addRow(['Total Geral']).font = { bold: true };
  for (const col of estrutura.colunasMetrica) {
    const row = ws.addRow([_labelColuna(col), estrutura.totalGeral[col] ?? 0]);
    row.getCell(2).numFmt = _numFmt(estrutura.tiposMetrica[col]);
  }
  ws.addRow([]);

  if (estrutura.resumoPorEmpresa) {
    const header = ws.addRow(['Empresa', 'Registros', ...estrutura.colunasMetrica.map(_labelColuna)]);
    header.font = { bold: true };
    for (const emp of estrutura.resumoPorEmpresa) {
      const row = ws.addRow([emp.empresaNome, emp.registros, ...estrutura.colunasMetrica.map(col => emp.valores[col] ?? 0)]);
      estrutura.colunasMetrica.forEach((col, idx) => {
        row.getCell(3 + idx).numFmt = _numFmt(estrutura.tiposMetrica[col]);
      });
    }
  } else if (estrutura.linhas.length) {
    const top = [...estrutura.linhas]
      .sort((a, b) => {
        const colPrincipal = estrutura.colunasMetrica[0];
        return (b.valores[colPrincipal] || 0) - (a.valores[colPrincipal] || 0);
      })
      .slice(0, 5);
    const header = ws.addRow(['Top', ...estrutura.colunasDimensao, ...estrutura.colunasMetrica.map(_labelColuna)]);
    header.font = { bold: true };
    top.forEach((linha, idx) => {
      const row = ws.addRow([idx + 1, ...linha.dimensoes, ...estrutura.colunasMetrica.map(col => linha.valores[col] ?? 0)]);
      estrutura.colunasMetrica.forEach((col, idx2) => {
        row.getCell(2 + estrutura.colunasDimensao.length + idx2).numFmt = _numFmt(estrutura.tiposMetrica[col]);
      });
    });
  }

  ws.columns.forEach(col => { col.width = 22; });
}

/**
 * Gera um Buffer .xlsx a partir da estrutura tabular.
 * @param {Object} estrutura - retorno de prepararEstruturaTabular
 * @param {Object} [opts]
 * @param {string} [opts.pergunta]
 * @param {string} [opts.empresaNome]
 * @returns {Promise<Buffer>}
 */
async function gerarExcel(estrutura, opts = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IA Command';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Dados', {
    pageSetup: { orientation: estrutura.colunasDimensao.length + estrutura.colunasMetrica.length > 6 ? 'landscape' : 'portrait' },
  });

  worksheet.addRow(_montarCabecalho(estrutura));
  _escreverLinhasDetalhe(worksheet, estrutura);
  _escreverSubtotais(worksheet, estrutura);
  _escreverTotalGeral(worksheet, estrutura);
  _formatarCabecalhoEAjustes(worksheet, estrutura);

  const precisaResumo = estrutura.multiEmpresa || estrutura.linhas.length > 20;
  if (precisaResumo) _adicionarAbaResumo(workbook, estrutura, opts);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { gerarExcel, _formatarValorMetrica };
