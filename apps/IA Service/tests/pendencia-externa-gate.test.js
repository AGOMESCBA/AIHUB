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
const situacaoOrigemService = require('../backend/services/situacao-origem-service');

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

teste('classificarPendencia: distribuidor e nomenclatura "AGUARDANDO X" equivalem a "RETORNO - X"', () => {
  const casos = {
    'RETORNO - DISTRIBUIDOR': 'distribuidor',
    'Aguardando Distribuidor': 'distribuidor',
    'AGUARDANDO FORNECEDOR': 'fornecedor',
    'AGUARDANDO CLIENTE': 'cliente',
  };
  for (const [v, resp] of Object.entries(casos)) {
    const r = gate.classificarPendencia({ aguardandoConsolidado: v }, []);
    assert.deepStrictEqual({ externa: r.externa, responsavel: r.responsavel }, { externa: true, responsavel: resp }, v);
  }
  assert.strictEqual(gate.classificarPendencia({ aguardandoConsolidado: 'AGUARDANDO ATENDENTE' }, []).externa, false);
});

teste('botao e automatico nao pesquisam sob pendencia de distribuidor; chat liberado', async () => {
  const pend = gate.classificarPendencia({ aguardandoConsolidado: 'RETORNO - DISTRIBUIDOR' }, []);
  const calls = [];
  for (const origem of [gate.ORIGEM.BOTAO, gate.ORIGEM.AUTOMATICO]) {
    const d = await gate.decidirPesquisaExterna({ pendencia: pend, origemAcao: origem, texto: 'pesquise', historico: [], chamarIA: chamarIAFixa({ pesquisa_externa: 'sim' }, calls) });
    assert.strictEqual(d.liberada, false, origem);
  }
  assert.strictEqual(calls.length, 0);
  const livre = await gate.decidirPesquisaExterna({ pendencia: pend, origemAcao: gate.ORIGEM.TEXTO_LIVRE, texto: 'pesquise na documentacao oficial outra causa', historico: [], chamarIA: chamarIAFixa({ pesquisa_externa: 'sim' }, calls) });
  assert.strictEqual(livre.liberada, true);
  assert.match(gate.instrucaoParaPrompt({ pendencia: pend, origemAcao: gate.ORIGEM.BOTAO }), /aguarda retorno de distribuidor/);
});

