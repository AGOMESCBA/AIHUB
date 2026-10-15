// Gate de pesquisa externa sob PENDENCIA EXTERNA (2026-10; caso #036752).
// Principio: a situacao do chamado controla SO o acionamento de pesquisa
// externa; a conversa continua normal e quem decide "pediu pesquisa?" e a IA
// (classificacao semantica com contexto), nunca regex. Nao chama IA real.
// Executar: node "apps/IA Service/tests/pendencia-externa-gate.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const dbTmpPath = path.join(os.tmpdir(), `ia-service-pendencia-gate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const gate = require('../backend/services/pendencia-externa-gate');
const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const aiConfigService = require('../backend/services/ai-config-service');
const aiProviderClient = require('../backend/services/ai-provider-client');
const technicalResearchService = require('../backend/services/technical-research-service');
const investigacaoDossieAtualizador = require('../backend/services/investigacao-dossie-atualizador-service');
const investigacaoService = require('../backend/services/investigacao-service');

const EMPRESA = 99301;

function limparEDesligar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {}
  }
}

const testes = [];
function teste(nome, fn) { testes.push({ nome, fn }); }

// ── classificarPendencia ────────────────────────────────────────────────────
teste('classificarPendencia: cliente e fornecedor reconhecidos como externos', () => {
  assert.deepStrictEqual(
    (({ externa, responsavel }) => ({ externa, responsavel }))(gate.classificarPendencia({ aguardandoConsolidado: 'RETORNO - CLIENTE' }, [])),
    { externa: true, responsavel: 'cliente' });
  assert.deepStrictEqual(
    (({ externa, responsavel }) => ({ externa, responsavel }))(gate.classificarPendencia({ aguardandoConsolidado: 'RETORNO - FORNECEDOR' }, [])),
    { externa: true, responsavel: 'fornecedor' });
  assert.strictEqual(gate.classificarPendencia({ aguardandoConsolidado: 'Retorno do Cliente' }, []).externa, true);
});

teste('classificarPendencia: atendente, vazio e desconhecido NAO sao externos (fail-safe)', () => {
  for (const v of ['RETORNO - ATENDENTE', null, '', 'CRM - DOC044', 'RETORNO - DISTRIBUIDOR']) {
    const r = gate.classificarPendencia({ aguardandoConsolidado: v }, []);
    assert.strictEqual(r.externa, false, `valor "${v}" nao deve ser externo`);
  }
});

teste('classificarPendencia: aguardando_retorno do ultimo posicionamento NAO desliga o gate (dado real: 52/52 externos tem =1)', () => {
  const r = gate.classificarPendencia(
    { aguardandoConsolidado: 'RETORNO - CLIENTE' },
    [{ aguardandoRetorno: false }, { aguardandoRetorno: true, situacaoRetorno: null }],
  );
  assert.strictEqual(r.externa, true);
  assert.strictEqual(r.responsavel, 'cliente');
});

// ── decidirPesquisaExterna ──────────────────────────────────────────────────
const PEND_CLIENTE = { externa: true, responsavel: 'cliente', motivo: 'pendencia_externa_reconhecida' };

function chamarIAFixa(json, spy) {
  return async (sys, prompt) => {
    if (spy) spy.push({ sys, prompt });
    return { texto: typeof json === 'string' ? json : JSON.stringify(json) };
  };
}

teste('sem pendencia externa: libera sem chamar IA', async () => {
  const calls = [];
  const d = await gate.decidirPesquisaExterna({
    pendencia: { externa: false, motivo: 'aguardando_atendente' }, origemAcao: gate.ORIGEM.TEXTO_LIVRE,
    texto: 'x', historico: [], chamarIA: chamarIAFixa({}, calls),
  });
  assert.strictEqual(d.liberada, true);
  assert.strictEqual(calls.length, 0);
});

teste('botao Pesquisar e pre-analise automatica nunca liberam sob pendencia externa (sem chamada IA)', async () => {
  const calls = [];
  for (const origem of [gate.ORIGEM.BOTAO, gate.ORIGEM.AUTOMATICO]) {
    const d = await gate.decidirPesquisaExterna({
      pendencia: PEND_CLIENTE, origemAcao: origem, texto: 'pesquise uma solucao', historico: [], chamarIA: chamarIAFixa({ pesquisa_externa: 'sim' }, calls),
    });
    assert.strictEqual(d.liberada, false, origem);
  }
  assert.strictEqual(calls.length, 0, 'nenhuma chamada ao provider para botao/automatico');
});

