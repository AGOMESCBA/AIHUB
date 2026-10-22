'use strict';
// Consultas de busca escritas pela IA (provider simulado, sem rede).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');

const ctx = { chamado: { produto: 'Protheus', titulo: 'Aprovação de contratos' }, mensagens: [{ conteudo: 'Ao concluir o lançamento do contrato não gera link de aprovação e não libera medições.' }], texto: 'Revise o histórico e pesquise uma solução na documentação oficial para este chamado.' };
const base = { searchConfig: { serperApiKey: 'fixture', provedorPrimario: 'serper', fallbackOrdem: '' }, abrirResultados: async () => [], interpretarSemantico: async () => null };

test('consultas da IA vão na frente, com produto, e a Central recebe todas', async () => {
  let serper = null; const central = [];
  const r = await svc.pesquisar(ctx, { ...base,
    gerarConsultasIA: async () => ({ consultas: ['SIGAGCT alçada situação contrato', 'SIGAGCT controle de aprovação medição'] }),
    buscarSerper: async (q) => { serper = q; return []; },
    buscarCentralTotvs: async (q) => { central.push(q); return []; },
  });
  assert.equal(r.plano.consultasIA.executada, true);
  assert.equal(serper[0], 'TOTVS Protheus SIGAGCT alçada situação contrato');
  assert.equal(serper[1], 'TOTVS Protheus SIGAGCT controle de aprovação medição');
  assert.ok(serper.length <= 5);
  assert.deepEqual(central, serper.slice(0, 2));
});

test('saída inválida da IA é filtrada; falha mantém as consultas atuais', async () => {
  assert.deepEqual(svc._validarConsultasIA({ consultas: ['site:tdn.totvs.com SIGAGCT alçada', 'x', 'uma consulta longa demais com muitos termos que nao serve para busca alguma', '"GPE geração DIRF"'] }), ['SIGAGCT alçada', 'GPE geração DIRF']);
  assert.deepEqual(svc._validarConsultasIA('lixo'), []);
  let serper = null;
  const r = await svc.pesquisar(ctx, { ...base,
    gerarConsultasIA: async () => { throw new Error('timeout'); },
    buscarSerper: async (q) => { serper = q; return []; },
    buscarCentralTotvs: async () => [],
  });
  assert.ok(r.plano.consultasIA.erro);
  assert.ok(serper.length > 0 && !serper.some(q => /SIGAGCT alçada/.test(q)));
});

test('sem pedido explícito (consultasPorIA) não chama a IA', async () => {
  const r = await svc.pesquisar(ctx, { ...base, buscarSerper: async () => [], buscarCentralTotvs: async () => [] });
  assert.equal(r.plano.consultasIA, undefined);
});

test('Central pesquisa todas as consultas da IA; a IA escolhe quais artigos abrir', async () => {
  const centralRecebeu = [];
  let abertos = null;
  const r = await svc.pesquisar(ctx, { ...base,
    gerarConsultasIA: async () => ({ consultas: ['SIGAGCT aprovação lançamento contratos', 'SIGAGCT alçada aprovação contratos'] }),
    buscarSerper: async () => [],
    buscarCentralTotvs: async (q) => { centralRecebeu.push(q); return q.includes('alçada')
      ? [{ titulo: 'SIGAGCT - Controle de alçada na mudança de situação do contrato', url: 'https://c/1', trecho: 'alçada', fonte: 'Central TOTVS', oficial: true }]
      : [{ titulo: 'SIGAGCT - Lançamentos Padronizados', url: 'https://c/2', trecho: 'LP', fonte: 'Central TOTVS', oficial: true }]; },
    selecionarArtigosIA: async ({ candidatos }) => ({ selecionados: [candidatos.find(c => /alçada/.test(c.titulo)).i], motivo: 'trata da alçada' }),
    abrirResultados: async (lista, limite) => { abertos = lista.slice(0, limite).map(x => x.url); return []; },
  });
  assert.equal(centralRecebeu.length, 2);
  assert.deepEqual(abertos, ['https://c/1']);
  assert.equal(r.selecaoArtigos.executada, true);
});

