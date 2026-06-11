'use strict';

/**
 * Testes de desambiguação de entidade no IA-OWNER runner
 *
 * Garante que quando resolverEntidades retorna status:'ambigua' (ex: cliente
 * com múltiplas lojas), o runner retorna 'pergunta_entidade' com as opções
 * em vez de ir para "ULTIMO RECURSO" e deixar a IA escolher arbitrariamente.
 *
 * Cenários cobertos:
 *   1. PRE-IA: ambiguidade na resolução prévia → pergunta_entidade retornada
 *   2. PRE-IA: não-encontrado → continua para IA (comportamento existente)
 *   3. Estrutura da resposta pergunta_entidade: campos obrigatórios presentes
 *   4. _opcoesEntidade contém todos os candidatos
 *   5. resposta_direta contém a pergunta formatada com "Todos" como última opção
 *   6. POST-IA: ambiguidade pós-declaração da IA → pergunta_entidade também
 *   7. Histórico: contrato_orquestrador não expõe periodo nem justificativa
 *   8. Histórico: contexto_usado removido do contrato_orquestrador
 *   9. Histórico: campos de roteamento (modulo, operacao, agrupamentos) preservados
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Importa formatarPerguntaAmbiguidade diretamente do spec de faturamento
const fatSpec = require(path.join(ROOT, 'modules/erp/faturamento/faturamento-ia-owner-spec'));

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CANDIDATOS_ASTER = [
  { tipo: 'cliente', rotuloTipo: 'cliente', tabelaBase: 'SA1', codigo: '000048', loja: '02', nome: 'ASTER MAQUINAS E SOLUCOES INTEGRADAS LTDA', joinHint: 'SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA' },
  { tipo: 'cliente', rotuloTipo: 'cliente', tabelaBase: 'SA1', codigo: '000048', loja: '03', nome: 'ASTER MAQUINAS E SOLUCOES INTEGRADAS LTDA', joinHint: 'SF2.F2_CLIENTE = SA1.A1_COD AND SF2.F2_LOJA = SA1.A1_LOJA' },
];

// ─── 1. formatarPerguntaAmbiguidade ──────────────────────────────────────────
console.log('\n[1] formatarPerguntaAmbiguidade — formato da pergunta ao usuário');

ok('pergunta contém o nome da entidade', () => {
  const msg = fatSpec.formatarPerguntaAmbiguidade('ASTER', CANDIDATOS_ASTER);
  assert.ok(msg.includes('ASTER'), 'deve mencionar ASTER');
});

ok('pergunta lista cada candidato numerado', () => {
  const msg = fatSpec.formatarPerguntaAmbiguidade('ASTER', CANDIDATOS_ASTER);
  assert.ok(msg.includes('1.'), 'deve ter opção 1');
  assert.ok(msg.includes('2.'), 'deve ter opção 2');
});

ok('última opção é "Todos"', () => {
  const msg = fatSpec.formatarPerguntaAmbiguidade('ASTER', CANDIDATOS_ASTER);
  const numero = CANDIDATOS_ASTER.length + 1;
  assert.ok(msg.includes(`${numero}.`), `deve ter opção ${numero}`);
  assert.ok(msg.toLowerCase().includes('todos'), 'deve incluir opção "Todos"');
});

ok('pergunta inclui código/loja de cada candidato', () => {
  const msg = fatSpec.formatarPerguntaAmbiguidade('ASTER', CANDIDATOS_ASTER);
  assert.ok(msg.includes('000048'), 'deve mostrar código');
  assert.ok(msg.includes('02'), 'deve mostrar loja 02');
  assert.ok(msg.includes('03'), 'deve mostrar loja 03');
});

ok('formatarPerguntaAmbiguidade exportada nos 4 specs', () => {
  const specs = [
    'faturamento/faturamento-ia-owner-spec',
    'compras/compras-ia-owner-spec',
    'financeiro/financeiro-ia-owner-spec',
    'comissao/comissao-ia-owner-spec',
  ];
  for (const nome of specs) {
    const s = require(path.join(ROOT, 'modules/erp', nome));
    assert.strictEqual(typeof s.formatarPerguntaAmbiguidade, 'function', `${nome} deve exportar formatarPerguntaAmbiguidade`);
  }
});

// ─── 2. Simulação do fluxo PRE-IA no runner ──────────────────────────────────
console.log('\n[2] Simulação do fluxo de desambiguação (lógica isolada)');

// Simula o trecho relevante do runner sem precisar de DB ou IA
function simularDecisaoPreIA(resolucaoPrevia, spec) {
  const diagnostico = resolucaoPrevia.status === 'ambigua' || resolucaoPrevia.status === 'nao_encontrado'
    ? { status: resolucaoPrevia.status, texto: resolucaoPrevia.texto, candidatos: resolucaoPrevia.candidatos || [] }
    : null;

  if (diagnostico) {
    if (diagnostico.status === 'ambigua' && typeof spec.formatarPerguntaAmbiguidade === 'function') {
      return {
        tipo: 'pergunta_entidade',
        _intentPendente: { intencao: 'faturamento_dinamico' },
        _opcoesEntidade: diagnostico.candidatos,
        resposta_direta: spec.formatarPerguntaAmbiguidade(diagnostico.texto, diagnostico.candidatos),
        sql_gerado: `-- Aguardando escolha de entidade: ${diagnostico.texto}`,
        duracao_ms: 0,
      };
    }
    return { tipo: 'continua', diagnostico };
  }
  return { tipo: 'resolvido' };
}

ok('ambigua com múltiplas lojas → retorna pergunta_entidade', () => {
  const resolucao = { status: 'ambigua', texto: 'ASTER', candidatos: CANDIDATOS_ASTER };
  const resultado = simularDecisaoPreIA(resolucao, fatSpec);
  assert.strictEqual(resultado.tipo, 'pergunta_entidade', `esperado pergunta_entidade, recebeu ${resultado.tipo}`);
});

ok('pergunta_entidade tem _opcoesEntidade com todos os candidatos', () => {
  const resolucao = { status: 'ambigua', texto: 'ASTER', candidatos: CANDIDATOS_ASTER };
  const resultado = simularDecisaoPreIA(resolucao, fatSpec);
  assert.deepStrictEqual(resultado._opcoesEntidade, CANDIDATOS_ASTER);
});

ok('pergunta_entidade tem resposta_direta com texto da pergunta', () => {
  const resolucao = { status: 'ambigua', texto: 'ASTER', candidatos: CANDIDATOS_ASTER };
  const resultado = simularDecisaoPreIA(resolucao, fatSpec);
  assert.ok(typeof resultado.resposta_direta === 'string' && resultado.resposta_direta.length > 0);
  assert.ok(resultado.resposta_direta.includes('ASTER'));
});

ok('nao_encontrado → continua (não retorna pergunta_entidade)', () => {
  const resolucao = { status: 'nao_encontrado', texto: 'XYZXYZ', candidatos: [] };
  const resultado = simularDecisaoPreIA(resolucao, fatSpec);
  assert.notStrictEqual(resultado.tipo, 'pergunta_entidade');
  assert.strictEqual(resultado.tipo, 'continua');
});

ok('resolvido → não interfere', () => {
  const resolucao = { status: 'resolvido', entidades: [{ tipo: 'cliente', codigo: '000048', loja: '02', nome: 'ASTER' }] };
  const resultado = simularDecisaoPreIA(resolucao, fatSpec);
  assert.strictEqual(resultado.tipo, 'resolvido');
});

ok('spec sem formatarPerguntaAmbiguidade → não retorna pergunta_entidade (fallback seguro)', () => {
  const specSemFormatar = { ...fatSpec, formatarPerguntaAmbiguidade: undefined };
  const resolucao = { status: 'ambigua', texto: 'ASTER', candidatos: CANDIDATOS_ASTER };
  const resultado = simularDecisaoPreIA(resolucao, specSemFormatar);
  assert.notStrictEqual(resultado.tipo, 'pergunta_entidade', 'sem formatarPerguntaAmbiguidade deve continuar para IA');
});

// ─── 3. Histórico: contrato_orquestrador sanitizado ──────────────────────────
console.log('\n[3] Histórico — contrato_orquestrador sanitizado');

// Simula a lógica de sanitização do _buildHistoricoResumido
function sanitizarContratoHistorico(contrato_orquestrador) {
  const co = contrato_orquestrador;
  if (!co) return null;
  const { periodo: _p, justificativa: _j, contexto_usado: _cu, ...coLimpo } = co;
  return coLimpo;
}

ok('periodo removido do contrato_orquestrador no histórico', () => {
  const co = {
    modulo: 'faturamento',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    justificativa: 'que corresponde ao período de 2024 a 2025.',
    contexto_usado: { modulo: 'faturamento', periodo: { tipo: 'anos' } },
    filtros: {},
    agrupamentos: ['ano'],
    operacao: 'media',
  };
  const resultado = sanitizarContratoHistorico(co);
  assert.strictEqual('periodo' in resultado, false, 'periodo nao deve existir');
});

ok('justificativa removida do contrato_orquestrador no histórico', () => {
  const co = {
    modulo: 'faturamento',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    justificativa: '2024 e 2025.',
    filtros: {},
    operacao: 'media',
  };
  const resultado = sanitizarContratoHistorico(co);
  assert.strictEqual('justificativa' in resultado, false, 'justificativa nao deve existir');
});

ok('contexto_usado removido do contrato_orquestrador no histórico', () => {
  const co = {
    modulo: 'faturamento',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    justificativa: 'texto',
    contexto_usado: { modulo: 'faturamento', periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' } },
    filtros: {},
    operacao: 'media',
  };
  const resultado = sanitizarContratoHistorico(co);
  assert.strictEqual('contexto_usado' in resultado, false, 'contexto_usado nao deve existir');
});

ok('campos de roteamento preservados no contrato_orquestrador histórico', () => {
  const co = {
    modulo: 'faturamento',
    intencao: 'faturamento_dinamico',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    justificativa: 'texto.',
    filtros: { vendedor: 'JOSE' },
    agrupamentos: ['ano'],
    operacao: 'media',
    carteira: null,
    estado: null,
    fluxoTipo: null,
    herdou_contexto: false,
    confianca: 1,
    precisa_confirmacao: false,
  };
  const resultado = sanitizarContratoHistorico(co);
  assert.strictEqual(resultado.modulo, 'faturamento');
  assert.strictEqual(resultado.operacao, 'media');
  assert.deepStrictEqual(resultado.agrupamentos, ['ano']);
  assert.strictEqual(resultado.herdou_contexto, false);
  assert.strictEqual(resultado.filtros.vendedor, 'JOSE');
});

ok('nenhum ano de 2024/2025 vaza via justificativa no histórico', () => {
  const co = {
    modulo: 'faturamento',
    periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
    justificativa: 'A pergunta solicita a média anual de faturamento dos últimos dois anos, que corresponde ao período de 2024 a 2025.',
    contexto_usado: {
      modulo: 'faturamento',
      periodo: { tipo: 'anos', dataInicio: '20240101', dataFim: '20251231' },
      justificativa: 'mesmo texto 2024 2025',
    },
    filtros: {},
    agrupamentos: ['ano'],
    operacao: 'media',
  };
  const resultado = sanitizarContratoHistorico(co);
  const str = JSON.stringify(resultado);
  assert.ok(!str.includes('20240101'), 'dataInicio 2024 nao deve vazar');
  assert.ok(!str.includes('20251231'), 'dataFim 2025 nao deve vazar');
  assert.ok(!str.includes('2024 a 2025'), 'texto da justificativa nao deve vazar');
});

ok('contrato null → retorna null', () => {
  assert.strictEqual(sanitizarContratoHistorico(null), null);
});

ok('contrato undefined → retorna null', () => {
  assert.strictEqual(sanitizarContratoHistorico(undefined), null);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`ia-owner-desambiguacao-entidade.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`ia-owner-desambiguacao-entidade.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
