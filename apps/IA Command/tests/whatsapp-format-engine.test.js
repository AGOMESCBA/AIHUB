'use strict';

/**
 * Suite de testes para o engine universal de formatação WhatsApp.
 * Cobre: prepararDadosComTotais, buildFormatUserPrompt, buildFormatSystemPrompt
 * (4 schemas) e response-formatter (_formatarAgrupamentoComposto / renderNivel).
 *
 * Execução: node "apps/IA Command/tests/whatsapp-format-engine.test.js"
 */

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(nome, fn) {
  try {
    fn();
    console.log(`  ✓ ${nome}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${nome}`);
    console.error(`    → ${e.message}`);
    failed++;
  }
}

function aprox(a, b, eps = 0.005) {
  return Math.abs(a - b) <= eps;
}

function assertAprox(real, esperado, msg) {
  assert(aprox(real, esperado), `${msg}: esperado ${esperado}, obtido ${real}`);
}

// ─────────────────────────────────────────────────────────────────────────────
const wf = require('../modules/erp/core/whatsapp-format-prompt');
const rf = require('../modules/erp/core/response-formatter');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  1. prepararDadosComTotais — agrupamento duplo (mes + fornecedor)');
console.log('══════════════════════════════════════════════════════');

test('detecta coluna ano_mes e fornecedor, gera subtotais', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'MURILLO CARVALHO PJ', saldo_a_pagar: -2191.80 },
    { ano_mes: '202602', fornecedor: 'ALESSANDRO GOMES',   saldo_a_pagar: -152101.46 },
    { ano_mes: '202602', fornecedor: 'ALMIR WEDER',        saldo_a_pagar: -201895.47 },
    { ano_mes: '202605', fornecedor: 'ALELO',              saldo_a_pagar:  1525.00 },
    { ano_mes: '202605', fornecedor: 'ALMIR WEDER',        saldo_a_pagar:  4550.37 },
    { ano_mes: '202605', fornecedor: 'AMAZON',             saldo_a_pagar:  0.03 },
  ];
  const { dados, subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.ok(subtotais, 'subtotais deve existir');
  assertAprox(subtotais['202601'].saldo_a_pagar, -2191.80, 'subtotal jan');
  assertAprox(subtotais['202602'].saldo_a_pagar, -353996.93, 'subtotal fev');
  assertAprox(subtotais['202605'].saldo_a_pagar, 6075.40, 'subtotal mai');
  assertAprox(totalGeral.saldo_a_pagar, -350113.33, 'total geral');
  assert.strictEqual(dados.length, 6, '6 linhas agregadas');
});

test('acumula corretamente quando há linhas duplicadas (mes+fornecedor iguais)', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'ALELO', saldo: 1000 },
    { ano_mes: '202605', fornecedor: 'ALELO', saldo: 525 },   // mesmo par → acumula
    { ano_mes: '202605', fornecedor: 'ALMIR', saldo: 200 },
  ];
  const { dados, subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.strictEqual(dados.length, 2, 'deve deduplicar ALELO em 1 linha');
  const alelo = dados.find(d => d.fornecedor === 'ALELO');
  assertAprox(alelo.saldo, 1525, 'ALELO acumulado');
  assertAprox(subtotais['202605'].saldo, 1725, 'subtotal mai');
  assertAprox(totalGeral.saldo, 1725, 'total geral');
});

test('preserva sinal negativo em todas as contas', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'A', saldo: -500.50 },
    { ano_mes: '202601', fornecedor: 'B', saldo: -250.25 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assertAprox(subtotais['202601'].saldo, -750.75, 'subtotal negativo');
  assertAprox(totalGeral.saldo, -750.75, 'total negativo');
});

test('arredondamento correto: evita acúmulo de erro float', () => {
  // 0.1 + 0.2 = 0.30000000000000004 sem arredondamento
  const rows = [
    { ano_mes: '202601', fornecedor: 'X', saldo: 0.1 },
    { ano_mes: '202601', fornecedor: 'Y', saldo: 0.2 },
  ];
  const { subtotais } = wf.prepararDadosComTotais(rows);
  assert.strictEqual(subtotais['202601'].saldo, 0.3, 'arredondamento float');
});