teste('texto livre: pedido contextual ("pode aprofundar?") libera; contexto vai ao classificador', async () => {
  const calls = [];
  const d = await gate.decidirPesquisaExterna({
    pendencia: PEND_CLIENTE, origemAcao: gate.ORIGEM.TEXTO_LIVRE, texto: 'pode aprofundar?',
    historico: [
      { papel: 'user', conteudo: 'Mesmo aguardando o cliente, procure alternativas para o evento 4010 pendente.' },
      { papel: 'assistant', conteudo: 'Encontrei duas hipoteses sobre recibo nao processado.' },
    ],
    chamarIA: chamarIAFixa({ pesquisa_externa: 'sim', motivo: 'continua a investigacao pedida antes' }, calls),
  });
  assert.strictEqual(d.liberada, true);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].prompt, /procure alternativas para o evento 4010/, 'historico recente deve ir ao classificador');
  assert.match(calls[0].prompt, /pode aprofundar\?/);
});

teste('texto livre: pergunta sobre historico ("o que o cliente respondeu?") nao libera', async () => {
  const d = await gate.decidirPesquisaExterna({
    pendencia: PEND_CLIENTE, origemAcao: gate.ORIGEM.TEXTO_LIVRE, texto: 'O que o cliente respondeu?',
    historico: [], chamarIA: chamarIAFixa({ pesquisa_externa: 'nao', motivo: 'pergunta sobre historico' }),
  });
  assert.strictEqual(d.liberada, false);
  assert.strictEqual(d.chamadaIA, true);
});

teste('texto livre: incerto, JSON invalido ou falha do provider => nao pesquisa', async () => {
  for (const chamarIA of [
    chamarIAFixa({ pesquisa_externa: 'incerto' }),
    chamarIAFixa('isso nao e json'),
    async () => { throw new Error('provider fora do ar'); },
  ]) {
    const d = await gate.decidirPesquisaExterna({
      pendencia: PEND_CLIENTE, origemAcao: gate.ORIGEM.TEXTO_LIVRE, texto: 'verifique isso', historico: [], chamarIA,
    });
    assert.strictEqual(d.liberada, false);
  }
});

teste('origem explicita: mensagem do botao entra como ACAO (nao como pedido digitado), sem depender do texto', () => {
  const ctx = gate._montarContexto([
    { papel: 'user', origemAcao: 'botao_pesquisar', conteudo: 'texto qualquer que o front resolva mudar no futuro' },
    { papel: 'user', origemAcao: 'texto_livre', conteudo: 'O cliente confirmou o envio?' },
    { papel: 'user', conteudo: 'mensagem legada, sem origem gravada' },
  ], 'e agora?');
  assert.ok(!/texto qualquer que o front/.test(ctx), 'conteudo da mensagem de botao nao deve ir ao classificador');
  assert.match(ctx, /clicou no botão Pesquisar/);
  assert.match(ctx, /\[Analista\]: O cliente confirmou o envio\?/);
  assert.match(ctx, /mensagem legada, sem origem gravada/);
});

teste('resolverOrigemAcao: cliente nao consegue rebaixar botao/automatico para texto livre', () => {
  const g = gate.resolverOrigemAcao;
  assert.strictEqual(g({ origemAcao: 'texto_livre', forcarPesquisa: true }), 'botao_pesquisar');
  assert.strictEqual(g({ origemAcao: 'texto_livre', automatico: true }), 'automatico');
  assert.strictEqual(g({ origemAcao: 'botao_pesquisar' }), 'botao_pesquisar');
  assert.strictEqual(g({ origemAcao: 'automatico' }), 'texto_livre');
  assert.strictEqual(g({ origemAcao: 'lixo' }), 'texto_livre');
  assert.strictEqual(g({}), 'texto_livre');
});

teste('avaliarPendencia: origem diverge do local (voltou ao atendente) => nao bloqueia', async () => {
  const p = await gate.avaliarPendencia({
    chamado: { aguardandoConsolidado: 'RETORNO - CLIENTE' }, posicionamentos: [],
    consultarSituacaoOrigem: async () => ({ ok: true, aguardando: 'RETORNO - ATENDENTE' }),
  });
  assert.strictEqual(p.externa, false);
  assert.strictEqual(p.fonteSituacao, 'origem_divergiu_do_local');
  assert.strictEqual(p.situacaoLocal, 'RETORNO - CLIENTE');
  assert.strictEqual(p.situacaoOrigem, 'RETORNO - ATENDENTE');
});

