'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

function carregar(relativo, mocks = {}) {
  const filename = path.resolve(__dirname, relativo);
  const modulo = new Module(filename, module);
  modulo.filename = filename;
  modulo.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = modulo.require.bind(modulo);
  modulo.require = id => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id);
  modulo._compile(fs.readFileSync(filename, 'utf8'), filename);
  return modulo.exports;
}

const platformDB = new Database(':memory:');
const store = carregar('../../IAHUB/backend/platform-store.js', {
  'better-sqlite3': function () { return platformDB; },
});
require('../../IAHUB/backend/platform-schema').ensurePlatformSchema(platformDB);
function identidade(id, empresa, meta = {}, liberado = 1) {
  platformDB.prepare(`INSERT INTO platform_whatsapp_identities
    (id, empresa_id, nome, numero, numero_normalizado, metadata_json, ativo)
    VALUES (?, ?, 'Teste', '5599999999999', '5599999999999', ?, 1)`)
    .run(id, empresa, JSON.stringify(meta));
  platformDB.prepare(`INSERT INTO platform_identity_roles
    (id, identity_id, empresa_id, sistema, modulo, codigo_identidade, liberado)
    VALUES (?, ?, ?, 'ia-service', 'chat-web', '10', ?)`)
    .run(`role-${id}`, id, empresa, liberado);
}
identidade('a', 1, { erp_tipo: 'preservar', iaService: { idSoftexpert: '10', preAnaliseAutomatica: false } });
identidade('b', 2, { iaService: { estiloResposta: 'DIRETO' } });
identidade('c', 3, {}, 0);

