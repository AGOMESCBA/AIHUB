// Fase 1 (2026-11-12): anonimizador das conversas reais do replay, com
// dicionário fictício. Cobre as duas falhas achadas na 1ª amostra: palavras
// comuns trocadas por [NOME] e o substituto reprocessado ("Pessoa").
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { criarAnonimizador, gerarAmostra } = require('./replay/anonimizar-conversas');

const DIC = {
  pessoas: ['Joana Campos Pessoa', 'SUPORTE COM ACESSO'],
  clientes: ['Agropecuária Boa Vista Ltda', 'FAZENDA ESPERANÇA'],
  emails: ['joana@cliente.com.br'],
  telefones: ['(66) 99876-5432'],
  cnpjs: ['12.345.678/0001-90'],
  chamados: ['036580'],
  palavrasComuns: new Set(['campos', 'acesso', 'suporte']),
  termosExtra: ['Sinop'],
};

test('troca dados identificáveis e preserva o texto técnico', () => {
  const anon = criarAnonimizador(DIC);
  const original = [
    'Bom dia, Joana Campos Pessoa. Falei com a Joana e com o Mauro sobre o chamado 036580.',
    'Os campos C5_CLIENTE e C5_LOJACLI estão vazios; com acesso de suporte não aparece.',
    'Contato: joana@cliente.com.br, (66) 99876-5432, CNPJ 12.345.678/0001-90, servidor 10.0.12.55, unidade de Sinop.',
    'Cliente Agropecuária Boa Vista Ltda (Boa Vista) e FAZENDA ESPERANÇA.',
    'THREAD ERROR ([8812], usr_fat, PCFAT03) senha=abc123',
  ].join('\n');
  const s = anon.anonimizar(original);

  for (const vazado of ['Joana', 'Mauro', 'Pessoa', 'joana@', '99876', '12.345.678', '10.0.12.55', 'Sinop', 'Agropecu', 'ESPERAN', 'usr_fat', 'PCFAT03', 'abc123', '036580']) {
    assert.ok(!s.includes(vazado), `vazou "${vazado}": ${s}`);
  }
  // Palavras comuns do texto técnico continuam intactas.
  for (const preservado of ['Os campos C5_CLIENTE e C5_LOJACLI', 'com acesso de suporte não aparece', 'Bom dia,']) {
    assert.ok(s.includes(preservado), `alterou texto técnico "${preservado}": ${s}`);
  }
  // Substitutos estáveis e nunca reprocessados.
  assert.match(s, /⟦PESSOA-001⟧/);
  assert.ok(!s.includes('[NOME]-'), 'substituto reprocessado');
  assert.deepEqual(anon.verificarResiduos(s), { emails: 0, ips: 0, cpfCnpj: 0, nomesCompletosDoCadastro: 0, primeirosNomesComuns: 0, termosExtra: 0 });
});

test('amostra com dados reais não pode ser gravada dentro do repositório', () => {
  assert.throws(() => gerarAmostra({ saida: path.join(__dirname, 'replay', 'saida-proibida') }), /não pode ser gravada dentro do repositório/);
});