test('nenhum artigo relevante: nada é aberto, a resposta é orientada e o Quality Gate não acusa falta de leitura', async () => {
  let abriu = false;
  const r = await svc.pesquisar(ctx, { ...base,
    gerarConsultasIA: async () => ({ consultas: ['SIGAFAT nota mãe saldo produto'] }),
    buscarSerper: async () => [],
    buscarCentralTotvs: async () => [{ titulo: 'SIGAEIC - Relacionamento de Nota Mãe e Filha', url: 'https://c/3', trecho: 'importação', fonte: 'Central TOTVS', oficial: true }],
    selecionarArtigosIA: async () => ({ selecionados: [], motivo: 'outro conceito' }),
    abrirResultados: async () => { abriu = true; return []; },
  });
  assert.equal(abriu, false);
  const ctxPrompt = svc.formatarContextoParaPrompt(r, []);
  assert.match(ctxPrompt, /nenhum trata do problema relatado/);
  assert.match(ctxPrompt, /nao encontrou artigo especifico/);
  assert.ok(!ctxPrompt.includes('Links relacionados'), 'artigo de outro módulo não vira link relacionado');
  const comRelacionado = svc.formatarContextoParaPrompt({ ...r, resultados: [...r.resultados, { titulo: 'SIGAFAT - Saldo do pedido de venda', url: 'https://c/4', oficial: true }] }, []);
  assert.ok(comRelacionado.includes('Links relacionados (oficiais, nao confirmam a causa):\n- SIGAFAT - Saldo do pedido de venda — https://c/4'));
  const qg = require('../backend/services/quality-gate-service').avaliarResposta({
    textoResposta: 'A documentação oficial encontrada não cobre este processo, que aparenta ser customizado.',
    manifesto: { selecionados: [], omitidos: [] }, pesquisa: { ...r, configurado: true }, pergunta: ctx.texto,
  });
  assert.ok(!qg.falhas.some(f => f.codigo === 'RESEARCH_FOUND_BUT_NOT_READ'), JSON.stringify(qg.falhas.map(f => f.codigo)));
});

test('falha na seleção mantém a escolha por ranking (2 primeiros)', async () => {
  let limiteUsado = null;
  await svc.pesquisar(ctx, { ...base,
    gerarConsultasIA: async () => ({ consultas: ['SIGAGCT alçada aprovação contratos'] }),
    buscarSerper: async () => [],
    buscarCentralTotvs: async () => [{ titulo: 'SIGAGCT - Alçada A', url: 'https://c/a', trecho: 'a', oficial: true }, { titulo: 'SIGAGCT - Alçada B', url: 'https://c/b', trecho: 'b', oficial: true }],
    selecionarArtigosIA: async () => { throw new Error('timeout'); },
    abrirResultados: async (lista, limite) => { limiteUsado = limite; return []; },
  });
  assert.equal(limiteUsado, 2);
});

test('artigo de outro módulo sai antes da seleção; sem módulo na consulta nada é filtrado', () => {
  const cands = [{ titulo: 'Linha Protheus - SIGAEIC - Relacionamento de Nota Mãe e Filha' }, { titulo: 'SIGAFAT - Saldo liberado parcialmente no pedido' }, { titulo: 'Artigo sem módulo no título' }];
  assert.deepEqual(svc._filtrarPorModulo(cands, ['SIGAFAT nota mãe saldo pedido']).map(c => c.titulo), [cands[1].titulo, cands[2].titulo]);
  assert.equal(svc._filtrarPorModulo(cands, ['nota mãe saldo pedido']).length, 3);
  assert.equal(svc._filtrarPorModulo([{ titulo: 'RH - Linha Protheus - GPE - Manutenção Arquivo DIRF' }], ['GPE geração DIRF']).length, 1);
});

test('regras fixas: página de seção, outro módulo e título sem termo do problema saem antes da IA', () => {
  const c = [
    { titulo: 'Faturamento (SIGAFAT)', url: 'https://centraldeatendimento.totvs.com/hc/pt-br/sections/1500001545362-Faturamento-SIGAFAT' },
    { titulo: 'SIGAFAT - Consultar saldo do item nos orçamentos de venda (MATA415)', url: 'https://c/b' },
    { titulo: 'SIGAEIC - Relacionamento de Nota Mãe e Filha', url: 'https://c/c' },
    { titulo: 'SIGAFAT - Faturamento x Cartão de Crédito', url: 'https://c/d' },
  ];
  assert.deepEqual(svc._filtrarCandidatos(c, ['SIGAFAT nota mãe saldo item']).map(x => x.url), ['https://c/b']);
  assert.equal(svc._filtrarCandidatos(c.slice(1), []).length, 3, 'sem consultas da IA: só a regra de seção');
});

test('com página lida, a resposta é orientada a usar o artigo e não citar referência sem lastro', () => {
  const ctxPrompt = svc.formatarContextoParaPrompt({ configurado: true, modo: 'web', paginasLidas: [{ titulo: 'SIGAGCT - Alçada', url: 'https://c/1', status: 'lida', trecho: 'MV_CNALCAD' }] }, []);
  assert.match(ctxPrompt, /USO OBRIGATORIO DAS PAGINAS LIDAS/);
  assert.doesNotMatch(svc.formatarContextoParaPrompt({ configurado: true, modo: 'web', paginasLidas: [] }, []), /USO OBRIGATORIO/);
});