const database = require('../backend/database');
database.inicializarDB(':memory:');
const consultorRepo = require('../backend/repositories/consultor-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const consultor = consultorRepo.criarConsultor(1, { telefone: '5599999999999', preAnaliseAutomatica: false });
const consultores = carregar('../backend/services/consultor-service.js', {
  '../../../IAHUB/backend/platform-store': store,
  '../../../IAHUB/backend/usuarios/database': {},
});

let chamadas = [];
let respostaMock;
const config = { resolverKeysEOrdem: empresaId => {
  assert.equal(empresaId, 1);
  return { keys: { openai: 'chave-mock' }, cfg: { provedorPrimario: 'openai' } };
} };
const provider = { chamarIA: async (...args) => {
  chamadas.push(args);
  if (respostaMock instanceof Error) throw respostaMock;
  return typeof respostaMock === 'function' ? respostaMock(...args) : respostaMock;
} };
const humanizador = carregar('../backend/services/resposta-humanizada-service.js', {
  './ai-provider-client': provider, './ai-config-service': config, './consultor-service': consultores,
});
const original = 'A rejeição 1031 ocorre na rotina MATA103 e no campo C7_FILIAL.\n\nA hipótese ainda precisa de confirmação em homologação.\n\nPróximo passo: acompanhar o chamado 30422148.';
function reescritaValida(_keys, _cfg, _system, user, imagens, opts) {
  assert.deepEqual(imagens, []);
  assert.equal(opts.maxProviderRounds, 1);
  assert.equal(opts.totalTimeoutMs, 15000);
  const dados = JSON.parse(user);
  assert.deepEqual(Object.keys(dados), ['estilo', 'limitePalavras', 'resposta']);
  assert.ok(Number.isInteger(dados.limitePalavras) && dados.limitePalavras >= 40, 'meta de tamanho calculada pelo código');
  return { texto: dados.resposta.replace('A rejeição 1031 ocorre', 'A rejeição 1031 aparece'), provider: 'openai', model: 'modelo-mock', usage: { total_tokens: 42 } };
}
after(() => { database.fecharDB(); platformDB.close(); });

test('cadastros antigos usam ORIGINAL; mudança mantém metadados e isola empresas e acesso', () => {
  assert.equal(store.obterEstiloResposta(1, '5599999999999'), 'ORIGINAL');
  store.definirEstiloResposta(1, '5599999999999', 'NATURAL');
  assert.equal(store.obterEstiloResposta(1, '5599999999999'), 'NATURAL');
  // Cadastro antigo com estilo descontinuado (DIRETO) passa a valer como NATURAL.
  assert.equal(store.obterEstiloResposta(2, '5599999999999'), 'NATURAL');
  assert.equal(store.obterEstiloResposta(3, '5599999999999'), 'ORIGINAL');
  assert.throws(() => store.definirEstiloResposta(3, '5599999999999', 'NATURAL'), /não encontrado/);
  assert.throws(() => store.definirEstiloResposta(1, '5599999999999', 'inventado'), /inválido/);
  const meta = JSON.parse(platformDB.prepare('SELECT metadata_json FROM platform_whatsapp_identities WHERE id = ?').get('a').metadata_json);
  assert.equal(meta.erp_tipo, 'preservar');
  assert.equal(meta.iaService.idSoftexpert, '10');
  assert.equal(meta.iaService.preAnaliseAutomatica, false);
});

test('alterar estilo pelo chat sincroniza cadastro e preserva resposta automática desligada', () => {
  consultorRepo.definirPreferenciaPessoal(1, consultor.id, false);
  const salvo = consultores.salvarPreferencias(1, consultor.id, { estiloResposta: 'DESCONTRAIDO' });
  assert.equal(salvo.preAnaliseAutomatica, false);
  assert.equal(salvo.preAnalisePessoal, false);
  // Cliente antigo enviando estilo descontinuado: gravado e lido como NATURAL.
  assert.equal(store.listarIaServicePorTelefone(consultor.telefone)[0].estiloResposta, 'NATURAL');
  assert.equal(consultores.obterEstiloResposta(1, consultor.id), 'NATURAL');
  assert.equal(consultores.obterEstiloResposta(2, consultor.id), 'ORIGINAL');
  assert.throws(() => consultores.salvarPreferencias(2, consultor.id, { estiloResposta: 'NATURAL' }), /não encontrado/);
  assert.throws(() => consultores.salvarPreferencias(1, consultor.id, { estiloResposta: 'invalido', preAnaliseAutomatica: true }), /inválido/);
  assert.equal(consultorRepo.getConsultor(1, consultor.id).preAnaliseAutomatica, false);
  store.definirEstiloResposta(1, consultor.telefone, 'ORIGINAL');
  assert.equal(consultores.obterEstiloResposta(1, consultor.id), 'ORIGINAL', 'alteração no cadastro chega ao chat sem novo login');
});

test('ORIGINAL mantém texto exato sem resolver provider nem chamar IA', async () => {
  chamadas = [];
  const r = await humanizador.humanizar({ empresaId: 1, respostaOriginal: original, estilo: 'ORIGINAL' });
  assert.equal(r.respostaFinal, original);
  assert.equal(r.status, 'original');
  assert.equal(chamadas.length, 0);
});

// DIRETO/DESCONTRAIDO foram descontinuados: preferências antigas aplicam NATURAL.
for (const estilo of ['NATURAL', 'DIRETO', 'DESCONTRAIDO']) {
  test(`${estilo}: aplica NATURAL, só reescreve comunicação, preserva referências, ressalvas e registra consumo`, async () => {
    chamadas = []; respostaMock = reescritaValida;
    const r = await humanizador.humanizar({ empresaId: 1, respostaOriginal: original, estilo });
    assert.equal(r.status, 'aplicada');
    assert.equal(r.estilo, 'NATURAL');
    assert.equal(r.respostaOriginal, original);
    assert.ok(r.respostaFinal.includes('A rejeição 1031 aparece'));
    assert.ok(r.respostaFinal.includes('A hipótese ainda precisa de confirmação em homologação.'));
    assert.equal(r.usage.total_tokens, 42);
    assert.equal(chamadas.length, 1);
  });
}

test('falha, timeout, vazio, truncamento e referências alteradas voltam ao original', async () => {
  for (const resposta of [new Error('timeout'), { texto: '' }, { texto: original, truncado: true },
    { texto: original.replace('C7_FILIAL', 'C7_FILIA2') }, { texto: 'Foi resolvido.' }]) {
    respostaMock = resposta;
    const r = await humanizador.humanizar({ empresaId: 1, respostaOriginal: original, estilo: 'NATURAL' });
    assert.equal(r.status, 'fallback');
    assert.equal(r.respostaFinal, original);
  }
});

test('código, SQL, comandos, hipóteses e pendências são protegidos literalmente', async () => {
  const texto = 'O erro ocorre na rotina MATA103.\n\n```sql\nSELECT C7_FILIAL FROM SC7010;\n```\n\nTalvez o campo `C7_FILIAL` tenha relação com o erro.\n\nNão repetir ajustes: aguardando o fornecedor.\n\nPróximo passo: acompanhar o retorno.';
  respostaMock = (_k, _c, _s, user) => ({ texto: JSON.parse(user).resposta.replace('O erro ocorre', 'O erro aparece') });
  const r = await humanizador.humanizar({ empresaId: 1, respostaOriginal: texto, estilo: 'NATURAL' });
  assert.equal(r.status, 'aplicada');
  assert.ok(r.respostaFinal.includes('```sql\nSELECT C7_FILIAL FROM SC7010;\n```'));
  assert.ok(r.respostaFinal.includes('Talvez o campo `C7_FILIAL` tenha relação com o erro.'));
  assert.ok(r.respostaFinal.includes('Não repetir ajustes: aguardando o fornecedor.'));
  respostaMock = (_k, _c, _s, user) => ({ texto: JSON.parse(user).resposta.replace(/__IAHUB_PROTEGIDO_\d+__/, 'Causa confirmada.') });
  assert.equal((await humanizador.humanizar({ empresaId: 1, respostaOriginal: texto, estilo: 'DIRETO' })).status, 'fallback');
});

test('resposta reprovada e texto excessivo não consomem chamada adicional', async () => {
  chamadas = [];
  for (const dados of [{ respostaOriginal: original, aprovado: false }, { respostaOriginal: 'x'.repeat(18001) }]) {
    const r = await humanizador.humanizar({ empresaId: 1, estilo: 'NATURAL', ...dados });
    assert.equal(r.status, 'ignorada');
  }
  assert.equal(chamadas.length, 0);
});

test('segredos ficam locais e comandos ou identificadores novos são rejeitados', async () => {
  const texto = 'A rotina aItens registra erro.\n\nsenha=segredo-teste-local\n\nPróximo passo: conferir o retorno.';
  respostaMock = (_k, _c, _s, user) => {
    assert.equal(user.includes('segredo-teste-local'), false);
    return { texto: JSON.parse(user).resposta.replace('registra erro', 'apresenta erro') };
  };
  const r = await humanizador.humanizar({ empresaId: 1, respostaOriginal: texto, estilo: 'NATURAL' });
  assert.equal(r.status, 'aplicada');
  assert.ok(r.respostaFinal.includes('senha=segredo-teste-local'));
  assert.equal(humanizador.validar('Use aItens.', 'Use bItens.'), false);
  assert.equal(humanizador.validar('Verificar o retorno.', 'Verificar o retorno.\ncurl exemplo'), false);
  // Gate final: frase nova e dado acrescentado são aviso; identificador removido bloqueia.
  assert.equal(humanizador.validar('O erro não foi resolvido.', 'O erro não foi resolvido. Foi resolvido.'), true);
  assert.equal(humanizador.validar('O erro ocorre na rotina ROTINA99.', 'O erro ocorre.'), false);
});

// 2026-10-26 (achado real): a resposta curta de conversa ("você consegue...?")
// NÃO passa mais pela reescrita de estilo — a Objetiva forçava "Falta:/Próximos
// passos:" e deixava a resposta seca ("Falta: error.log e o código fonte.").
test('resposta curta (pergunta de processo) é gravada como a IA escreveu, sem reescrita de estilo', async () => {
  store.definirEstiloResposta(1, consultor.telefone, 'NATURAL');
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Erro', consultorId: consultor.id });
  const curtoProvider = {};
  // Classificação é a primeira chamada do fluxo existente; não é humanização.
  let n = 0;
  curtoProvider.chamarIA = async () => ++n === 1 ? { texto: '{"tipo":"pergunta_processo"}' } : { texto: original, provider: 'openai', model: 'mock' };
  respostaMock = reescritaValida;
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-provider-client': curtoProvider, './ai-config-service': config,
    './consultor-service': consultores, './resposta-humanizada-service': humanizador,
    './technical-research-service': new Proxy({}, { get: () => () => { throw Error('Pesquisa externa indevida'); } }),
  });
  const retorno = await investigacao.processarTurno(1, at.id, { texto: 'Você consegue ajudar?', consultorId: consultor.id });
  assert.equal(retorno.conteudo, original.trim(), 'texto da IA, sem reescrita');
  assert.equal(retorno.diagnostico, null, 'sem auditoria de humanização');
  assert.equal(retorno.respostaCurta, 'pergunta_processo');
  assert.equal(n, 2, 'só classificação + resposta curta; nenhuma chamada de reescrita');
  const mensagens = mensagemRepo.listarMensagens(1, at.id);
  assert.equal(mensagens.filter(m => m.papel === 'assistant').length, 1);
  assert.equal(mensagens.at(-1).conteudo, retorno.conteudo);
  const outro = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Outro' });
  assert.equal(consultores.obterEstiloResposta(1, consultor.id), 'NATURAL');
  assert.notEqual(outro.id, at.id);
});

