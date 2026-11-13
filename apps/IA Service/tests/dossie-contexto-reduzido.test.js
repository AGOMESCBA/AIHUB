'use strict';
// Contexto reduzido do turno para a atualização do dossiê (experimental,
// IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO=1). Sem IA: compara o prompt completo
// e o reduzido montados a partir dos mesmos dados e confere, com banco
// temporário, que evidências citadas por id continuam aceitas.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-dossie-reduzido-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const anexoRepo = require('../backend/repositories/anexo-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const dossieService = require('../backend/services/investigacao-dossie-service');
const atualizador = require('../backend/services/investigacao-dossie-atualizador-service');
const aiConfigService = require('../backend/services/ai-config-service');
const aiProviderClient = require('../backend/services/ai-provider-client');

const originais = { chamarIA: aiProviderClient.chamarIA, resolver: aiConfigService.resolverKeysEOrdem, flag: process.env.IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO };
after(() => {
  aiProviderClient.chamarIA = originais.chamarIA;
  aiConfigService.resolverKeysEOrdem = originais.resolver;
  if (originais.flag === undefined) delete process.env.IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO;
  else process.env.IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO = originais.flag;
  try { database.getDB().close(); } catch (_) {}
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbTmpPath + s, { force: true });
});

// Mesma forma do manifesto do Context Engine e do objeto da pesquisa.
const MANIFESTO = {
  versao: 1,
  orcamento: { entradaDisponivel: 90000, saidaReservada: 6000 },
  tokensEstimadosPrompt: 8123,
  mensagensDisponiveis: 6, mensagensSelecionadas: 6, anexosDisponiveis: 2, anexosSelecionados: 1, imagensSelecionadas: 0,
  selecionados: [
    { tipo: 'mensagem', id: 11, nome: null, status: 'ANALISADA', statusEnvio: 'ENVIADA_COMO_TEXTO', prioridade: 'ALTA', score: 40, tokensEstimados: 120, motivo: 'mensagem atual', tamanhoOriginal: null, textoEnviado: true },
    { tipo: 'anexo', id: 21, nome: 'console.log', status: 'PARCIALMENTE_ANALISADA', statusEnvio: 'ENVIADA_COMO_TEXTO', prioridade: 'CRITICA', score: 90, tokensEstimados: 2400, motivo: 'log com erro', tamanhoOriginal: 81234, textoEnviado: true, cobertura: { linhas: 400 } },
  ],
  omitidos: [{ tipo: 'anexo', id: 22, nome: 'foto.heic', status: 'NAO_SUPORTADA', motivo: 'formato nao suportado', score: 3 }],
  dossie: { versao: 4, itensSelecionados: [{ tipo: 'HIPOTESE', codigo: 'H01' }] },
  pesquisaExterna: { tokensUsados: 900 },
  pendenciaConsolidada: { responsavel: 'cliente', descricao: 'enviar trecho do fonte' },
  quadroInvestigativo: { problemaPrincipal: 'relatorio aborta', evidencias: [{ resumo: 'x'.repeat(360) }], lacunasInformacao: ['Falta o fonte'] },
  eventosOperacionais: [],
  planoRespostaRastreavel: { objetivo: 'Limitar a resposta...', referenciasPermitidas: ['RELFAT01', 'PCFAT03'], lacunasObrigatorias: [{ id: 'lacuna-1' }] },
};
const PESQUISA = {
  dominio: 'protheus', confianca: 'alta', perfil: { nome: 'protheus', instrucao: '...' },
  plano: {
    devePesquisar: true, motivo: 'mudanca investigativa reconhecida semanticamente: evidencia_nova',
    lacunaInvestigativa: { tipo: 'TESTE', descricao: 'validar dado de outubro' },
    historico: { consultas: [{ consulta: 'thread error relfat01' }, { consulta: 'array out of bounds advpl' }], urlsLidas: ['https://tdn.totvs.com/a'] },
    consultasIgnoradas: [{ consulta: 'repetida', motivo: 'ja executada' }],
  },
  consultas: ['relfat01 array out of bounds'],
  consultasExecutadas: ['relfat01 array out of bounds', 'pcfat03 relatorio faturamento'],
  resultados: [{ titulo: 'Nao lido', url: 'https://tdn.totvs.com/nao-lido', trecho: 'resultado nao aberto' }],
  ranking: [{ url: 'https://tdn.totvs.com/a', score: 12 }],
  paginasLidas: [
    { titulo: 'Erro array out of bounds', url: 'https://tdn.totvs.com/a', fonte: 'TDN', status: 'lida', trecho: 'Ocorre ao acessar posicao inexistente do array.', rankingScore: 12, bytes: 5000 },
    { titulo: 'Reaproveitada', url: 'https://tdn.totvs.com/b', fonte: 'TDN', status: 'reutilizada', trecho: 'Trecho reaproveitado.' },
    { titulo: 'Falhou', url: 'https://tdn.totvs.com/c', fonte: 'TDN', status: 'erro', trecho: null },
  ],
  tentativasBusca: [{ provider: 'serper', status: 'ok' }],
};
const ESTADO = {
  dossie: { status: 'ATIVO', problemaAtual: 'Relatorio RELFAT01 aborta', diagnosticoAtual: 'array com 2 posicoes', solucaoProposta: null, solucaoAplicada: null, resultadoValidacao: null, pendencias: ['trecho do fonte'], versao: 4, stale: false },
  fatos: [{ id: 1, codigo: 'F01', tipo: 'FATO', titulo: 'Erro na linha 88', descricao: 'array out of bounds [3] of [2]', status: 'REGISTRADO', confianca: 'ALTA', dados: {} }],
  hipoteses: [
    { id: 2, codigo: 'H01', tipo: 'HIPOTESE', titulo: 'Registro com OBS curto', descricao: 'OBS sem centro de custo', status: 'ABERTA', confianca: 'MEDIA', dados: {} },
    { id: 3, codigo: 'H02', tipo: 'HIPOTESE', titulo: 'PCFAT03 culpado', descricao: 'rotina padrao', status: 'DESCARTADA', confianca: 'BAIXA', dados: {} },
  ],
  testes: [{ id: 4, codigo: 'T01', tipo: 'TESTE', titulo: 'Validar Len(aDados)', descricao: 'conferir tamanho', status: 'SOLICITADO', confianca: 'MEDIA', dados: {} }],
  resultados: [{ id: 5, codigo: 'R01', tipo: 'RESULTADO', titulo: 'Sem fonte', descricao: 'analista sem acesso ao fonte', status: 'REGISTRADO', confianca: 'ALTA', dados: { resultado: 'INCONCLUSIVO' } }],
  relacoes: [{ itemId: 1, alvoTipo: 'anexo', alvoId: 21, papel: 'evidencia' }],
};
const TURNO = { estado: ESTADO, mensagemUsuario: 'A consultoria mandou o trecho, segue.', respostaAssistente: 'O trecho mostra StrTokArr com 2 posicoes.', contextoResumo: { tokensEstimadosPrompt: 8123 }, referencias: { retryDeQualityGate: false, providerPrincipal: 'openai', modelPrincipal: 'gpt-5.4' } };

