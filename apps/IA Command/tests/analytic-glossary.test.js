'use strict';

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const store = require(path.join(ROOT, 'modules/ai/analytic-glossary-store'));
const resolver = require(path.join(ROOT, 'modules/ai/analytic-glossary-resolver'));
const aiProviderClient = require(path.join(ROOT, 'modules/erp/core/ai-provider-client'));

function limpar() {
  getDB().prepare("DELETE FROM analytic_glossary WHERE termo LIKE 'teste %' OR termo = 'analise horizontal' OR termo LIKE 'analise vertical%' OR termo = 'analise de sazonalidade' OR termo = 'analise de desempenho'").run();
}
limpar();

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
async function okAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ok - ${desc}`);
    passou++;
  } catch (e) {
    console.error(`  fail - ${desc}`);
    console.error(`    ${e.message}`);
    falhou++;
  }
}

(async () => {
  // ── detectarConceitoDesconhecido: caso critico que motivou a feature ──────
  ok('detecta "Analise horizontal" com acentuacao preservada no retorno', () => {
    const r = resolver.detectarConceitoDesconhecido('Análise horizontal da venda desta semana x compras');
    assert.strictEqual(r, 'Análise horizontal');
  });

  ok('detecta variante maiuscula sem acento', () => {
    const r = resolver.detectarConceitoDesconhecido('ANALISE VERTICAL de custos');
    assert.strictEqual(r, 'ANALISE VERTICAL');
  });

  ok('nao detecta em pergunta comum de ERP (faturamento)', () => {
    assert.strictEqual(resolver.detectarConceitoDesconhecido('faturamento de hoje'), null);
  });

  ok('nao detecta em pergunta comum de ERP (compras por fornecedor)', () => {
    assert.strictEqual(resolver.detectarConceitoDesconhecido('compras por fornecedor semana passada'), null);
  });

  ok('detecta "indice de liquidez"', () => {
    const r = resolver.detectarConceitoDesconhecido('índice de liquidez corrente');
    assert.strictEqual(r, 'índice de liquidez');
  });

  // ── extrairDominioExplicito: nao adivinha, so reconhece o que a pergunta ja diz ─
  ok('reconhece dominio combinado quando a pergunta cruza faturamento e compras', () => {
    const d = resolver.extrairDominioExplicito('Análise horizontal da venda desta semana x compras');
    assert.ok(d);
    assert.strictEqual(d.chave, 'compras_x_faturamento');
  });

  ok('reconhece fluxo de caixa como dominio explicito', () => {
    const d = resolver.extrairDominioExplicito('Análise vertical do fluxo de caixa deste mes');
    assert.ok(d);
    assert.strictEqual(d.chave, 'fluxo_caixa');
  });

  ok('retorna null quando a pergunta nao especifica nenhum dominio conhecido (caso real que motivou a correcao de rota)', () => {
    const d = resolver.extrairDominioExplicito('realize uma Análise Vertical Financeira das movimentações do mes atual');
    assert.strictEqual(d, null, 'a palavra "financeira" isolada nao deve resolver o dominio — ambiguo entre fluxo de caixa/pagar/receber, confirmado em conversa real com o usuario');
  });

  // ── analytic-glossary-store: CRUD basico (termo + dominio) ─────────────────
  ok('normalizarTermo remove acento, baixa caixa e colapsa espacos', () => {
    assert.strictEqual(store.normalizarTermo('  Análise   Horizontal '), 'analise horizontal');
  });

  ok('criar + buscarPorTermo distingue por dominio (mesmo termo, dominios diferentes)', () => {
    store.criar({ termo: 'teste conceito', dominio: 'financeiro', definicaoTecnica: 'Definicao financeira.' });
    store.criar({ termo: 'teste conceito', dominio: 'compras_x_faturamento', definicaoTecnica: 'Definicao de compras x faturamento.' });

    const semDominio = store.buscarPorTermo('teste conceito');
    assert.strictEqual(semDominio, null, 'sem dominio nao deve casar com nenhuma das entradas gravadas');

    const financeiro = store.buscarPorTermo('teste conceito', 'financeiro');
    assert.strictEqual(financeiro.definicao_tecnica, 'Definicao financeira.');

    const compras = store.buscarPorTermo('TESTE Conceito', 'compras_x_faturamento');
    assert.strictEqual(compras.definicao_tecnica, 'Definicao de compras x faturamento.');
  });

  ok('buscarPorTermo retorna null para termo inexistente', () => {
    assert.strictEqual(store.buscarPorTermo('termo que nunca existiu 12345', 'financeiro'), null);
  });

  ok('desativar remove da busca (soft delete)', () => {
    const id = store.criar({ termo: 'teste conceito desativavel', dominio: 'compras', definicaoTecnica: 'Vai ser desativado.' });
    assert.ok(store.buscarPorTermo('teste conceito desativavel', 'compras'));
    store.desativar(id);
    assert.strictEqual(store.buscarPorTermo('teste conceito desativavel', 'compras'), null);
  });

  // ── resolverConceito: fluxo completo ────────────────────────────────────────
  await okAsync('resolverConceito retorna null para pergunta sem conceito nomeado (nao gasta IA)', async () => {
    const resultado = await resolver.resolverConceito('faturamento de hoje', -9992);
    assert.strictEqual(resultado, null);
  });

  await okAsync('resolverConceito com dominio explicito e termo ja conhecido usa o glossario direto (sem chamar IA)', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise horizontal'").run();
    store.criar({
      termo: 'analise horizontal',
      dominio: 'compras_x_faturamento',
      definicaoTecnica: 'Compara o mesmo indicador entre periodos, com variacao absoluta e percentual.',
    });
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('NAO deveria ter chamado a IA — termo ja esta no glossario.'); };
    try {
      const resultado = await resolver.resolverConceito('Análise horizontal da venda desta semana x compras', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.precisaConfirmacao, undefined);
      assert.strictEqual(resultado.termo, 'Análise horizontal');
      assert.strictEqual(resultado.definicaoTecnica, 'Compara o mesmo indicador entre periodos, com variacao absoluta e percentual.');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise horizontal'").run();
    }
  });

  // ── caso central: dominio ausente -> nunca gera SQL, sempre pergunta ────────
  await okAsync('resolverConceito SEM dominio explicito retorna precisaConfirmacao (nunca chama IA, nunca assume dominio)', async () => {
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('NAO deveria ter chamado a IA — dominio esta indefinido, deve perguntar ao usuario primeiro.'); };
    try {
      const resultado = await resolver.resolverConceito('realize uma Análise Vertical Financeira das movimentações do mes atual', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.precisaConfirmacao, true);
      assert.ok(typeof resultado.perguntaEsclarecimento === 'string' && resultado.perguntaEsclarecimento.length > 0);
      assert.ok(resultado.perguntaEsclarecimento.includes('Análise Vertical'), 'a pergunta de esclarecimento deve citar o termo detectado');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  // ── fail-open: garante que a integracao nunca quebra o fluxo principal ─────
  await okAsync('resolverConceito nao lanca excecao quando a IA auxiliar falha (fail-open)', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise de sazonalidade'").run();
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('Simulado: nenhum provider disponivel.'); };
    try {
      const resultado = await resolver.resolverConceito('Análise de sazonalidade das vendas', -9992);
      assert.strictEqual(resultado, null, 'deve ser fail-open (null) quando a IA auxiliar falha, nunca lancar excecao');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceito nao lanca excecao quando a IA retorna JSON invalido (fail-open)', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise de sazonalidade'").run();
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => 'isso nao e um JSON valido';
    try {
      const resultado = await resolver.resolverConceito('Análise de sazonalidade das vendas', -9992);
      assert.strictEqual(resultado, null, 'deve ser fail-open (null) quando a resposta da IA nao e JSON parseavel');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise de sazonalidade'").run();
    }
  });

  await okAsync('resolverConceito grava e usa a definicao quando a IA responde corretamente (termo+dominio novos)', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise de desempenho'").run();
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => JSON.stringify({
      definicao_tecnica: 'Compara o desempenho de vendas contra metas ou periodos anteriores.',
    });
    try {
      const resultado = await resolver.resolverConceito('Análise de desempenho das vendas', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.precisaConfirmacao, undefined);
      assert.strictEqual(resultado.definicaoTecnica, 'Compara o desempenho de vendas contra metas ou periodos anteriores.');
      const gravado = store.buscarPorTermo('analise de desempenho', 'faturamento');
      assert.ok(gravado, 'deveria ter gravado no glossario sob o dominio faturamento');
      assert.strictEqual(gravado.origem, 'ia_aprendido');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise de desempenho'").run();
    }
  });

  limpar();

  console.log(`\nanalytic-glossary.test.js: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
