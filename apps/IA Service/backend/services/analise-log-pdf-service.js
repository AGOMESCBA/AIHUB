'use strict';

const PDFDocument = require('pdfkit');
const { redigirTexto } = require('./redaction-service');

function invalido() { return Object.assign(new Error('Dados inválidos para o relatório de erros.'), { status: 400 }); }
function limpar(texto) {
  return redigirTexto(texto).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}
function validar(dados) {
  if (!dados || typeof dados !== 'object' || Buffer.byteLength(JSON.stringify(dados)) > 1024 * 1024 ||
    typeof dados.nome !== 'string' || !dados.nome.trim() || dados.nome.length > 255 ||
    (dados.numero != null && (typeof dados.numero !== 'string' || dados.numero.length > 100)) ||
    !Array.isArray(dados.erros) || dados.erros.length > 100) throw invalido();
  const ids = new Set();
  const erros = dados.erros.map(e => {
    if (!e || typeof e.id !== 'string' || !/^erro-(?:[1-9]\d?|100)$/.test(e.id) || ids.has(e.id) ||
      typeof e.titulo !== 'string' || !e.titulo.trim() || e.titulo.length > 500 ||
      (e.solucoes != null && (typeof e.solucoes !== 'string' || e.solucoes.length > 4000))) throw invalido();
    ids.add(e.id);
    return { id: e.id, titulo: limpar(e.titulo), solucoes: e.solucoes ? limpar(e.solucoes) : '' };
  });
  return { nome: limpar(dados.nome), numero: dados.numero ? limpar(dados.numero) : '', erros };
}

async function gerarPdf(dados) {
  const relatorio = validar(dados);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'Erros e possíveis soluções', Author: 'IA Service' } });
    const partes = [];
    doc.on('data', parte => partes.push(parte));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(partes)));
    try {
      const margem = 48;
      const largura = doc.page.width - margem * 2;
      const limite = doc.page.height - 78;
      let y = margem;
      let inicioPagina;

      function quebrar(texto, tamanho, fonte, indentacao = 0) {
        doc.font(fonte).fontSize(tamanho);
        const linhas = [];
        for (const paragrafo of texto.split('\n')) {
          let resto = paragrafo.trim();
          if (!resto) { linhas.push(''); continue; }
          while (resto) {
            if (doc.widthOfString(resto) <= largura - indentacao) { linhas.push(resto); break; }
            let baixo = 1; let alto = resto.length;
            while (baixo < alto) {
              const meio = Math.ceil((baixo + alto) / 2);
              if (doc.widthOfString(resto.slice(0, meio)) <= largura - indentacao) baixo = meio;
              else alto = meio - 1;
            }
            const espaco = resto.lastIndexOf(' ', baixo);
            const corte = espaco > 0 ? espaco : baixo;
            linhas.push(resto.slice(0, corte).trimEnd()); resto = resto.slice(corte).trimStart();
          }
        }
        return linhas;
      }
      function linha(texto, tamanho, fonte, cor, indentacao = 0) {
        doc.font(fonte).fontSize(tamanho).fillColor(cor).text(texto, margem + indentacao, y, { lineBreak: false });
        y += tamanho * 1.4;
      }
      function cabecalho() {
        y = margem;
        linha('Erros e possíveis soluções', 20, 'Helvetica-Bold', '#16283b');
        y += 7;
        for (const texto of quebrar(relatorio.nome, 9, 'Helvetica')) linha(texto, 9, 'Helvetica', '#64748b');
        if (relatorio.numero) for (const texto of quebrar(`Chamado ${relatorio.numero}`, 9, 'Helvetica')) linha(texto, 9, 'Helvetica', '#64748b');
        y += 10;
        doc.strokeColor('#dbe3eb').lineWidth(0.7).moveTo(margem, y).lineTo(margem + largura, y).stroke();
        y += 20; inicioPagina = y;
      }
      function espaco(altura) {
        if (y + altura > limite) { doc.addPage(); cabecalho(); }
      }
      function escrever(linhas, tamanho, fonte, cor, indentacao = 0) {
        for (const texto of linhas) { espaco(tamanho * 1.4); linha(texto, tamanho, fonte, cor, indentacao); }
      }

      cabecalho();
      if (!relatorio.erros.length) escrever(['Nenhum erro foi selecionado para este relatório.'], 11, 'Helvetica', '#334155');
      for (const erro of relatorio.erros) {
        const mensagem = quebrar(erro.titulo, 11, 'Helvetica-Bold');
        const acoes = erro.solucoes ? erro.solucoes.split(/\n+/).filter(s => s.trim()).map((s, i) => `${i + 1}. ${s.replace(/^\s*(?:[-•]|\d+[.)])\s+/, '')}`) : ['Ainda não há possíveis soluções geradas pela IA para este erro.'];
        const solucoes = quebrar(acoes.join('\n'), 10, 'Helvetica', 12);
        const altura = 18 + mensagem.length * 15.4 + 13 + 14 + solucoes.length * 14 + 24;
        espaco(altura <= limite - inicioPagina ? altura : 18 + mensagem.length * 15.4 + 55);
        linha(`Erro #${erro.id.slice(5)}`, 11, 'Helvetica-Bold', '#2563eb');
        y += 3;
        escrever(mensagem, 11, 'Helvetica-Bold', '#1e293b');
        y += 10;
        espaco(42);
        linha('Possíveis soluções', 10, 'Helvetica-Bold', '#334155');
        y += 3;
        escrever(solucoes, 10, 'Helvetica', '#334155', 12);
        y += 22;
      }
      const paginas = doc.bufferedPageRange();
      for (let i = 0; i < paginas.count; i++) {
        doc.switchToPage(i);
        // O rodapé fica fora da margem do corpo; liberar essa área evita
        // que o PDFKit crie uma página extra ao posicionar a numeração.
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Página ${i + 1} de ${paginas.count}`, margem, doc.page.height - 40, { width: largura, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (err) { reject(err); doc.destroy(); }
  });
}

module.exports = { gerarPdf };
