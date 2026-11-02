// node --test "apps/IA Service/tests/anexos-garantia-turno.test.js"
// Turno completo com o modelo simulado: o arquivo copiado na hora chega à IA como
// anexo do turno, e o que faltou chega ao prompt e à mensagem visível do analista.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.SVC_GARANTIA_ANEXOS_TEMPO_MAX_MS = '200';
process.env.SVC_GARANTIA_ANEXOS_PAUSA_MS = '60000';
const dbTmpPath = path.join(os.tmpdir(), `ia-service-garantia-turno-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.SVC_DATA_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

let origem = [];
let falhar = false;
let travar = false;
let chamadasAgente = 0;
const adapterPath = require.resolve('../backend/services/import/softexpert-sqlserver-adapter');
require.cache[adapterPath] = {
  id: adapterPath, filename: adapterPath, loaded: true,
  exports: {
    SISTEMA_ORIGEM: 'softexpert',
    async listarChamadosPeriodo() { return []; },
    async listarPosicionamentosDoChamado() { return []; },
    async listarAnexosDoChamado(_e, _f, _n, opcoes) {
      chamadasAgente += 1;
      if (travar) return new Promise(() => {});
      if (falhar) throw new Error('Agente Local fora do ar');
      const lista = opcoes.oid ? origem.filter((a) => a.OID === opcoes.oid) : origem;
      return lista.map((a) => (opcoes.comConteudo === false ? { ...a, FLDATA: null } : a));
    },
  },
};

const agenteRepo = require('../backend/repositories/agente-local-repository');
const chamadoRepo = require('../backend/repositories/chamado-repository');
const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const aiConfigService = require('../backend/services/ai-config-service');
const technicalResearchService = require('../backend/services/technical-research-service');
const contextEngine = require('../backend/services/context-engine');
const investigacaoService = require('../backend/services/investigacao-service');

const EMPRESA = 99103;
const fonte = agenteRepo.criarFonte(EMPRESA, { connectionKey: 'k', nome: 'SE', sistemaOrigem: 'softexpert', adapter: 'SoftExpertSqlServerAdapter' });
let sequencia = 0;

function novoAtendimento() {
  sequencia += 1;
  const numero = String(80000 + sequencia);
  chamadoRepo.upsertChamado(EMPRESA, { fonteId: fonte.id, sistemaOrigem: 'softexpert', oidOrigem: `OID-${numero}`, numero, titulo: 'Chamado' });
  return atendimentoRepo.criarAtendimento(EMPRESA, { origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: numero, conteudoBruto: 'Histórico' });
}

function bruto(oid, nome, extras = {}) {
  const b = Buffer.from(`conteudo tecnico de ${nome}`, 'utf8');
  return { origem: 'anexo', OID_REFERENCIA: 'R', OID: oid, NMNAME: nome, IDEXTENSION: nome.split('.').pop(), NRSIZE: b.length, FLDATA: b.toString('base64'), CONTEUDO_ACESSIVEL: 1, ...extras };
}

function respostaModelo() {
  const res = new Readable({ read() {} });
  res.statusCode = 200;
  res.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    res.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Resposta final com evidencias especificas, stack trace e linha 10.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })));
    res.emit('end');
  });
  return res;
}

async function executarTurno(atendimento) {
  const antigos = {
    resolver: aiConfigService.resolverKeysEOrdem, pesquisar: technicalResearchService.pesquisar,
    formatar: technicalResearchService.formatarContextoParaPrompt, montar: contextEngine.montarContextoInvestigacao, request: https.request,
  };
  const capturado = {};
  aiConfigService.resolverKeysEOrdem = () => ({ keys: { openai: 'sk-test' }, cfg: { provedorPrimario: 'openai', fallbackOrdem: 'openai', modelos: { openai: 'gpt-4o-mini' } } });
  technicalResearchService.pesquisar = async () => ({ configurado: false, modo: 'links', paginasLidas: [] });
  technicalResearchService.formatarContextoParaPrompt = () => '';
  contextEngine.montarContextoInvestigacao = (params) => {
    capturado.systemPrompt = params.systemPrompt;
    capturado.anexosDoTurno = params.anexosDoTurno;
    return {
      userPrompt: 'prompt', imagensSelecionadas: [], pdfsVisuaisSelecionados: [],
      manifesto: { versao: 1, selecionados: [{ id: 'texto', tipo: 'anexo', status: 'ANALISADA', score: 10 }], omitidos: [] },
      contextoResumo: { tokensEstimadosPrompt: 10 },
    };
  };
  https.request = (_o, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.write = () => {};
    req.end = () => process.nextTick(() => cb(respostaModelo()));
    return req;
  };
  try {
    const mensagem = await investigacaoService.processarTurno(EMPRESA, atendimento.id, { texto: 'Pesquise a solução', usuarioId: null, anexoIds: [], anexosComoContexto: true, forcarPesquisa: true, origemAcao: 'botao_pesquisar' });
    return { ...capturado, mensagem };
  } finally {
    aiConfigService.resolverKeysEOrdem = antigos.resolver;
    technicalResearchService.pesquisar = antigos.pesquisar;
    technicalResearchService.formatarContextoParaPrompt = antigos.formatar;
    contextEngine.montarContextoInvestigacao = antigos.montar;
    https.request = antigos.request;
  }
}

after(() => {
  database.fecharDB();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + s); } catch (_) {} }
});

test('arquivo que ainda não tinha cópia chega à IA no mesmo turno, sem aviso', async () => {
  const atendimento = novoAtendimento();
  origem = [bruto('A1', 'erro.log')];
  falhar = false;
  const r = await executarTurno(atendimento);
  assert.deepEqual(r.anexosDoTurno.map((a) => a.nomeOriginal), ['erro.log']);
  assert.doesNotMatch(r.systemPrompt, /ANEXOS NÃO/);
  assert.deepEqual(r.mensagem.avisosFonteCorrigido, []);
});

test('anexo inacessível: IA não deduz o conteúdo e o analista vê o aviso gravado', async () => {
  const atendimento = novoAtendimento();
  origem = [bruto('wf-1', 'Doc1.pdf', { origem: 'workflow', IDEXTENSION: null, FLDATA: null, CONTEUDO_ACESSIVEL: '0' })];
  falhar = false;
  const r = await executarTurno(atendimento);
  assert.match(r.systemPrompt, /ANEXOS NÃO LIDOS NESTA ANÁLISE.*Doc1\.pdf/s);
  assert.match(r.mensagem.avisosFonteCorrigido[0], /A IA analisou sem 1 anexo: Doc1\.pdf \(guardado só no SoftExpert\)/);
  const gravada = mensagemRepo.listarMensagens(EMPRESA, atendimento.id).find((m) => m.papel === 'assistant');
  assert.match(gravada.avisosFonteCorrigido[0], /Doc1\.pdf/, 'aviso continua visível ao reabrir o chamado');
});

test('agente travado: a primeira análise espera o limite, as seguintes não esperam de novo', async () => {
  const atendimento = novoAtendimento();
  falhar = false;
  travar = true;
  chamadasAgente = 0;
  try {
    const r1 = await executarTurno(atendimento);
    assert.match(r1.mensagem.avisosFonteCorrigido[0], /tempo esgotado/);
    const antes = chamadasAgente;
    const inicio = Date.now();
    const r2 = await executarTurno(atendimento);
    assert.equal(chamadasAgente, antes, 'na pausa não chama o agente');
    assert.ok(Date.now() - inicio < 150, 'não espera o limite de novo');
    assert.match(r2.mensagem.avisosFonteCorrigido[0], /conferência adiada/);
    assert.match(r2.systemPrompt, /Não afirme que o chamado não tem anexos/);
  } finally {
    travar = false;
  }
});

test('agente fora do ar não impede a pesquisa e avisa a IA e o analista', async () => {
  const atendimento = novoAtendimento();
  falhar = true;
  const r = await executarTurno(atendimento);
  assert.ok(r.mensagem.conteudo, 'a IA respondeu');
  assert.match(r.systemPrompt, /Não afirme que o chamado não tem anexos/);
  assert.match(r.mensagem.avisosFonteCorrigido[0], /Não foi possível verificar os anexos/);
});
