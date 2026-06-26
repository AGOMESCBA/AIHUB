'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const canonical = require(path.join(ROOT, 'modules/erp/canonical-whatsapp-format'));

let passou = 0;
let falhou = 0;

function ok(desc, fn) {
  try {
    fn();
    console.log(`  ok - ${desc}`);
    passou++;
  } catch (e) {
    console.error(`  fail - ${desc}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

console.log('\n[whatsapp-canonical-format]');

ok('etapa 1: formata metricas simples com resultado recebido-pago', () => {
  const texto = canonical.renderSingle([
    { valor_recebido: 508884.06, valor_pago: 413498.60 },
  ], { nomeModulo: 'Financeiro', contextoConsulta: 'Contas recebidas e pagas | Jun/2026' });

  assert.ok(texto.includes('*Financeiro --> Contas recebidas e pagas | Jun/2026*'), texto);
  assert.ok(texto.includes('Recebido: *R$'), texto);
  assert.ok(texto.includes('Pago: *R$'), texto);
  assert.ok(texto.includes('*Resultado*: *R$'), texto);
  assert.ok(texto.includes('*Total Geral*: R$'), texto);
});

ok('etapa 1: consolidado soma mesmas metricas em todas as empresas', () => {
  const texto = canonical.renderAll([
    { nomeEmpresa: 'C3i Systems', rows: [{ valor_recebido: 327.87, valor_pago: 18592.51 }] },
    { nomeEmpresa: 'J2A Consultoria', rows: [{ valor_recebido: 508884.06, valor_pago: 413498.60 }] },
  ], { mensagem: 'contas pagas e recebidas no mes' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(texto.includes('C3i Systems'), texto);
  assert.ok(texto.includes('J2A Consultoria'), texto);
  assert.ok(texto.includes('Recebido: *R$'), texto);
  assert.ok(texto.includes('Pago: *R$'), texto);
  assert.ok(texto.includes('*Total Geral*: R$'), texto);
  assert.ok(!texto.includes('valor_recebido'), texto);
});

ok('consolidado soma metricas equivalentes com aliases diferentes', () => {
  const texto = canonical.renderAll([
    { nomeEmpresa: 'C3i Systems', rows: [{ total_compras: 29743.83 }] },
    { nomeEmpresa: 'J2A Consultoria', rows: [{ valor_compra: 307249.04 }] },
  ], { mensagem: 'notas de entradas no mes de janeiro' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(/C3i Systems: Compras: \*R\$\s*29\.743,83\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Compras: \*R\$\s*307\.249,04\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Compras: \*R\$\s*336\.992,87\*/.test(texto), texto);
  assert.ok(!/J2A Consultoria: .*R\$\s*0,00/.test(texto), texto);
  assert.ok(!texto.includes('total_compras'), texto);
  assert.ok(!texto.includes('valor_compra'), texto);
});

ok('financeiro aberto: separa carteira pagar e receber quando UNION usa alias unico', () => {
  const rows = [
    { carteira: 'pagar', saldo_a_pagar: '478493,69' },
    { carteira: 'receber', saldo_a_pagar: '504299,91' },
  ];
  const shape = canonical.detectarShape(rows);
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Jun a Jun/2026 | Preciso do total do contas a pagar e a receber em aberto do mes.',
  });

  assert.strictEqual(shape.tipo, 'categoria_metrica_unica');
  assert.ok(texto.includes('*Financeiro --> Jun a Jun/2026 | Preciso do total do contas a pagar e a receber em aberto do mes.*'), texto);
  assert.ok(/A pagar: \*R\$\s*478\.493,69\*/.test(texto), texto);
  assert.ok(/A receber: \*R\$\s*504\.299,91\*/.test(texto), texto);
  assert.ok(!/1\. A pagar: \*R\$\s*982\.793,60\*/.test(texto), texto);
});

ok('financeiro aberto: consolidado separa carteira pagar e receber com alias unico', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { carteira: 'pagar', saldo_a_pagar: 278154.68 },
        { carteira: 'receber', saldo_a_pagar: 1000 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { carteira: 'pagar', saldo_a_pagar: '478493,69' },
        { carteira: 'receber', saldo_a_pagar: '504299,91' },
      ],
    },
  ], { mensagem: 'Preciso do total do contas a pagar e a receber em aberto do mes.' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(texto.includes('C3i Systems: A pagar:'), texto);
  assert.ok(texto.includes('J2A Consultoria: A pagar:'), texto);
  assert.ok(/A pagar: \*R\$\s*756\.648,37\*/.test(texto), texto);
  assert.ok(/A receber: \*R\$\s*505\.299,91\*/.test(texto), texto);
  assert.ok(!/A pagar: \*R\$\s*1\.261\.948,28\*/.test(texto), texto);
});

ok('categoria semantica: separa entrada e saida com alias unico', () => {
  const rows = [
    { tipo_movimento: 'entrada', valor_total: 1500 },
    { tipo_movimento: 'saida', valor_total: 700 },
  ];
  const shape = canonical.detectarShape(rows);
  const texto = canonical.renderSingle(rows, { nomeModulo: 'Financeiro', contextoConsulta: 'Fluxo por tipo' });

  assert.strictEqual(shape.tipo, 'categoria_metrica_unica');
  assert.ok(/Entrada: \*R\$\s*1\.500,00\*/.test(texto), texto);
  assert.ok(/Saida: \*R\$\s*700,00\*/.test(texto), texto);
  assert.ok(!/Valor Total: \*R\$\s*2\.200,00\*/.test(texto), texto);
});

ok('categoria semantica: separa receita e despesa com alias unico', () => {
  const rows = [
    { natureza: 'receita', total: 8000 },
    { natureza: 'despesa', total: 3000 },
  ];
  const shape = canonical.detectarShape(rows);
  const texto = canonical.renderSingle(rows, { nomeModulo: 'Financeiro', contextoConsulta: 'Receitas e despesas' });

  assert.strictEqual(shape.tipo, 'categoria_metrica_unica');
  assert.ok(/Receita: \*R\$\s*8\.000,00\*/.test(texto), texto);
  assert.ok(/Despesa: \*R\$\s*3\.000,00\*/.test(texto), texto);
  assert.ok(!/Total: \*R\$\s*11\.000,00\*/.test(texto), texto);
});

ok('etapa 2: formata uma dimensao por vendedor', () => {
  const texto = canonical.renderSingle([
    { vendedor: 'Ana', total_faturamento: 1000 },
    { vendedor: 'Bruno', total_faturamento: 500 },
    { vendedor: 'Ana', total_faturamento: 250 },
  ], { nomeModulo: 'Faturamento', contextoConsulta: 'Por vendedor' });

  assert.ok(texto.includes('*Por Vendedor*'), texto);
  assert.ok(texto.includes('Ana: Faturamento: *R$'), texto);
  assert.ok(texto.includes('Bruno: Faturamento: *R$'), texto);
  assert.ok(texto.includes('*Total Geral*: Faturamento: *R$'), texto);
});

ok('etapa 2: reconhece mes numerico como dimensao temporal', () => {
  const rows = [
    { mes: 6, total_faturamento: 1000 },
    { mes: 5, total_faturamento: 500 },
  ];
  const shape = canonical.detectarShape(rows);
  const texto = canonical.renderSingle(rows, { nomeModulo: 'Faturamento' });

  assert.strictEqual(shape.tipo, 'uma_dimensao');
  assert.strictEqual(shape.dimensao, 'mes');
  assert.ok(texto.indexOf('Maio') < texto.indexOf('Junho'), texto);
});

ok('etapa 3: formata duas dimensoes mes e vendedor', () => {
  const texto = canonical.renderSingle([
    { mes: 6, vendedor: 'Ana', total_faturamento: 1000 },
    { mes: 6, vendedor: 'Bruno', total_faturamento: 500 },
    { mes: 5, vendedor: 'Ana', total_faturamento: 250 },
  ], { nomeModulo: 'Faturamento' });

  assert.ok(texto.includes('*Por Mes e Vendedor*'), texto);
  assert.ok(texto.indexOf('*Maio*') < texto.indexOf('*Junho*'), texto);
  assert.ok(texto.includes('Ana: Faturamento: *R$'), texto);
  assert.ok(texto.includes('Subtotal: Faturamento: *R$'), texto);
});

ok('etapa 3/4: formata comparativo mes e ano', () => {
  const texto = canonical.renderSingle([
    { mes: 1, ano: 2025, total_faturamento: 1000 },
    { mes: 1, ano: 2026, total_faturamento: 1500 },
    { mes: 2, ano: 2025, total_faturamento: 800 },
    { mes: 2, ano: 2026, total_faturamento: 900 },
  ], { nomeModulo: 'Faturamento', contextoConsulta: 'Comparativo' });

  assert.ok(texto.includes('*Por Mes e Ano*'), texto);
  assert.ok(texto.includes('*Janeiro*'), texto);
  assert.ok(texto.includes('2025: Faturamento: *R$'), texto);
  assert.ok(texto.includes('2026: Faturamento: *R$'), texto);
});

ok('etapa 4: preserva metricas atual e anterior em comparativo', () => {
  const texto = canonical.renderSingle([
    { mes: 1, faturamento_atual: 1500, faturamento_anterior: 1000, crescimento_pct: 50 },
    { mes: 2, faturamento_atual: 900, faturamento_anterior: 800, crescimento_pct: 12.5 },
  ], { nomeModulo: 'Faturamento', contextoConsulta: 'Comparativo' });

  assert.ok(texto.includes('Faturamento Atual: *R$'), texto);
  assert.ok(texto.includes('Faturamento Anterior: *R$'), texto);
  assert.ok(!texto.includes('crescimento_pct'), texto);
});

ok('etapa 4: formata detalhe por cliente e documento', () => {
  const texto = canonical.renderSingle([
    { cliente: 'BIPAR', documento: '004750', valor_total: 4906.62 },
    { cliente: 'BIPAR', documento: '004767', valor_total: 12000 },
    { cliente: 'ABACO', documento: '004765', valor_total: 4117.05 },
  ], { nomeModulo: 'Faturamento' });

  assert.ok(texto.includes('*Detalhamento por Cliente e Documento*'), texto);
  assert.ok(texto.includes('*BIPAR*'), texto);
  assert.ok(texto.includes('Doc. 004750: Valor Total: *R$'), texto);
  assert.ok(texto.includes('Doc. 004767: Valor Total: *R$'), texto);
  assert.ok(texto.includes('*Total Geral*: Valor Total: *R$'), texto);
});

ok('etapa 4: consolidado preserva detalhe por documento', () => {
  const texto = canonical.renderAll([
    { nomeEmpresa: 'Empresa A', rows: [{ cliente: 'BIPAR', documento: '004750', valor_total: 100 }] },
    { nomeEmpresa: 'Empresa B', rows: [{ cliente: 'BIPAR', documento: '004750', valor_total: 200 }] },
  ], { mensagem: 'documentos por cliente' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(texto.includes('Doc. 004750: Valor Total: *R$'), texto);
  assert.ok(texto.includes('*Total Geral*: Valor Total: *R$'), texto);
});

ok('multidimensional: formata saldo bancario por banco agencia e conta', () => {
  const rows = [
    { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: '4263046', saldo: '37158,8' },
    { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: 'CDB', saldo: 445510.97 },
    { E8_BANCO: '341', E8_AGENCIA: '0288', E8_CONTA: '50593', saldo: 298802.34 },
  ];
  const shape = canonical.detectarShape(rows);
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Saldos bancarios por Banco, Agencia e Conta Corrente',
  });

  assert.strictEqual(shape.tipo, 'multiplas_dimensoes');
  assert.deepStrictEqual(shape.dimensoes, ['E8_BANCO', 'E8_AGENCIA', 'E8_CONTA']);
  assert.ok(texto.includes('*Financeiro --> Saldos bancarios por Banco, Agencia e Conta Corrente*'), texto);
  assert.ok(texto.includes('*Por Banco, Agencia, Conta Corrente*'), texto);
  assert.ok(texto.includes('Banco 077 | Agencia 0001 | Conta Corrente CDB: Saldo: *R$'), texto);
  assert.ok(/R\$\s*37\.158,80/.test(texto), texto);
  assert.ok(texto.includes('*Total Geral*: Saldo: *R$'), texto);
});

ok('multidimensional: consolidado soma saldo bancario por banco agencia e conta', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: '4263046', saldo: '37158,8' },
        { E8_BANCO: '341', E8_AGENCIA: '0288', E8_CONTA: '50593', saldo: 298802.34 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: '4263046', saldo: 100 },
      ],
    },
  ], { mensagem: 'Saldos bancarios por Banco, Agencia e Conta Corrente, excluindo CX1 e CX2' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(texto.includes('_Saldos bancarios por Banco, Agencia e Conta Corrente, excluindo CX1 e CX2_'), texto);
  assert.ok(texto.includes('*Por Banco, Agencia, Conta Corrente*'), texto);
  assert.ok(/Banco 077 \| Agencia 0001 \| Conta Corrente 4263046: Saldo: \*R\$\s*37\.258,80\*/.test(texto), texto);
  assert.ok(texto.includes('*Total Geral*: Saldo: *R$'), texto);
});

ok('fluxo projetado: consolidado soma por dia periodo e empresa', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { data_fluxo: '2026-06-22', entrada: 0, saida: 85906.72 },
        { data_fluxo: '2026-06-29', entrada: 198400, saida: 85906.72 },
        { data_fluxo: '2026-06-30', entrada: 581440, saida: 85906.72 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { data_fluxo: '2026-06-22', entrada: 61205303.90, saida: 73392756.20 },
        { data_fluxo: '2026-06-24', entrada: 9556166.10, saida: 63819788.00 },
        { data_fluxo: '2026-06-30', entrada: 15492163.40, saida: 14359452.30 },
      ],
    },
  ], { mensagem: 'Preciso do fluxo de caixa projetado dos proximos 30 dias detalhado por dia.' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(texto.includes('*Por Data Fluxo*'), texto);
  assert.ok(/22\/06\/2026: Entradas: \*R\$\s*61\.205\.303,90\* \| Saidas: \*R\$\s*73\.478\.662,92\*/.test(texto), texto);
  assert.ok(/30\/06\/2026: Entradas: \*R\$\s*16\.073\.603,40\* \| Saidas: \*R\$\s*14\.445\.359,02\*/.test(texto), texto);
  assert.ok(/\*Subtotal\*: Entradas: \*R\$\s*87\.033\.473,40\* \| Saidas: \*R\$\s*151\.829\.716,66\*/.test(texto), texto);
  assert.ok(texto.includes('*Por Empresa*'), texto);
  assert.ok(/C3i Systems: Entradas: \*R\$\s*779\.840,00\* \| Saidas: \*R\$\s*257\.720,16\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Entradas: \*R\$\s*86\.253\.633,40\* \| Saidas: \*R\$\s*151\.571\.996,50\*/.test(texto), texto);
  assert.ok(!texto.includes('registro(s)'), texto);
});

ok('fluxo projetado mensal: totais usam saldo inicial e fluxo final', () => {
  const rows = [
    { competencia: '202606', saldo_bancario_base: 252135.16, total_a_receber: 12185, total_a_pagar: 3459.52, fluxo_liquido: 260860.64 },
    { competencia: '202607', saldo_bancario_base: 252135.16, total_a_receber: 20667.50, total_a_pagar: 5603.94, fluxo_liquido: 275924.20 },
    { competencia: '202608', saldo_bancario_base: 252135.16, total_a_receber: 0, total_a_pagar: 3634.42, fluxo_liquido: 272289.78 },
    { competencia: '202609', saldo_bancario_base: 252135.16, total_a_receber: 0, total_a_pagar: 707.35, fluxo_liquido: 271582.43 },
  ];
  const texto = canonical.renderSingle(rows, { nomeModulo: 'Financeiro', contextoConsulta: 'Fluxo projetado por mes' });

  assert.ok(/Junho\/2026: Saldo Bancario Base: \*R\$\s*252\.135,16\*/.test(texto), texto);
  assert.ok(/\*Subtotal\*: Saldo Bancario Base: \*R\$\s*252\.135,16\* \| Total A Receber: \*R\$\s*32\.852,50\* \| Total A Pagar: \*R\$\s*13\.405,23\* \| Fluxo Liquido: \*R\$\s*271\.582,43\*/.test(texto), texto);
  assert.ok(!/Saldo Bancario Base: \*R\$\s*1\.008\.540,64\*/.test(texto), texto);
  assert.ok(!/Fluxo Liquido: \*R\$\s*1\.080\.657,05\*/.test(texto), texto);
});

ok('fluxo projetado mensal: consolidado carrega posicao por empresa', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { competencia: '202606', saldo_bancario_base: 252135.16, total_a_receber: 12185, total_a_pagar: 3459.52, fluxo_liquido: 260860.64 },
        { competencia: '202607', saldo_bancario_base: 252135.16, total_a_receber: 20667.50, total_a_pagar: 5603.94, fluxo_liquido: 275924.20 },
        { competencia: '202608', saldo_bancario_base: 252135.16, total_a_receber: 0, total_a_pagar: 3634.42, fluxo_liquido: 272289.78 },
        { competencia: '202609', saldo_bancario_base: 252135.16, total_a_receber: 0, total_a_pagar: 707.35, fluxo_liquido: 271582.43 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { competencia: '202606', saldo_bancario_base: 750298.44, total_a_receber: 77334.02, total_a_pagar: 63260.64, fluxo_liquido: 764371.82 },
        { competencia: '202607', saldo_bancario_base: 750298.44, total_a_receber: 364451.64, total_a_pagar: 53064.67, fluxo_liquido: 1075758.79 },
        { competencia: '202608', saldo_bancario_base: 750298.44, total_a_receber: 3139.50, total_a_pagar: 4835.53, fluxo_liquido: 1074062.76 },
      ],
    },
  ], { mensagem: 'Preciso do fluxo de caixa projetado dos proximos 90 dias detalhado por mes.' });

  assert.ok(/Setembro\/2026: Saldo Bancario Base: \*R\$\s*1\.002\.433,60\* \| Total A Receber: \*R\$\s*0,00\* \| Total A Pagar: \*R\$\s*707,35\* \| Fluxo Liquido: \*R\$\s*1\.345\.645,19\*/.test(texto), texto);
  assert.ok(/\*Subtotal\*: Saldo Bancario Base: \*R\$\s*1\.002\.433,60\* \| Total A Receber: \*R\$\s*477\.777,66\* \| Total A Pagar: \*R\$\s*134\.566,07\* \| Fluxo Liquido: \*R\$\s*1\.345\.645,19\*/.test(texto), texto);
  assert.ok(/C3i Systems: Saldo Bancario Base: \*R\$\s*252\.135,16\* \| Total A Receber: \*R\$\s*32\.852,50\* \| Total A Pagar: \*R\$\s*13\.405,23\* \| Fluxo Liquido: \*R\$\s*271\.582,43\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Saldo Bancario Base: \*R\$\s*750\.298,44\* \| Total A Receber: \*R\$\s*444\.925,16\* \| Total A Pagar: \*R\$\s*121\.160,84\* \| Fluxo Liquido: \*R\$\s*1\.074\.062,76\*/.test(texto), texto);
  assert.ok(!/Saldo Bancario Base: \*R\$\s*3\.259\.435,96\*/.test(texto), texto);
  assert.ok(!/Fluxo Liquido: \*R\$\s*3\.994\.850,42\*/.test(texto), texto);
});

console.log(`\nwhatsapp-canonical-format.test.js: ${passou} passaram, ${falhou} falharam`);
if (falhou) process.exit(1);
