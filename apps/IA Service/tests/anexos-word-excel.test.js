'use strict';
// Leitura de anexos Word (.docx) e Excel (.xlsx); .zip continua fora.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { extrairConteudo } = require('../backend/services/extracao-conteudo');
const { validarAnexo } = require('../backend/services/armazenamento-anexos');

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Erro ao transmitir o evento R-2010 &amp; R-2020</w:t></w:r></w:p><w:p><w:r><w:t>Parâmetro</w:t></w:r><w:r><w:tab/><w:t>MV_TAFISCH = 1</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function xlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pedidos');
  ws.addRow(['Pedido', 'Produto', 'Saldo']);
  ws.addRow(['000123', 'Brita 01 Fina', 40]);
  ws.addRow(['000123', 'Pedra de mão', { formula: '10+5', result: 15 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('Word: texto dos parágrafos extraído, com tabulação e entidades', async () => {
  const r = await extrairConteudo({ buffer: await docx(), nomeOriginal: 'relato.docx', mimeDeclarado: MIME_DOCX });
  assert.equal(r.ehTexto, true);
  assert.equal(r.mimeReal, MIME_DOCX);
  assert.match(r.conteudoExtraido, /Erro ao transmitir o evento R-2010 & R-2020/);
  assert.match(r.conteudoExtraido, /Parâmetro\tMV_TAFISCH = 1/);
});

test('Excel: linhas de cada planilha extraídas, inclusive resultado de fórmula', async () => {
  const r = await extrairConteudo({ buffer: await xlsx(), nomeOriginal: 'saldos.xlsx', mimeDeclarado: 'application/octet-stream' });
  assert.equal(r.ehTexto, true);
  assert.match(r.conteudoExtraido, /## Planilha: Pedidos/);
  assert.match(r.conteudoExtraido, /000123 \| Brita 01 Fina \| 40/);
  assert.match(r.conteudoExtraido, /000123 \| Pedra de mão \| 15/);
});

test('arquivo corrompido com extensão .docx não quebra e não vira texto', async () => {
  const falso = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('lixo')]);
  const r = await extrairConteudo({ buffer: falso, nomeOriginal: 'x.docx', mimeDeclarado: MIME_DOCX });
  assert.equal(r.ehTexto, false);
  assert.equal(r.conteudoExtraido, null);
});

test('validação: Word e Excel aceitos; zip continua recusado', () => {
  assert.equal(validarAnexo({ nomeOriginal: 'a.docx', mimeType: MIME_DOCX, tamanho: 10, conteudo: Buffer.from('x'), aceitarFontesTextuais: true }).ok, true);
  assert.equal(validarAnexo({ nomeOriginal: 'a.xlsx', mimeType: MIME_XLSX, tamanho: 10, conteudo: Buffer.from('x'), aceitarFontesTextuais: true }).ok, true);
  assert.equal(validarAnexo({ nomeOriginal: 'a.zip', mimeType: 'application/zip', tamanho: 10, conteudo: Buffer.from('x'), aceitarFontesTextuais: true }).ok, false);
});
