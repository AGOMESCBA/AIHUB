'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirRespostaBloqueada } = require('../backend/services/resposta-validacao-fonte-service');

test('aprovação e ausência de proposta não substituem a resposta normal', () => {
  assert.equal(construirRespostaBloqueada(), null);
  assert.equal(construirRespostaBloqueada({ avaliacoes: [{ estado: 'aprovado', codigo: 'APROVADO_PARA_PROPOSTA' }], fontes: [{}] }), null);
});

test('evidência de fluxo exibe operação, caminho e condições sem copiar recomendações rejeitadas', () => {
  const r = construirRespostaBloqueada({ avaliacoes: [{
    arquivo: 'Rotina.prw', estado: 'reprovado', codigo: 'FINALIZACAO_DESVIADA',
    motivos: ['Aplique Return .F.; esta alteração é segura.'],
    etapas: { fluxo: { evidencias: Array(2).fill({ operacao: 'fwrestarea(aarea)', linha: 104, trilha: [99,100,101,104], condicoes: { 'empty(cuser)|cuser=m->zch_user[]': true } }) } },
  }] });
  assert.match(r, /fwrestarea\(aarea\)/); assert.match(r, /99 → 100 → 101 → 104/); assert.match(r, /empty\(cuser\) = true/);
  assert.doesNotMatch(r, /Return \.F\.|esta alteração é segura/);
  assert.match(r, /Não aplique a proposta rejeitada/);
  assert.equal(r.match(/Operação\/finalização afetada/g).length, 1);
});

test('aprovação parcial não transforma o restante em orientação nem afirma ausência de todas as versões', () => {
  const r = construirRespostaBloqueada({ fontes: [{ versao: { id: 'aprovada' } }], avaliacoes: [
    { arquivo: 'Valido.prw', estado: 'aprovado', codigo: 'APROVADO_PARA_PROPOSTA' },
    { arquivo: 'Incerto.tlpp', estado: 'inconclusivo', codigo: 'FLUXO_NAO_COMPROVADO' },
  ] });
  assert.match(r, /Estado: inconclusivo/); assert.match(r, /para esta proposta bloqueada/);
  assert.match(r, /outros arquivos que foram aprovadas permanecem disponíveis/);
  assert.doesNotMatch(r, /Arquivo: Valido/);
});

test('falha técnica não se apresenta como defeito causal comprovado', () => {
  const r = construirRespostaBloqueada({ avaliacoes: [{ estado: 'falha_tecnica', codigo: 'FALHA_TECNICA_VERIFICADOR' }] });
  assert.match(r, /Estado: falha_tecnica/); assert.match(r, /processamento impediu/);
  assert.doesNotMatch(r, /Foi identificada contradição/);
});