const completo = () => JSON.parse(atualizador._montarPrompt({ ...TURNO, manifesto: MANIFESTO, pesquisa: PESQUISA }));
const reduzido = () => JSON.parse(atualizador._montarPrompt({ ...TURNO, manifesto: atualizador._manifestoParaDossie(MANIFESTO), pesquisa: atualizador._pesquisaParaDossie(PESQUISA) }));

test('estrutura compatível: mesmas chaves, instruções e schema', () => {
  const c = completo(); const r = reduzido();
  assert.deepEqual(Object.keys(r), Object.keys(c));
  assert.deepEqual(Object.keys(r.turnoAtual), Object.keys(c.turnoAtual));
  for (const k of ['tarefa', 'regras', 'schemaEsperado', 'acoesPermitidas']) assert.deepEqual(r[k], c[k], k);
});

test('fatos, hipóteses (inclusive descartadas), testes, resultados e relações preservados', () => {
  const r = reduzido();
  assert.deepEqual(r.estadoAtual, completo().estadoAtual);
  assert.equal(r.estadoAtual.hipoteses.find(h => h.codigo === 'H02').status, 'DESCARTADA');
  assert.equal(r.estadoAtual.relacoes.length, 1);
});

test('mensagem, resposta, resumo e referências do turno preservados', () => {
  const c = completo(); const r = reduzido();
  for (const k of ['mensagemUsuario', 'respostaAssistente', 'contextoResumo', 'referencias']) assert.deepEqual(r.turnoAtual[k], c.turnoAtual[k], k);
});