test('rotas internas e externas salvam estilo da identidade autenticada, sem aceitar outro consultor', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  database.getDB().prepare('UPDATE consultores SET usuario_id_iahub = 42 WHERE id = ?').run(consultor.id);
  const interno = carregar('../backend/routes/index.js', { '../services/consultor-service': consultores });
  app.use((req, _res, next) => { req.session = { user_id: 42 }; next(); });
  interno(app, {
    requireAuth: (req, res, next) => req.headers['x-teste'] ? next() : res.sendStatus(401),
    requireIaService: (req, _res, next) => { req.svcEmpresaId = Number(req.headers['x-empresa'] || 1); next(); },
  });
  const externo = carregar('../backend/routes/externo-routes.js', {
    '../services/consultor-service': consultores,
    '../services/sessao-externa-middleware': { requireSessaoExterna: (req, res, next) => {
      if (!req.headers['x-teste']) return res.sendStatus(401);
      req.svcEmpresaId = Number(req.headers['x-empresa'] || 1);
      req.svcConsultorExterno = consultor.id;
      next();
    } },
  });
  externo(app);
  const atendimentoAuditoria = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Conversa para auditoria' });
  const mensagemAuditoria = mensagemRepo.salvarMensagem(1, atendimentoAuditoria.id, {
    papel: 'assistant', conteudo: 'Resposta ajustada auditável',
    diagnostico: { humanizacao: { respostaOriginal: 'Resposta primária auditável', respostaHumanizada: 'Resposta ajustada auditável',
      estilo: 'NATURAL', status: 'aplicada', provider: 'mock', model: 'mock-model', usage: { total_tokens: 42 } } },
  });
  require('../backend/repositories/investigacao-execucao-repository').salvarExecucao(1, {
    atendimentoId: atendimentoAuditoria.id, mensagemId: mensagemAuditoria.id, status: 'concluido',
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const headers = { 'Content-Type': 'application/json', 'x-teste': 'sim' };
    for (const prefixo of ['ia-service', 'ia-service-externo']) {
      const url = `http://127.0.0.1:${server.address().port}/api/${prefixo}/radar/minhas-preferencias`;
      assert.equal((await fetch(url)).status, 401);
      const salvo = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ estiloResposta: 'DESCONTRAIDO', consultorId: 'outro', empresaId: 2 }) });
      assert.equal(salvo.status, 200);
      assert.equal((await salvo.json()).preAnaliseAutomatica, false);
      const leitura = await (await fetch(url, { headers })).json();
      assert.equal(leitura.estiloResposta, 'NATURAL', 'estilo descontinuado enviado é gravado como NATURAL');
      assert.equal(leitura.consultorId, consultor.id);
      assert.equal((await fetch(url, { method: 'PUT', headers, body: '{"estiloResposta":"inventado"}' })).status, 400);
      assert.equal((await fetch(url, { method: 'PUT', headers: { ...headers, 'x-empresa': '2' }, body: '{"estiloResposta":"NATURAL"}' })).status, 404);
      const trilhaUrl = `http://127.0.0.1:${server.address().port}/api/${prefixo}/atendimentos/${atendimentoAuditoria.id}/trilha`;
      const auditoria = await (await fetch(trilhaUrl, { headers })).json();
      const etapas = auditoria.trilha[0].eventos.slice(-2);
      assert.deepEqual(etapas.map(e => e.tipo), ['resposta_tecnica_original', 'resposta_ajustada']);
      assert.equal(etapas[0].detalhes.conteudo, 'Resposta primária auditável');
      assert.equal(etapas[1].detalhes.conteudo, 'Resposta ajustada auditável');
      assert.equal(etapas[1].detalhes.consumoAdicional.total, 42);
      assert.equal((await fetch(trilhaUrl, { headers: { ...headers, 'x-empresa': '2' } })).status, 404);
    }
    assert.equal(store.obterEstiloResposta(2, consultor.telefone), 'NATURAL');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('trilha mantém versões em ordem, indica fallback e inclui conversa curta sem duplicar execução', () => {
  const trilha = require('../backend/services/trilha-investigacao-service');
  const m = { id: 'msg-audit', papel: 'assistant', criadoEm: '2026-10-17T12:00:00Z', conteudo: 'Texto final', respostaCurta: 'pergunta_processo',
    diagnostico: { humanizacao: { respostaOriginal: 'Primária: senha=segredo-local', respostaHumanizada: 'Texto final', estilo: 'NATURAL',
      status: 'aplicada', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } } };
  const curta = trilha.montarTrilha([], [m]);
  assert.equal(curta.length, 1);
  assert.equal(curta[0].origem, 'conversa');
  assert.deepEqual(curta[0].eventos.map(e => e.tipo), ['resposta_tecnica_original', 'resposta_ajustada']);
  assert.equal(curta[0].eventos[0].detalhes.conteudo.includes('segredo-local'), false);
  assert.equal(curta[0].eventos[1].detalhes.consumoAdicional.total, 15);
  const execucao = { id: 'exec-audit', mensagemId: m.id, criadoEm: m.criadoEm, status: 'concluido' };
  assert.equal(trilha.montarTrilha([execucao], [m]).length, 1);
  m.diagnostico.humanizacao.status = 'fallback';
  m.diagnostico.humanizacao.respostaHumanizada = null;
  const fallback = trilha.montarTrilha([execucao], [m])[0].eventos.at(-1);
  assert.equal(fallback.status, 'alerta');
  assert.ok(fallback.resumo.includes('original entregue'));
  assert.equal(fallback.detalhes.conteudo.includes('segredo-local'), false);
  const antiga = trilha.montarTrilha([execucao], [{ ...m, diagnostico: null }])[0].eventos.at(-1);
  assert.equal(antiga.tipo, 'resposta_tecnica_original');
  assert.equal(antiga.detalhes.conteudo, 'Texto final');
});

