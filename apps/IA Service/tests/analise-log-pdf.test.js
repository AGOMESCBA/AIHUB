'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pdfParse = require('pdf-parse');
const { gerarPdf } = require('../backend/services/analise-log-pdf-service');

test('PDF contém somente identificação, erros e soluções, preserva numeração e oculta credenciais', async () => {
  const buffer = await gerarPdf({ nome: 'error.log.txt', numero: '123', cobertura: 'MÉTRICAS INDEVIDAS', erros: [
    { id: 'erro-1', titulo: 'Erro ao cancelar workflow', solucoes: 'Confirmar o identificador.\nVerificar token=segredo123 no ambiente.', evidencia: 'EVIDÊNCIA INDEVIDA' },
    { id: 'erro-30', titulo: 'Falha de conexão', solucoes: '' },
  ] });
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const pdf = await pdfParse(Uint8Array.from(buffer), { version: 'v2.0.550' });
  assert.equal(pdf.numpages, 1);
  for (const texto of ['error.log.txt', 'Chamado 123', 'Erro #1', 'Erro #30', 'Confirmar o identificador.', 'Ainda não há possíveis soluções', 'Página 1 de 1']) assert.ok(pdf.text.includes(texto), texto);
  assert.doesNotMatch(pdf.text, /segredo123|MÉTRICAS INDEVIDAS|EVIDÊNCIA INDEVIDA/);
});

test('PDF pagina textos extensos sem perder erros, ações ou ultrapassar as margens', async () => {
  const erros = Array.from({ length: 30 }, (_, i) => ({ id: `erro-${i + 1}`, titulo: `FALHA_${i + 1}: ${'ROTINA_'.repeat(35)}`, solucoes: `Verificar configuração ${i + 1}.\n${'Confirmar ambiente e executar a validação funcional. '.repeat(18)}\nFINAL_${i + 1}` }));
  const buffer = await gerarPdf({ nome: 'grande.log', erros });
  const paginas = [];
  const pdf = await pdfParse(Uint8Array.from(buffer), { version: 'v2.0.550', pagerender: async page => {
    const content = await page.getTextContent();
    paginas.push(content.items);
    return content.items.map(item => item.str).join('\n');
  } });
  assert.ok(pdf.numpages > 2);
  for (let i = 1; i <= 30; i++) {
    assert.equal((pdf.text.match(new RegExp(`Erro #${i}(?!\\d)`, 'g')) || []).length, 1);
    assert.ok(pdf.text.includes(`FINAL_${i}`));
  }
  paginas.forEach((itens, i) => {
    assert.ok(itens.some(item => item.str === `Página ${i + 1} de ${pdf.numpages}`));
    assert.ok(itens.some(item => item.str.startsWith('Erro #') || item.str.includes('Confirmar ambiente')), 'não cria páginas vazias');
    for (const item of itens) {
      assert.ok(item.transform[4] >= 47 && item.transform[4] + item.width <= 548.4, `largura: ${item.str}`);
      assert.ok(item.transform[5] >= 32 && item.transform[5] <= 795, `altura: ${item.str}`);
    }
  });
});

test('PDF rejeita conteúdo inválido e excessivo antes de gerar documento', async () => {
  const erro = { id: 'erro-1', titulo: 'Erro', solucoes: 'Verificar.' };
  for (const dados of [null, {}, { nome: 'a.log', erros: [erro, erro] }, { nome: 'a.log', erros: [{ ...erro, id: 'erro-101' }] }, { nome: 'a.log', erros: [{ ...erro, solucoes: 'a'.repeat(4001) }] }, { nome: 'a.log', erros: [erro], extra: 'a'.repeat(1024 * 1024) }]) {
    await assert.rejects(gerarPdf(dados), { status: 400 });
  }
});