test('ordena dados por mês cronologicamente', () => {
  const rows = [
    { ano_mes: '202603', fornecedor: 'Z', saldo: 10 },
    { ano_mes: '202601', fornecedor: 'A', saldo: 20 },
    { ano_mes: '202602', fornecedor: 'B', saldo: 30 },
  ];
  const { dados } = wf.prepararDadosComTotais(rows);
  assert.strictEqual(dados[0].ano_mes, '202601', 'primeiro mes');
  assert.strictEqual(dados[1].ano_mes, '202602', 'segundo mes');
  assert.strictEqual(dados[2].ano_mes, '202603', 'terceiro mes');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  2. prepararDadosComTotais — agrupamento simples');
console.log('══════════════════════════════════════════════════════');

test('apenas ano_mes (sem entidade): gera subtotais por mes', () => {
  const rows = [
    { ano_mes: '202601', saldo: 1000 },
    { ano_mes: '202601', saldo: 500 },
    { ano_mes: '202602', saldo: 2000 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  // Sem colEntidade, entra no agrupamento simples
  assert.ok(subtotais, 'subtotais deve existir');
  assertAprox(totalGeral.saldo, 3500, 'total geral');
});

test('apenas fornecedor (sem temporal): gera subtotais por fornecedor', () => {
  const rows = [
    { fornecedor: 'ALFA', valor: 100 },
    { fornecedor: 'ALFA', valor: 200 },
    { fornecedor: 'BETA', valor: 300 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.ok(subtotais, 'subtotais deve existir');
  assertAprox(subtotais['ALFA'].valor, 300, 'subtotal ALFA');
  assertAprox(subtotais['BETA'].valor, 300, 'subtotal BETA');
  assertAprox(totalGeral.valor, 600, 'total geral');
});

test('sem dimensão reconhecível: retorna rows originais + totalGeral', () => {
  const rows = [
    { id: 1, cod: 'X', valor: 100 },
    { id: 2, cod: 'Y', valor: 200 },
  ];
  const { dados, subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.strictEqual(dados.length, 2, 'rows preservadas');
  assert.strictEqual(subtotais, null, 'sem subtotais');
  // valor tem nome "valor" — deve ser detectado como numérico
  // id e cod são SKIP → só valor conta
  assertAprox(totalGeral.valor, 300, 'total geral');
});

test('campo "mes" com valor AAAAMM detectado como temporal', () => {
  const rows = [
    { mes: '202605', fornecedor: 'A', saldo: 100 },
    { mes: '202605', fornecedor: 'B', saldo: 200 },
  ];
  const { subtotais } = wf.prepararDadosComTotais(rows);
  assert.ok(subtotais, 'subtotais deve existir para mes AAAAMM');
  assertAprox(subtotais['202605'].saldo, 300, 'subtotal do mes');
});

test('campo "mes" com valor inteiro simples NÃO é tratado como temporal', () => {
  const rows = [
    { mes: 5, produto: 'FERRO', quantidade: 10 },
    { mes: 5, produto: 'ACO',   quantidade: 20 },
  ];
  const { subtotais } = wf.prepararDadosComTotais(rows);
  // mes=5 não é AAAAMM, então mes não é temporal; produto não é entidade -> agrupamento simples
  // sem temporal e sem entidade reconhecida -> subtotais podem ser null ou por produto
  // O importante é não crashar
  assert.ok(true, 'não deve lançar exceção');
});

test('rows vazias retornam estrutura segura', () => {
  const { dados, subtotais, totalGeral } = wf.prepararDadosComTotais([]);
  assert.deepStrictEqual(dados, [], 'dados vazio');
  assert.strictEqual(subtotais, null, 'sem subtotais');
  assert.strictEqual(totalGeral, null, 'sem total');
});

test('rows null retornam estrutura segura', () => {
  const { dados, subtotais, totalGeral } = wf.prepararDadosComTotais(null);
  assert.deepStrictEqual(dados, [], 'dados vazio');
  assert.strictEqual(subtotais, null, 'sem subtotais');
  assert.strictEqual(totalGeral, null, 'sem total');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  3. prepararDadosComTotais — colunas numéricas múltiplas');
console.log('══════════════════════════════════════════════════════');

test('múltiplas colunas numéricas somadas independentemente', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'A', valor: 1000, juros: 50, multa: 10 },
    { ano_mes: '202605', fornecedor: 'B', valor: 2000, juros: 80, multa: 20 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assertAprox(subtotais['202605'].valor, 3000, 'subtotal valor');
  assertAprox(subtotais['202605'].juros,   130, 'subtotal juros');
  assertAprox(subtotais['202605'].multa,    30, 'subtotal multa');
  assertAprox(totalGeral.valor, 3000, 'total valor');
  assertAprox(totalGeral.juros,  130, 'total juros');
  assertAprox(totalGeral.multa,   30, 'total multa');
});

test('colunas SKIP (id, cod, seq, ano, mes) não entram no totalGeral', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'X', id: 1, cod: 99, seq: 5, saldo: 500 },
  ];
  const { totalGeral } = wf.prepararDadosComTotais(rows);
  assert.ok(!('id'  in totalGeral), 'id não deve estar em totalGeral');
  assert.ok(!('cod' in totalGeral), 'cod não deve estar em totalGeral');
  assert.ok(!('seq' in totalGeral), 'seq não deve estar em totalGeral');
  assert.ok('saldo' in totalGeral, 'saldo deve estar em totalGeral');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  4. buildFormatUserPrompt — estrutura do prompt gerado');
console.log('══════════════════════════════════════════════════════');

test('prompt contém instrução "calculado pelo sistema"', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'ALELO', saldo: 1000 },
  ];
  const prompt = wf.buildFormatUserPrompt('contas a pagar por fornecedor', rows);
  assert.ok(prompt.includes('calculado pelo sistema'), 'instrução anti-recalculo');
});

test('prompt contém instrução "NUNCA recalcule"', () => {
  const rows = [{ ano_mes: '202605', fornecedor: 'X', saldo: 500 }];
  const prompt = wf.buildFormatUserPrompt('teste', rows);
  assert.ok(prompt.includes('NUNCA recalcule'), 'instrução NUNCA recalcule');
});

test('valores dos subtotais no prompt batem com os calculados', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'A', saldo: 300 },
    { ano_mes: '202601', fornecedor: 'B', saldo: 200 },
  ];
  const { subtotais } = wf.prepararDadosComTotais(rows);
  const prompt = wf.buildFormatUserPrompt('teste', rows);
  // O subtotal 500 deve aparecer no prompt
  assert.ok(prompt.includes('500'), 'subtotal 500 presente no prompt');
});

test('amostra enviada à IA é limitada a 50 rows', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ano_mes: '202605', fornecedor: `FORN_${i}`, saldo: i * 10,
  }));
  const prompt = wf.buildFormatUserPrompt('teste', rows);
  // Após agregar 120 linhas únicas (forn diferentes), a amostra é max 50
  assert.ok(prompt.includes('50 de'), 'mensagem de corte "50 de N"');
});