test('fluxo investigativo humaniza somente após o gate e mantém dossiê e consumo técnico originais', async () => {
  const etapas = [];
  let pesquisas = 0, dossie;
  store.definirEstiloResposta(1, consultor.telefone, 'NATURAL');
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Erro técnico', consultorId: consultor.id });
  const anterior = mensagemRepo.salvarMensagem(1, at.id, {
    papel: 'assistant', conteudo: 'Texto humanizado anterior',
    diagnostico: { humanizacao: { respostaOriginal: 'Texto técnico anterior completo' } },
  });
  const realProvider = require('../backend/services/ai-provider-client');
  const realContexto = require('../backend/services/context-engine');
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-provider-client': { ...realProvider, chamarIA: async () => {
      etapas.push('resposta_tecnica');
      return { texto: original, provider: 'openai', model: 'gpt-4o-mini', usage: { total_tokens: 100 } };
    } },
    './ai-config-service': { ...config, resolverConfigPesquisa: () => ({}) },
    './consultor-service': consultores,
    './context-engine': { ...realContexto, montarContextoInvestigacao: dados => {
      if (dados.atendimento.id === at.id) assert.equal(dados.mensagens.find(m => m.id === anterior.id).conteudo, 'Texto técnico anterior completo');
      return realContexto.montarContextoInvestigacao(dados);
    } },
    './resposta-humanizada-service': { prepararResposta: async dados => {
      etapas.push('humanizacao');
      assert.equal(dados.aprovado, true);
      return humanizador.prepararResposta(dados);
    } },
    './technical-research-service': { pesquisar: async () => { pesquisas++; return {}; }, formatarContextoParaPrompt: () => '' },
    './quality-gate-service': { avaliarResposta: dados => {
      etapas.push('quality_gate'); assert.equal(dados.textoResposta, original);
      return { aprovado: true, deveRetry: false, falhas: [] };
    } },
    './investigacao-dossie-atualizador-service': { atualizarAposTurno: async (_e, _a, dados) => { dossie = dados; } },
  });
  respostaMock = reescritaValida;
  const retorno = await investigacao.processarPreAnalise(1, at.id);
  assert.deepEqual(etapas, ['resposta_tecnica', 'quality_gate', 'humanizacao']);
  assert.equal(pesquisas, 1, 'humanização não repete pesquisa');
  assert.equal(retorno.diagnostico.humanizacao.status, 'aplicada');
  assert.equal(dossie.respostaAssistente, original);
  const historico = mensagemRepo.listarMensagens(1, at.id);
  assert.equal(historico.length, 2, 'somente uma nova mensagem');
  assert.equal(historico.find(m => m.id === anterior.id).conteudo, 'Texto humanizado anterior', 'não reescreve mensagem antiga');
  const execucoes = require('../backend/repositories/investigacao-execucao-repository').listarPorAtendimento(1, at.id);
  assert.equal(execucoes.length, 1);
  assert.equal(execucoes[0].model, 'gpt-4o-mini', 'auditoria investigativa mantém o modelo técnico');
  assert.equal(retorno.diagnostico.humanizacao.usage.total_tokens, 42);
  etapas.length = 0;
  const fallbackAt = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Erro técnico', consultorId: consultor.id });
  respostaMock = { texto: original.replace('C7_FILIAL', 'C7_FILIA2'), provider: 'openai', model: 'mock' };
  const fallback = await investigacao.processarPreAnalise(1, fallbackAt.id);
  assert.deepEqual(etapas, ['resposta_tecnica', 'quality_gate', 'humanizacao'], 'falha editorial não repete gate nem investigação');
  assert.equal(fallback.conteudo, original);
  assert.equal(fallback.diagnostico.humanizacao.aprovacaoTecnica.aprovado, true);
  assert.ok(fallback.diagnostico.humanizacao.respostaCandidata.includes('C7_FILIA2'));
  assert.ok(fallback.diagnostico.humanizacao.validacaoPreservacao.falhas.some(f => f.codigo === 'REFERENCIA_TECNICA_REMOVIDA'));
});

