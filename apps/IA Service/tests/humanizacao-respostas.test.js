'use strict';

require('./helpers/rotinas-svc-liberadas'); // rotas exigem rotina svc-* (2026-10-28)
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

const config = { resolverKeysEOrdem: empresaId => {
  assert.equal(empresaId, 1);
  return { keys: { openai: 'chave-mock' }, cfg: { provedorPrimario: 'openai' } };
} };
const original = 'A rejeição 1031 ocorre na rotina MATA103 e no campo C7_FILIAL.\n\nA hipótese ainda precisa de confirmação em homologação.\n\nPróximo passo: acompanhar o chamado 30422148.';
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

// A reescrita "Objetiva" (resposta-humanizada-service) saiu do fluxo em 7219851
// e o serviço foi removido em 2026-11-02. O validador de preservação continua
// em uso (limpeza técnica) e mantém estas verificações.
test('validador: identificador trocado e comando novo reprovam; frase nova é só aviso', () => {
  const aprovado = (a, b) => analisarPreservacao(a, b).aprovado;
  assert.equal(aprovado('Use aItens.', 'Use bItens.'), false);
  assert.equal(aprovado('Verificar o retorno.', 'Verificar o retorno.
curl exemplo'), false);
  assert.equal(aprovado('O erro não foi resolvido.', 'O erro não foi resolvido. Foi resolvido.'), true);
  assert.equal(aprovado('O erro ocorre na rotina ROTINA99.', 'O erro ocorre.'), false);
});

// 2026-10-26 (achado real): a resposta curta de conversa ("você consegue...?")
// NÃO passa mais pela reescrita de estilo — a Objetiva forçava "Falta:/Próximos
// passos:" e deixava a resposta seca ("Falta: error.log e o código fonte.").
test('resposta curta (pergunta de processo) é gravada como a IA escreveu, sem reescrita de estilo', async () => {
  store.definirEstiloResposta(1, consultor.telefone, 'NATURAL');
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Erro', consultorId: consultor.id });
  const curtoProvider = {};
  // Classificação é a primeira chamada do fluxo; não é humanização.
  let n = 0;
  curtoProvider.chamarIA = async () => ++n === 1 ? { texto: '{"tipo":"conversa"}' } : { texto: original, provider: 'openai', model: 'mock' };
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-provider-client': curtoProvider, './ai-config-service': config,
    './consultor-service': consultores,
    './technical-research-service': new Proxy({}, { get: () => () => { throw Error('Pesquisa externa indevida'); } }),
  });
  const retorno = await investigacao.processarTurno(1, at.id, { texto: 'Você consegue ajudar?', consultorId: consultor.id });
  assert.equal(retorno.conteudo, original.trim(), 'texto da IA, sem reescrita');
  assert.equal(retorno.diagnostico, null, 'sem auditoria de humanização');
  assert.equal(retorno.respostaCurta, 'conversa');
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

test('fluxo entrega diálogo original sem editorial mesmo com preferência NATURAL', async () => {
  const etapas = [];
  let pesquisas = 0, dossie;
  store.definirEstiloResposta(1, consultor.telefone, 'NATURAL');
  const conversa = 'O print mostra Failed to load program M185GRV.PRW. Ainda falta confrontar o erro com o código.\n\nPode enviar o fonte completo M185GRV.PRW e o log desta ocorrência? Houve compilação recente?';
  let textoGerado = conversa;
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Erro técnico', consultorId: consultor.id });
  const anterior = mensagemRepo.salvarMensagem(1, at.id, {
    papel: 'assistant', conteudo: 'Texto humanizado anterior',
    diagnostico: { humanizacao: { respostaOriginal: 'Texto técnico anterior completo' } },
  });
  const realProvider = require('../backend/services/ai-provider-client');
  const realContexto = require('../backend/services/context-engine');
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-provider-client': { ...realProvider, chamarIA: async (_keys, _cfg, systemPrompt, _userPrompt, _imagens, opts) => {
      if (systemPrompt.includes('Você classifica a mensagem atual')) return { texto: '{"tipo":"investigacao"}' };
      assert.ok(Array.isArray(opts.conversa), 'orquestrador entrega histórico nativo ao provedor');
      assert.equal(opts.conversa.at(-1).role, 'user');
      assert.ok(opts.conversa.some(m => m.role === 'assistant' && m.content.includes('Texto técnico anterior completo')));
      if (textoGerado !== conversa) {
        assert.ok(opts.conversa.at(-1).content.includes('Não tenho o fonte. Houve compilação ontem.'));
        assert.ok(opts.conversa.some(m => m.role === 'assistant' && m.content.includes('Pode enviar o fonte completo M185GRV.PRW')));
      }
      etapas.push('resposta_tecnica');
      return { texto: textoGerado, provider: 'openai', model: 'gpt-4o-mini', usage: { total_tokens: 100 } };
    } },
    './ai-config-service': { ...config, resolverConfigPesquisa: () => ({}) },
    './consultor-service': consultores,
    './context-engine': { ...realContexto, montarContextoInvestigacao: dados => {
      assert.equal(dados.mensagens.find(m => m.id === anterior.id).conteudo, 'Texto técnico anterior completo');
      const montado = realContexto.montarContextoInvestigacao(dados);
      if (dados.mensagemAtual === 'Não tenho o fonte. Houve compilação ontem.') {
        assert.ok(dados.mensagens.some(m => m.conteudo === conversa), 'a continuação recebe a pergunta anterior');
        assert.ok(montado.userPrompt.includes(dados.mensagemAtual), 'a continuação recebe a resposta atual do usuário');
      }
      return montado;
    } },
    './resposta-humanizada-service': { prepararResposta: async () => { throw new Error('Não deve reescrever'); } },
    './technical-research-service': { pesquisar: async () => { pesquisas++; return {}; }, formatarContextoParaPrompt: () => '' },
    './quality-gate-service': { avaliarResposta: dados => {
      etapas.push('quality_gate'); assert.equal(dados.textoResposta, textoGerado);
      return { aprovado: true, deveRetry: false, falhas: [] };
    } },
    './investigacao-dossie-atualizador-service': { atualizarAposTurno: async (_e, _a, dados) => { dossie = dados; } },
  });
  const retorno = await investigacao.processarPreAnalise(1, at.id);
  assert.deepEqual(etapas, ['resposta_tecnica', 'quality_gate']);
  assert.equal(pesquisas, 1);
  assert.equal(retorno.conteudo, conversa, 'preserva perguntas e parágrafos da resposta original');
  assert.equal(retorno.diagnostico?.humanizacao, undefined);
  assert.equal(dossie.respostaAssistente, conversa);
  const historico = mensagemRepo.listarMensagens(1, at.id);
  assert.equal(historico.length, 2);
  assert.equal(historico.find(m => m.id === anterior.id).conteudo, 'Texto humanizado anterior');
  const execucoes = require('../backend/repositories/investigacao-execucao-repository').listarPorAtendimento(1, at.id);
  assert.equal(execucoes.length, 1);
  assert.equal(execucoes[0].model, 'gpt-4o-mini');
  textoGerado = 'A compilação de ontem é uma pista para conferir no log, mas ainda não confirma a causa.\n\nComo o fonte não está disponível, pode enviar o log completo da ocorrência para verificarmos a falha de carregamento?';
  etapas.length = 0;
  const continuacao = await investigacao.processarTurno(1, at.id, {
    texto: 'Não tenho o fonte. Houve compilação ontem.', usuarioId: null, consultorId: consultor.id,
  });
  assert.deepEqual(etapas, ['resposta_tecnica', 'quality_gate']);
  assert.equal(continuacao.conteudo, textoGerado, 'entrega a continuação sem reescrever perguntas');
  assert.equal(continuacao.diagnostico?.humanizacao, undefined);
});

