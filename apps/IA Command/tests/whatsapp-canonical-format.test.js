'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const canonical = require(path.join(ROOT, 'modules/erp/canonical-whatsapp-format'));
const whatsappPrompt = require(path.join(ROOT, 'modules/erp/whatsapp-format-prompt'));

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

ok('consolidado ignora alinhamento quando alguma resposta nao tem shape detectavel', () => {
  assert.doesNotThrow(() => {
    canonical.renderAll([
      { nomeEmpresa: 'C3i Systems', rows: [{ mensagem_formatada: 'Saldo bancario ja formatado' }] },
      { nomeEmpresa: 'J2A Consultoria', rows: [{ banco: '077', agencia: '0001', conta: 'CDB', saldo: 438938.72 }] },
    ], { mensagem: 'Saldo bancario desconsiderando os Bancos CX1 e CX2' });
  });
});

ok('consolidado misto: soma detalhe por documento com resumo simples', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { fornecedor: 'ASSOCIACAO MATOGROSSENSE DOS TRANSPORTADORES URBANOS', documento: '5992540', tipo: 'FOL', valor: 227.70 },
        { fornecedor: 'FOLHA DE PAGAMENTO', documento: '20230244', tipo: 'FOL', valor: 3389.57 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [{ saldo_a_pagar: 376 }],
    },
  ], { mensagem: 'Contas a pagar do dia 29/06/2026' });

  assert.ok(texto.includes('*Consolidado - Todas as empresas*'), texto);
  assert.ok(/C3i Systems: A pagar: \*R\$\s*3\.617,27\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: A pagar: \*R\$\s*376,00\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: A pagar: \*R\$\s*3\.993,27\*/.test(texto), texto);
  assert.ok(!/R\$\s*3\.617,27\* \| R\$\s*3\.617,27/.test(texto), texto);
});

ok('consolidado misto: reduz vencimento e vencimento-fornecedor para vencimento', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { vencimento: '2026-06-29', saldo_a_pagar: 3617.27 },
        { vencimento: '2026-06-30', saldo_a_pagar: 3550 },
        { vencimento: '2026-07-01', saldo_a_pagar: 514.88 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { E2_VENCREA: '2026-06-26', fornecedor: 'SOFTEXPERT SOFTWARE SA', saldo_a_pagar: 5049.05 },
        { E2_VENCREA: '2026-06-29', fornecedor: 'LUIZ BARROS PJ - LLA CONSULTORIA LTDA', saldo_a_pagar: 376 },
        { E2_VENCREA: '2026-06-30', fornecedor: 'RECEITA FEDERAL DO BRASIL', saldo_a_pagar: 37285.34 },
        { E2_VENCREA: '2026-07-01', fornecedor: 'SOFTEXPERT SOFTWARE SA', saldo_a_pagar: 11896.92 },
        { E2_VENCREA: '2026-07-02', fornecedor: 'BRASOFTWARE INFORMATICA LTDA', saldo_a_pagar: 140 },
        { E2_VENCREA: '2026-07-06', fornecedor: 'BRADESCO SAUDE', saldo_a_pagar: 5140.08 },
      ],
    },
  ], { mensagem: 'Agora me detalhe por vencimento, por favor.' });

  assert.ok(texto.includes('*Por Vencimento*'), texto);
  assert.ok(/29\/06\/2026: A pagar: \*R\$\s*3\.993,27\*/.test(texto), texto);
  assert.ok(/30\/06\/2026: A pagar: \*R\$\s*40\.835,34\*/.test(texto), texto);
  assert.ok(/01\/07\/2026: A pagar: \*R\$\s*12\.411,80\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: A pagar: \*R\$\s*67\.569,54\*/.test(texto), texto);
  assert.ok(/C3i Systems: A pagar: \*R\$\s*7\.682,15\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: A pagar: \*R\$\s*59\.887,39\*/.test(texto), texto);
});

ok('contrato de apresentacao: troca campos fisicos de contas a pagar por nomes amigaveis', () => {
  const rows = [
    { E2_VENCREA: '20260624', E2_NUM: '24/06/2026', fornecedor: 'BANCO INTER', E2_VALOR: 69.95 },
    { E2_VENCREA: '20260629', E2_NUM: '44/02/2023', fornecedor: 'FOLHA DE PAGAMENTO', E2_VALOR: 3389.57 },
  ];
  const shape = canonical.detectarShape(rows, { mensagem: 'Contas a pagar dos proximos 10 dias' });
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Contas a pagar dos proximos 10 dias',
  });

  assert.strictEqual(shape.tipo, 'multiplas_dimensoes');
  assert.ok(texto.includes('*Por Vencimento, Documento, Fornecedor*'), texto);
  assert.ok(/Vencimento 24\/06\/2026 \| Documento 24\/06\/2026 \| Fornecedor BANCO INTER: A pagar: \*R\$\s*69,95\*/.test(texto), texto);
  assert.ok(!texto.includes('E2 VENCREA'), texto);
  assert.ok(!texto.includes('E2 VALOR'), texto);
});

