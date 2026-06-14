'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const WhatsAppService = require(path.join(ROOT, 'modules/whatsapp/service'));
const svc = Object.create(WhatsAppService.prototype);

const intentMediaProduto = {
  _mensagemOriginal: 'Preciso do faturamento medio DE JANEIRO A JUNHO do ano de 2026 por produto',
  operacao: 'media',
};

const consolidadoMensal = svc._formatarConsolidadoDinamicoAll(intentMediaProduto, [
  {
    nomeEmpresa: 'C3i Systems',
    rows: [
      { competencia: '202601', produto: 'SOFTEXPERT', faturamento_mes: 60 },
      { competencia: '202602', produto: 'SOFTEXPERT', faturamento_mes: 120 },
      { competencia: '202601', produto: 'PROTHEUS', faturamento_mes: 50 },
    ],
  },
  {
    nomeEmpresa: 'J2A Consultoria',
    rows: [
      { competencia: '202601', produto: 'SOFTEXPERT', faturamento_mes: 40 },
      { competencia: '202602', produto: 'SOFTEXPERT', faturamento_mes: 80 },
    ],
  },
]);

assert(consolidadoMensal.includes('*Media consolidada por Produto*'), 'deve usar ramo de media consolidada por produto');
assert(consolidadoMensal.includes('SOFTEXPERT: *R$'), 'deve listar SOFTEXPERT');
assert(consolidadoMensal.includes('150,00'), 'SOFTEXPERT deve ter media (60+40, 120+80) / 2 = 150');
assert(consolidadoMensal.includes('PROTHEUS: *R$'), 'deve listar PROTHEUS');
assert(consolidadoMensal.includes('25,00'), 'PROTHEUS deve dividir por todos os periodos consolidados, incluindo mes sem movimento');
assert(!consolidadoMensal.includes('1. *Geral*'), 'nao deve cair em agrupamento Geral');

const consolidadoMediaFinal = svc._formatarConsolidadoDinamicoAll(intentMediaProduto, [
  {
    nomeEmpresa: 'C3i Systems',
    rows: [
      { produto: 'SOFTEXPERT', faturamento_medio: 10 },
      { produto: 'PROTHEUS', faturamento_medio: 15 },
    ],
  },
  {
    nomeEmpresa: 'J2A Consultoria',
    rows: [
      { produto: 'SOFTEXPERT', faturamento_medio: 20 },
      { produto: 'ARREDONDAMENTO', faturamento_medio: 1 },
    ],
  },
]);

assert(consolidadoMediaFinal.includes('*SOFTEXPERT*: *R$'), 'fallback deve consolidar media final por produto');
assert(consolidadoMediaFinal.includes('30,00'), 'fallback soma medias por produto quando a base mensal nao esta disponivel');
assert(consolidadoMediaFinal.includes('*PROTHEUS*: *R$'), 'fallback deve preservar produto PROTHEUS');
assert(!consolidadoMediaFinal.includes('1. *Geral*'), 'fallback nao deve usar Geral quando existe produto');

const consolidadoPorResposta = svc._formatarConsolidadoDinamicoAll(intentMediaProduto, [
  {
    nomeEmpresa: 'C3i Systems',
    rows: [
      { faturamento_medio: 3965 },
      { faturamento_medio: 41150.12 },
    ],
    resposta: [
      '💰 Faturamento Médio por Produto — Jan a Jun/2026',
      '  1. CONTRATO SUPORTE/FULL - SOFTEXPERT: R$ 3.965,00',
      '  2. LICENCIAMENTO/COMISSAO - SOFTEXPERT: R$ 41.150,12',
      '🧾 Subtotal: R$ 45.115,12',
    ].join('\n'),
  },
  {
    nomeEmpresa: 'J2A Consultoria',
    rows: [
      { faturamento_medio: 20291.67 },
      { faturamento_medio: 64155.40 },
    ],
    resposta: [
      '💰 Faturamento Médio por Produto — Jan a Jun/2026',
      '  1. CONTRATO SUPORTE/FULL - SOFTEXPERT: R$ 20.291,67',
      '  2. LICENCIAMENTO/COMISSAO - SOFTEXPERT: R$ 64.155,40',
      '🧾 Subtotal: R$ 84.447,07',
    ].join('\n'),
  },
]);

assert(consolidadoPorResposta.includes('*CONTRATO SUPORTE/FULL - SOFTEXPERT*: *R$'), 'deve extrair produto da resposta da empresa quando rows nao trazem produto');
assert(consolidadoPorResposta.includes('24.256,67'), 'deve somar medias do mesmo produto entre empresas');
assert(consolidadoPorResposta.includes('*LICENCIAMENTO/COMISSAO - SOFTEXPERT*: *R$'), 'deve preservar segundo produto extraido da resposta');
assert(consolidadoPorResposta.includes('105.305,52'), 'deve somar licenciamento entre empresas');
assert(!consolidadoPorResposta.includes('1. *Geral*'), 'fallback por resposta nao deve usar Geral');

console.log('whatsapp-consolidado-media-produto.test.js: ok');