test('provider respeita orçamento total de timeout e desliga retry extra de raciocínio somente quando solicitado', async () => {
  const https = require('https');
  const { EventEmitter } = require('events');
  const realRequest = https.request;
  let chamadasRede = 0;
  const ia = require('../backend/services/ai-provider-client');
  try {
    https.request = (opts, _cb) => {
      chamadasRede++;
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {};
      opts.signal.addEventListener('abort', () => req.emit('error', new Error('timeout simulado')), { once: true });
      return req;
    };
    await assert.rejects(() => ia.chamarIA({ openai: 'mock', deepseek: 'mock' },
      { provedorPrimario: 'openai', fallbackOrdem: 'openai,deepseek' }, 'system', 'user', [],
      { timeoutMs: 20, totalTimeoutMs: 30, maxProviderRounds: 1, semRetryRaciocinio: true }));
    assert.ok(chamadasRede >= 1 && chamadasRede <= 2);
    chamadasRede = 0;
    https.request = (_opts, cb) => {
      chamadasRede++;
      const req = new EventEmitter(); req.write = () => {};
      req.end = () => process.nextTick(() => {
        const res = new EventEmitter(); cb(res);
        res.emit('data', JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: {} }));
        res.emit('end');
      });
      return req;
    };
    await assert.rejects(() => ia.chamarIA({ groq: 'mock' }, { provedorPrimario: 'groq', fallbackOrdem: 'groq' },
      'system', 'user', [], { maxProviderRounds: 1, semRetryRaciocinio: true }));
    assert.equal(chamadasRede, 1);
  } finally { https.request = realRequest; }
});
