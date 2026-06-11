'use strict';

/**
 * Testes de buildEstadoAnterior — garantias de isolamento de período
 *
 * Verifica que o estado enviado ao IA-OWNER não carrega nenhuma informação
 * de período pré-calculada pelo orquestrador. O IA-OWNER deve derivar o
 * período exclusivamente de: mensagem atual + histórico + data_atual.
 *
 * Cenários cobertos:
 *   1. periodo removido do topo do estado
 *   2. periodo removido do contrato_orquestrador
 *   3. justificativa removida do contrato_orquestrador (pode conter anos em texto livre)
 *   4. metadados de roteamento preservados (modulo, operacao, agrupamentos, filtros)
 *   5. campos de continuidade preservados (ultimo_sql, contexto_ia_anterior)
 *   6. cenário real: "média anual dos últimos dois anos" — nenhum ano vaza para o estado
 *   7. intent sem contrato_orquestrador — não explode
 *   8. filtros temporais proibidos (anos/meses como arrays) removidos
 *   9. multiempresa — empresa removida de filtros e agrupamentos; periodo ainda ausente
 *  10. imutabilidade — o intent original não é mutado
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { _test } = require(path.join(ROOT, 'modules/erp/ia-owner/runner'));
const buildEstadoAnterior = _test.buildEstadoAnterior;

let passou = 0;
let falhou = 0;

function ok(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

// ─── 1. periodo removido do topo do estado ────────────────────────────────────
console.log('\n[1] periodo removido do topo do estadoAnterior');

ok('periodo ausente quando intent tem periodo com datas', () => {
  const intent = {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'personalizado', dataInicio: '20240101', dataFim: '20251231' },
    filtros: {},
    _orquestradorContrato: null,
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('periodo' in estado, false, 'periodo nao deve existir no estado');
});

ok('periodo ausente quando intent tem periodo.tipo=anos', () => {
  const intent = {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    filtros: {},
    _orquestradorContrato: null,
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('periodo' in estado, false);
});

ok('periodo ausente mesmo quando intent.periodo e null', () => {
  const intent = { intencao: 'faturamento_dinamico', periodo: null, filtros: {} };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('periodo' in estado, false);
});

ok('periodo ausente quando intent nao tem periodo definido', () => {
  const intent = { intencao: 'faturamento_dinamico', filtros: {} };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('periodo' in estado, false);
});

// ─── 2. periodo removido do contrato_orquestrador ────────────────────────────
console.log('\n[2] periodo removido do contrato_orquestrador');

ok('contrato_orquestrador.periodo ausente quando orquestrador tinha datas', () => {
  const intent = {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    filtros: {},
    _orquestradorContrato: {
      modulo: 'faturamento',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      filtros: {},
      agrupamentos: ['ano'],
      operacao: 'media',
    },
  };
  const estado = buildEstadoAnterior(intent);
  assert.ok(estado.contrato_orquestrador, 'contrato_orquestrador deve existir');
  assert.strictEqual('periodo' in estado.contrato_orquestrador, false, 'periodo nao deve existir no contrato_orquestrador');
});

ok('contrato_orquestrador.periodo ausente com tipo mes_atual', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'compras',
      periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
      filtros: {},
      agrupamentos: null,
    },
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('periodo' in estado.contrato_orquestrador, false);
});

ok('contrato_orquestrador.periodo ausente com periodo.tipo=nenhum', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'financeiro',
      periodo: { tipo: 'nenhum', dataInicio: null, dataFim: null },
      filtros: {},
    },
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('periodo' in estado.contrato_orquestrador, false);
});

// ─── 3. justificativa removida do contrato_orquestrador ──────────────────────
console.log('\n[3] justificativa removida do contrato_orquestrador');

ok('justificativa ausente quando orquestrador tinha texto com anos errados', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'faturamento',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: 'A pergunta corresponde aos anos de 2024 e 2025.',
      filtros: {},
      operacao: 'media',
    },
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('justificativa' in estado.contrato_orquestrador, false, 'justificativa nao deve existir no contrato_orquestrador');
});

ok('justificativa ausente mesmo quando nao contem anos', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'compras',
      periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
      justificativa: 'Compras do mes atual.',
      filtros: {},
    },
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('justificativa' in estado.contrato_orquestrador, false);
});

// ─── 4. metadados de roteamento preservados ──────────────────────────────────
console.log('\n[4] metadados de roteamento preservados');

ok('modulo, operacao, agrupamentos e filtros preservados', () => {
  const intent = {
    intencao: 'faturamento_dinamico',
    filtros: { vendedor: 'JOAO' },
    _moduloDinamico: 'faturamento',
    _orquestradorContrato: {
      modulo: 'faturamento',
      intencao: 'faturamento_dinamico',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: 'Média dos últimos 2 anos.',
      filtros: { vendedor: 'JOAO' },
      agrupamentos: ['ano'],
      operacao: 'media',
      carteira: null,
      estado: null,
      fluxoTipo: null,
      herdou_contexto: false,
      confianca: 1,
      precisa_confirmacao: false,
    },
  };
  const estado = buildEstadoAnterior(intent);
  const co = estado.contrato_orquestrador;
  assert.strictEqual(co.modulo, 'faturamento', 'modulo preservado');
  assert.strictEqual(co.operacao, 'media', 'operacao preservada');
  assert.deepStrictEqual(co.agrupamentos, ['ano'], 'agrupamentos preservados');
  assert.strictEqual(co.herdou_contexto, false, 'herdou_contexto preservado');
  assert.strictEqual(co.confianca, 1, 'confianca preservada');
  assert.strictEqual(co.precisa_confirmacao, false, 'precisa_confirmacao preservada');
});

ok('carteira e estado financeiro preservados', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'financeiro',
      periodo: { tipo: 'mes_atual', dataInicio: '20260601', dataFim: '20260630' },
      justificativa: 'Contas a pagar do mes.',
      filtros: {},
      carteira: 'pagar',
      estado: 'em_aberto',
      operacao: 'contas_a_pagar',
    },
  };
  const co = buildEstadoAnterior(intent).contrato_orquestrador;
  assert.strictEqual(co.carteira, 'pagar');
  assert.strictEqual(co.estado, 'em_aberto');
  assert.strictEqual(co.operacao, 'contas_a_pagar');
});

// ─── 5. campos de continuidade preservados ───────────────────────────────────
console.log('\n[5] campos de continuidade preservados');

ok('ultimo_sql preservado', () => {
  const sql = "SET ROWCOUNT 50000; SELECT COALESCE(SUM(SF2.F2_VALBRUT),0) FROM SF2990 SF2 WHERE SF2.D_E_L_E_T_ = ' ' AND SF2.F2_EMISSAO BETWEEN '20250101' AND '20261231'";
  const intent = {
    filtros: {},
    _sqlCanonicoOriginal: sql,
    _orquestradorContrato: null,
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual(estado.ultimo_sql, sql, 'ultimo_sql deve ser preservado integralmente');
});

ok('contexto_ia_anterior preservado', () => {
  const ctxAnterior = { decisao_contexto: 'nova_consulta', periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' } };
  const intent = {
    filtros: {},
    _contextoIAAnterior: ctxAnterior,
    _orquestradorContrato: null,
  };
  const estado = buildEstadoAnterior(intent);
  assert.deepStrictEqual(estado.contexto_ia_anterior, ctxAnterior, 'contexto_ia_anterior deve ser preservado');
});

// ─── 6. cenário real: "média anual dos últimos dois anos" ─────────────────────
console.log('\n[6] cenário real — média anual dos últimos dois anos (data_atual=2026-06-08)');

ok('nenhuma data ou ano vaza para o estado enviado ao IA-OWNER', () => {
  const intent = {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    filtros: {},
    group_by: ['ano'],
    _moduloDinamico: 'faturamento',
    _orquestradorContrato: {
      modulo: 'faturamento',
      intencao: 'faturamento_dinamico',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: 'A pergunta solicita a média anual de faturamento dos últimos dois anos, que corresponde aos anos de 2024 e 2025.',
      filtros: {},
      agrupamentos: ['ano'],
      operacao: 'media',
      carteira: null,
      estado: null,
      fluxoTipo: null,
      herdou_contexto: false,
      contexto_usado: null,
      confianca: 1,
      precisa_confirmacao: false,
    },
  };
  const estado = buildEstadoAnterior(intent);
  const estadoStr = JSON.stringify(estado);

  // Período ausente no topo
  assert.strictEqual('periodo' in estado, false, 'periodo nao deve existir no topo');

  // Período e justificativa ausentes no contrato
  const co = estado.contrato_orquestrador;
  assert.strictEqual('periodo' in co, false, 'periodo nao deve existir no contrato_orquestrador');
  assert.strictEqual('justificativa' in co, false, 'justificativa nao deve existir no contrato_orquestrador');

  // Nenhum ano pre-calculado vaza como string de data
  assert.ok(!estadoStr.includes('20240101'), 'dataInicio 2024 nao deve vazar');
  assert.ok(!estadoStr.includes('20251231'), 'dataFim 2025 nao deve vazar');

  // Roteamento preservado
  assert.strictEqual(co.modulo, 'faturamento');
  assert.strictEqual(co.operacao, 'media');
  assert.deepStrictEqual(co.agrupamentos, ['ano']);
});

ok('IA-OWNER so recebe: modulo, operacao, agrupamentos, filtros, flags booleanas', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'faturamento',
      intencao: 'faturamento_dinamico',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: '2024 e 2025.',
      filtros: {},
      agrupamentos: ['ano'],
      operacao: 'media',
      carteira: null,
      estado: null,
      fluxoTipo: null,
      herdou_contexto: false,
      contexto_usado: null,
      confianca: 1,
      precisa_confirmacao: false,
    },
  };
  const co = buildEstadoAnterior(intent).contrato_orquestrador;
  const chavesProibidas = ['periodo', 'justificativa'];
  const chavesPresentes = Object.keys(co);
  for (const proibida of chavesProibidas) {
    assert.ok(!chavesPresentes.includes(proibida), `chave proibida presente: ${proibida}`);
  }
  // Chaves obrigatórias de roteamento presentes
  for (const obrigatoria of ['modulo', 'operacao', 'agrupamentos', 'filtros', 'herdou_contexto']) {
    assert.ok(chavesPresentes.includes(obrigatoria), `chave obrigatoria ausente: ${obrigatoria}`);
  }
});

// ─── 7. intent sem contrato_orquestrador ─────────────────────────────────────
console.log('\n[7] intent sem contrato_orquestrador');

ok('contrato_orquestrador null quando intent nao tem _orquestradorContrato', () => {
  const estado = buildEstadoAnterior({ filtros: {} });
  assert.strictEqual(estado.contrato_orquestrador, null);
});

ok('contrato_orquestrador null quando _orquestradorContrato e null', () => {
  const estado = buildEstadoAnterior({ filtros: {}, _orquestradorContrato: null });
  assert.strictEqual(estado.contrato_orquestrador, null);
});

// ─── 8. filtros temporais proibidos (arrays de anos/meses) ───────────────────
console.log('\n[8] filtros temporais proibidos removidos');

ok('filtros.anos (array) removido do estado', () => {
  const intent = {
    filtros: { anos: [2024, 2025], cliente: 'ACME' },
    _orquestradorContrato: null,
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('anos' in estado.filtros, false, 'anos array nao deve existir nos filtros');
  assert.strictEqual(estado.filtros.cliente, 'ACME', 'filtros nao-temporais preservados');
});

ok('filtros.meses (array) removido do estado', () => {
  const intent = {
    filtros: { meses: [1, 2, 3], vendedor: 'JOSE' },
    _orquestradorContrato: null,
  };
  const estado = buildEstadoAnterior(intent);
  assert.strictEqual('meses' in estado.filtros, false);
  assert.strictEqual(estado.filtros.vendedor, 'JOSE');
});

ok('filtros.anos (array) removido do contrato_orquestrador tambem', () => {
  const intent = {
    filtros: {},
    _orquestradorContrato: {
      modulo: 'faturamento',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: 'anos 2024 e 2025',
      filtros: { anos: [2024, 2025] },
      agrupamentos: ['ano'],
      operacao: 'media',
    },
  };
  const co = buildEstadoAnterior(intent).contrato_orquestrador;
  assert.strictEqual('anos' in co.filtros, false, 'anos array nao deve existir nos filtros do contrato');
});

// ─── 9. multiempresa ─────────────────────────────────────────────────────────
console.log('\n[9] multiempresa — empresa removida, periodo ainda ausente');

ok('empresa removida dos filtros em contexto multiempresa', () => {
  const intent = {
    filtros: { empresa: 'J2A' },
    _empresasMencionadasTextos: ['J2A'],
    _orquestradorContrato: {
      modulo: 'faturamento',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: 'Faturamento J2A 2024-2025.',
      filtros: { empresa: 'J2A' },
      agrupamentos: ['empresa', 'ano'],
      operacao: 'media',
    },
  };
  const estado = buildEstadoAnterior(intent);

  // Empresa removida dos filtros
  assert.strictEqual('empresa' in estado.filtros, false, 'empresa removida dos filtros');

  // Periodo e justificativa ausentes no contrato
  const co = estado.contrato_orquestrador;
  assert.strictEqual('periodo' in co, false);
  assert.strictEqual('justificativa' in co, false);

  // "empresa" removida dos agrupamentos (metadata de exibicao)
  assert.ok(!co.agrupamentos.includes('empresa'), '"empresa" removida dos agrupamentos SQL');
});

// ─── 10. imutabilidade ───────────────────────────────────────────────────────
console.log('\n[10] imutabilidade — intent original nao e mutado');

ok('intent original preservado apos buildEstadoAnterior', () => {
  const contrato = {
    modulo: 'faturamento',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    justificativa: 'anos 2024 e 2025',
    filtros: {},
    agrupamentos: ['ano'],
    operacao: 'media',
  };
  const intent = {
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    filtros: {},
    _orquestradorContrato: contrato,
  };

  buildEstadoAnterior(intent);

  // Intent original não mutado
  assert.deepStrictEqual(intent.periodo, { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' }, 'intent.periodo nao mutado');
  assert.strictEqual(intent._orquestradorContrato.periodo.dataInicio, '20240101', 'contrato.periodo nao mutado');
  assert.strictEqual(intent._orquestradorContrato.justificativa, 'anos 2024 e 2025', 'contrato.justificativa nao mutada');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`ia-owner-estado-anterior-periodo.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`ia-owner-estado-anterior-periodo.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