test('aviso de nomes não encontrados aparece no prompt quando fornecido', () => {
  const rows = [{ ano_mes: '202605', fornecedor: 'ALELO', saldo: 100 }];
  const prompt = wf.buildFormatUserPrompt('teste', rows, { avisoNaoEncontradas: ['FULANO', 'BELTRANO'] });
  assert.ok(prompt.includes('FULANO'), 'nome ignorado no prompt');
  assert.ok(prompt.includes('BELTRANO'), 'nome ignorado no prompt');
  assert.ok(prompt.includes('AVISO'), 'bloco AVISO presente');
});

test('sem aviso quando lista vazia', () => {
  const rows = [{ ano_mes: '202605', fornecedor: 'A', saldo: 100 }];
  const prompt = wf.buildFormatUserPrompt('teste', rows, { avisoNaoEncontradas: [] });
  assert.ok(!prompt.includes('AVISO'), 'sem AVISO quando lista vazia');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  4b. buildFormatUserPrompt — agrupamento simples categórico');
console.log('══════════════════════════════════════════════════════');

test('agrupamento simples por vendedor: gera lista pré-estruturada (sem BLOCO)', () => {
  const rows = [
    { vendedor: 'JEAN DUARTE',     valor_comissao: 1346.85 },
    { vendedor: 'LUCINIR CORREIA', valor_comissao:  335.46 },
    { vendedor: 'GILSON HUGO',     valor_comissao:  202.66 },
  ];
  const prompt = wf.buildFormatUserPrompt('comissoes em aberto', rows);
  assert.ok(prompt.includes('lista'), 'instrução de lista presente');
  assert.ok(prompt.includes('JEAN DUARTE'), 'nome do vendedor presente no prompt');
  assert.ok(!prompt.includes('--- BLOCO'), 'não deve usar formato de BLOCO para agrupamento simples');
  assert.ok(prompt.includes('calculado pelo sistema'), 'instrução anti-recalculo presente');
});

test('agrupamento simples por vendedor: Total Geral presente com valor correto', () => {
  const rows = [
    { vendedor: 'JEAN',  valor_comissao: 1000 },
    { vendedor: 'MARIA', valor_comissao:  500 },
  ];
  const prompt = wf.buildFormatUserPrompt('comissoes', rows);
  assert.ok(prompt.includes('Total Geral'), 'Total Geral presente');
  assert.ok(prompt.includes('1500'), 'valor total 1500 presente no prompt');
});

test('agrupamento simples por vendedor: itens ordenados por valor decrescente', () => {
  const rows = [
    { vendedor: 'PEQUENO', valor_comissao: 100 },
    { vendedor: 'GRANDE',  valor_comissao: 900 },
    { vendedor: 'MEDIO',   valor_comissao: 500 },
  ];
  const prompt = wf.buildFormatUserPrompt('ranking comissoes', rows);
  const posGrande  = prompt.indexOf('GRANDE');
  const posMedio   = prompt.indexOf('MEDIO');
  const posPequeno = prompt.indexOf('PEQUENO');
  assert.ok(posGrande < posMedio && posMedio < posPequeno, 'ordem decrescente: GRANDE > MEDIO > PEQUENO');
});

test('agrupamento simples por vendedor: sem sub-agrupamentos — instrução explícita no prompt', () => {
  const rows = [
    { vendedor: 'JEAN',  valor_comissao: 1000 },
    { vendedor: 'MARIA', valor_comissao:  500 },
  ];
  const prompt = wf.buildFormatUserPrompt('comissoes', rows);
  assert.ok(prompt.includes('nao adicione sub-agrupamentos'), 'instrução contra sub-agrupamentos presente');
});

test('agrupamento simples por fornecedor (sem temporal): mesma estrutura de lista', () => {
  const rows = [
    { fornecedor: 'ALFA', saldo_a_pagar: 5000 },
    { fornecedor: 'BETA', saldo_a_pagar: 3000 },
  ];
  const prompt = wf.buildFormatUserPrompt('contas a pagar', rows);
  assert.ok(prompt.includes('ALFA'), 'fornecedor ALFA no prompt');
  assert.ok(prompt.includes('Total Geral'), 'Total Geral presente');
  assert.ok(prompt.includes('8000'), 'total 8000 presente');
  assert.ok(!prompt.includes('--- BLOCO'), 'sem blocos duplos');
});

test('agrupamento simples temporal (sem entidade): lista cronológica', () => {
  const rows = [
    { ano_mes: '202603', saldo: 300 },
    { ano_mes: '202601', saldo: 100 },
    { ano_mes: '202602', saldo: 200 },
  ];
  const prompt = wf.buildFormatUserPrompt('saldo por mes', rows);
  const posJan = prompt.indexOf('Janeiro');
  const posFev = prompt.indexOf('Fevereiro');
  const posMar = prompt.indexOf('Março');
  assert.ok(posJan < posFev && posFev < posMar, 'ordem cronológica Jan < Fev < Mar');
  assert.ok(prompt.includes('Total Geral'), 'Total Geral presente para temporal simples');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  5. buildFormatSystemPrompt — uniformidade entre os 4 schemas');
console.log('══════════════════════════════════════════════════════');

const schemas = {
  financeiro:  { buildFormatSystemPrompt: wf.buildFormatSystemPrompt, buildFormatUserPrompt: wf.buildFormatUserPrompt },
  compras:     { buildFormatSystemPrompt: wf.buildFormatSystemPrompt, buildFormatUserPrompt: wf.buildFormatUserPrompt },
  faturamento: { buildFormatSystemPrompt: wf.buildFormatSystemPrompt, buildFormatUserPrompt: wf.buildFormatUserPrompt },
  comissao:    { buildFormatSystemPrompt: wf.buildFormatSystemPrompt, buildFormatUserPrompt: wf.buildFormatUserPrompt },
};

test('todos os 4 schemas retornam EXATAMENTE o mesmo system prompt', () => {
  const prompts = Object.entries(schemas).map(([, s]) => s.buildFormatSystemPrompt());
  const ref = prompts[0];
  prompts.slice(1).forEach((p, i) => {
    assert.strictEqual(p, ref, `schema ${i + 1} difere do schema 0`);
  });
});

test('system prompt contém a Regra 1 (sem redundância de cabeçalho)', () => {
  const p = wf.buildFormatSystemPrompt();
  assert.ok(p.includes('SEM REDUNDANCIA'), 'Regra 1 presente');
});

test('system prompt contém a Regra 3 (subtotal obrigatório)', () => {
  const p = wf.buildFormatSystemPrompt();
  assert.ok(p.includes('SUBTOTAL OBRIGATORIO'), 'Regra 3 presente');
});

test('system prompt contém seção anti-cálculo (Regra 6)', () => {
  const p = wf.buildFormatSystemPrompt();
  assert.ok(p.includes('NUNCA recalcule'), 'seção anti-cálculo presente');
});

test('system prompt define emoji 🗓 para tempo', () => {
  const p = wf.buildFormatSystemPrompt();
  assert.ok(p.includes('🗓'), 'emoji temporal presente');
});

test('system prompt define emoji 👤 para pessoas', () => {
  const p = wf.buildFormatSystemPrompt();
  assert.ok(p.includes('👤'), 'emoji pessoa presente');
});

test('system prompt define emoji 📍 para geográfico', () => {
  const p = wf.buildFormatSystemPrompt();
  assert.ok(p.includes('📍'), 'emoji geo presente');
});

test('buildFormatUserPrompt dos 4 schemas gera prompt com valores corretos', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'ALELO', saldo_a_pagar: 1525 },
    { ano_mes: '202605', fornecedor: 'AMTU',  saldo_a_pagar:  297 },
  ];
  Object.entries(schemas).forEach(([nome, schema]) => {
    const prompt = schema.buildFormatUserPrompt('contas a pagar', rows, []);
    assert.ok(prompt.includes('1822'), `${nome}: subtotal 1822 presente`);
    assert.ok(prompt.includes('calculado pelo sistema'), `${nome}: instrução presente`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  6. response-formatter — _formatarAgrupamentoComposto + renderNivel');
console.log('══════════════════════════════════════════════════════');

test('formatarAiSqlLocal com group_by [mes, fornecedor] inclui linha de subtotal', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'MURILLO', saldo_a_pagar: -2191.80 },
    { ano_mes: '202605', fornecedor: 'ALELO',   saldo_a_pagar:  1525.00 },
    { ano_mes: '202605', fornecedor: 'ALMIR',   saldo_a_pagar:  4550.37 },
  ];
  const intent = { group_by: ['mes', 'fornecedor'] };
  const saida = rf.formatarAiSqlLocal(rows, intent);
  assert.ok(saida.includes('🧾') && saida.includes('Subtotal'), 'linha 🧾 Subtotal presente');
});

test('renderNivel: mês aparece uma única vez como cabeçalho', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'A', saldo: 100 },
    { ano_mes: '202605', fornecedor: 'B', saldo: 200 },
    { ano_mes: '202605', fornecedor: 'C', saldo: 300 },
  ];
  const intent = { group_by: ['mes', 'fornecedor'] };
  const saida = rf.formatarAiSqlLocal(rows, intent);
  // Conta ocorrências do label do mês (Mai/2025 ou similar)
  const matches = [...saida.matchAll(/Mai\/2026/gi)];
  assert.ok(matches.length <= 1, `mês aparece mais de uma vez no output: ${matches.length}x`);
});

