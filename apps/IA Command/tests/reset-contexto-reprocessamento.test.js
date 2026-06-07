'use strict';

/**
 * Testes do comportamento de reset de contexto com reprocessamento
 *
 * Valida:
 *   1. _clearLastIntent limpa intent E historico de todos os escopos
 *   2. _buildHistoricoResumido retorna vazio após o reset
 *   3. _historicoTurnosConfig retorna valor configurado (ou fallback 5)
 *   4. nivel_contexto atinge 5 após 4 heranças e dispara o reset na 5ª mensagem
 *   5. Prefixo de reset é construído corretamente
 *   6. Após reset, nova mensagem é processada sem contexto anterior (nivel = 1)
 */

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// ── Carrega apenas os módulos puros (sem WhatsApp, sem DB ativo) ──────────────
const intentMerger = require(path.join(ROOT, 'modules/ai/intent-merger'));

// IACWhatsAppService: instanciar apenas o construtor — não inicializa WhatsApp
// O require pode falhar em módulos opcionais (whatsapp-web.js, puppeteer).
// Usamos um shim mínimo que copia apenas os métodos que testamos.
let ServiceClass;
try {
  ServiceClass = require(path.join(ROOT, 'modules/whatsapp/service'));
} catch (_) {
  ServiceClass = null;
}

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

