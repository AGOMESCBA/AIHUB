'use strict';
// Falha de estilo do Quality Gate é aviso: não reescreve nem tira a aprovação
// (o gate bloqueia o mínimo; a IA predomina). Arquivo de fonte corrigido segue
// exigindo aprovação sem ressalvas. Decisão do usuário, 2026-10-21.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const qg = require('../backend/services/quality-gate-service');

const base = { manifesto: { selecionados: [], omitidos: [] }, pergunta: 'Analise o erro.' };

test('correção sem orientar validação: aviso, sem reescrita, aprovada; mas não libera arquivo de fonte', () => {
  const gate = qg.avaliarResposta({ ...base, textoResposta: 'Altere o parâmetro MV_CNMDALC para .T. e ajuste o campo CN9_GRPAPR com o grupo correto.' });
  const f = gate.falhas.find(x => x.codigo === 'CORRECTION_WITHOUT_VALIDATION');
  assert.ok(f, JSON.stringify(gate.falhas.map(x => x.codigo)));
  assert.equal(f.decisionKind, 'correcao_estilo');
  assert.equal(gate.deveRetry, false);
  assert.equal(gate.aprovado, true);
  assert.equal(gate.aprovadoSemRessalvas, false);
});

test('vazamento de bastidor interno continua barrando', () => {
  const gate = qg.avaliarResposta({ ...base, textoResposta: 'O Quality Gate reprovou a analise, mas o erro ERR-PRZ-01 indica prazo.' });
  assert.ok(gate.falhas.some(x => x.codigo === 'RETRY_CONTEXT_LEAKED'));
  assert.equal(gate.aprovado, false);
});