test('consultas da IA não usam respostas anteriores da IA (evita eco de referência sem lastro)', async () => {
  let recebido = null;
  await svc.pesquisar({ ...ctx, mensagens: [...ctx.mensagens, { papel: 'assistant', conteudo: 'Verifique o ponto de entrada M120FGCT.' }] }, { ...base,
    gerarConsultasIA: async ({ ctx: c }) => { recebido = c; return { consultas: [] }; },
    buscarSerper: async () => [], buscarCentralTotvs: async () => [],
  });
  assert.ok(recebido);
  const { _textoParaConsultasIA } = svc;
  if (_textoParaConsultasIA) assert.doesNotMatch(_textoParaConsultasIA(recebido), /M120FGCT/);
});

test('termos de busca recebem trechos de anexos (linhas de erro) e o texto dos prints, sem código-fonte', () => {
  const texto = svc._textoParaConsultasIA({ ...ctx,
    anexos: [
      { nomeOriginal: 'appserver.log', conteudoExtraido: 'inicio\nTHREAD ERROR: Help CNTA100MIN ao incluir contrato\nfim' },
      { nomeOriginal: 'relato.docx', conteudoExtraido: '[Word extraido textualmente]\nO saldo foi baixado do item errado.' },
      { nomeOriginal: 'CNTA300.prw', eCodigo: true, conteudoExtraido: 'User Function XPTO()\nReturn' },
    ],
    textoPrints: 'Tela: Manutenção Arquivo DIRF\nSem registros para o filtro selecionado',
  });
  assert.match(texto, /Help CNTA100MIN/);
  assert.match(texto, /saldo foi baixado do item errado/);
  assert.match(texto, /Sem registros para o filtro selecionado/);
  assert.doesNotMatch(texto, /User Function XPTO/);
});

test('leitura dos prints só acontece quando a pesquisa vai buscar', async () => {
  let leu = 0;
  await svc.pesquisar({ ...ctx, obterTextoPrints: async () => { leu += 1; return 'Sem registros'; } }, { ...base,
    gerarConsultasIA: async ({ ctx: c }) => { assert.equal(c.textoPrints, 'Sem registros'); return { consultas: [] }; },
    buscarSerper: async () => [], buscarCentralTotvs: async () => [],
  });
  assert.equal(leu, 1);
  leu = 0;
  await svc.pesquisar({ ...ctx, pesquisaExternaBloqueada: { responsavel: 'cliente' }, obterTextoPrints: async () => { leu += 1; return ''; } }, { ...base, buscarSerper: async () => [] });
  assert.equal(leu, 0, 'pesquisa bloqueada não lê prints');
});

test('consulta em linguagem natural vai na frente para o Google; a Central recebe só as técnicas', async () => {
  let serper = null; const central = [];
  await svc.pesquisar(ctx, { ...base,
    gerarConsultasIA: async () => ({ consultas: ['GPE manutenção DIRF conferência'], consultaNatural: 'colaboradores não aparecem na manutenção da DIRF protheus' }),
    buscarSerper: async (q) => { serper = q; return []; },
    buscarCentralTotvs: async (q) => { central.push(q); return []; },
  });
  assert.equal(serper[0], 'colaboradores não aparecem na manutenção da DIRF protheus');
  assert.deepEqual(central, ['TOTVS Protheus GPE manutenção DIRF conferência']);
});

test('orientações da pesquisa sobrevivem quando o motor de contexto remonta o texto com as páginas lidas', () => {
  const { _selecionarPesquisaExterna } = require('../backend/services/context-engine');
  const pesquisa = { configurado: true, modo: 'web', paginasLidas: [{ titulo: 'SIGAGCT - Alçada', url: 'https://c/1', status: 'lida', trecho: 'MV_CNALCRV' }] };
  const texto = svc.formatarContextoParaPrompt(pesquisa, []) + '\n\n## Chamado de customização\nPeça o fonte.';
  const r = _selecionarPesquisaExterna(pesquisa, texto, 5000);
  assert.match(r.texto, /Paginas abertas e lidas/);
  assert.match(r.texto, /USO OBRIGATORIO DAS PAGINAS LIDAS/);
  assert.match(r.texto, /Chamado de customização/);
  const curto = _selecionarPesquisaExterna({ configurado: true }, 'x'.repeat(20000) + '\n## Orientacoes para a resposta\nRegra Y', 200);
  assert.match(curto.texto, /Regra Y/, 'mesmo cortado por orçamento');
});