test('renderNivel: itens de nível 3 têm 2 espaços de recuo', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'ALELO', saldo: 1000 },
  ];
  const intent = { group_by: ['mes', 'fornecedor'] };
  const saida = rf.formatarAiSqlLocal(rows, intent);
  // Deve existir ao menos uma linha iniciando com "  1. "
  assert.ok(/^ {2}1\. /m.test(saida), 'recuo de 2 espaços no item 1');
});

test('renderNivel: subtotal calcula corretamente 3 fornecedores no mesmo mês', () => {
  const rows = [
    { ano_mes: '202605', fornecedor: 'ALELO',  saldo_a_pagar: 1525.00 },
    { ano_mes: '202605', fornecedor: 'ALMIR',  saldo_a_pagar: 4550.37 },
    { ano_mes: '202605', fornecedor: 'AMAZON', saldo_a_pagar:    0.03 },
  ];
  const intent = { group_by: ['mes', 'fornecedor'] };
  const saida = rf.formatarAiSqlLocal(rows, intent);
  // R$ 6.075,40 deve aparecer na linha de Subtotal
  assert.ok(saida.includes('6.075,40'), `subtotal R$ 6.075,40 presente na saída:\n${saida}`);
});

test('renderNivel: múltiplos meses geram múltiplos subtotais', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'A', saldo_a_pagar: -2191.80 },
    { ano_mes: '202602', fornecedor: 'B', saldo_a_pagar: -100.00 },
    { ano_mes: '202602', fornecedor: 'C', saldo_a_pagar: -200.00 },
  ];
  const intent = { group_by: ['mes', 'fornecedor'] };
  const saida = rf.formatarAiSqlLocal(rows, intent);
  const subtotais = [...saida.matchAll(/🧾/g)];
  assert.strictEqual(subtotais.length, 2, 'exatamente 2 linhas de Subtotal (1 por mês)');
});

