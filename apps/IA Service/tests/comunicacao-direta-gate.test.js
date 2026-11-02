'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const gate = require('../backend/services/quality-gate-service');
const prompt = require('../backend/services/prompt-builder');
const manifesto = { selecionados: [{ tipo: 'mensagem', status: 'ANALISADA', trecho: 'Faltam valor do pedido e fornecedor no Browser.' }], omitidos: [] };

test('pedido de evidência concreta ao analista não exige prolongar a resposta', () => {
  for (const verbo of ['Peça', 'Solicite']) {
    const texto = `A diferença pode estar na configuração das colunas; ainda precisamos confirmar. ${verbo} ao cliente prints das propriedades de exibição dos campos valor do pedido e fornecedor nos dois contextos para distinguir configuração de personalização.`;
    const r = gate.avaliarResposta({ textoResposta: texto, pergunta: 'Analise o layout.', manifesto });
    assert.equal(r.aprovado, true, JSON.stringify(r.falhas));
    assert.equal(r.deveRetry, false);
  }
});

test('pedido genérico continua sinalizado, sem solicitar segunda geração', () => {
  const r = gate.avaliarResposta({ textoResposta: 'Peça mais informações e verifique os dados.', pergunta: 'Analise o layout.', manifesto });
  assert.equal(r.aprovado, false);
  assert.ok(r.falhas.some(f => f.codigo === 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE'));
  assert.equal(r.deveRetry, false);
});

test('pré-análise e pesquisa completa recebem contexto de turno sem perder as proteções de fonte', () => {
  const pre = prompt.selecionarSystemPrompt([], { automatico: true });
  const pesquisa = prompt.selecionarSystemPrompt([{ nomeOriginal: 'rotina.prw' }], { forcarPesquisa: true });
  assert.match(pre, /pré-análise automática/);
  assert.match(pesquisa, /Pesquisar Soluções/);
  assert.ok(pesquisa.includes(prompt.INSTRUCOES_FONTE));
  assert.match(pre, /analista do IA Service, não com o cliente/);
});

test('reprovação preserva aviso visível, inclusive em falhas sem mensagem específica', () => {
  for (const codigo of ['RETRY_CONTEXT_LEAKED', 'REDUNDANT_OPERATIONAL_ESCALATION', 'NOVA_RESSALVA_SEM_MAPEAMENTO']) {
    const aviso = gate.montarObservacaoAnalista({ aprovado: false, falhas: [{ codigo }] });
    assert.match(aviso, /Pontos de atenção/);
    assert.ok(!aviso.includes(codigo), 'código interno fica na auditoria');
  }
  assert.equal(gate.montarObservacaoAnalista({ aprovado: true, falhas: [{ codigo: 'NOVA_RESSALVA_SEM_MAPEAMENTO' }] }), null);
});