test('identificadores de todas as evidências selecionadas e omitidas preservados', () => {
  const ids = l => l.map(i => `${i.tipo}:${i.id}`).sort();
  const r = reduzido().turnoAtual.manifesto;
  assert.deepEqual(ids(r.selecionados), ids(MANIFESTO.selecionados));
  assert.deepEqual(ids(r.omitidos), ids(MANIFESTO.omitidos));
  assert.equal(r.omitidos[0].status, 'NAO_SUPORTADA');
  assert.deepEqual(r.pendenciaConsolidada, MANIFESTO.pendenciaConsolidada);
});

test('páginas lidas e reaproveitadas preservadas com trecho; não lidas ficam de fora', () => {
  const p = reduzido().turnoAtual.pesquisa;
  assert.deepEqual(p.paginasLidas.map(x => x.url), ['https://tdn.totvs.com/a', 'https://tdn.totvs.com/b']);
  assert.equal(p.paginasLidas[0].trecho, PESQUISA.paginasLidas[0].trecho);
  assert.deepEqual(p.consultasExecutadas, PESQUISA.consultasExecutadas);
  assert.equal(p.devePesquisar, true);
  assert.equal(p.lacuna, 'TESTE', 'classificação da lacuna continua visível ao dossiê');
  assert.ok(!JSON.stringify(p).includes('nao-lido'));
});

test('sai só auditoria da montagem do contexto e da pesquisa', () => {
  const r = JSON.stringify(reduzido().turnoAtual);
  for (const auditoria of ['orcamento', 'quadroInvestigativo', 'planoRespostaRastreavel', 'historico', 'consultasIgnoradas', 'ranking', 'tentativasBusca', 'tokensEstimados"']) {
    assert.ok(!r.includes(auditoria), auditoria);
  }
  assert.ok(atualizador._montarPrompt({ ...TURNO, manifesto: atualizador._manifestoParaDossie(MANIFESTO), pesquisa: atualizador._pesquisaParaDossie(PESQUISA) }).length
    < atualizador._montarPrompt({ ...TURNO, manifesto: MANIFESTO, pesquisa: PESQUISA }).length);
});

test('entradas ausentes ou vazias não quebram', () => {
  assert.equal(atualizador._manifestoParaDossie(null), null);
  assert.equal(atualizador._pesquisaParaDossie(undefined), null);
  assert.deepEqual(atualizador._manifestoParaDossie({}), { selecionados: [], omitidos: [], pendenciaConsolidada: null });
  assert.deepEqual(atualizador._pesquisaParaDossie({}).paginasLidas, []);
});