ok('contrato de apresentacao: compras fisico Protheus consolida com alias semantico', () => {
  const texto = canonical.renderAll([
    { nomeEmpresa: 'C3i Systems', rows: [{ F1_VALBRUT: 29743.83 }] },
    { nomeEmpresa: 'J2A Consultoria', rows: [{ valor_compra: 307249.04 }] },
  ], { mensagem: 'notas de entradas no mes de janeiro' });

  assert.ok(/C3i Systems: Compras: \*R\$\s*29\.743,83\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Compras: \*R\$\s*307\.249,04\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Compras: \*R\$\s*336\.992,87\*/.test(texto), texto);
  assert.ok(!texto.includes('F1 VALBRUT'), texto);
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
  assert.ok(/\*Resultado\*: \*-R\$\s*251\.348,46\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: -R\$\s*251\.348,46/.test(texto), texto);
  assert.ok(!/A pagar: \*R\$\s*1\.261\.948,28\*/.test(texto), texto);
});

ok('financeiro aberto detalhado: rotulo acompanha categoria pagar e receber', () => {
  const rows = [
    { categoria: 'receber', cliente: 'BOM JESUS AGROPECUARIA', saldo_a_pagar: 9085 },
    { categoria: 'pagar', cliente: 'ALELO', saldo_a_pagar: 3550 },
    { categoria: 'pagar', cliente: 'FOLHA DE PAGAMENTO', saldo_a_pagar: 3389.57 },
  ];
  const shape = canonical.detectarShape(rows, { mensagem: 'Contas a receber e a pagar do mes de junho' });
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Contas a receber e a pagar do mes de junho',
  });

  assert.strictEqual(shape.tipo, 'duas_dimensoes');
  assert.ok(/\*pagar\*: A pagar: \*R\$\s*6\.939,57\*/.test(texto), texto);
  assert.ok(/ALELO: A pagar: \*R\$\s*3\.550,00\*/.test(texto), texto);
  assert.ok(/\*receber\*: A receber: \*R\$\s*9\.085,00\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Resultado: \*R\$\s*2\.145,43\*/.test(texto), texto);
  assert.ok(!/pagar[\s\S]{0,160}A receber: \*R\$\s*6\.939,57/.test(texto), texto);
});

ok('financeiro aberto detalhado: consolidado rotula categoria corretamente', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { categoria: 'receber', cliente: 'BOM JESUS AGROPECUARIA', saldo_a_pagar: 12185 },
        { categoria: 'pagar', cliente: 'ALELO', saldo_a_pagar: 7667.27 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { categoria: 'pagar', cliente: 'RECEITA FEDERAL DO BRASIL - IRPJ A PAGAR', saldo_a_pagar: 50132.89 },
        { categoria: 'receber', cliente: 'SCHEFFER E CIA LTDA', saldo_a_pagar: 40905.17 },
      ],
    },
  ], { mensagem: 'Contas a receber e a pagar do mes de junho' });

  assert.ok(/1\. \*pagar\*: A pagar: \*R\$\s*57\.800,16\*/.test(texto), texto);
  assert.ok(/2\. \*receber\*: A receber: \*R\$\s*53\.090,17\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Resultado: \*-R\$\s*4\.709,99\*/.test(texto), texto);
  assert.ok(!/pagar[\s\S]{0,160}A receber: \*R\$\s*57\.800,16/.test(texto), texto);
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
  assert.ok(/Total Geral\*: Resultado: \*R\$\s*800,00\*/.test(texto), texto);
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
  assert.ok(/Total Geral\*: Resultado: \*R\$\s*5\.000,00\*/.test(texto), texto);
  assert.ok(!/Total: \*R\$\s*11\.000,00\*/.test(texto), texto);
});

ok('categoria semantica: preserva rotulos compras e faturamento', () => {
  const rows = [
    { categoria: 'faturamento', cliente: 'CLIENTE A', valor: 12000 },
    { categoria: 'compras', cliente: 'FORNECEDOR B', valor: 4500 },
  ];
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Compras e faturamento do periodo',
  });

  assert.ok(/\*faturamento\*: Faturamento: \*R\$\s*12\.000,00\*/.test(texto), texto);
  assert.ok(/\*compras\*: Compras: \*R\$\s*4\.500,00\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Resultado: \*R\$\s*7\.500,00\*/.test(texto), texto);
  assert.ok(!/faturamento[\s\S]{0,120}Receita: \*R\$\s*12\.000,00/.test(texto), texto);
  assert.ok(!/compras[\s\S]{0,120}Despesa: \*R\$\s*4\.500,00/.test(texto), texto);
});