teste('avaliarPendencia: origem confirma; origem indisponivel mantem local; local ATENDENTE com origem CLIENTE => externa', async () => {
  const confirma = await gate.avaliarPendencia({
    chamado: { aguardandoConsolidado: 'RETORNO - CLIENTE' }, posicionamentos: [],
    consultarSituacaoOrigem: async () => ({ ok: true, aguardando: 'RETORNO - CLIENTE' }),
  });
  assert.strictEqual(confirma.externa, true);
  assert.strictEqual(confirma.fonteSituacao, 'origem_confirmou');
  const fora = await gate.avaliarPendencia({
    chamado: { aguardandoConsolidado: 'RETORNO - CLIENTE' }, posicionamentos: [],
    consultarSituacaoOrigem: async () => ({ ok: false, motivo: 'timeout' }),
  });
  assert.strictEqual(fora.externa, true);
  assert.strictEqual(fora.fonteSituacao, 'local_nao_confirmada_na_origem');
  const atendenteMasOrigemCliente = await gate.avaliarPendencia({
    chamado: { aguardandoConsolidado: 'RETORNO - ATENDENTE' }, posicionamentos: [],
    consultarSituacaoOrigem: async () => ({ ok: true, aguardando: 'RETORNO - CLIENTE' }),
  });
  assert.strictEqual(atendenteMasOrigemCliente.externa, true, 'defasagem no sentido ATENDENTE -> externo e corrigida (caso #036752)');
  assert.strictEqual(atendenteMasOrigemCliente.fonteSituacao, 'origem_divergiu_do_local');
  assert.strictEqual(atendenteMasOrigemCliente.situacaoLocal, 'RETORNO - ATENDENTE');
});

// ── technical-research-service.pesquisar com bloqueio ───────────────────────
teste('pesquisar(): pesquisaExternaBloqueada nao busca na web nem interpreta semantica', async () => {
  let buscas = 0; let semantica = 0;
  const r = await technicalResearchService.pesquisar({
    empresaId: EMPRESA, texto: 'erro no evento 4010 REINF', forcarPesquisa: true,
    chamado: { numero: '036752', titulo: 'ausencia de retorno EFD REINF 4010' },
    pesquisaExternaBloqueada: { responsavel: 'cliente', origemAcao: 'botao_pesquisar', motivo: 'botao sob pendencia' },
  }, {
    buscarSerper: async () => { buscas++; return []; },
    buscarBing: async () => { buscas++; return []; },
    buscarGemini: async () => { buscas++; return []; },
    buscarOpenai: async () => { buscas++; return []; },
    interpretarSemantico: async () => { semantica++; return null; },
  });
  assert.strictEqual(r.modo, 'nao_pesquisado');
  assert.strictEqual(r.plano.devePesquisar, false);
  assert.strictEqual(r.plano.bloqueioPendenciaExterna.responsavel, 'cliente');
  assert.match(r.plano.motivo, /dispensada/);
  assert.strictEqual(buscas, 0);
  assert.strictEqual(semantica, 0);
  const prompt = technicalResearchService.formatarContextoParaPrompt(r, []);
  assert.match(prompt, /pendencia externa \(aguardando cliente\)/);
});

// ── processarTurno ponta a ponta (providers stubados) ───────────────────────
function criarChamadoComAtendimento({ numero, aguardando, posicionamentos = [] }) {
  const fonte = agenteRepo.criarFonte(EMPRESA, {
    connectionKey: `fonte-${numero}`, nome: `Fonte ${numero}`, sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter',
  });
  const { chamado } = chamadoRepo.upsertChamado(EMPRESA, {
    fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: `OID-${numero}`, numero,
    titulo: 'ausencia de retorno de confirmacao - EFD REINF 4000 4010',
    aguardandoConsolidado: aguardando,
  });
  posicionamentos.forEach((p, i) => chamadoRepo.upsertPosicionamento(EMPRESA, {
    fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: `POS-${numero}-${i}`, chamadoId: chamado.id,
    dataPosicionamento: `2026-10-13T1${i}:00:00.000Z`, ...p,
  }));
  const atendimento = atendimentoRepo.criarAtendimento(EMPRESA, {
    origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: numero, conteudoBruto: 'Historico do chamado',
  });
  mensagemRepo.salvarMensagem(EMPRESA, atendimento.id, {
    papel: 'assistant', conteudo: 'Registro anterior.', usuarioId: null,
  });
  return { chamado, atendimento };
}

