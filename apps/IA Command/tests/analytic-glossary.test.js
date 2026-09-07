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

  // ── Achados de auditoria (Codex): guarda de ruido antes de gastar chamada de IA ───────────
  await okAsync('resolverConceitoPorFalhaSql NAO chama IA para saudacoes/ruido obvio (oi, teste, kkkk)', async () => {
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('NAO deveria ter chamado a IA para mensagem sem estrutura de pergunta.'); };
    try {
      for (const msg of ['oi', 'teste', 'kkkk', 'bom dia', 'ok', 'valeu']) {
        const resultado = await resolver.resolverConceitoPorFalhaSql(msg, -9992);
        assert.strictEqual(resultado, null, `"${msg}" deveria ser filtrado sem chamar IA`);
      }
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPorFalhaSql chama IA normalmente para pergunta real (com "?")', async () => {
    const original = aiProviderClient.chamarIA;
    let chamou = false;
    aiProviderClient.chamarIA = async () => { chamou = true; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      await resolver.resolverConceitoPorFalhaSql('Qual o markup deste item?', -9992);
      assert.strictEqual(chamou, true, 'pergunta real com "?" deveria acionar a IA extratora');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  // ── resolverConceitoPorFalhaSql: segundo gatilho, sem lista de vocabulario fixa ───────────
  // Usado quando a IA principal ja tentou gerar SQL e falhou (sql_nao_extraido em runner.js).
  // Nao depende de PADROES_CONCEITO — quem decide se ha um termo tecnico e a propria IA
  // auxiliar, lendo a pergunta livre. Caso real que motivou: "Qual o markup deste item?".
  await okAsync('resolverConceitoPorFalhaSql identifica termo de negocio nao coberto por PADROES_CONCEITO (caso real: markup)', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => JSON.stringify({
      termo_encontrado: 'markup',
      definicao_tecnica: 'Markup e o percentual aplicado sobre o custo do item para formar o preco de venda: (preco_venda - custo) / custo * 100.',
    });
    try {
      const resultado = await resolver.resolverConceitoPorFalhaSql('Qual o markup deste item?', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.precisaConfirmacao, true, 'markup nao especifica dominio de dado na pergunta, deve pedir esclarecimento antes de gerar SQL');
      assert.ok(resultado.perguntaEsclarecimento.includes('markup'));
      // Item 6 (pendencia de dominio): o termo e a definicao ja extraidos nesta mesma chamada
      // de IA precisam ser preservados no retorno, para nao gastar uma segunda chamada de IA
      // quando o usuario responder o dominio depois.
      assert.strictEqual(resultado.termo, 'markup');
      assert.strictEqual(resultado.definicaoTecnicaPreExtraida, 'Markup e o percentual aplicado sobre o custo do item para formar o preco de venda: (preco_venda - custo) / custo * 100.');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    }
  });

  await okAsync('resolverConceitoPorFalhaSql resolve direto quando pergunta ja traz dominio explicito', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'ticket medio'").run();
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => JSON.stringify({
      termo_encontrado: 'ticket medio',
      definicao_tecnica: 'Ticket medio e o valor total faturado dividido pela quantidade de vendas/notas do periodo.',
    });
    try {
      const resultado = await resolver.resolverConceitoPorFalhaSql('Qual o ticket medio de vendas deste mes?', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.precisaConfirmacao, undefined);
      assert.strictEqual(resultado.termo, 'ticket medio');
      assert.ok(resultado.definicaoTecnica.includes('faturado'));
      const gravado = store.buscarPorTermo('ticket medio', 'faturamento');
      assert.ok(gravado, 'deveria gravar no glossario para a proxima pergunta reaproveitar sem chamar IA de novo');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'ticket medio'").run();
    }
  });

  await okAsync('resolverConceitoPorFalhaSql retorna null quando a IA nao encontra termo tecnico (falha e de outra natureza)', async () => {
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => JSON.stringify({ termo_encontrado: null, definicao_tecnica: null });
    try {
      const resultado = await resolver.resolverConceitoPorFalhaSql('faturamento de ontem por favor', -9992);
      assert.strictEqual(resultado, null, 'sem termo tecnico identificado, deve manter o erro generico original (fail-open)');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPorFalhaSql e fail-open quando a IA auxiliar falha', async () => {
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('Simulado: nenhum provider disponivel.'); };
    try {
      const resultado = await resolver.resolverConceitoPorFalhaSql('Qual a margem de contribuicao deste produto?', -9992);
      assert.strictEqual(resultado, null, 'deve ser fail-open (null), nunca lancar excecao nem piorar a mensagem de erro original');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPorFalhaSql reaproveita termo ja gravado sem chamar IA de novo', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'giro de estoque'").run();
    store.criar({
      termo: 'giro de estoque',
      dominio: 'estoque',
      definicaoTecnica: 'Giro de estoque = custo das mercadorias vendidas no periodo / estoque medio do periodo.',
    });
    const original = aiProviderClient.chamarIA;
    let chamouParaDefinicao = false;
    aiProviderClient.chamarIA = async (keys, cfg, systemPrompt) => {
      if (systemPrompt.includes('julgar se a causa provavel')) {
        return JSON.stringify({ termo_encontrado: 'giro de estoque', definicao_tecnica: null });
      }
      chamouParaDefinicao = true;
      throw new Error('NAO deveria ter chamado a IA de definicao — termo ja esta no glossario.');
    };
    try {
      const resultado = await resolver.resolverConceitoPorFalhaSql('Qual o giro de estoque deste produto?', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.definicaoTecnica, 'Giro de estoque = custo das mercadorias vendidas no periodo / estoque medio do periodo.');
      assert.strictEqual(chamouParaDefinicao, false);
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'giro de estoque'").run();
    }
  });

  // ── Achados de auditoria (Codex, rodada 2): filtro de ruido nao pode barrar pergunta informal ─
  await okAsync('resolverConceitoPorFalhaSql chama IA para perguntas informais SEM "?" (falso negativo da rodada 2)', async () => {
    const original = aiProviderClient.chamarIA;
    let chamadas = 0;
    aiProviderClient.chamarIA = async () => { chamadas++; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      const frasesInformais = [
        'queria saber o markup desse produto nas vendas',
        'me mostra o ticket medio de vendas desse mes',
        'preciso saber a margem de contribuicao das vendas',
        'mostra o giro de estoque desse item',
      ];
      for (const frase of frasesInformais) {
        await resolver.resolverConceitoPorFalhaSql(frase, -9992);
      }
      assert.strictEqual(chamadas, frasesInformais.length, 'todas as frases informais deveriam acionar a IA extratora, mesmo sem "?"');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPorFalhaSql NAO chama IA para formulas sociais mais longas (bom dia pessoal, obrigado pela ajuda)', async () => {
    const original = aiProviderClient.chamarIA;
    let chamadas = 0;
    aiProviderClient.chamarIA = async () => { chamadas++; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      const formulasSociais = [
        'bom dia pessoal',
        'obrigado pela ajuda',
        'muito obrigado',
        'boa tarde equipe',
        'valeu demais',
        'de nada',
      ];
      for (const frase of formulasSociais) {
        await resolver.resolverConceitoPorFalhaSql(frase, -9992);
      }
      assert.strictEqual(chamadas, 0, 'formulas sociais mais longas nao deveriam acionar a IA — regressao apontada na rodada 2 da auditoria');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  // ── Achados de auditoria (Codex, rodada 3) ──────────────────────────────────────────────
  await okAsync('resolverConceitoPorFalhaSql NAO chama IA para conversa comum sem relacao com consulta (achado 3)', async () => {
    const original = aiProviderClient.chamarIA;
    let chamadas = 0;
    aiProviderClient.chamarIA = async () => { chamadas++; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      const conversaComum = [
        'minha internet caiu',
        'estou chegando agora',
        'reuniao terminou tarde',
        'ta td show por aqui',
      ];
      for (const frase of conversaComum) {
        await resolver.resolverConceitoPorFalhaSql(frase, -9992);
      }
      assert.strictEqual(chamadas, 0, 'frases de conversa comum (3+ palavras, substancia) nao deveriam acionar a IA so por terem "tamanho" — precisam de estrutura de pedido/complemento nominal');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPorFalhaSql chama IA para "top X por Y" mesmo sem "?" (achado 4: "top" nao e so giria social)', async () => {
    const original = aiProviderClient.chamarIA;
    let chamadas = 0;
    aiProviderClient.chamarIA = async () => { chamadas++; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      await resolver.resolverConceitoPorFalhaSql('top produtos por markup', -9992);
      await resolver.resolverConceitoPorFalhaSql('top clientes por ticket medio', -9992);
      assert.strictEqual(chamadas, 2, '"top X por Y" e uma consulta de ranking legitima, nao deveria ser barrada como formula social de aprovacao ("ta top!")');
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPorFalhaSql chama IA para complemento nominal sem verbo/interrogativo ("o giro de estoque desse produto")', async () => {
    const original = aiProviderClient.chamarIA;
    let chamadas = 0;
    aiProviderClient.chamarIA = async () => { chamadas++; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      await resolver.resolverConceitoPorFalhaSql('o giro de estoque desse produto', -9992);
      await resolver.resolverConceitoPorFalhaSql('a margem deste item', -9992);
      assert.strictEqual(chamadas, 2);
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  // ── resolverConceitoPreventivo: roda ANTES de gerar SQL (nao so depois de falhar) ──────────
  // Caso real que motivou: "Qual o markup deste item?" nao falhava tecnicamente — a IA
  // principal gerava SQL "valido" mas semanticamente errado (markup interpretado como preco
  // medio), entao resolverConceitoPorFalhaSql (so chamado apos falha) nunca disparava.
  await okAsync('resolverConceitoPreventivo: termo novo (nao gravado) chama a IA extratora e grava para a proxima vez', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    const original = aiProviderClient.chamarIA;
    let chamadas = 0;
    aiProviderClient.chamarIA = async () => {
      chamadas++;
      return JSON.stringify({ termo_encontrado: 'markup', definicao_tecnica: 'Markup e o percentual sobre o custo.' });
    };
    try {
      const resultado = await resolver.resolverConceitoPreventivo('Qual o markup das vendas deste mes?', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.termo, 'markup');
      assert.strictEqual(resultado.definicaoTecnica, 'Markup e o percentual sobre o custo.');
      assert.strictEqual(chamadas, 1, 'termo novo deveria gastar exatamente 1 chamada de IA');
      const gravado = store.buscarPorTermo('markup', 'faturamento');
      assert.ok(gravado, 'deveria gravar no glossario para a proxima pergunta ser gratuita');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    }
  });

  await okAsync('resolverConceitoPreventivo: termo ja gravado no glossario NAO chama IA (caso central: reincidencia e gratuita)', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    store.criar({
      termo: 'markup',
      dominio: 'faturamento',
      definicaoTecnica: 'Markup e o percentual aplicado sobre o custo do item.',
    });
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('NAO deveria ter chamado a IA — termo ja esta no glossario.'); };
    try {
      const resultado = await resolver.resolverConceitoPreventivo('Qual o markup deste item?', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.termo, 'markup');
      assert.strictEqual(resultado.definicaoTecnica, 'Markup e o percentual aplicado sobre o custo do item.');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'markup'").run();
    }
  });

  await okAsync('resolverConceitoPreventivo: pergunta comum sem termo tecnico continua null (zero custo)', async () => {
    const original = aiProviderClient.chamarIA;
    let chamou = false;
    aiProviderClient.chamarIA = async () => { chamou = true; return JSON.stringify({ termo_encontrado: null, definicao_tecnica: null }); };
    try {
      const resultado = await resolver.resolverConceitoPreventivo('faturamento de hoje por favor mostra pra mim', -9992);
      assert.strictEqual(resultado, null);
    } finally {
      aiProviderClient.chamarIA = original;
    }
  });

  await okAsync('resolverConceitoPreventivo: reaproveita resolverConceito (regex) primeiro, sem duplicar logica de "analise horizontal"', async () => {
    getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise horizontal'").run();
    store.criar({
      termo: 'analise horizontal',
      dominio: 'compras_x_faturamento',
      definicaoTecnica: 'Compara o mesmo indicador entre periodos.',
    });
    const original = aiProviderClient.chamarIA;
    aiProviderClient.chamarIA = async () => { throw new Error('NAO deveria ter chamado a IA — resolverConceito (regex) ja resolve isso.'); };
    try {
      const resultado = await resolver.resolverConceitoPreventivo('Análise horizontal da venda desta semana x compras', -9992);
      assert.ok(resultado);
      assert.strictEqual(resultado.termo, 'Análise horizontal');
    } finally {
      aiProviderClient.chamarIA = original;
      getDB().prepare("DELETE FROM analytic_glossary WHERE termo = 'analise horizontal'").run();
    }
  });

  limpar();

  console.log(`\nanalytic-glossary.test.js: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