ok('categoria semantica por competencia: subtotal e total usam faturamento menos compras', () => {
  const rows = [
    { competencia: '202506', categoria: 'compras', valor: 36018.69 },
    { competencia: '202506', categoria: 'faturamento', valor: 25142.04 },
    { competencia: '202606', categoria: 'faturamento', valor: 180553.69 },
    { competencia: '202606', categoria: 'compras', valor: 10437.69 },
  ];
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Compras e Faturamento',
    contextoConsulta: 'comparando junho de 2026 com junho de 2025',
  });

  assert.ok(/Junho\/2025\*: Resultado: \*-R\$\s*10\.876,65\*/.test(texto), texto);
  assert.ok(/faturamento: Faturamento: \*R\$\s*25\.142,04\*/.test(texto), texto);
  assert.ok(/compras: Compras: \*R\$\s*36\.018,69\*/.test(texto), texto);
  assert.ok(/Subtotal: Resultado: \*-R\$\s*10\.876,65\*/.test(texto), texto);
  assert.ok(/Junho\/2026\*: Resultado: \*R\$\s*170\.116,00\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Resultado: \*R\$\s*159\.239,35\*/.test(texto), texto);
  assert.ok(!/Total Geral\*: Compras: \*R\$\s*252\.152,11/.test(texto), texto);
});

ok('categoria semantica por competencia: subtotal e total usam receber menos pagar', () => {
  const rows = [
    { competencia: '202606', categoria: 'receber', saldo: 53090.17 },
    { competencia: '202606', categoria: 'pagar', saldo: 57800.16 },
    { competencia: '202607', categoria: 'receber', saldo: 10000 },
    { competencia: '202607', categoria: 'pagar', saldo: 4000 },
  ];
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Contas a receber e a pagar por competencia',
  });

  assert.ok(/Junho\/2026\*: Resultado: \*-R\$\s*4\.709,99\*/.test(texto), texto);
  assert.ok(/receber: A receber: \*R\$\s*53\.090,17\*/.test(texto), texto);
  assert.ok(/pagar: A pagar: \*R\$\s*57\.800,16\*/.test(texto), texto);
  assert.ok(/Subtotal: Resultado: \*-R\$\s*4\.709,99\*/.test(texto), texto);
  assert.ok(/Julho\/2026\*: Resultado: \*R\$\s*6\.000,00\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Resultado: \*R\$\s*1\.290,01\*/.test(texto), texto);
  assert.ok(!/Total Geral\*: Saldo: \*R\$\s*124\.890,33/.test(texto), texto);
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

ok('crescimento mensal: exibe valor e percentual retornados pelo SQL', () => {
  const texto = canonical.renderSingle([
    { competencia: '202601', faturamento: 74731.49, faturamento_anterior: null, crescimento_valor: null, crescimento_percentual: null },
    { competencia: '202602', faturamento: 79810.32, faturamento_anterior: 74731.49, crescimento_valor: 5078.83, crescimento_percentual: 6.79610429284899 },
    { competencia: '202603', faturamento: 119926.80, faturamento_anterior: 79810.32, crescimento_valor: 40116.48, crescimento_percentual: 50.2647777881357 },
  ], { nomeModulo: 'Faturamento', contextoConsulta: 'Preciso do percentual e valor do crescimento do faturamento do ano por mes' });

  assert.ok(/Janeiro\/2026: Faturamento: \*R\$\s*74\.731,49\* .*Crescimento Valor: \*N\/A\* .*Crescimento %: \*N\/A\*/.test(texto), texto);
  assert.ok(/Fevereiro\/2026: Faturamento: \*R\$\s*79\.810,32\* .*Crescimento Valor: \*R\$\s*5\.078,83\* .*Crescimento %: \*\+6,80%\*/.test(texto), texto);
  assert.ok(/\*Subtotal\*: Faturamento: \*R\$\s*274\.468,61\*/.test(texto), texto);
  assert.ok(!/\*Subtotal\*: .*Crescimento %/.test(texto), texto);
});