async function comProvidersFake({ decisaoGate }, fn) {
  const old = {
    resolver: aiConfigService.resolverKeysEOrdem,
    pesquisar: technicalResearchService.pesquisar,
    chamarIA: aiProviderClient.chamarIA,
    dossie: investigacaoDossieAtualizador.atualizarAposTurno,
  };
  const registro = { pesquisarCtx: [], gateCalls: 0, promptsPrincipais: [], classificadorPrompts: [] };
  aiConfigService.resolverKeysEOrdem = () => ({
    keys: { groq: 'gsk-test' },
    cfg: { provedorPrimario: 'groq', fallbackOrdem: 'groq', modelos: { groq: 'openai/gpt-oss-20b' } },
  });
  // Spy: devolve o mesmo formato que pesquisar() devolveria; a logica real de
  // bloqueio de pesquisar() e coberta no teste dedicado acima.
  technicalResearchService.pesquisar = async (ctx) => {
    registro.pesquisarCtx.push(ctx);
    return {
      configurado: false, resultados: [], paginasLidas: [], consultas: [], links: [],
      modo: ctx.pesquisaExternaBloqueada ? 'nao_pesquisado' : 'web',
      plano: ctx.pesquisaExternaBloqueada
        ? { devePesquisar: false, motivo: ctx.pesquisaExternaBloqueada.motivo, bloqueioPendenciaExterna: ctx.pesquisaExternaBloqueada }
        : { devePesquisar: true, motivo: 'pesquisa liberada' },
      dominio: 'softexpert', confianca: 0.5, perfil: { nome: 'SoftExpert' },
    };
  };
  investigacaoDossieAtualizador.atualizarAposTurno = async () => ({ aplicado: false });
  aiProviderClient.chamarIA = async (_keys, _cfg, system, prompt) => {
    if (/Você decide, para um chat de suporte técnico/.test(system)) {
      registro.gateCalls++;
      registro.classificadorPrompts.push(prompt);
      return { texto: JSON.stringify(decisaoGate), provider: 'groq', model: 'x' };
    }
    if (/classifica uma única mensagem/.test(system)) {
      return { texto: '{"tipo":"investigacao"}', provider: 'groq', model: 'x' };
    }
    registro.promptsPrincipais.push(prompt);
    return {
      texto: 'Situação: o chamado aguarda o retorno do cliente. O analista já registrou a resolução em 13/10; falta a confirmação formal. Nenhuma pesquisa externa foi executada.',
      provider: 'groq', model: 'x',
    };
  };
  try {
    return await fn(registro);
  } finally {
    aiConfigService.resolverKeysEOrdem = old.resolver;
    technicalResearchService.pesquisar = old.pesquisar;
    aiProviderClient.chamarIA = old.chamarIA;
    investigacaoDossieAtualizador.atualizarAposTurno = old.dossie;
  }
}

teste('#036752 botao Pesquisar com RETORNO - CLIENTE: sem pesquisa externa, resposta conversacional gerada', async () => {
  const { atendimento } = criarChamadoComAtendimento({
    numero: '036752', aguardando: 'RETORNO - CLIENTE',
    posicionamentos: [{ aguardandoRetorno: false, situacaoRetorno: 'RETORNO - CLIENTE', assunto: 'retorno', descricao: 'problema ja resolvido, transmitido e com retorno da RFB' }],
  });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'sim' } }, async (reg) => {
    const msg = await investigacaoService.processarTurno(EMPRESA, atendimento.id, {
      texto: 'Revise todo o historico e pesquise uma solucao para este chamado.', usuarioId: 1, forcarPesquisa: true,
    });
    assert.ok(msg && msg.conteudo, 'a IA deve responder (conversa nao e interrompida)');
    assert.strictEqual(reg.gateCalls, 0, 'botao nao deve gastar chamada de classificacao');
    assert.strictEqual(reg.pesquisarCtx.length, 1);
    assert.ok(reg.pesquisarCtx[0].pesquisaExternaBloqueada, 'pesquisar() deve receber o bloqueio');
    assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada.origemAcao, 'botao_pesquisar');
    assert.match(reg.promptsPrincipais.join('\n'), /Pesquisa externa NÃO executada neste turno/);
  });
});

teste('#036752 texto livre sobre historico: sem pesquisa externa', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036753', aguardando: 'RETORNO - CLIENTE' });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'nao', motivo: 'pergunta sobre historico' } }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto: 'O que o cliente respondeu?', usuarioId: 1 });
    assert.strictEqual(reg.gateCalls, 1);
    assert.ok(reg.pesquisarCtx[0].pesquisaExternaBloqueada);
    assert.strictEqual(reg.pesquisarCtx[0].forcarPesquisa, false);
  });
});

