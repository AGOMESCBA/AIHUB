'use strict';
// Conversa no chat (2026-11-02): caminho único. O classificador só decide se o
// turno é conversa (resposta curta com histórico nativo) ou investigação
// completa; a IA pergunta ao analista só no fim e só com dúvida; resposta do
// analista a uma pergunta da IA vai para a investigação completa.
// Sem rede e sem IA: o provider é simulado. Dados sintéticos.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-conversa-chat-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const aiProviderClient = require('../backend/services/ai-provider-client');
const aiConfigService = require('../backend/services/ai-config-service');
const technicalResearchService = require('../backend/services/technical-research-service');
const respostaOperacional = require('../backend/services/resposta-operacional-service');
const promptBuilder = require('../backend/services/prompt-builder');
const investigacao = require('../backend/services/investigacao-service');

const EMPRESA = 99211;
const originais = {
  chamarIA: aiProviderClient.chamarIA,
  resolver: aiConfigService.resolverKeysEOrdem,
  pesquisar: technicalResearchService.pesquisar,
};
aiConfigService.resolverKeysEOrdem = () => ({ keys: { openai: 'x' }, cfg: { provedorPrimario: 'openai', fallbackOrdem: '', modelos: { openai: 'm' } } });
technicalResearchService.pesquisar = async () => ({ configurado: false, modo: 'nao_pesquisado', paginasLidas: [] });

after(() => {
  aiProviderClient.chamarIA = originais.chamarIA;
  aiConfigService.resolverKeysEOrdem = originais.resolver;
  technicalResearchService.pesquisar = originais.pesquisar;
  try { database.getDB().close(); } catch (_) {}
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

const PERGUNTA_DA_IA = 'Peça o print do D1_TES e confira a SF4. Isso acontece só na filial 02?';
function atendimentoComHistorico(ultimaIA = 'A TES do item não é aceita. Peça o print do D1_TES e confira a SF4.') {
  const at = atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'manual', canalEntrada: 'chat', conteudoBruto: 'Erro "Tipo de entrada inválido" no MATA103.' });
  mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'user', conteudo: 'Erro "Tipo de entrada inválido" no MATA103.' });
  mensagemRepo.salvarMensagem(EMPRESA, at.id, { papel: 'assistant', conteudo: ultimaIA });
  return at;
}

test('regra de pergunta: só com dúvida, só no final, sem trocar a análise; vale em todo turno, exceto pré-análise', () => {
  const regra = promptBuilder.INSTRUCAO_DIALOGO;
  assert.match(regra, /somente quando houver dúvida/);
  assert.match(regra, /entregue primeiro a análise completa e, só no final, faça uma única pergunta/);
  assert.match(regra, /Se não houver dúvida, não faça pergunta/);
  assert.match(regra, /Nunca troque a análise pela pergunta/);
  const codigo = [{ nomeOriginal: 'MT103.prw' }];
  assert.equal(promptBuilder.selecionarSystemPrompt([], {}), `${promptBuilder.SYSTEM_PROMPT}\n\n${regra}`);
  assert.equal(promptBuilder.selecionarSystemPrompt(codigo, {}), `${promptBuilder.SYSTEM_PROMPT}\n\n${regra}\n\n${promptBuilder.INSTRUCOES_FONTE}`);
  assert.ok(promptBuilder.selecionarSystemPrompt(codigo, { forcarPesquisa: true }).includes(regra));
  const pre = promptBuilder.selecionarSystemPrompt(codigo, { automatico: true });
  assert.ok(!pre.includes(regra), 'pré-análise automática não tem analista para responder');
  assert.ok(pre.includes(promptBuilder.INSTRUCOES_FONTE), 'proteções de fonte preservadas');
});

