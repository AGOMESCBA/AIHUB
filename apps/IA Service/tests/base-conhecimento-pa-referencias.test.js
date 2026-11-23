'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../backend/repositories/chamado-repository');
const auditoria = require('../backend/repositories/investigacao-execucao-repository');
const jade = require('../backend/services/jade-pa-service');

test('PA só autoriza referência selecionada, com identidade e trechos ainda válidos', () => {
  const originais = { identidade: repo.identidadeConfirmadaPa, obter: repo.obterCandidatosPorIds, numero: repo.getChamadoPorNumero, auditoria: auditoria.listarPorAtendimento };
  const atual = { id: 'atual', numero: '037000', descricao: 'Falha específica A12 no faturamento' };
  const candidato = { chamado: { id: 'c1', numero: '036000', descricao: 'Falha específica A12 no faturamento' }, posicionamentos: [{ id: 'p1', resultado: 'Após ajuste o faturamento funcionou' }] };
  const aval = { relevancia: 'mesmo_problema', trechoAtual: 'Falha específica A12', origemAtual: { tipo: 'chamado', campo: 'descricao' }, trechoCandidato: 'Falha específica A12', origemCandidato: { tipo: 'chamado', campo: 'descricao' }, trechoResultado: 'Após ajuste o faturamento funcionou', origemResultado: { tipo: 'posicionamento', id: 'p1', campo: 'resultado' } };
  try {
    repo.identidadeConfirmadaPa = () => true;
    repo.obterCandidatosPorIds = (_e, _id, _ids, opts) => { assert.equal(opts.escopo, 'cliente_pa'); return [candidato]; };
    repo.getChamadoPorNumero = () => candidato.chamado;
    auditoria.listarPorAtendimento = () => [{ mensagemId: 'msg', manifesto: { pesquisaExterna: { baseConhecimento: { selecionados: [{ chamadoId: 'c1', numero: '036000', avaliacaoIa: aval }] } } } }];
    assert.deepEqual(jade.referenciasDaAnalise(1, 'at', 'msg', atual).map(x => x.numero), ['036000']);
    assert.deepEqual(jade.referenciasDaAnalise(1, 'at', 'outra', atual), []);
    candidato.chamado.descricao = 'Conteúdo alterado';
    assert.deepEqual(jade.referenciasDaAnalise(1, 'at', 'msg', atual), []);
    candidato.chamado.descricao = 'Falha específica A12 no faturamento';
    repo.identidadeConfirmadaPa = () => false;
    assert.deepEqual(jade.referenciasDaAnalise(1, 'at', 'msg', atual), []);
    repo.identidadeConfirmadaPa = () => true;
    repo.obterCandidatosPorIds = () => [];
    assert.deepEqual(jade.referenciasDaAnalise(1, 'at', 'msg', atual), []);
  } finally { repo.identidadeConfirmadaPa = originais.identidade; repo.obterCandidatosPorIds = originais.obter; repo.getChamadoPorNumero = originais.numero; auditoria.listarPorAtendimento = originais.auditoria; }
});

test('texto de PA recusa números não autorizados mesmo com referência permitida', () => {
  assert.deepEqual(jade.verificarVazamento('Veja o chamado 036000.', '037000', [], [], ['036000']), []);
  assert.ok(jade.verificarVazamento('Veja o chamado 036001.', '037000', [], [], ['036000']).length);
  assert.ok(jade.verificarVazamento('Consulte o protocolo 1234.', '037000', [], [], ['036000']).length);
  assert.ok(jade.verificarVazamento('Consulte #1234.', '037000', [], [], ['036000']).length);
});

test('formatos alternativos de referência são recusados sem afetar datas, rotinas e links autorizados', () => {
  const textos = [
    'Confira o chamado 036900.', 'Confira o chamado 036.900.', 'Veja 0 3 6 9 0 0.',
    'Veja o ticket ０３６９００.', 'Veja o protocolo ٠٣٦٩٠٠.', 'Veja o chamado 03\u200b6900.',
    'Veja o chamado trinta e seis mil e novecentos.', 'Conforme outro chamado, realize a verificação.',
    'Consulte o atendimento nº 36900.', 'Consulte #36900.',
  ];
  for (const texto of textos) assert.ok(jade.verificarVazamento(texto, '037000').length, texto);
  assert.deepEqual(jade.verificarVazamento('No dia 06/01/2026 verifique MATA110 e o passo 2.', '037000'), []);
  const url = 'https://exemplo.test/artigos/036900';
  assert.deepEqual(jade.verificarVazamento(`Consulte ${url}.`, '037000', [], [url]), []);
});

test('simulação: IA escolhe marcador e servidor insere somente referência da lista', () => {
  const refs = [{ numero: '036900' }];
  const texto = 'O histórico [[REF_1]] pode ser relacionado; verifique a configuração e teste o resultado.';
  assert.equal(jade.simularMontagemReferencias(texto, '037000', refs), 'O histórico chamado 036900 pode ser relacionado; verifique a configuração e teste o resultado.');
  for (const entrada of ['Consulte [[REF_2]].', 'Consulte [[REF_01]].', 'Consulte [[REF_X]].', 'Consulte chamado 036901 e [[REF_1]].', 'Consulte 0 3 6 9 0 1 e [[REF_1]].']) {
    assert.throws(() => jade.simularMontagemReferencias(entrada, '037000', refs), undefined, entrada);
  }
  assert.throws(() => jade.simularMontagemReferencias(texto, '037000', [{ numero: '036900' }, { numero: '036900' }]));
  assert.throws(() => jade.simularMontagemReferencias(texto, '037000', []));
});

test('simulação acrescenta somente números selecionados em bloco separado', () => {
  const refs = [{ numero: '036900' }, { numero: '036901' }];
  const orientacao = 'Verifique a configuração em homologação e repita o teste.';
  const frase = 'Encontramos outros chamados seus que podem tratar de situações semelhantes. Se quiser, você pode consultá-los pelos números abaixo:';
  assert.equal(jade.simularReferenciasNoRodape(orientacao, '037000', refs, [1]), `${orientacao}\n\n${frase}\n\n036901`);
  assert.equal(jade.simularReferenciasNoRodape(orientacao, '037000', refs, [0, 1]), `${orientacao}\n\n${frase}\n\n036900\n\n036901`);
  assert.equal(jade.simularReferenciasNoRodape(orientacao, '037000', refs, []), orientacao);
  assert.throws(() => jade.simularReferenciasNoRodape(orientacao, '037000', refs, [2]));
  assert.throws(() => jade.simularReferenciasNoRodape(orientacao, '037000', refs, [0, 0]));
  assert.throws(() => jade.simularReferenciasNoRodape('Consulte o chamado 036999.', '037000', refs, [0]));
});