test('gate reprovado entrega original com alerta, mesmo se um avaliador antigo solicitar retry', async () => {
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Faltam colunas no Browser.' });
  let geracoes = 0;
  const original = 'A configuração das colunas pode diferir. Peça ao cliente prints das propriedades dos campos de valor e fornecedor nos dois contextos para confirmar.';
  const realProvider = require('../backend/services/ai-provider-client');
  const realGate = require('../backend/services/quality-gate-service');
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-config-service': { ...config, resolverConfigPesquisa: () => ({}) },
    './ai-provider-client': { ...realProvider, chamarIA: async () => { geracoes++; return { texto: original, provider: 'openai', model: 'gpt-4o' }; } },
    './technical-research-service': { pesquisar: async () => ({}), formatarContextoParaPrompt: () => '' },
    './quality-gate-service': { ...realGate, avaliarResposta: () => ({ aprovado: false, aprovadoSemRessalvas: false, deveRetry: true,
      falhas: [{ codigo: 'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE', severidade: 'alta' }] }) },
    './investigacao-dossie-atualizador-service': { atualizarAposTurno: async () => ({}) },
  });
  const retorno = await investigacao.processarTurno(1, at.id, { texto: 'Revise o layout.', forcarPesquisa: true });
  assert.equal(geracoes, 1, 'gate não aciona reescrita nem recuperação determinística');
  assert.ok(retorno.conteudo.startsWith(original));
  assert.match(retorno.conteudo, /Pontos de atenção/);
  const exec = require('../backend/repositories/investigacao-execucao-repository').listarPorAtendimento(1, at.id)[0];
  assert.equal(exec.retryDeQualityGate, false);
  assert.equal(exec.status, 'concluido_com_alerta_quality_gate');
});