ok('crescimento mensal: consolidado recalcula valor e percentual sobre total das empresas', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { competencia: '202601', faturamento: 74731.49, crescimento_valor: null, crescimento_percentual: null },
        { competencia: '202602', faturamento: 79810.32, crescimento_valor: 5078.83, crescimento_percentual: 6.79610429284899 },
        { competencia: '202603', faturamento: 119926.80, crescimento_valor: 40116.48, crescimento_percentual: 50.2647777881357 },
        { competencia: '202604', faturamento: 48730.17, crescimento_valor: -71196.63, crescimento_percentual: -59.3667387106135 },
        { competencia: '202605', faturamento: 169896.50, crescimento_valor: 121166.33, crescimento_percentual: 248.647460084789 },
        { competencia: '202606', faturamento: 180553.69, crescimento_valor: 10657.19, crescimento_percentual: 6.27275429452637 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { competencia: '202601', faturamento: 445426.20, crescimento_valor: null, crescimento_percentual: null },
        { competencia: '202602', faturamento: 397287.79, crescimento_valor: -48138.41, crescimento_percentual: -10.807276 },
        { competencia: '202603', faturamento: 387310.71, crescimento_valor: -9977.08, crescimento_percentual: -2.511299 },
        { competencia: '202604', faturamento: 603902.39, crescimento_valor: 216591.68, crescimento_percentual: 55.917 },
        { competencia: '202605', faturamento: 596095.12, crescimento_valor: -7807.27, crescimento_percentual: -1.293 },
        { competencia: '202606', faturamento: 672935.20, crescimento_valor: 76840.08, crescimento_percentual: 12.89 },
      ],
    },
  ], { mensagem: 'Preciso do percentual e valor do crescimento do faturamento do ano por mês' });

  assert.ok(/Janeiro\/2026: Faturamento: \*R\$\s*520\.157,69\* .*Crescimento Valor: \*N\/A\* .*Crescimento %: \*N\/A\*/.test(texto), texto);
  assert.ok(/Fevereiro\/2026: Faturamento: \*R\$\s*477\.098,11\* .*Crescimento Valor: \*-R\$\s*43\.059,58\* .*Crescimento %: \*-8,28%\*/.test(texto), texto);
  assert.ok(/Junho\/2026: Faturamento: \*R\$\s*853\.488,89\* .*Crescimento Valor: \*R\$\s*87\.497,27\* .*Crescimento %: \*\+11,42%\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Faturamento: \*R\$\s*3\.776\.606,38\*/.test(texto), texto);
  assert.ok(/C3i Systems: Faturamento: \*R\$\s*673\.648,97\* \| Crescimento Valor: \*R\$\s*105\.822,20\* \| Crescimento %: \*\+141,60%\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Faturamento: \*R\$\s*3\.102\.957,41\* \| Crescimento Valor: \*R\$\s*227\.509,00\* \| Crescimento %: \*\+51,08%\*/.test(texto), texto);
  assert.ok(texto.includes('Obs.: no Por Empresa, o Crescimento Valor e o Crescimento % comparam a primeira e a ultima competencia exibidas para cada empresa; percentuais nao sao somados.'), texto);
  assert.ok(!/\*Total Geral\*: .*Crescimento Percentual/.test(texto), texto);
});

ok('crescimento mensal: consolidado misto recalcula crescimento e nao soma percentuais', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { competencia: '202601', faturamento: 100, crescimento_valor: null, crescimento_percentual: null },
        { competencia: '202602', faturamento: 120, crescimento_valor: 20, crescimento_percentual: 20 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { competencia: '202601', receita: 300, variacao_valor: null, variacao_percentual: null },
        { competencia: '202602', receita: 330, variacao_valor: 30, variacao_percentual: 10 },
      ],
    },
  ], { mensagem: 'crescimento do faturamento por mes' });

  assert.ok(/Janeiro\/2026: Faturamento: \*R\$\s*400,00\* .*Crescimento Valor: \*N\/A\* .*Crescimento %: \*N\/A\*/.test(texto), texto);
  assert.ok(/Fevereiro\/2026: Faturamento: \*R\$\s*450,00\* .*Crescimento Valor: \*R\$\s*50,00\* .*Crescimento %: \*\+12,50%\*/.test(texto), texto);
  assert.ok(!/Crescimento %: \*\+30,00%\*/.test(texto), texto);
  assert.ok(!/\*Total Geral\*: .*Crescimento %/.test(texto), texto);
});

ok('etapa 4: preserva metricas atual e anterior em comparativo', () => {
  const texto = canonical.renderSingle([
    { mes: 1, faturamento_atual: 1500, faturamento_anterior: 1000, crescimento_pct: 50 },
    { mes: 2, faturamento_atual: 900, faturamento_anterior: 800, crescimento_pct: 12.5 },
  ], { nomeModulo: 'Faturamento', contextoConsulta: 'Comparativo' });

  assert.ok(texto.includes('Faturamento Atual: *R$'), texto);
  assert.ok(texto.includes('Faturamento Anterior: *R$'), texto);
  assert.ok(texto.includes('Crescimento %: *'), texto);
  assert.ok(!texto.includes('crescimento_pct'), texto);
});