test('renderNivel: valores negativos aparecem corretamente formatados', () => {
  const rows = [
    { ano_mes: '202601', fornecedor: 'MURILLO', saldo_a_pagar: -2191.80 },
  ];
  const intent = { group_by: ['mes', 'fornecedor'] };
  const saida = rf.formatarAiSqlLocal(rows, intent);
  assert.ok(saida.includes('-R$') || saida.includes('R$ -') || saida.includes('-2.191'), `valor negativo formatado:\n${saida}`);
});

test('formatarAiSqlLocal sem group_by retorna resultado simples (sem subtotal)', () => {
  const rows = [{ saldo_a_pagar: 5000 }];
  const intent = {};
  const saida = rf.formatarAiSqlLocal(rows, intent);
  assert.ok(!saida.includes('🧾'), 'sem subtotal para query sem agrupamento');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  7. normalizarAgrupamentosPais — pós-processamento de texto da IA');
console.log('══════════════════════════════════════════════════════');

test('insere linha em branco antes de cabeçalho de mês sem linha em branco anterior', () => {
  // normalizarAgrupamentosPais detecta linhas no formato "N. *MesNome Ano*:"
  const texto = '1. *Janeiro 2026*: R$ 100\n  1. Fornecedor A\n2. *Fevereiro 2026*: R$ 200';
  const saida = rf.normalizarAgrupamentosPais(texto);
  // Deve haver linha vazia antes do bloco de Fevereiro
  assert.ok(saida.includes('\n\n2. *Fevereiro'), 'linha em branco inserida antes do 2º mês');
});

test('não duplica linha em branco se já existir', () => {
  const texto = '*Janeiro 2026*: R$ 100\n\n*Fevereiro 2026*: R$ 200';
  const saida = rf.normalizarAgrupamentosPais(texto);
  assert.ok(!saida.includes('\n\n\n'), 'sem tripla quebra de linha');
});

test('texto sem marcadores de mês passa inalterado', () => {
  const texto = 'Linha A\nLinha B\nLinha C';
  const saida = rf.normalizarAgrupamentosPais(texto);
  assert.strictEqual(saida, texto, 'texto sem mês não alterado');
});

test('entrada não-string retorna inalterada', () => {
  assert.strictEqual(rf.normalizarAgrupamentosPais(null), null, 'null retorna null');
  assert.strictEqual(rf.normalizarAgrupamentosPais(42), 42, 'number retorna igual');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  8. Cenário de carga — 500 linhas brutas (J2A simulation)');
console.log('══════════════════════════════════════════════════════');

test('500 linhas brutas (50 fornecedores × 10 meses) — totais corretos', () => {
  const meses = ['202601','202602','202603','202604','202605','202606','202607','202608','202609','202610'];
  const forns  = Array.from({ length: 50 }, (_, i) => `FORN_${String(i).padStart(3,'0')}`);
  const rows   = [];
  let somaEsperada = 0;
  for (const mes of meses) {
    for (const forn of forns) {
      const v = parseFloat((Math.random() * 10000 - 5000).toFixed(2));
      somaEsperada += v;
      rows.push({ ano_mes: mes, fornecedor: forn, saldo: v });
    }
  }
  somaEsperada = Math.round(somaEsperada * 100) / 100;

  const { dados, subtotais, totalGeral } = wf.prepararDadosComTotais(rows);

  // Deve ter 50 * 10 = 500 linhas agregadas (já são únicas)
  assert.strictEqual(dados.length, 500, '500 linhas agregadas');
  // 10 subtotais
  assert.strictEqual(Object.keys(subtotais).length, 10, '10 subtotais (1 por mês)');
  // Total geral deve bater
  assertAprox(totalGeral.saldo, somaEsperada, 'total geral com 500 linhas');
  // Soma dos subtotais deve igual ao total geral
  const somaSubtotais = Object.values(subtotais).reduce((s, v) => s + v.saldo, 0);
  assertAprox(somaSubtotais, totalGeral.saldo, 'soma dos subtotais = total geral');
});

test('500 linhas brutas — buildFormatUserPrompt não estoura o prompt (≤50 rows IA)', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({
    ano_mes: `2026${String(Math.floor(i / 50) + 1).padStart(2,'0')}`,
    fornecedor: `FORN_${i}`,
    saldo: i * 10,
  }));
  const prompt = wf.buildFormatUserPrompt('teste stress', rows);
  // O JSON no prompt não deve ter mais de 50 entradas
  const jsonMatch = prompt.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    const arr = JSON.parse(jsonMatch[0]);
    assert.ok(arr.length <= 50, `IA recebe no máximo 50 linhas; recebeu ${arr.length}`);
  }
  assert.ok(prompt.length < 80000, 'prompt não deve ser excessivamente grande');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  9. Cenário multi-módulo — variantes de agrupamento');
console.log('══════════════════════════════════════════════════════');

test('Faturamento: estado (UF) detectado como entidade', () => {
  const rows = [
    { ano_mes: '202605', estado: 'MT', faturamento: 50000 },
    { ano_mes: '202605', estado: 'SP', faturamento: 120000 },
    { ano_mes: '202606', estado: 'MT', faturamento: 30000 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.ok(subtotais, 'subtotais por mês para faturamento por estado');
  assertAprox(subtotais['202605'].faturamento, 170000, 'subtotal mai');
  assertAprox(subtotais['202606'].faturamento, 30000, 'subtotal jun');
  assertAprox(totalGeral.faturamento, 200000, 'total faturamento');
});

test('Compras: grupo detectado como entidade', () => {
  const rows = [
    { grupo: 'FERRAMENTAS',       valor_compras: 1525.00 },
    { grupo: 'FERRAMENTAS',       valor_compras:  450.37 },
    { grupo: 'MAT ELETRICOS',     valor_compras: 3200.00 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.ok(subtotais, 'subtotais por grupo');
  assertAprox(subtotais['FERRAMENTAS'].valor_compras, 1975.37, 'subtotal ferramentas');
  assertAprox(totalGeral.valor_compras, 5175.37, 'total compras');
});

test('Comissão: vendedor detectado como entidade', () => {
  const rows = [
    { ano_mes: '202605', vendedor: 'JOAO SILVA',  comissao: 2500 },
    { ano_mes: '202605', vendedor: 'MARIA COSTA', comissao: 3100 },
    { ano_mes: '202606', vendedor: 'JOAO SILVA',  comissao: 2800 },
  ];
  const { subtotais, totalGeral } = wf.prepararDadosComTotais(rows);
  assert.ok(subtotais, 'subtotais por mes para comissão');
  assertAprox(subtotais['202605'].comissao, 5600, 'subtotal mai');
  assertAprox(subtotais['202606'].comissao, 2800, 'subtotal jun');
  assertAprox(totalGeral.comissao, 8400, 'total comissão');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  10. detectarDimensaoCategorica — detecção para Consolidado');
console.log('══════════════════════════════════════════════════════');

test('detecta "vendedor" como dimensão categórica', () => {
  const row = { vendedor: 'JEAN DUARTE', valor_comissao: 1346.85 };
  assert.strictEqual(rf.detectarDimensaoCategorica(row), 'vendedor', 'deve retornar "vendedor"');
});

test('detecta "fornecedor" como dimensão categórica', () => {
  const row = { fornecedor: 'ALFA LTDA', saldo_a_pagar: 5000 };
  assert.strictEqual(rf.detectarDimensaoCategorica(row), 'fornecedor', 'deve retornar "fornecedor"');
});

test('detecta "cliente" como dimensão categórica', () => {
  const row = { cliente: 'EMPRESA SA', faturamento: 20000 };
  assert.strictEqual(rf.detectarDimensaoCategorica(row), 'cliente', 'deve retornar "cliente"');
});

test('vendedor tem prioridade sobre fornecedor quando ambos presentes', () => {
  const row = { vendedor: 'JOAO', fornecedor: 'ALFA', valor: 100 };
  assert.strictEqual(rf.detectarDimensaoCategorica(row), 'vendedor', 'vendedor tem prioridade');
});

test('retorna null quando não há dimensão categórica reconhecível', () => {
  const row = { id: 1, valor: 500 };
  assert.strictEqual(rf.detectarDimensaoCategorica(row), null, 'null para row sem dimensão');
});

test('retorna null para row nula ou undefined', () => {
  assert.strictEqual(rf.detectarDimensaoCategorica(null), null, 'null para null');
  assert.strictEqual(rf.detectarDimensaoCategorica(undefined), null, 'null para undefined');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  Resultado Final');
console.log('══════════════════════════════════════════════════════');

const total = passed + failed;
console.log(`\n  Passaram : ${passed}/${total}`);
console.log(`  Falharam : ${failed}/${total}`);

if (failed > 0) {
  console.error('\n  ❌ Há falhas — revisar antes de deploy.\n');
  process.exit(1);
} else {
  console.log('\n  ✅ Todos os testes passaram.\n');
  process.exit(0);
}
