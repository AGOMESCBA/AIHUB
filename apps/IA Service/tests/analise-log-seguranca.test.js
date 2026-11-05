'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redigirTexto } = require('../backend/services/redaction-service');
const { analisarBuffer } = require('../backend/services/analise-log-service');
const { gerarPdf } = require('../backend/services/analise-log-pdf-service');
const pdfParse = require('pdf-parse');
const segredo = 'CREDENCIAL_SINTETICA_TESTE';
const amostras = [
  `{"password":"${segredo}"}`, `{"access_token": "${segredo}"}`, `{'client_secret':'${segredo}'}`,
  `https://usuario:${segredo}@exemplo.invalid/log?access_token=${segredo}&pagina=2`,
  `Authorization: Basic ${segredo}`, `{"Authorization":"Bearer ${segredo}"}`,
  `X-Api-Key: ${segredo}`, `Cookie: sessao=${segredo}`, `{"cookie":"sessao=${segredo}"}`,
  `https://${segredo}@exemplo.invalid/path?%61ccess_token=${segredo}`, `{"private_key":"${segredo} com espaços"}`,
];
test('credenciais sintéticas em JSON, URLs e cabeçalhos são ocultadas sem apagar dados técnicos', () => {
  for (const texto of amostras) {
    const seguro = redigirTexto(texto);
    assert.equal(seguro.includes(segredo), false);
    assert.equal(redigirTexto(seguro), seguro, 'reaplicar o filtro no histórico não altera o texto já protegido');
  }
  assert.match(redigirTexto(amostras[3]), /pagina=2/);
  assert.match(redigirTexto('ERROR: campo CTEST on U_TESTE(TESTE.PRW) line 9'), /CTEST.*U_TESTE/);
});
test('mascara antes do prompt, no resultado e no PDF sem chamar provedor externo', async () => {
  let enviado;
  const r = await analisarBuffer(1, Buffer.from(`THREAD ERROR\nERROR: ${amostras.join(' ')}\n`), 'audit.log', {
    config: { resolverKeysEOrdem: () => ({ keys: {}, cfg: {} }) },
    client: { chamarIA: async (_k, _c, _s, p) => { enviado = p; return { texto: JSON.stringify({ analises: [{ id: 'erro-1', explicacao: 'Falha.', causaProvavel: 'A confirmar.', solucoes: amostras[0], validacao: 'Conferir.', informacoesFaltantes: 'Contexto.' }] }) }; } },
  });
  assert.equal(enviado.includes(segredo), false);
  assert.equal(JSON.stringify(r).includes(segredo), false);
  const pdf = await gerarPdf({ nome: 'audit.log', erros: [{ id: 'erro-1', titulo: 'Falha', solucoes: amostras.join('\n') }] });
  assert.equal((await pdfParse(Uint8Array.from(pdf), { version: 'v2.0.550' })).text.includes(segredo), false);
});