ok('comparativo anual simples: agrupa metricas por periodo atual e ano comparado', () => {
  const rows = [
    { total_compras: 386471.41, total_faturamento: 672935.20, total_compras_2025: 356805.06, total_faturamento_2025: 561602.44 },
  ];
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Compras e Faturamento',
    contextoConsulta: 'total das compras e do faturamento do mes de junho de 2026 comparando com junho de 2025',
  });

  assert.ok(texto.includes('*Junho/2026*'), texto);
  assert.ok(texto.includes('*Junho/2025*'), texto);
  assert.ok(/Junho\/2026[\s\S]*Compras: \*R\$\s*386\.471,41\*[\s\S]*Faturamento: \*R\$\s*672\.935,20\*/.test(texto), texto);
  assert.ok(/Junho\/2025[\s\S]*Compras: \*R\$\s*356\.805,06\*[\s\S]*Faturamento: \*R\$\s*561\.602,44\*/.test(texto), texto);
  assert.ok(texto.includes('*Variacao 2026 x 2025*'), texto);
  assert.ok(/Compras: \*R\$\s*29\.666,35\* \| \*\+8,31%\*/.test(texto), texto);
  assert.ok(/Faturamento: \*R\$\s*111\.332,76\* \| \*\+19,82%\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Junho\/2026: \*R\$\s*286\.463,79\* \| Junho\/2025: \*R\$\s*204\.797,38\*/.test(texto), texto);
  assert.ok(!texto.includes('Total Compras 2025'), texto);
});

ok('comparativo anual fallback direto: resposta individual tambem agrupa por periodo', () => {
  const rows = [
    {
      total_compras: 10437.69,
      total_faturamento: 180553.69,
      total_compras_2025: 37787.81,
      total_faturamento_2025: 23306.28,
      total_compras_2024: 45477.39,
      total_faturamento_2024: 24574.06,
    },
  ];
  const texto = whatsappPrompt.buildFormatComparativoSimples(rows, {
    contextoConsulta: 'Preciso do total das compras e do faturamento do mes de junho de 2026 comparando com o mes de junho de 2025 e 2024.',
  });

  assert.ok(texto.includes('*Junho/2026*'), texto);
  assert.ok(texto.includes('*Junho/2025*'), texto);
  assert.ok(texto.includes('*Junho/2024*'), texto);
  assert.ok(/Junho\/2026[\s\S]*Compras: R\$\s*10\.437,69[\s\S]*Faturamento: R\$\s*180\.553,69[\s\S]*Resultado.*R\$\s*170\.116,00/.test(texto), texto);
  assert.ok(/Junho\/2025[\s\S]*Compras: R\$\s*37\.787,81[\s\S]*Faturamento: R\$\s*23\.306,28/.test(texto), texto);
  assert.ok(!texto.includes('Total Compras 2025'), texto);
  assert.ok(!texto.includes('Resultado (Fat'), texto);
});

ok('comparativo anual fallback direto: usa o mesmo formato para recebido menos pago', () => {
  const rows = [
    {
      valor_recebido: 1000,
      valor_pago: 600,
      valor_recebido_2025: 800,
      valor_pago_2025: 500,
    },
  ];
  const texto = whatsappPrompt.buildFormatComparativoSimples(rows, {
    contextoConsulta: 'Recebido e pago de junho de 2026 comparando com junho de 2025',
  });

  assert.ok(texto.includes('*Junho/2026*'), texto);
  assert.ok(texto.includes('*Junho/2025*'), texto);
  assert.ok(/Junho\/2026[\s\S]*Pago: R\$\s*600,00[\s\S]*Recebido: R\$\s*1\.000,00[\s\S]*Resultado.*R\$\s*400,00/.test(texto), texto);
  assert.ok(/Junho\/2025[\s\S]*Pago: R\$\s*500,00[\s\S]*Recebido: R\$\s*800,00[\s\S]*Resultado.*R\$\s*300,00/.test(texto), texto);
});

ok('metricas simples: calcula resultado para entrada menos saida', () => {
  const texto = canonical.renderSingle([
    { entrada: 1500, saida: 700 },
  ], { nomeModulo: 'Financeiro', contextoConsulta: 'Entrada e saida' });

  assert.ok(/Entradas: \*R\$\s*1\.500,00\*/.test(texto), texto);
  assert.ok(/Saidas: \*R\$\s*700,00\*/.test(texto), texto);
  assert.ok(/Resultado\*: \*R\$\s*800,00\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: R\$\s*800,00/.test(texto), texto);
});

