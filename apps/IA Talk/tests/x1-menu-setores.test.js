'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarMenu, interpretarResposta, proximaAcao } = require('../backend/lib/menu-setores');

const setores = [
  { id: 's', nome: 'Suporte', opcao_texto: 'Suporte Protheus', ordem: 1 },
  { id: 'f', nome: 'Financeiro', opcao_texto: 'Suporte Financeiro', ordem: 2 },
  { id: 'c', nome: 'Cobrança', ordem: 3 },
];
const { opcoes } = montarMenu({ setores });

test('interpreta formatos numéricos e rejeita números fora da faixa', () => {
  for (const resposta of ['1', ' 1 ', '1.', 'opção 1', '1️⃣', '1⃣']) {
    assert.deepEqual(interpretarResposta(resposta, opcoes), { setor_id: 's' }, resposta);
  }
  for (const resposta of ['4', '10', '999999999999999999999999']) {
    assert.deepEqual(interpretarResposta(resposta, opcoes), { invalida: true });
  }
});

test('interpreta rótulos e palavras únicas sem distinguir acentos ou maiúsculas', () => {
  for (const resposta of ['Cobrança', 'COBRANCA', 'cobrança']) {
    assert.deepEqual(interpretarResposta(resposta, opcoes), { setor_id: 'c' });
  }
  assert.deepEqual(interpretarResposta('protheus suporte', opcoes), { setor_id: 's' });
  assert.deepEqual(interpretarResposta('protheus', opcoes), { setor_id: 's' });
  assert.deepEqual(interpretarResposta('suporte', opcoes), { invalida: true });
  assert.deepEqual(interpretarResposta('proth', opcoes), { invalida: true });
});

test('rejeita ambiguidades, texto vazio e emoji', () => {
  for (const resposta of ['', '   ', '😀', 'protheus 😀', 'não sei']) {
    assert.deepEqual(interpretarResposta(resposta, opcoes), { invalida: true });
  }
  const duplicadas = [{ numero: 1, setor_id: 'a', rotulo: 'Suporte' }, { numero: 2, setor_id: 'b', rotulo: 'SUPORTE' }];
  assert.deepEqual(interpretarResposta('suporte', duplicadas), { invalida: true });
});

test('reconhece pedidos de ajuda', () => {
  for (const resposta of ['0', ' MENU ', 'Voltar']) {
    assert.deepEqual(interpretarResposta(resposta, opcoes), { ajuda: true });
  }
});

test('ordena por ordem e nome sem alterar a entrada', () => {
  const entrada = [{ id: 1, nome: 'Zebra', ordem: 2 }, { id: 2, nome: 'Árvore', ordem: 1 }, { id: 3, nome: 'Abacate', ordem: 1 }];
  const menu = montarMenu({ saudacao: 'Bem-vindo!', setores: entrada });
  assert.deepEqual(menu.opcoes.map((opcao) => opcao.setor_id), [3, 2, 1]);
  assert.deepEqual(entrada.map((setor) => setor.id), [1, 2, 3]);
  assert.equal(menu.texto, 'Bem-vindo!\n1 – Abacate\n2 – Árvore\n3 – Zebra\nResponda com o número da opção.');
});

test('monta menus com um e dez setores', () => {
  const lista = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, nome: `Setor ${i + 1}`, ordem: i }));
  const um = montarMenu({ saudacao: '  ', setores: lista.slice(0, 1) });
  assert.match(um.texto, /^Olá! Escolha um setor:\n1 – Setor 1\n/);
  assert.equal(um.opcoes.length, 1);
  const dez = montarMenu({ setores: lista });
  assert.equal(dez.opcoes.length, 10);
  assert.match(dez.texto, /10 – Setor 10/);
  assert.deepEqual(interpretarResposta('10', dez.opcoes), { setor_id: 10 });
});

test('decide a próxima ação no limite de tentativas', () => {
  assert.equal(proximaAcao({ tentativas: 0 }), 'repetir');
  assert.equal(proximaAcao({ tentativas: 1 }), 'repetir');
  assert.equal(proximaAcao({ tentativas: 2 }), 'setor_padrao');
  assert.equal(proximaAcao({ tentativas: 3, maxTentativas: 3 }), 'setor_padrao');
});

test('rejeita conflito entre número e rótulo numérico de outro setor', () => {
  const conflitos = [{ numero: 1, setor_id: 'a', rotulo: 'Primeiro' }, { numero: 2, setor_id: 'b', rotulo: '1' }];
  assert.deepEqual(interpretarResposta('1', conflitos), { invalida: true });
  assert.deepEqual(interpretarResposta('2', conflitos), { setor_id: 'b' });
});

test('usa o nome quando o texto da opção contém apenas espaços', () => {
  const menu = montarMenu({ setores: [{ id: 1, nome: 'Suporte', opcao_texto: '   ', ordem: 1 }] });
  assert.equal(menu.opcoes[0].rotulo, 'Suporte');
  assert.match(menu.texto, /1 – Suporte/);
});
test('descarta cortesias sem adivinhar opções ou descartar números', () => {
  const menu = montarMenu({ setores: [
    { id: 's', nome: 'Suporte', ordem: 1 },
    { id: 'f', nome: 'Financeiro', ordem: 2 },
    { id: 'c', nome: 'Comercial', ordem: 3 },
  ] });
  for (const resposta of ['quero falar com o suporte', 'Olá, gostaria de falar com o setor Suporte, por favor']) {
    assert.deepEqual(interpretarResposta(resposta, menu.opcoes), { setor_id: 's' });
  }
  assert.deepEqual(interpretarResposta('bom dia, financeiro por favor', menu.opcoes), { setor_id: 'f' });
  assert.deepEqual(interpretarResposta('quero o 2', menu.opcoes), { setor_id: 'f' });
  for (const resposta of ['quero falar com o setor', 'quero o 2 e o 3', 'bom dia, por favor', 'quero o 9', 'quero suporte 😀']) {
    assert.deepEqual(interpretarResposta(resposta, menu.opcoes), { invalida: true }, resposta);
  }
  assert.deepEqual(interpretarResposta('quero falar com o suporte', opcoes), { invalida: true });
});