teste('classificarPendencia: atendente, vazio e desconhecido NAO sao externos (fail-safe)', () => {
  for (const v of ['RETORNO - ATENDENTE', null, '', 'CRM - DOC044']) {
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

teste('texto livre (chat): liberado 100% sob pendencia externa, sem chamada de classificacao', async () => {
  for (const texto of ['pode aprofundar?', 'O que o cliente respondeu?', 'verifique isso', 'Mesmo aguardando, procure alternativas.']) {
    const d = await gate.decidirPesquisaExterna({ pendencia: PEND_CLIENTE, origemAcao: gate.ORIGEM.TEXTO_LIVRE, texto });
    assert.strictEqual(d.liberada, true, texto);
    assert.strictEqual(d.chamadaIA, false, texto);
  }
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

async function comProvidersFake({ decisaoGate, situacaoOrigem = { ok: false, motivo: 'stub_sem_agente' } }, fn) {
  const old = {
    situacao: situacaoOrigemService.consultarSituacaoAtual,
    resolver: aiConfigService.resolverKeysEOrdem,
    pesquisar: technicalResearchService.pesquisar,
    chamarIA: aiProviderClient.chamarIA,
    dossie: investigacaoDossieAtualizador.atualizarAposTurno,
  };
  const registro = { pesquisarCtx: [], gateCalls: 0, promptsPrincipais: [], origemCalls: 0, classificadorPrompts: [] };
  situacaoOrigemService.consultarSituacaoAtual = async () => { registro.origemCalls++; return situacaoOrigem; };
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
    situacaoOrigemService.consultarSituacaoAtual = old.situacao;
    technicalResearchService.pesquisar = old.pesquisar;
    aiProviderClient.chamarIA = old.chamarIA;
    investigacaoDossieAtualizador.atualizarAposTurno = old.dossie;
  }
}

teste('#036752 botao Pesquisar com RETORNO - CLIENTE/FORNECEDOR: só avisa que aguarda retorno, sem IA e sem pesquisa', async () => {
  for (const [numero, aguardando, quem] of [['036752', 'RETORNO - CLIENTE', /retorno enviado ao cliente/], ['036799', 'RETORNO - FORNECEDOR', /aguardando o retorno do fornecedor/]]) {
    const { atendimento } = criarChamadoComAtendimento({
      numero, aguardando,
      posicionamentos: [{ aguardandoRetorno: false, situacaoRetorno: aguardando, assunto: 'retorno', descricao: 'problema ja resolvido, transmitido e com retorno da RFB' }],
    });
    await comProvidersFake({ decisaoGate: { pesquisa_externa: 'sim' } }, async (reg) => {
      const msg = await investigacaoService.processarTurno(EMPRESA, atendimento.id, {
        texto: 'Revise todo o historico e pesquise uma solucao para este chamado.', usuarioId: 1, forcarPesquisa: true,
      });
      assert.match(msg.conteudo, quem);
      assert.match(msg.conteudo, /pedir aqui no chat/);
      assert.strictEqual(reg.gateCalls, 0, 'botao nao deve gastar chamada de classificacao');
      assert.strictEqual(reg.pesquisarCtx.length, 0, 'botao sob pendencia nao chama pesquisar()');
      assert.strictEqual(reg.promptsPrincipais.length, 0, 'botao sob pendencia nao chama a IA');
    });
  }
});

teste('chat sob pendencia de cliente/fornecedor: pesquisa liberada, sem classificador, planejamento normal decide', async () => {
  for (const [numero, aguardando, texto] of [['036753', 'RETORNO - CLIENTE', 'O que o cliente respondeu?'], ['036754', 'RETORNO - FORNECEDOR', 'Mesmo aguardando o fornecedor, procure alternativas.']]) {
    const { atendimento } = criarChamadoComAtendimento({ numero, aguardando });
    await comProvidersFake({ decisaoGate: { pesquisa_externa: 'nao' } }, async (reg) => {
      await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto, usuarioId: 1 });
      assert.strictEqual(reg.gateCalls, 0);
      assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada, undefined, texto);
      assert.strictEqual(reg.pesquisarCtx[0].forcarPesquisa, false, 'liberar nao e forcar: o plano normal decide');
    });
  }
});

teste('processarTurno: origem confirma ao vivo que voltou ao atendente => pesquisa normal', async () => {
  const { atendimento } = criarChamadoComAtendimento({ numero: '036760', aguardando: 'RETORNO - CLIENTE' });
  await comProvidersFake({ decisaoGate: { pesquisa_externa: 'nao' }, situacaoOrigem: { ok: true, aguardando: 'RETORNO - ATENDENTE' } }, async (reg) => {
    await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto: 'Qual a causa do erro 4010?', usuarioId: 1 });
    assert.strictEqual(reg.origemCalls, 1);
    assert.strictEqual(reg.gateCalls, 0);
    assert.strictEqual(reg.pesquisarCtx[0].pesquisaExternaBloqueada, undefined);
  });
});

