'use strict';
// Apoio de domínio de integração contábil / Lançamento Padrão (2026-11-18).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectar } = require('../backend/services/conhecimento-integracao-contabil');
const { _montarQuadroInvestigativo } = require('../backend/services/context-engine');

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

test('detecta chamados de Lançamento Padrão e contabilização', () => {
  for (const s of [
    'LP 563 EM DUPLICIDADE',
    'Cadastro do LP 835',
    'Lançamento padrão 610-001 vendas',
    'Não está contabilizando alguns documentos',
    'Contabilização on-line rotina compensação',
    'conta contábil errada no débito',
    'conferir a CT5 da filial',
    'descontabilizar o título',
  ]) assert.ok(detectar(norm(s)), s);
});

test('não detecta chamado financeiro ou de faturamento sem integração contábil', () => {
  for (const s of [
    'Faturamento gerando títulos de ISS',
    'Retorno bancário não baixou o título',
    'Relatório contábil com layout desalinhado',
    'Help no pedido de venda',
  ]) assert.ok(!detectar(norm(s)), s);
});

// Cadastro de Compras: sem a ponte, a evidência contábil saía INCIDENTAL
// (conflitoModuloSemPonte) num chamado que é justamente de integração contábil.
const CHAMADO_COMPRAS = { produto: 'Protheus', modulo: 'Compras', titulo: 'Não esta contabilizando alguns documentos', assunto: 'documento de entrada' };
const abertura = { id: 'm1', papel: 'customer', criadoEm: '2026-11-01T00:00:00Z', conteudo: 'Alguns documentos de entrada não estão contabilizando.' };
const evidContabil = { id: 'm2', papel: 'user', criadoEm: '2026-11-02T00:00:00Z', conteudo: 'Conferi a contabilidade: o lançamento contábil da baixa no financeiro não foi gerado na CT2.' };
const sel = m => ({ tipo: 'mensagem', id: m.id, texto: m.conteudo, score: 5, prioridade: 'MEDIA', motivo: 'historico', ref: { id: m.id, papel: m.papel } });

test('chamado de integração contábil: evidência contábil é ponte, não incidental', () => {
  const q = _montarQuadroInvestigativo({
    atendimento: { conteudoBruto: abertura.conteudo }, mensagens: [abertura, evidContabil], mensagemAtual: 'Analise.',
    selecionadosEfetivos: [abertura, evidContabil].map(sel), chamado: CHAMADO_COMPRAS,
  });
  assert.equal(q.integracaoContabil, true);
  const ev = q.evidencias.find(e => e.referencia === 'm2');
  assert.ok(ev && !ev.papeis.includes('INCIDENTAL'), JSON.stringify(ev?.papeis));
});

test('chamado sem integração contábil mantém o comportamento anterior', () => {
  const aberturaPedido = { ...abertura, conteudo: 'Pedido de compra não libera na alçada de aprovação.' };
  const q = _montarQuadroInvestigativo({
    atendimento: { conteudoBruto: aberturaPedido.conteudo }, mensagens: [aberturaPedido], mensagemAtual: 'Analise.',
    selecionadosEfetivos: [aberturaPedido].map(sel), chamado: { produto: 'Protheus', modulo: 'Compras', titulo: 'Alçada' },
  });
  assert.equal(q.integracaoContabil, false);
});