test('conversa curta: papéis reais, começa e termina no analista, última resposta da IA inteira, dados sensíveis redigidos', () => {
  const conversa = investigacao._montarConversaCurta({
    historico: [
      { papel: 'user', conteudo: 'Chamado: erro na NF. CPF do cliente 123.456.789-09' },
      { papel: 'assistant', conteudo: 'y'.repeat(9000) },
      { papel: 'customer', conteudo: 'retorno do cliente' },
      { papel: 'assistant', conteudo: '   ' },
      { papel: 'assistant', conteudo: 'x'.repeat(9000) },
    ],
    texto: 'ok, obrigado',
    codigoAtendimento: 'AI-1',
    registroPesquisa: 'Pesquisa externa na última análise: não executada.',
  });
  assert.equal(conversa[0].role, 'user');
  assert.match(conversa[0].content, /AI-1/);
  assert.match(conversa[0].content, /Registro da pesquisa externa/);
  assert.deepEqual(conversa.map(m => m.role), ['user', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(conversa.at(-1).content, 'ok, obrigado');
  assert.equal(conversa[4].content.length, 9000, 'última resposta da IA vai inteira');
  assert.equal(conversa[2].content.length, 3000, 'respostas anteriores são limitadas');
  assert.ok(!conversa[1].content.includes('123.456.789-09'), 'CPF não vai para o provider');
});

test('classificador: só "conversa" ou "investigacao"; erro, JSON inválido e texto longo seguem investigação', async () => {
  const chamadas = [];
  const responder = texto => { aiProviderClient.chamarIA = async (...args) => { chamadas.push(args); if (texto instanceof Error) throw texto; return { texto }; }; };
  const ctx = { keys: {}, cfg: {} };
  responder('{"tipo":"conversa"}');
  assert.equal(await investigacao._classificarTurnoConversa('ok, obrigado', ctx), 'conversa');
  assert.equal(chamadas[0][2], investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA);
  assert.equal(chamadas[0][3], 'ok, obrigado', 'sem resposta anterior da IA vai só a mensagem');
  responder('{"tipo":"investigacao"}');
  assert.equal(await investigacao._classificarTurnoConversa('testei e falhou', ctx), 'investigacao');
  responder('{"tipo":"fora_de_escopo"}');
  assert.equal(await investigacao._classificarTurnoConversa('piada', ctx), 'investigacao');
  responder('sem json');
  assert.equal(await investigacao._classificarTurnoConversa('oi', ctx), 'investigacao');
  responder(new Error('provider fora'));
  assert.equal(await investigacao._classificarTurnoConversa('oi', ctx), 'investigacao');
  const antes = chamadas.length;
  assert.equal(await investigacao._classificarTurnoConversa('a'.repeat(401), ctx), 'investigacao');
  assert.equal(chamadas.length, antes, 'texto longo não chama o provider');
  for (const exemplo of ['ok, obrigado', 'de onde você tirou isso', 'sim, monta a mensagem', 'RESPONDE a uma pergunta que a IA fez ao analista']) {
    assert.ok(investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA.includes(exemplo), exemplo);
  }
});

test('classificador vê o final da última resposta da IA (onde fica a pergunta), redigido e limitado', async () => {
  let entrada;
  aiProviderClient.chamarIA = async (_k, _c, _s, user) => { entrada = user; return { texto: '{"tipo":"investigacao"}' }; };
  const longa = `${'contexto '.repeat(200)}senha=segredo123 ${PERGUNTA_DA_IA}`;
  await investigacao._classificarTurnoConversa('sim', { keys: {}, cfg: {}, ultimaRespostaIA: longa });
  assert.match(entrada, /## Final da última resposta da IA\n/);
  assert.ok(entrada.includes(PERGUNTA_DA_IA), 'a pergunta da IA chega ao classificador');
  assert.ok(!entrada.includes('segredo123'), 'credencial redigida');
  assert.ok(entrada.length < 800, 'só o final da resposta');
  assert.match(entrada, /## Mensagem atual do analista\nsim$/);
});

test('resposta curta: envia a conversa nativa; sinal da IA, vazia ou truncada devolvem null', async () => {
  const conversa = [{ role: 'user', content: 'apoio' }, { role: 'assistant', content: 'r' }, { role: 'user', content: 'ok' }];
  let opts;
  const responder = r => { aiProviderClient.chamarIA = async (...args) => { opts = args[5]; return r; }; };
  responder({ texto: 'Combinado!', provider: 'openai', model: 'm' });
  assert.deepEqual(await investigacao._responderConversaCurta({ keys: {}, cfg: {}, conversa, systemPrompt: 's' }), { conteudo: 'Combinado!', provider: 'openai', model: 'm' });
  assert.equal(opts.conversa, conversa);
  for (const r of [{ texto: '[[INVESTIGAR]]' }, { texto: '  ' }, { texto: 'meio texto', truncado: true }]) {
    responder(r);
    assert.equal(await investigacao._responderConversaCurta({ keys: {}, cfg: {}, conversa, systemPrompt: 's' }), null);
  }
  assert.match(investigacao.INSTRUCAO_CONVERSA, /responder a uma pergunta que você fez sobre o caso[^.]*\[\[INVESTIGAR\]\]/);
  // T2 real (2026-11-02): "de onde você tirou?" respondia a origem e ainda
  // acrescentava um pedido ao cliente que já tinha sido feito.
  assert.match(investigacao.INSTRUCAO_CONVERSA, /origem de uma informação: responda só o que foi perguntado[^.]*sem propor novos passos/);
  assert.match(investigacao.INSTRUCAO_CONVERSA, /próximo passo: responda direto[^.]*sem repetir pedidos já feitos/);
});

test('turno de conversa: histórico nativo, salvo como resposta curta sem avaliação; caminho curto não leva a regra de pergunta', async () => {
  const at = atendimentoComHistorico();
  const chamadas = [];
  aiProviderClient.chamarIA = async (_k, _c, system, user, _i, opts) => {
    chamadas.push({ system, user, opts });
    if (system === investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA) return { texto: '{"tipo":"conversa"}' };
    return { texto: 'Combinado! Quando o cliente mandar o print, me envie aqui.', provider: 'openai', model: 'm' };
  };
  const msg = await investigacao.processarTurno(EMPRESA, at.id, { texto: 'ok, obrigado', usuarioId: null, anexoIds: [] });
  assert.equal(chamadas.length, 2, 'só classificação + resposta');
  assert.match(chamadas[0].user, /Final da última resposta da IA\n.*confira a SF4/s);
  const resposta = chamadas[1];
  assert.ok(resposta.system.includes(investigacao.INSTRUCAO_CONVERSA));
  assert.ok(!resposta.system.includes(promptBuilder.INSTRUCAO_DIALOGO), 'conversa curta não analisa, então não pergunta');
  assert.deepEqual(resposta.opts.conversa.map(m => m.role), ['user', 'user', 'assistant', 'user']);
  assert.match(resposta.opts.conversa[2].content, /D1_TES/);
  assert.equal(resposta.opts.conversa.at(-1).content, 'ok, obrigado');
  assert.equal(msg.respostaCurta, 'conversa');
  assert.equal(msg.conteudo, 'Combinado! Quando o cliente mandar o print, me envie aqui.');
  assert.equal(respostaOperacional.execucaoAvaliavel('concluido', msg.respostaCurta), false);
});

test('resposta do analista à pergunta da IA, sinal [[INVESTIGAR]] ou classificação "investigacao" seguem a investigação completa', async () => {
  const cenarios = [
    { nome: 'resposta à pergunta da IA', ultimaIA: PERGUNTA_DA_IA, texto: 'sim', classif: e => (e.includes('só na filial 02?') ? 'investigacao' : 'conversa') },
    { nome: 'sinal da IA', texto: 'testei com outra TES e falhou', classif: () => 'conversa' },
    { nome: 'classificação', texto: 'testei com outra TES e falhou', classif: () => 'investigacao' },
  ];
  for (const c of cenarios) {
    const at = atendimentoComHistorico(c.ultimaIA);
    const sistemas = [];
    aiProviderClient.chamarIA = async (_k, _c, system, user) => {
      sistemas.push(system);
      if (system === investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA) return { texto: `{"tipo":"${c.classif(user)}"}` };
      if (system.includes(investigacao.INSTRUCAO_CONVERSA)) return { texto: '[[INVESTIGAR]]' };
      throw new Error('FLUXO_COMPLETO_ALCANCADO');
    };
    await investigacao.processarTurno(EMPRESA, at.id, { texto: c.texto, usuarioId: null, anexoIds: [] }).catch(() => null);
    const completo = sistemas.filter(s => s !== investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA && !s.includes(investigacao.INSTRUCAO_CONVERSA));
    assert.ok(completo.length > 0, `${c.nome}: chegou à investigação completa`);
    assert.ok(completo.every(s => s.includes(promptBuilder.INSTRUCAO_DIALOGO)), `${c.nome}: investigação completa recebe a regra de pergunta`);
    if (c.nome === 'resposta à pergunta da IA') assert.ok(!sistemas.some(s => s.includes(investigacao.INSTRUCAO_CONVERSA)), 'nem tenta a conversa curta');
    assert.ok(!mensagemRepo.listarMensagens(EMPRESA, at.id).some(m => m.respostaCurta === 'conversa'), `${c.nome}: nada salvo como conversa`);
  }
});

test('botão Pesquisar Soluções e turno com anexo novo não passam pelo classificador', async () => {
  for (const extra of [{ forcarPesquisa: true }, { anexoIds: ['anexo-inexistente'] }]) {
    const at = atendimentoComHistorico();
    const sistemas = [];
    aiProviderClient.chamarIA = async (_k, _c, system) => { sistemas.push(system); throw new Error('FLUXO_COMPLETO_ALCANCADO'); };
    await investigacao.processarTurno(EMPRESA, at.id, { texto: 'ok, obrigado', usuarioId: null, anexoIds: [], ...extra }).catch(() => null);
    assert.ok(!sistemas.includes(investigacao.SYSTEM_PROMPT_CLASSIFICACAO_CONVERSA), JSON.stringify(extra));
  }
});
