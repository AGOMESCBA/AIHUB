'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avaliar } = require('../backend/services/base-conhecimento-economia-service');
function casoRevisado() {
  const evid = { confirmado: true, localizador: 'registro:1', localizadorAtual: 'atual:1', localizadorAnterior: 'historico:1' };
  return { chamado: { id: 'c1', numero: '010001' }, comprovacaoRevisada: { revisao: { confirmada: true, revisorId: 'consultor', registroId: 'revisao:1' }, mesmoProblema: { ...evid }, compatibilidade: { ...evid }, procedimento: { ...evid }, funcionamento: { ...evid }, semLacunas: { ...evid, contradicoes: [], lacunas: [], diferencas: [] }, autorizacao: { ...evid } } };
}
test('somente evidências completas e revisão rastreável indicam oportunidades independentes', () => {
  const r = avaliar({ candidatos: [casoRevisado()] });
  assert.equal(r.modo, 'observacao');
  assert.equal(r.pesquisaExterna.poderiaDispensar, true);
  assert.equal(r.analiseIa.poderiaDispensar, true);
  assert.equal(r.cobertura.funcionamento.demonstrados, 1);
  assert.equal(r.metricas.economiaReal, 0);
  assert.equal(r.metricas.potencial.tokens, null);
  assert.equal(r.verificacoes[0].criterios.mesmoProblema.localizadorAtual, 'atual:1');
  const pa = avaliar({ candidatos: [casoRevisado()], escopo: 'cliente_pa', identidadePa: true, pesquisaObrigatoriaPa: true });
  assert.equal(pa.pesquisaExterna.poderiaDispensar, false);
  assert.equal(pa.analiseIa.poderiaDispensar, true);
});
test('pré-avaliação da IA, score e solução aplicada nunca bastam', () => {
  const r = avaliar({ candidatos: [{ chamado: { id: 'x' }, score: 99, temSolucaoAplicada: true, avaliacaoIa: { relevancia: 'mesmo_problema', trechoProcedimento: 'ajuste', trechoResultado: 'funcionou' } }] });
  assert.equal(r.pesquisaExterna.poderiaDispensar, false);
  assert.equal(r.analiseIa.poderiaDispensar, false);
  assert.match(r.analiseIa.motivos.join(' '), /Revisão rastreável/);
});
test('ausência, contradição, escopo inválido, pedido e indisponibilidade mantêm IA necessária', () => {
  const falta = casoRevisado(); delete falta.comprovacaoRevisada.funcionamento;
  const contradicao = casoRevisado(); contradicao.comprovacaoRevisada.semLacunas.contradicoes.push('versões incompatíveis');
  const proibido = casoRevisado(); proibido.comprovacaoRevisada.autorizacao.confirmado = false;
  const semOrigem = casoRevisado(); delete semOrigem.comprovacaoRevisada.mesmoProblema.localizadorAnterior;
  for (const entrada of [
    { candidatos: [falta] }, { candidatos: [contradicao] }, { candidatos: [proibido] }, { candidatos: [semOrigem] },
    { candidatos: [casoRevisado()], escopo: 'cliente_pa', identidadePa: false },
    { candidatos: [casoRevisado()], baseDisponivel: false },
    { candidatos: [casoRevisado()], provedorDisponivel: false },
    { candidatos: [casoRevisado()], pedidoExplicito: true },
  ]) {
    const r = avaliar(entrada);
    assert.equal(r.pesquisaExterna.poderiaDispensar, false);
    assert.equal(r.analiseIa.poderiaDispensar, false);
    assert.ok(r.analiseIa.motivos.length);
  }
});