ok('comparativo anual simples: consolidado agrupa por periodo antes do total geral', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [{ total_compras: 10437.69, total_faturamento: 180553.69, total_compras_2025: 37787.81, total_faturamento_2025: 23306.28 }],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [{ total_compras: 386471.41, total_faturamento: 672935.20, total_compras_2025: 356805.06, total_faturamento_2025: 561602.44 }],
    },
  ], { mensagem: 'Preciso do total das compras e do faturamento do mes de junho de 2026 comparando com o mes de junho de 2025.' });

  assert.ok(texto.includes('*Resumo por Empresa*'), texto);
  assert.ok(texto.includes('C3i Systems: Junho/2026:'), texto);
  assert.ok(texto.includes('J2A Consultoria: Junho/2026:'), texto);
  assert.ok(texto.includes('*Junho/2026*'), texto);
  assert.ok(texto.includes('*Junho/2025*'), texto);
  assert.ok(/Junho\/2026[\s\S]*Compras: \*R\$\s*396\.909,10\*[\s\S]*Faturamento: \*R\$\s*853\.488,89\*/.test(texto), texto);
  assert.ok(/Junho\/2025[\s\S]*Compras: \*R\$\s*394\.592,87\*[\s\S]*Faturamento: \*R\$\s*584\.908,72\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Junho\/2026: \*R\$\s*456\.579,79\* \| Junho\/2025: \*R\$\s*190\.315,85\*/.test(texto), texto);
  assert.ok(!texto.includes('Total Compras 2025'), texto);
});

ok('comparativo temporal sem periodo: nao exibe resumo agregado ambiguo', () => {
  const mensagem = 'Preciso do total das compras e do faturamento do mes de junho de 2026 comparando com o mes de junho de 2025 e 2024.';
  const texto = canonical.renderSingle([
    { total_compras: 91933.77, total_faturamento: 230269.79 },
  ], { nomeModulo: 'Compras e Faturamento', contextoConsulta: mensagem });

  assert.ok(texto.includes('Nao consegui formatar o comparativo por periodo'), texto);
  assert.ok(texto.includes('sem coluna de competencia/ano'), texto);
  assert.ok(!texto.includes('*Resumo*'), texto);
  assert.ok(!texto.includes('Total Geral: R$'), texto);
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

ok('multidimensional: consolidado alinha E8_SALATUA com saldo', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: 'INTER', E8_SALATUA: 20639.33 },
        { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: 'CDB', E8_SALATUA: 230448.47 },
        { E8_BANCO: '341', E8_AGENCIA: '0288', E8_CONTA: 'INTERCOMPANY', E8_SALATUA: -2055091.39 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: '4263046', saldo: 35305.08 },
        { E8_BANCO: '077', E8_AGENCIA: '0001', E8_CONTA: 'CDB', saldo: 438938.72 },
        { E8_BANCO: '341', E8_AGENCIA: '0288', E8_CONTA: '27680', saldo: 31306.41 },
        { E8_BANCO: '341', E8_AGENCIA: '0288', E8_CONTA: '50593', saldo: 294673.00 },
      ],
    },
  ], { mensagem: 'Saldo bancario desconsiderando os Bancos CX1 e CX2' });

  assert.ok(/Conta Corrente CDB: Saldo: \*R\$\s*669\.387,19\*/.test(texto), texto);
  assert.ok(/Conta Corrente INTERCOMPANY: Saldo: \*-R\$\s*2\.055\.091,39\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Saldo: \*-R\$\s*1\.003\.780,38\*/.test(texto), texto);
  assert.ok(!texto.includes('E8_SALATUA'), texto);
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
  assert.ok(texto.lastIndexOf('*Total Geral*:') > texto.indexOf('*Por Empresa*'), texto);
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
  assert.ok(/\*Subtotal\*: Saldo Bancario Base: \*R\$\s*252\.135,16\* \| Total A Receber: \*R\$\s*32\.852,50\* \| Total A Pagar: \*R\$\s*13\.405,23\* \| Saldo Bancario Final: \*R\$\s*271\.582,43\*/.test(texto), texto);
  assert.ok(!/Saldo Bancario Base: \*R\$\s*1\.008\.540,64\*/.test(texto), texto);
  assert.ok(!/Saldo Bancario Final: \*R\$\s*1\.080\.657,05\*/.test(texto), texto);
});

ok('fluxo mensal: imprime competencia quando SQL retorna competencia', () => {
  const rows = [
    { competencia: '202606', saldo_bancario_base: 251087.80, total_a_receber: 12185, total_a_pagar: 7667.27, fluxo_liquido: 255605.53 },
  ];
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Fluxo de Caixa do mes de Junho desconsiderando os Bancos CX1 e CX2',
  });

  assert.ok(texto.includes('*Por Competencia*'), texto);
  assert.ok(texto.includes('Junho/2026'), texto);
  assert.ok(/\*Total Geral\*: Saldo Bancario Base: \*R\$\s*251\.087,80\* \| Total A Receber: \*R\$\s*12\.185,00\* \| Total A Pagar: \*R\$\s*7\.667,27\* \| Saldo Bancario Final: \*R\$\s*255\.605,53\*/.test(texto), texto);
});

