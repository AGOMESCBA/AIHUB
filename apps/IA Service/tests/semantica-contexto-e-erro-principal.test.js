'use strict';
// (1) A interpretação semântica recebe o problema do chamado e a última
// resposta da IA (replay v03: "Onde ajusto esse limite?" ficava sem referente).
// (2) Erros de log viram candidatos e a IA de consultas escolhe a mensagem
// principal (replay d06: THREAD ERROR + array out of bounds). Sem rede.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../backend/services/technical-research-service');
const aiProviderClient = require('../backend/services/ai-provider-client');
const aiConfigService = require('../backend/services/ai-config-service');

const originais = { chamarIA: aiProviderClient.chamarIA, resolver: aiConfigService.resolverKeysEOrdem };
after(() => { aiProviderClient.chamarIA = originais.chamarIA; aiConfigService.resolverKeysEOrdem = originais.resolver; });
aiConfigService.resolverKeysEOrdem = () => ({ keys: { openai: 'x' }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: 'm' } } });

function iaSemantica(resposta) {
  const prompts = [];
  aiProviderClient.chamarIA = async (_k, _c, sys, user) => {
    if (!sys.startsWith('Voce classifica apenas')) throw new Error(`chamada inesperada: ${sys.slice(0, 40)}`);
    prompts.push(JSON.parse(user));
    return { provider: 'openai', model: 'm', texto: JSON.stringify(resposta) };
  };
  return prompts;
}

const ctxV03 = () => ({
  empresaId: 1,
  chamado: { produto: 'SoftExpert', titulo: 'Anexo recusado no formulário de contratos', descricao: "No formulário do workflow de contratos, anexos acima de 10 MB são recusados com 'Arquivo excede o tamanho permitido'." },
  mensagens: [{ papel: 'customer', conteudo: "No formulário do workflow de contratos, anexos acima de 10 MB são recusados com 'Arquivo excede o tamanho permitido'." }],
  texto: 'Onde ajusto esse limite?',
  turnoHumano: true,
});
const NAO_PEDIDO = { haMudancaInvestigativa: false, tipoMudanca: 'nenhuma_mudanca', haEvidenciaNova: false, relevanciaParaPesquisa: 'nenhuma', justificativa: 'x', confiancaQualitativa: 'alta' };

test('v03: a interpretação semântica recebe o problema do chamado', async () => {
  const prompts = iaSemantica({ ...NAO_PEDIDO, pedidoInvestigacaoAnalista: 'sim' });
  await svc.planejarPesquisaComSemantica(ctxV03());
  assert.equal(prompts.length, 1);
  const estado = JSON.parse(prompts[0].estadoCompacto);
  assert.match(estado.problemaDoChamado, /10 MB/);
  assert.match(estado.problemaDoChamado, /Arquivo excede o tamanho permitido/);
  assert.equal(prompts[0].mensagemAtual, 'Onde ajusto esse limite?');
});

test('v03: com o contexto, quem decide é a IA — "sim" pesquisa, "incerto" pergunta', async () => {
  iaSemantica({ ...NAO_PEDIDO, pedidoInvestigacaoAnalista: 'sim' });
  const sim = await svc.planejarPesquisaComSemantica(ctxV03());
  assert.equal(sim.devePesquisar, true, sim.motivo);
  iaSemantica({ ...NAO_PEDIDO, pedidoInvestigacaoAnalista: 'incerto' });
  const incerto = await svc.planejarPesquisaComSemantica(ctxV03());
  assert.equal(incerto.devePesquisar, false);
  assert.equal(incerto.confirmarPedidoPesquisa, true);
});

test('pergunta que se refere à resposta anterior: a semântica recebe essa resposta', async () => {
  const prompts = iaSemantica({ ...NAO_PEDIDO, pedidoInvestigacaoAnalista: 'nao' });
  const ctx = ctxV03();
  ctx.mensagens.push({ papel: 'assistant', conteudo: 'O limite pode estar no tipo de documento ou no servidor web (maxAllowedContentLength do IIS).' });
  ctx.texto = 'E onde eu confiro isso?';
  await svc.planejarPesquisaComSemantica(ctx);
  const estado = JSON.parse(prompts[0].estadoCompacto);
  assert.match(estado.ultimaRespostaIA, /maxAllowedContentLength/);
});

