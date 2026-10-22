'use strict';
// A mensagem de abertura do chamado (descrição do problema) é sempre CENTRAL,
// mesmo em linguagem natural e sem vocabulário técnico (#036727 / auditoria #035988).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _montarQuadroInvestigativo } = require('../backend/services/context-engine');

const abertura = { id: 'm1', papel: 'customer', criadoEm: '2026-10-07T00:00:00Z', conteudo: 'Abertura do chamado por Cliente Exemplo\n\nO comercial faz uma nota mãe de uma venda de vários produtos do mesmo cliente. Conforme vai retirando o produto na emissão das NFs na expedição, deve ir diminuindo o saldo conforme pedido do cliente. Foi retirado pedra de mão e a NF automática foi diminuindo do saldo da brita 01. Teve que voltar o saldo e emitir as NFs manualmente.' };
const posterior = { id: 'm3', papel: 'customer', criadoEm: '2026-10-09T00:00:00Z', conteudo: 'Bom dia, o financeiro também comentou sobre o título do contas a receber da semana passada no status do workflow.' };
const mensagens = [abertura, { id: 'm2', papel: 'user', criadoEm: '2026-10-08T00:00:00Z', conteudo: 'Realizado a abertura de fabrica.' }, posterior];
// Mesmo cadastro do caso real #036727 (familia/modulo/servico), que fazia a abertura sair INCIDENTAL.
const CHAMADO = { produto: 'Protheus', familia: 'Materiais', modulo: 'Faturamento', servico: 'Ajuste/Correção de Customização', natureza: 'Em Análise', nivel: 'Nível 1', titulo: 'Cliente | Protheus | erro na nota mães', assunto: 'erro na nota mães' };
const sel = m => ({ tipo: 'mensagem', id: m.id, texto: m.conteudo, score: 5, prioridade: 'MEDIA', motivo: 'historico recente/continuidade', ref: { id: m.id, papel: m.papel } });

function quadro() {
  return _montarQuadroInvestigativo({
    atendimento: { conteudoBruto: abertura.conteudo }, mensagens, mensagemAtual: 'Revise o historico e pesquise uma solucao.',
    selecionadosEfetivos: mensagens.map(sel), chamado: CHAMADO,
  });
}

test('abertura do chamado é CENTRAL e nunca INCIDENTAL/RUIDO', () => {
  const ev = quadro().evidencias.find(e => e.referencia === 'm1' || e.id === 'm1');
  assert.ok(ev, 'abertura presente no quadro');
  assert.ok(ev.papeis.includes('CENTRAL'), JSON.stringify(ev.papeis));
  assert.ok(!ev.papeis.includes('INCIDENTAL') && !ev.papeis.includes('RUIDO'), JSON.stringify(ev.papeis));
});

test('a regra vale só para a abertura: mensagem posterior de outro assunto continua incidental', () => {
  const ev = quadro().evidencias.find(e => e.referencia === 'm3');
  assert.ok(ev);
  assert.ok(!ev.papeis.includes('CENTRAL'), JSON.stringify(ev.papeis));
});