ok('fluxo diario longo: imprime por dia quando SQL retorna dia', () => {
  const rows = Array.from({ length: 12 }, (_, idx) => {
    const dia = String(idx + 1).padStart(2, '0');
    return {
      dia: `202606${dia}`,
      saldo_bancario_base: 1000,
      total_a_receber: idx === 11 ? 120 : 0,
      total_a_pagar: idx === 5 ? 50 : 0,
      fluxo_liquido: 1000 + (idx === 11 ? 70 : idx >= 5 ? -50 : 0),
    };
  });
  const texto = canonical.renderSingle(rows, {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Fluxo de Caixa do mes de Junho',
  });

  assert.ok(texto.includes('*Por Dia*'), texto);
  assert.ok(texto.includes('12/06/2026'), texto);
  assert.ok(/\*Total Geral\*: Saldo Bancario Base: \*R\$\s*1\.000,00\* \| Total A Receber: \*R\$\s*120,00\* \| Total A Pagar: \*R\$\s*50,00\* \| Saldo Bancario Final: \*R\$\s*1\.070,00\*/.test(texto), texto);
});

ok('fluxo diario: saldo inicial do dia seguinte usa saldo final anterior', () => {
  const texto = canonical.renderSingle([
    { dia: '20260629', saldo_bancario_base: 251087.80, total_a_receber: 3100, total_a_pagar: 3617.27, fluxo_liquido: 250570.53 },
    { dia: '20260630', saldo_bancario_base: 251087.80, total_a_receber: 9085, total_a_pagar: 3550, fluxo_liquido: 256105.53 },
  ], {
    nomeModulo: 'Financeiro',
    contextoConsulta: 'Fluxo de Caixa dos proximos dois dias',
  });

  assert.ok(/29\/06\/2026: Saldo Bancario Base: \*R\$\s*251\.087,80\* .* Saldo Bancario Final: \*R\$\s*250\.570,53\*/.test(texto), texto);
  assert.ok(/30\/06\/2026: Saldo Bancario Base: \*R\$\s*250\.570,53\* .* Saldo Bancario Final: \*R\$\s*256\.105,53\*/.test(texto), texto);
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

  assert.ok(/Setembro\/2026: Saldo Bancario Base: \*R\$\s*1\.002\.433,60\* \| Total A Receber: \*R\$\s*0,00\* \| Total A Pagar: \*R\$\s*707,35\* \| Saldo Bancario Final: \*R\$\s*1\.345\.645,19\*/.test(texto), texto);
  assert.ok(/\*Subtotal\*: Saldo Bancario Base: \*R\$\s*1\.002\.433,60\* \| Total A Receber: \*R\$\s*477\.777,66\* \| Total A Pagar: \*R\$\s*134\.566,07\* \| Saldo Bancario Final: \*R\$\s*1\.345\.645,19\*/.test(texto), texto);
  assert.ok(/C3i Systems: Saldo Bancario Base: \*R\$\s*252\.135,16\* \| Total A Receber: \*R\$\s*32\.852,50\* \| Total A Pagar: \*R\$\s*13\.405,23\* \| Saldo Bancario Final: \*R\$\s*271\.582,43\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Saldo Bancario Base: \*R\$\s*750\.298,44\* \| Total A Receber: \*R\$\s*444\.925,16\* \| Total A Pagar: \*R\$\s*121\.160,84\* \| Saldo Bancario Final: \*R\$\s*1\.074\.062,76\*/.test(texto), texto);
  assert.ok(texto.lastIndexOf('*Total Geral*:') > texto.indexOf('*Por Empresa*'), texto);
  assert.ok(!/Saldo Bancario Base: \*R\$\s*3\.259\.435,96\*/.test(texto), texto);
  assert.ok(!/Saldo Bancario Final: \*R\$\s*3\.994\.850,42\*/.test(texto), texto);
});