const LOG = [
  'THREAD ERROR ([8812], usr_fat, PCFAT03)   04/11/2026   09:12:44',
  'array out of bounds [3] of [2]  on U_RELFAT01(RELFAT01.PRW) 21/08/2026 10:02:11 line : 88',
  '[TOTVS build: 7.00.210324P-20230915]',
  'Called from U_RELFAT01(RELFAT01.PRW) 21/08/2026 10:02:11 line : 88',
  'Called from RPTSTATUS(RPTDEF.PRW) line : 912',
].join('\n');
const ctxD06 = () => ({
  empresaId: 1,
  chamado: { produto: 'Protheus', titulo: 'Relatório de faturamento aborta' },
  mensagens: [{ papel: 'customer', conteudo: 'O relatório customizado de faturamento aborta ao processar outubro.' }],
  anexos: [{ nomeOriginal: 'error.log', conteudoExtraido: LOG }],
  texto: 'O que esse log indica? Pesquise na documentação.',
  forcarPesquisa: true,
});

test('log com vários marcadores: linhas preservadas e erros como candidatos', () => {
  const s = svc._extrairSinaisTecnicos(ctxD06());
  assert.ok(s.erros.some(e => /THREAD ERROR \(\[8812\], usr_fat, PCFAT03\) 04\/11\/2026 09:12:44$/.test(e)), JSON.stringify(s.erros));
  assert.ok(!s.erros.some(e => e.length > 120), 'o erro é a linha, não o texto inteiro');
  assert.ok(!s.erros.some(e => /Called from/.test(e)), 'a pilha não é colada ao erro');
  assert.ok(s.errosCandidatos.some(c => /THREAD ERROR .* \|\| array out of bounds \[3\] of \[2\]/.test(c)), JSON.stringify(s.errosCandidatos));
});

async function pesquisarD06(erroPrincipal) {
  const buscas = []; let promptConsultas = null;
  const r = await svc.pesquisar(ctxD06(), {
    searchConfig: { serperApiKey: 'fixture', provedorPrimario: 'serper', fallbackOrdem: '' },
    interpretarSemantico: async () => null,
    gerarConsultasIA: async ({ plano }) => { promptConsultas = plano.sinaisTecnicos.errosCandidatos; return { consultas: ['SIGAFAT array out of bounds relatorio'], erroPrincipal }; },
    buscarSerper: async (qs) => { buscas.push(...qs); return [
      { titulo: 'Erro array out of bounds em ADVPL', url: 'https://tdn.totvs.com/array', trecho: 'array out of bounds ocorre ao acessar posicao inexistente', fonte: 'TDN' },
      { titulo: 'THREAD ERROR no appserver', url: 'https://tdn.totvs.com/thread', trecho: 'thread error generico do appserver', fonte: 'TDN' },
    ]; },
    buscarCentralTotvs: async () => [],
    abrirResultados: async () => [],
  });
  return { r, buscas, promptConsultas };
}

test('a IA de consultas recebe os candidatos e a mensagem principal escolhida guia busca e ranking', async () => {
  const { r, buscas, promptConsultas } = await pesquisarD06('array out of bounds');
  assert.ok(promptConsultas.length > 0, 'candidatos enviados à IA de consultas');
  assert.ok(r.plano.sinaisTecnicos.assinaturasErro.includes('array out of bounds'));
  assert.ok(buscas.some(q => /Protheus array out of bounds/.test(q)), JSON.stringify(buscas));
  const [top] = r.ranking;
  assert.equal(top.url, 'https://tdn.totvs.com/array');
  assert.ok(top.motivos.includes('mensagem principal correspondente'), JSON.stringify(top.motivos));
});

test('mensagem principal que não está no chamado é ignorada; sem ela, vale o determinístico', async () => {
  const inventada = await pesquisarD06('deadlock detected');
  assert.equal(inventada.r.plano.consultasIA.erroPrincipal, null);
  assert.ok(!inventada.r.plano.sinaisTecnicos.assinaturasErro.includes('deadlock detected'));
  assert.ok(inventada.buscas.length > 0, 'a busca segue com as consultas da IA e determinísticas');
});

test('o prompt real da IA de consultas leva as linhas de erro candidatas', async () => {
  let enviado = null;
  aiProviderClient.chamarIA = async (_k, _c, sys, user) => { enviado = { sys, user: JSON.parse(user) }; return { provider: 'openai', model: 'm', texto: JSON.stringify({ consultas: ['SIGAFAT array out of bounds'], erroPrincipal: 'array out of bounds' }) }; };
  const plano = svc.planejarPesquisa({ ...ctxD06(), forcarPesquisa: true });
  const auditoria = await svc._gerarConsultasComIA(ctxD06(), plano);
  assert.match(enviado.sys, /erroPrincipal/);
  assert.ok(enviado.user.linhasDeErro.some(l => /array out of bounds/.test(l)));
  assert.equal(enviado.user.mensagemAtual, ctxD06().texto, 'a IA de consultas distingue a mensagem atual');
  assert.match(enviado.sys, /erro ATUAL e o da mensagemAtual/);
  assert.equal(auditoria.erroPrincipal, 'array out of bounds');
});