teste('texto livre com pedido contextual: pesquisa externa liberada e tratada como pedido explicito', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036754', aguardando: 'RETORNO - FORNECEDOR' });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'sim', motivo: 'pede alternativas' } }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto: 'Mesmo aguardando o fornecedor, procure alternativas.', usuarioId: 1 });
    assert.strictEqual(reg.gateCalls, 1);
    assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada, undefined);
    assert.strictEqual(reg.pesquisarCtx[0].forcarPesquisa, true);
  });
});

teste('mensagem do analista grava origem explicita; classificador recebe ACAO de botao, nao o texto', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036761', aguardando: 'RETORNO - CLIENTE' });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'nao', motivo: 'sem pedido' } }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, {
      texto: 'TEXTO DO BOTAO QUE O FRONT PODE MUDAR', usuarioId: 1, forcarPesquisa: true, origemAcao: 'botao_pesquisar',
    });
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, {
      texto: 'O que voce acha que aconteceu?', usuarioId: 1, origemAcao: 'texto_livre',
    });
    const msgs = mensagemRepo.listarMensagens(EMPRESA, atendimento.id).filter(m => m.papel === 'user');
    assert.deepStrictEqual(msgs.map(m => m.origemAcao), ['botao_pesquisar', 'texto_livre']);
    assert.strictEqual(reg.gateCalls, 1, 'so o texto livre usa classificador');
    assert.match(reg.classificadorPrompts[0], /clicou no botão Pesquisar/);
    assert.ok(!/TEXTO DO BOTAO QUE O FRONT PODE MUDAR/.test(reg.classificadorPrompts[0]));
  });
});

teste('pre-analise automatica sob pendencia externa: responde, sem pesquisa e sem chamada de classificacao', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036755', aguardando: 'RETORNO - CLIENTE' });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'sim' } }, async (reg) => {
    const msg = await investigacaoService.processarPreAnalise(EMPRESA, atendimento.id, {});
    assert.ok(msg && msg.conteudo);
    assert.strictEqual(reg.gateCalls, 0);
    assert.ok(reg.pesquisarCtx[0].pesquisaExternaBloqueada);
    assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada.origemAcao, 'automatico');
  });
});

teste('RETORNO - ATENDENTE: comportamento atual (sem bloqueio, sem chamada de classificacao)', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036756', aguardando: 'RETORNO - ATENDENTE' });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'nao' } }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto: 'Qual a causa do erro 4010?', usuarioId: 1 });
    assert.strictEqual(reg.gateCalls, 0);
    assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada, undefined);
  });
});

teste('situacao vazia: comportamento atual', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036757', aguardando: null });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'nao' } }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto: 'Qual a causa do erro 4010?', usuarioId: 1, forcarPesquisa: true });
    assert.strictEqual(reg.gateCalls, 0);
    assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada, undefined);
    assert.strictEqual(reg.pesquisarCtx[0].forcarPesquisa, true);
  });
});

teste('pesquisarParaChamado (aba/selecao): sob pendencia externa nao pesquisa e mantem relacionados', async () => {
  const { chamado } = criarChamadoComAtendimento({ numero: '036758', aguardando: 'RETORNO - CLIENTE' });
  const old = technicalResearchService.pesquisar;
  // pesquisarParaChamado chama a funcao local pesquisar(); valida pelo resultado real.
  const r = await technicalResearchService.pesquisarParaChamado(EMPRESA, chamado.id);
  assert.strictEqual(r.pesquisa.modo, 'nao_pesquisado');
  assert.ok(r.pesquisa.plano.bloqueioPendenciaExterna);
  assert.ok(Array.isArray(r.relacionados));
  technicalResearchService.pesquisar = old;
});

async function main() {
  let falhas = 0;
  for (const t of testes) {
    try {
      await t.fn();
      console.log(`  ok  ${t.nome}`);
    } catch (err) {
      falhas++;
      console.error(`  FALHOU  ${t.nome}\n    ${err.stack || err.message}`);
    }
  }
  limparEDesligar();
  console.log(falhas ? `\n${falhas} teste(s) falharam.` : `\n${testes.length} testes passaram.`);
  process.exit(falhas ? 1 : 0);
}

main().catch(err => { console.error(err); limparEDesligar(); process.exit(1); });