async function atualizarComFlag(flag, empresaId) {
  process.env.IA_SERVICE_DOSSIE_CONTEXTO_REDUZIDO = flag;
  const at = atendimentoRepo.criarAtendimento(empresaId, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Relatorio aborta' });
  const anexo = anexoRepo.salvarMetadadosAnexo(empresaId, at.id, { nomeOriginal: 'console.log', nomeInterno: `console-${empresaId}.log`, mimeType: 'text/plain', tamanho: 30, caminhoRelativo: 'fake/console.log', conteudoExtraido: 'array out of bounds', linguagemDetectada: 'log' });
  const user = mensagemRepo.salvarMensagem(empresaId, at.id, { papel: 'user', conteudo: 'Segue o log.', usuarioId: null });
  const assistant = mensagemRepo.salvarMensagem(empresaId, at.id, { papel: 'assistant', conteudo: 'O log mostra array out of bounds.', usuarioId: null, provider: 'openai', model: 'm' });
  const exec = execucaoRepo.salvarExecucao(empresaId, { atendimentoId: at.id, mensagemId: assistant.id, mensagemUsuarioId: user.id, provider: 'openai', model: 'm', status: 'concluido', manifesto: { selecionados: [] }, contexto: {}, usage: {} });
  dossieService.obterOuCriarDossie(empresaId, at.id);
  const prompts = [];
  aiConfigService.resolverKeysEOrdem = () => ({ keys: { openai: 'x' }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: 'm' } } });
  aiProviderClient.chamarIA = async (_k, _c, _s, userPrompt) => {
    prompts.push(userPrompt);
    const m = JSON.parse(userPrompt).turnoAtual.manifesto;
    const anexoCitado = m.selecionados.find(s => s.tipo === 'anexo');
    return { provider: 'openai', model: 'm', texto: JSON.stringify({
      interpretacao: { tipoEvento: 'NOVA_EVIDENCIA', temporalidade: 'PRESENTE', ambiguidade: 'BAIXA', confianca: 'ALTA' },
      alteracoes: [
        { acao: 'CRIAR_FATO', dados: { titulo: 'Log com array out of bounds', descricao: 'O log anexado mostra array out of bounds.', confianca: 'ALTA' }, evidencias: [{ tipo: 'anexo', id: anexoCitado.id }], motivo: 'log' },
        { acao: 'CRIAR_FATO', dados: { titulo: 'Documentacao do erro', descricao: 'TDN descreve o erro de array.', confianca: 'MEDIA' }, evidencias: [{ tipo: 'fonte_externa', id: JSON.parse(userPrompt).turnoAtual.pesquisa.paginasLidas[0].url }], motivo: 'fonte' },
      ],
      diagnosticoAtual: null, pendencias: [], houveMudanca: true,
    }) };
  };
  const manifesto = { ...MANIFESTO, selecionados: [{ ...MANIFESTO.selecionados[1], id: anexo.id }] };
  const r = await atualizador.atualizarAposTurno(empresaId, at.id, {
    mensagemUsuarioId: user.id, mensagemAssistenteId: assistant.id, execucaoId: exec.id,
    mensagemUsuario: user.conteudo, respostaAssistente: assistant.conteudo,
    contextoResumo: { tokensEstimadosPrompt: 10 }, manifesto, pesquisa: PESQUISA,
  });
  return { r, prompt: prompts[0], estado: dossieService.obterEstadoCompleto(empresaId, at.id), anexo };
}

test('com a flag, o atualizador usa o contexto reduzido e aceita evidências citadas por id', async () => {
  const { r, prompt, estado, anexo } = await atualizarComFlag('1', 77101);
  assert.equal(r.status, 'aplicado', JSON.stringify(r.erro || r.auditoria || null));
  assert.ok(!prompt.includes('planoRespostaRastreavel'));
  assert.equal(estado.fatos.length, 2);
  assert.ok(estado.relacoes.some(rel => rel.alvoTipo === 'anexo' && rel.alvoId === anexo.id));
  assert.ok(estado.relacoes.some(rel => rel.alvoTipo === 'fonte_externa'));
});

test('sem a flag, o comportamento atual é mantido (contexto completo)', async () => {
  const { r, prompt, estado } = await atualizarComFlag('0', 77102);
  assert.equal(r.status, 'aplicado');
  assert.ok(prompt.includes('planoRespostaRastreavel'));
  assert.equal(estado.fatos.length, 2);
});