test('resposta truncada é entregue com aviso e fica em revisão, sem segunda geração', async () => {
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Erro na rotina.' });
  let geracoes = 0;
  const realProvider = require('../backend/services/ai-provider-client');
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-config-service': { ...config, resolverConfigPesquisa: () => ({}) },
    './ai-provider-client': { ...realProvider, chamarIA: async () => { geracoes++; return { texto: 'O erro ainda precisa de confirmação pelo log', truncado: true, provider: 'openai', model: 'gpt-4o' }; } },
    './technical-research-service': { pesquisar: async () => ({}), formatarContextoParaPrompt: () => '' },
    './investigacao-dossie-atualizador-service': { atualizarAposTurno: async () => ({}) },
  });
  const retorno = await investigacao.processarTurno(1, at.id, { texto: 'Analise.', forcarPesquisa: true });
  assert.equal(geracoes, 1);
  assert.match(retorno.conteudo, /Resposta cortada pelo limite/);
  const exec = require('../backend/repositories/investigacao-execucao-repository').listarPorAtendimento(1, at.id)[0];
  assert.equal(exec.status, 'revisao_necessaria_quality_gate');
});

test('imagem selecionada e ilegível mantém interrupção e aviso, sem inferência da IA', async () => {
  const at = atendimentoRepo.criarAtendimento(1, { origem: 'manual', conteudoBruto: 'Analise o erro no print.' });
  const anexos = require('../backend/repositories/anexo-repository');
  anexos.salvarMetadadosAnexo(1, at.id, { nomeOriginal: 'erro-indisponivel.png', nomeInterno: 'erro-indisponivel.png', mimeType: 'image/png', tamanho: 10,
    caminhoRelativo: `1/${at.id}/erro-indisponivel.png` });
  let geracoes = 0;
  const realProvider = require('../backend/services/ai-provider-client');
  const investigacao = carregar('../backend/services/investigacao-service.js', {
    './ai-config-service': { ...config, resolverConfigPesquisa: () => ({}) },
    './ai-provider-client': { ...realProvider, chamarIA: async () => { geracoes++; throw Error('Não deveria gerar análise sem o print'); } },
    './technical-research-service': { pesquisar: async () => ({}), formatarContextoParaPrompt: () => '' },
  });
  const retorno = await investigacao.processarPreAnalise(1, at.id);
  assert.equal(geracoes, 0);
  assert.match(retorno.conteudo, /Não foi possível carregar/);
  assert.match(retorno.conteudo, /erro-indisponivel\.png/);
  assert.match(retorno.conteudo, /interrompida/);
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