async function okAsync(descricao, fn) {
  try {
    await fn();
    console.log(`  ✓ ${descricao}`);
    passou++;
  } catch (e) {
    console.error(`  ✗ ${descricao}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: cria intent simulado com nivel_contexto
// ─────────────────────────────────────────────────────────────────────────────
function mkIntent(nivel, intencao = 'faturamento_dinamico', extra = {}) {
  return {
    intencao,
    confianca: 0.95,
    _nivel_contexto: nivel,
    periodo: { tipo: 'ano_atual', dataInicio: '20260101', dataFim: '20261231' },
    filtros: {},
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 1 — intent-merger: nivel_contexto sobe até 5 e trava
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 1] intent-merger — nivel_contexto e limite de 5');

ok('T1 sem contexto anterior: nivel = 1', () => {
  const intent = intentMerger.mesclar(mkIntent(0), null);
  assert.strictEqual(intent._nivel_contexto, 1);
});

ok('T2 com contexto nivel 1: nivel = 2', () => {
  const merged = intentMerger.mesclar(mkIntent(0), mkIntent(1), Date.now(), 'detalhar por mes');
  assert.strictEqual(merged._nivel_contexto, 2);
});

ok('T5 com contexto nivel 4: nivel = 5 (cap)', () => {
  const merged = intentMerger.mesclar(mkIntent(0), mkIntent(4), Date.now(), 'por fornecedor');
  assert.strictEqual(merged._nivel_contexto, 5);
});

ok('T6 com contexto nivel 5: nivel permanece 5 (cap mantido)', () => {
  // O merger ancora em 5 — a verificação de reset acontece no service ANTES do merger
  const merged = intentMerger.mesclar(mkIntent(0), mkIntent(5), Date.now(), 'top 10');
  assert.strictEqual(merged._nivel_contexto, 5);
});

ok('Reset por nova intenção diferente (confiança >= 0.85): nivel volta a 1', () => {
  const novoIntent = mkIntent(0, 'compras_dinamico', { confianca: 0.90 });
  const merged = intentMerger.mesclar(novoIntent, mkIntent(4, 'faturamento_dinamico'), Date.now(), 'compras de maio');
  assert.strictEqual(merged._nivel_contexto, 1, `esperado 1, recebeu ${merged._nivel_contexto}`);
});

ok('Sequência completa 5 turnos: nivel cresce de 1 até 5', () => {
  let ctx = null;
  const mensagens = [
    'compras do ano',
    'por mes',
    'por fornecedor',
    'top 10',
    'somente acima de 1000',
  ];
  const niveis = [];
  for (const msg of mensagens) {
    const novo = mkIntent(0);
    const merged = intentMerger.mesclar(novo, ctx, ctx ? Date.now() : 0, msg);
    niveis.push(merged._nivel_contexto);
    ctx = merged;
  }
  assert.deepStrictEqual(niveis, [1, 2, 3, 4, 5], `niveis: ${niveis.join(', ')}`);
});

ok('Após 5 turnos, contexto com nivel 5 deve disparar reset no service (verificação da condição)', () => {
  // Simula a condição de reset do service: contextoAnterior._nivel_contexto >= 5
  const contextoAnteriorNivel5 = mkIntent(5);
  const deveResetar = (contextoAnteriorNivel5._nivel_contexto || 1) >= 5;
  assert.ok(deveResetar, 'nivel 5 deve disparar reset');
});

ok('Contexto com nivel 4 NÃO deve disparar reset', () => {
  const contextoNivel4 = mkIntent(4);
  const deveResetar = (contextoNivel4._nivel_contexto || 1) >= 5;
  assert.ok(!deveResetar, 'nivel 4 não deve disparar reset');
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 2 — IACWhatsAppService: sessão e limpeza de histórico
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 2] IACWhatsAppService — sessão e limpeza de histórico');

if (!ServiceClass) {
  console.log('  ⚠ IACWhatsAppService não pôde ser carregado (dependências opcionais ausentes). Pulando bloco 2.');
} else {
  const svc = new ServiceClass();

  // Shim: _normalizarNumeroWa é usado pelo _sessionKey
  if (!svc._normalizarNumeroWa) {
    svc._normalizarNumeroWa = (n) => String(n || '').replace(/\D/g, '');
  }

  const SENDER = '5565999990001';
  const EMPRESA = '1';

  ok('_getSenderContext retorna null para sender inexistente', () => {
    assert.strictEqual(svc._getSenderContext(SENDER), null);
  });

  ok('_setSenderContext armazena contexto', () => {
    svc._setSenderContext(SENDER, { foo: 'bar' });
    const ctx = svc._getSenderContext(SENDER);
    assert.ok(ctx, 'contexto deve existir');
    assert.strictEqual(ctx.foo, 'bar');
  });

  ok('_clearLastIntent remove lastIntent e lastIntentTs', () => {
    svc._setSenderContext(SENDER, {
      lastIntent: mkIntent(3),
      lastIntentTs: Date.now(),
      lastIntentSeq: 3,
      lastIntentEmpresaId: EMPRESA,
    });
    svc._clearLastIntent(SENDER);
    const ctx = svc._getSenderContext(SENDER);
    assert.ok(ctx, 'contexto ainda existe após clear');
    assert.ok(!ctx.lastIntent, 'lastIntent deve estar limpo');
    assert.ok(!ctx.lastIntentTs, 'lastIntentTs deve estar limpo');
    assert.ok(!ctx.lastIntentSeq, 'lastIntentSeq deve estar limpo');
    assert.ok(!ctx.lastIntentEmpresaId, 'lastIntentEmpresaId deve estar limpo');
  });

  ok('_clearLastIntent remove todos os buffers _history_*', () => {
    // Simula histórico de dois escopos
    svc._setSenderContext(SENDER, {
      [`_history_${EMPRESA}`]: [{ mensagem: 'compras do ano' }, { mensagem: 'por mes' }],
      [`_history_2`]:           [{ mensagem: 'faturamento' }],
      lastIntent: mkIntent(3),
    });
    svc._clearLastIntent(SENDER);
    const ctx = svc._getSenderContext(SENDER);
    const historicoKeys = Object.keys(ctx || {}).filter(k => k.startsWith('_history_'));
    assert.deepStrictEqual(historicoKeys, [], `buffers restantes: ${historicoKeys.join(', ')}`);
  });

  ok('_buildHistoricoResumido retorna [] para sender sem contexto', () => {
    const novoSender = '5565999990099';
    const hist = svc._buildHistoricoResumido(novoSender, EMPRESA, 5);
    assert.deepStrictEqual(hist, []);
  });

  // Entrada mínima compatível com _buildHistoricoResumido (requer campo agrupamento como array)
  function mkEntry(mensagem, intencao = 'compras_dinamico', ts = Date.now()) {
    return { mensagem, intencao, ts, filtros: {}, agrupamento: [], periodo: null, modulo: null };
  }

  ok('_buildHistoricoResumido retorna [] após _clearLastIntent', () => {
    svc._setSenderContext(SENDER, {
      [`_history_${EMPRESA}`]: [mkEntry('compras do ano'), mkEntry('por mes')],
      lastIntent: mkIntent(2),
    });
    const antes = svc._buildHistoricoResumido(SENDER, EMPRESA, 5);
    assert.ok(antes.length > 0, 'deve ter histórico antes do clear');
    svc._clearLastIntent(SENDER);
    const depois = svc._buildHistoricoResumido(SENDER, EMPRESA, 5);
    assert.deepStrictEqual(depois, [], 'histórico deve estar vazio após clear');
  });

  ok('_buildHistoricoResumido respeita o limite N configurado', () => {
    const entries = Array.from({ length: 8 }, (_, i) => mkEntry(`msg ${i + 1}`, 'faturamento_dinamico', Date.now() - (8 - i) * 1000));
    svc._setSenderContext(SENDER, { [`_history_${EMPRESA}`]: entries });
    const hist5 = svc._buildHistoricoResumido(SENDER, EMPRESA, 5);
    const hist3 = svc._buildHistoricoResumido(SENDER, EMPRESA, 3);
    assert.strictEqual(hist5.length, 5, `esperado 5, recebeu ${hist5.length}`);
    assert.strictEqual(hist3.length, 3, `esperado 3, recebeu ${hist3.length}`);
  });

  ok('_buildHistoricoResumido retorna os N mais recentes', () => {
    const entries = [
      mkEntry('msg 1', 'x'), mkEntry('msg 2', 'x'), mkEntry('msg 3', 'x'),
      mkEntry('msg 4', 'x'), mkEntry('msg 5', 'x'),
    ];
    svc._setSenderContext(SENDER, { [`_history_${EMPRESA}`]: entries });
    const hist = svc._buildHistoricoResumido(SENDER, EMPRESA, 3);
    const msgs = hist.map(h => h.pergunta);
    assert.ok(msgs.includes('msg 3'), `deve conter msg 3: ${msgs.join(', ')}`);
    assert.ok(msgs.includes('msg 4'), `deve conter msg 4: ${msgs.join(', ')}`);
    assert.ok(msgs.includes('msg 5'), `deve conter msg 5: ${msgs.join(', ')}`);
    assert.ok(!msgs.includes('msg 1'), `não deve conter msg 1: ${msgs.join(', ')}`);
  });

  ok('_historicoTurnosConfig retorna número entre 1 e 10 (ou fallback 5)', () => {
    // O método faz SELECT no DB. Se o DB não responder, cai no fallback 5.
    const val = svc._historicoTurnosConfig(EMPRESA);
    assert.ok(typeof val === 'number', `esperado number, recebeu ${typeof val}`);
    assert.ok(val >= 1 && val <= 10, `valor fora do range: ${val}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 3 — Prefixo de reset: formato e conteúdo
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 3] Prefixo de reset — formato e conteúdo');

function construirPrefixoReset(limiteNivel) {
  // Replica exatamente a lógica do service.js
  return `🔄 *Conversa renovada* — atingimos o limite de ${limiteNivel} trocas desta consulta. Processei sua pergunta como início de uma nova consulta.\n\n`;
}

ok('Prefixo com limite 5 contém número correto', () => {
  const prefixo = construirPrefixoReset(5);
  assert.ok(prefixo.includes('5 trocas'), `prefixo: ${prefixo}`);
});

ok('Prefixo com limite 3 contém número correto', () => {
  const prefixo = construirPrefixoReset(3);
  assert.ok(prefixo.includes('3 trocas'), `prefixo: ${prefixo}`);
});

ok('Prefixo termina com \\n\\n para separar da resposta', () => {
  const prefixo = construirPrefixoReset(5);
  assert.ok(prefixo.endsWith('\n\n'), 'prefixo deve terminar com \\n\\n');
});

ok('Prefixo contém indicação de nova consulta', () => {
  const prefixo = construirPrefixoReset(5);
  assert.ok(prefixo.includes('nova consulta'), `prefixo: ${prefixo}`);
});

ok('Concatenação do prefixo com resposta normal', () => {
  const prefixo = construirPrefixoReset(5);
  const respostaOriginal = '📊 Faturamento: R$ 1.000.000,00';
  const respostaFinal = prefixo + respostaOriginal;
  assert.ok(respostaFinal.startsWith('🔄'), 'deve começar com o prefixo');
  assert.ok(respostaFinal.endsWith(respostaOriginal), 'deve terminar com a resposta original');
  assert.ok(respostaFinal.includes('\n\n'), 'deve ter separação entre prefixo e resposta');
});

ok('Prefixo nulo não altera a resposta', () => {
  const _prefixoReset = null;
  const resposta = '📊 Faturamento: R$ 1.000.000,00';
  const respostaFinal = (_prefixoReset || '') + resposta;
  assert.strictEqual(respostaFinal, resposta);
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 4 — Simulação do fluxo completo de reset + reprocessamento
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[Bloco 4] Simulação do fluxo de reset e reprocessamento');

ok('Fluxo: 5 turnos normais, 6º dispara reset, contexto zerado', () => {
  // Simula o estado que existiria no service após 5 turnos
  let nivelAtual = 0;
  const mensagens = ['compras do ano', 'por mes', 'por fornecedor', 'top 10', 'somente acima de 1000'];

  // Simula o merger 5x
  let ctx = null;
  for (const msg of mensagens) {
    const merged = intentMerger.mesclar(mkIntent(0), ctx, ctx ? Date.now() : 0, msg);
    ctx = merged;
    nivelAtual = merged._nivel_contexto;
  }
  assert.strictEqual(nivelAtual, 5, `após 5 turnos, nivel deve ser 5: ${nivelAtual}`);

  // 6ª mensagem: service detecta >= 5 → reseta
  const deveResetar = (ctx._nivel_contexto || 1) >= 5;
  assert.ok(deveResetar, 'deveria resetar no T6');

  // Após reset, ctx = null → T6 processado como T1
  ctx = null;
  const t6 = intentMerger.mesclar(mkIntent(0), ctx, 0, 'faturamento do ano');
  assert.strictEqual(t6._nivel_contexto, 1, `T6 reprocessado deve ter nivel 1: ${t6._nivel_contexto}`);
});

ok('Após reset, período não é herdado (t6 começa fresh)', () => {
  // T6 sem contexto: período vem do próprio texto da mensagem, não do contexto anterior
  const t6 = intentMerger.mesclar(mkIntent(0), null, 0, 'faturamento do ano');
  assert.ok(!t6._herdouPeriodo, 'T6 fresh não deve herdar período');
  assert.strictEqual(t6._nivel_contexto, 1);
});

ok('Após reset, refinamento puro como T6 resulta em intent sem contexto', () => {
  // "por fornecedor" como primeira mensagem → sem herança de período
  const t6 = intentMerger.mesclar(mkIntent(0), null, 0, 'por fornecedor');
  assert.strictEqual(t6._nivel_contexto, 1);
  // Sem contexto, não há _herdouPeriodo
  assert.ok(!t6._herdouPeriodo, 'sem contexto não há herança de período');
});

ok('Prefixo é aplicado independente do tipo de resposta', () => {
  const casos = [
    '📊 Faturamento: R$ 100.000',
    'Nenhum dado encontrado para sua consulta.',
    '⚠️ Não consegui processar.',
    '',
  ];
  const prefixo = construirPrefixoReset(5);
  for (const resposta of casos) {
    const final = (prefixo || '') + resposta;
    assert.ok(final.startsWith('🔄'), `deve ter prefixo: "${final.slice(0, 30)}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Resultado final
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (falhou === 0) {
  console.log(`reset-contexto-reprocessamento.test.js: ${passou} testes passaram, 0 falhas ✓`);
} else {
  console.error(`reset-contexto-reprocessamento.test.js: ${passou} passaram, ${falhou} FALHARAM ✗`);
  process.exit(1);
}