ok('fluxo diario: consolidado inclui saldo base de empresa sem movimento no dia', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { dia: '20260624', saldo_bancario_base: 251087.80, total_a_receber: 0, total_a_pagar: 500, fluxo_liquido: 250587.80 },
        { dia: '20260630', saldo_bancario_base: 251087.80, total_a_receber: 9085, total_a_pagar: 3550, fluxo_liquido: 255605.53 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { dia: '20260601', saldo_bancario_base: 800223.21, total_a_receber: 15735.72, total_a_pagar: 55205.99, fluxo_liquido: 760752.94 },
        { dia: '20260624', saldo_bancario_base: 800223.21, total_a_receber: 53664.27, total_a_pagar: 7916.56, fluxo_liquido: 1197182.74 },
        { dia: '20260630', saldo_bancario_base: 800223.21, total_a_receber: 9867.62, total_a_pagar: 46285.34, fluxo_liquido: 1013288.24 },
      ],
    },
  ], { mensagem: 'Fluxo de Caixa do mes de Junho desconsiderando os Bancos CX1 e CX2' });

  assert.ok(/01\/06\/2026: Saldo Bancario Base: \*R\$\s*1\.051\.311,01\* \| Total A Receber: \*R\$\s*15\.735,72\* \| Total A Pagar: \*R\$\s*55\.205,99\* \| Saldo Bancario Final: \*R\$\s*1\.011\.840,74\*/.test(texto), texto);
  assert.ok(/24\/06\/2026: Saldo Bancario Base: \*R\$\s*1\.011\.840,74\* \| Total A Receber: \*R\$\s*53\.664,27\* \| Total A Pagar: \*R\$\s*8\.416,56\* \| Saldo Bancario Final: \*R\$\s*1\.447\.770,54\*/.test(texto), texto);
  assert.ok(/\*Total Geral\*: Saldo Bancario Base: \*R\$\s*1\.051\.311,01\* \| Total A Receber: \*R\$\s*88\.352,61\* \| Total A Pagar: \*R\$\s*113\.457,89\* \| Saldo Bancario Final: \*R\$\s*1\.268\.893,77\*/.test(texto), texto);
});

ok('fluxo mensal misto: consolidado nao soma saldo base nem fluxo diario repetido', () => {
  const texto = canonical.renderAll([
    {
      nomeEmpresa: 'C3i Systems',
      rows: [
        { competencia: '202606', saldo_bancario_base: 251087.80, total_a_receber: 12185, total_a_pagar: 7667.27, fluxo_liquido: 255605.53 },
      ],
    },
    {
      nomeEmpresa: 'J2A Consultoria',
      rows: [
        { dia: '20260601', saldo_bancario_base: 800223.21, total_a_receber: 0, total_a_pagar: 0, fluxo_liquido: 800223.21 },
        { dia: '20260615', saldo_bancario_base: 800223.21, total_a_receber: 0, total_a_pagar: 300, fluxo_liquido: 799923.21 },
        { dia: '20260625', saldo_bancario_base: 800223.21, total_a_receber: 4709.16, total_a_pagar: 582.42, fluxo_liquido: 797509.87 },
        { dia: '20260626', saldo_bancario_base: 800223.21, total_a_receber: 22163.99, total_a_pagar: 5049.05, fluxo_liquido: 814624.81 },
        { dia: '20260629', saldo_bancario_base: 800223.21, total_a_receber: 4164.40, total_a_pagar: 376, fluxo_liquido: 818413.21 },
        { dia: '20260630', saldo_bancario_base: 800223.21, total_a_receber: 9867.62, total_a_pagar: 37285.34, fluxo_liquido: 790995.49 },
      ],
    },
  ], { mensagem: 'Fluxo de Caixa do mes de Junho desconsiderando os Bancos CX1 e CX2' });

  assert.ok(/\*Subtotal\*: Saldo Bancario Base: \*R\$\s*1\.051\.311,01\* \| A receber: \*R\$\s*53\.090,17\* \| A pagar: \*R\$\s*51\.260,08\* \| Saldo Bancario Final: \*R\$\s*1\.046\.601,02\*/.test(texto), texto);
  assert.ok(/C3i Systems: Saldo Bancario Base: \*R\$\s*251\.087,80\* \| A receber: \*R\$\s*12\.185,00\* \| A pagar: \*R\$\s*7\.667,27\* \| Saldo Bancario Final: \*R\$\s*255\.605,53\*/.test(texto), texto);
  assert.ok(/J2A Consultoria: Saldo Bancario Base: \*R\$\s*800\.223,21\* \| A receber: \*R\$\s*40\.905,17\* \| A pagar: \*R\$\s*43\.592,81\* \| Saldo Bancario Final: \*R\$\s*790\.995,49\*/.test(texto), texto);
  assert.ok(texto.lastIndexOf('*Total Geral*:') > texto.indexOf('*Por Empresa*'), texto);
  assert.ok(/\*Total Geral\*: Saldo Bancario Base: \*R\$\s*1\.051\.311,01\* \| A receber: \*R\$\s*53\.090,17\* \| A pagar: \*R\$\s*51\.260,08\* \| Saldo Bancario Final: \*R\$\s*1\.046\.601,02\*/.test(texto), texto);
  assert.ok(!/Saldo Bancario Base: \*R\$\s*4\.801\.339,26\*/.test(texto), texto);
});

console.log(`\nwhatsapp-canonical-format.test.js: ${passou} passaram, ${falhou} falharam`);
if (falhou) process.exit(1);

