'use strict';

// Gera um PDF formatado a partir da estrutura tabular intermediaria produzida
// por whatsapp-attachment-builder.js. pdfkit nao tem grid nativo — a tabela e
// desenhada manualmente linha a linha, com cabecalho redesenhado a cada pagina.

const PDFDocument = require('pdfkit');

const { _formatarValorMetrica } = require('../erp/core/response-formatter');

const MARGEM = 36;
const ALTURA_LINHA = 20;
const COR_HEADER_BG = '#1f2937';
const COR_HEADER_TEXTO = '#ffffff';
const COR_SUBTOTAL_BG = '#eff2ff';
const COR_TOTAL_BG = '#dce4ff';
const COR_LINHA_ALT = '#f8fafc';

function _labelColuna(col) {
  return String(col || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function _formatarValor(col, valor) {
  return _formatarValorMetrica(col, valor);
}

function _calcularLargurasColunas(estrutura, larguraUtil) {
  const nDim = estrutura.colunasDimensao.length;
  const nMet = estrutura.colunasMetrica.length;
  const total = nDim + nMet;
  if (!total) return [];
  // Dimensões recebem peso 2, métricas peso 1 (métricas costumam ser mais curtas: números)
  const pesoTotal = nDim * 2 + nMet * 1;
  const unidade = larguraUtil / pesoTotal;
  return [
    ...new Array(nDim).fill(unidade * 2),
    ...new Array(nMet).fill(unidade * 1),
  ];
}

function _desenharCabecalho(doc, estrutura, largurasColunas, x0, y) {
  const cabecalho = [...estrutura.colunasDimensao, ...estrutura.colunasMetrica.map(_labelColuna)];
  const larguraTotal = largurasColunas.reduce((a, b) => a + b, 0);
  doc.rect(x0, y, larguraTotal, ALTURA_LINHA).fill(COR_HEADER_BG);
  doc.fillColor(COR_HEADER_TEXTO).fontSize(9).font('Helvetica-Bold');
  let x = x0;
  cabecalho.forEach((texto, idx) => {
    doc.text(String(texto), x + 4, y + 5, { width: largurasColunas[idx] - 8, ellipsis: true });
    x += largurasColunas[idx];
  });
  doc.fillColor('#000000').font('Helvetica');
  return y + ALTURA_LINHA;
}

function _desenharLinha(doc, valores, largurasColunas, x0, y, opts = {}) {
  const larguraTotal = largurasColunas.reduce((a, b) => a + b, 0);
  if (opts.bg) doc.rect(x0, y, larguraTotal, ALTURA_LINHA).fill(opts.bg);
  doc.fillColor('#000000').fontSize(9).font(opts.negrito ? 'Helvetica-Bold' : 'Helvetica');
  let x = x0;
  valores.forEach((texto, idx) => {
    doc.text(String(texto ?? ''), x + 4, y + 5, { width: largurasColunas[idx] - 8, ellipsis: true });
    x += largurasColunas[idx];
  });
  return y + ALTURA_LINHA;
}

/**
 * Gera um Buffer .pdf a partir da estrutura tabular.
 * @param {Object} estrutura - retorno de prepararEstruturaTabular
 * @param {Object} [opts]
 * @param {string} [opts.pergunta]
 * @param {string} [opts.empresaNome]
 * @returns {Promise<Buffer>}
 */
function gerarPdf(estrutura, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const nColunas = estrutura.colunasDimensao.length + estrutura.colunasMetrica.length;
      const paisagem = nColunas > 5;
      const doc = new PDFDocument({
        margin: MARGEM,
        size: 'A4',
        layout: paisagem ? 'landscape' : 'portrait',
        bufferPages: true,
      });

      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const larguraUtil = doc.page.width - MARGEM * 2;
      const largurasColunas = _calcularLargurasColunas(estrutura, larguraUtil);
      const x0 = MARGEM;
      const yLimite = doc.page.height - MARGEM;

      let y = MARGEM;

      function _desenharTituloPagina() {
        doc.fillColor('#000000').fontSize(13).font('Helvetica-Bold')
          .text(estrutura.tituloConsulta || opts.pergunta || 'Consulta', x0, y);
        y += 18;
        doc.fontSize(9).font('Helvetica').fillColor('#555555');
        const linhasInfo = [];
        if (estrutura.periodoLabel) linhasInfo.push(`Período: ${estrutura.periodoLabel}`);
        if (opts.empresaNome) linhasInfo.push(`Empresa: ${opts.empresaNome}`);
        linhasInfo.push(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);
        doc.text(linhasInfo.join('   |   '), x0, y);
        y += 20;
        doc.fillColor('#000000');
        y = _desenharCabecalho(doc, estrutura, largurasColunas, x0, y);
      }

      _desenharTituloPagina();

      function _garantirEspaco() {
        if (y + ALTURA_LINHA > yLimite) {
          doc.addPage();
          y = MARGEM;
          y = _desenharCabecalho(doc, estrutura, largurasColunas, x0, y);
        }
      }

      const { colunasMetrica, colunasDimensao } = estrutura;
      let contadorLinha = 0;

      if (estrutura.subtotais.length && colunasDimensao.length) {
        // Agrupado: percorre subtotais na ordem em que aparecem nas linhas, imprimindo
        // o detalhe de cada grupo seguido do seu subtotal — evita cortar um grupo ao
        // meio de forma confusa (verifica espaço antes de cada grupo inteiro quando possível).
        const gruposOrdem = [];
        const vistos = new Set();
        for (const linha of estrutura.linhas) {
          const chave = linha.dimensoes.join(' » ');
          if (!vistos.has(chave)) { vistos.add(chave); gruposOrdem.push(chave); }
        }
        for (const chaveGrupo of gruposOrdem) {
          const linhasDoGrupo = estrutura.linhas.filter(l => l.dimensoes.join(' » ') === chaveGrupo);
          for (const linha of linhasDoGrupo) {
            _garantirEspaco();
            const valores = [...linha.dimensoes, ...colunasMetrica.map(col => _formatarValor(col, linha.valores[col]))];
            y = _desenharLinha(doc, valores, largurasColunas, x0, y, { bg: (contadorLinha++ % 2) ? COR_LINHA_ALT : null });
          }
          const sub = estrutura.subtotais.find(s => s.chaveGrupo === chaveGrupo);
          if (sub) {
            _garantirEspaco();
            const rotulo = [`Subtotal — ${chaveGrupo}`, ...new Array(Math.max(colunasDimensao.length - 1, 0)).fill('')];
            const valoresSub = colunasMetrica.map(col => _formatarValor(col, sub.valores[col]));
            y = _desenharLinha(doc, [...rotulo, ...valoresSub], largurasColunas, x0, y, { bg: COR_SUBTOTAL_BG, negrito: true });
          }
        }
      } else {
        for (const linha of estrutura.linhas) {
          _garantirEspaco();
          const valores = [...linha.dimensoes, ...colunasMetrica.map(col => _formatarValor(col, linha.valores[col]))];
          y = _desenharLinha(doc, valores, largurasColunas, x0, y, { bg: (contadorLinha++ % 2) ? COR_LINHA_ALT : null });
        }
      }

      _garantirEspaco();
      const rotuloTotal = ['Total Geral', ...new Array(Math.max(colunasDimensao.length - 1, 0)).fill('')];
      const valoresTotal = colunasMetrica.map(col => _formatarValor(col, estrutura.totalGeral[col]));
      y = _desenharLinha(doc, [...rotuloTotal, ...valoresTotal], largurasColunas, x0, y, { bg: COR_TOTAL_BG, negrito: true });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { gerarPdf };