teste('mensagem do analista grava origem explicita (botao x chat); nenhum classificador e chamado', async () => {
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
    assert.strictEqual(reg.gateCalls, 0);
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

// ── Quality Gate: pesquisa dispensada pelo gate nao e alerta; pesquisa devida sem resultado continua alertando
teste('Quality Gate: pesquisa dispensada por pendencia externa nao gera RESEARCH_CONFIGURED_WITHOUT_RESULTS', () => {
  const qg = require('../backend/services/quality-gate-service');
  const base = { textoResposta: 'Aguardo a confirmacao do cliente sobre o teste em HMG.', manifesto: { selecionados: [], omitidos: [] }, pergunta: 'Revise o historico e pesquise uma solucao para este chamado.' };
  const dispensada = qg.avaliarResposta({ ...base, pesquisa: { configurado: true, modo: 'nao_pesquisado', plano: { devePesquisar: false, bloqueioPendenciaExterna: { responsavel: 'cliente' } } } });
  assert.ok(!dispensada.falhas.some(f => /RESEARCH_/.test(f.codigo)), JSON.stringify(dispensada.falhas.map(f => f.codigo)));
  const devida = qg.avaliarResposta({ ...base, pesquisa: { configurado: true, modo: 'nao_pesquisado', plano: { devePesquisar: true } } });
  assert.ok(devida.falhas.some(f => f.codigo === 'RESEARCH_CONFIGURED_WITHOUT_RESULTS'), 'pesquisa devida sem resultado continua alertando');
  const naoConfigurada = qg.avaliarResposta({ ...base, pesquisa: { configurado: false, modo: 'nao_pesquisado', plano: { devePesquisar: true } } });
  assert.ok(naoConfigurada.falhas.some(f => f.codigo === 'RESEARCH_REQUIRED_NOT_EXECUTED'));
});

teste('contexto da pesquisa dispensada orienta informar a dispensa de forma natural (sem tom de erro)', () => {
  const tr = require('../backend/services/technical-research-service');
  const txt = tr.formatarContextoParaPrompt({ configurado: true, modo: 'nao_pesquisado', plano: { devePesquisar: false, bloqueioPendenciaExterna: { responsavel: 'cliente' } }, consultasExecutadas: [], resultados: [] }, []);
  assert.match(txt, /aguardando o retorno do cliente/);
  assert.match(txt, /Isto nao e uma falha/);
});

// ── Chamado ENCERRADO: somente consulta (sem interacao, pesquisa nem pre-analise)
teste('chamado encerrado: processarTurno recusa (409) em botao, texto livre e automatico, sem gravar mensagem nem chamar IA', async () => {
  const { chamado, atendimento } = criarChamadoComAtendimento({ numero: 'ENC-1', aguardando: 'RETORNO - CLIENTE' });
  chamadoRepo.upsertChamado(EMPRESA, { fonteId: chamado.fonteId, sistemaOrigem: 'softexpert', oidOrigem: 'OID-ENC-1', numero: 'ENC-1', titulo: 'x', statusEncerramento: 'Encerrado' });
  const antes = mensagemRepo.listarMensagens(EMPRESA, atendimento.id).length;
  let chamadasIA = 0;
  const old = aiProviderClient.chamarIA;
  aiProviderClient.chamarIA = async () => { chamadasIA++; throw new Error('nao deveria chamar IA'); };
  try {
    for (const opcoes of [
      { texto: 'pesquise uma solucao', forcarPesquisa: true, origemAcao: 'botao_pesquisar' },
      { texto: 'o que voce acha?', origemAcao: 'texto_livre' },
      { automatico: true },
    ]) {
      await assert.rejects(() => investigacaoService.processarTurno(EMPRESA, atendimento.id, opcoes), (err) => err.status === 409 && err.codigo === 'CHAMADO_ENCERRADO');
    }
  } finally { aiProviderClient.chamarIA = old; }
  assert.strictEqual(chamadasIA, 0);
  assert.strictEqual(mensagemRepo.listarMensagens(EMPRESA, atendimento.id).length, antes, 'nenhuma mensagem gravada');
});

teste('chamado encerrado: iniciarAnalise abre para consulta, sem pre-analise, devolvendo detalhe do chamado', () => {
  const radarService = require('../backend/services/radar-service');
  const { chamado } = criarChamadoComAtendimento({ numero: 'ENC-2', aguardando: null });
  const { chamado: c2 } = chamadoRepo.upsertChamado(EMPRESA, { fonteId: chamado.fonteId, sistemaOrigem: 'softexpert', oidOrigem: 'OID-ENC-2', numero: 'ENC-2', titulo: 'Encerrado', statusEncerramento: 'Encerrado' });
  const r = radarService.iniciarAnalise(EMPRESA, c2.id, { preAnaliseAutomatica: true });
  assert.strictEqual(r.somenteLeitura, true);
  assert.strictEqual(r.preAnaliseDisparada, false, 'sem pre-analise para encerrado mesmo com a opcao ligada');
  assert.strictEqual(r.chamado.id, c2.id);
  assert.strictEqual(r.chamado.statusEncerramento, 'Encerrado');
});

teste('pre-analise automatica nao dispara quando o chamado aguarda cliente/fornecedor (zero tokens)', () => {
  const radarService = require('../backend/services/radar-service');
  for (const [numero, aguardando] of [['PRE-CLI', 'RETORNO - CLIENTE'], ['PRE-FOR', 'RETORNO - FORNECEDOR']]) {
    const { chamado } = criarChamadoComAtendimento({ numero, aguardando });
    const r = radarService.iniciarAnalise(EMPRESA, chamado.id, { preAnaliseAutomatica: true });
    assert.strictEqual(r.preAnaliseDisparada, false, aguardando);
    assert.strictEqual(r.somenteLeitura, false);
  }
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
