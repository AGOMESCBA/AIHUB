// Pre-avaliacao por IA (sugestao inicial para o modal de Avaliacao Humana):
// nunca lanca, nunca persiste, falha aberta (provider fora/JSON invalido ->
// sucesso:false). Mock de https.request, mesmo padrao de ai-provider-retry.test.js
// -- nunca bate em provider real.
// Executar: node "apps/IA Service/tests/pre-avaliacao-ia.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-pre-avaliacao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const avaliacaoRepo = require('../backend/repositories/avaliacao-investigacao-repository');
const aiConfigService = require('../backend/services/ai-config-service');
const preAvaliacaoIaService = require('../backend/services/pre-avaliacao-ia-service');

const EMPRESA_A = 98701;

function instalarMockHttps(filaRespostas) {
  const original = https.request;
  const chamadas = [];
  https.request = (options, cb) => {
    const { EventEmitter } = require('events');
    const req = new EventEmitter();
    req.write = () => {};
    req.setTimeout = () => {};
    req.destroy = err => req.emit('error', err);
    req.end = () => {
      const resposta = filaRespostas.shift();
      chamadas.push({ hostname: options.hostname });
      process.nextTick(() => {
        if (!resposta) { req.emit('error', new Error('Mock sem resposta configurada')); return; }
        if (resposta.erro) { req.emit('error', new Error(resposta.erro)); return; }
        const res = new EventEmitter();
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify(resposta.body)));
        res.emit('end');
      });
    };
    return req;
  };
  return { chamadas, restaurar() { https.request = original; } };
}

function criarAtendimentoComOrientacao(empresaId) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Cliente relata erro ao lancar nota fiscal.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: 'Hipótese: validação de índice ausente antes do acesso ao array de itens.',
  });
  return { atendimento, mensagemAssistente };
}

function stubConfigComChaveFake() {
  const original = aiConfigService.resolverKeysEOrdem;
  aiConfigService.resolverKeysEOrdem = () => ({
    keys: { openai: 'sk-test' },
    cfg: { provedorPrimario: 'openai', fallbackOrdem: 'openai', modelos: { openai: 'gpt-4o-mini' } },
  });
  return () => { aiConfigService.resolverKeysEOrdem = original; };
}

async function main() {
  const restaurarConfig = stubConfigComChaveFake();

  // 1) Sucesso: JSON valido com as 5 notas -> sugestao devolvida, nada persistido
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const mock = instalarMockHttps([
      { body: { choices: [{ message: { content: JSON.stringify({
        compreensaoProblema: 4, aproveitamentoEvidencias: 3, profundidadeTecnica: 4,
        orientacaoPratica: 3, confiabilidadeTecnica: 4, observacoes: 'Hipótese plausível, falta validação.',
      }) }, finish_reason: 'stop' }], usage: { total_tokens: 50 } } },
    ]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      });
      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.sugestao.notas.compreensaoProblema, 4);
      assert.strictEqual(resultado.sugestao.notas.confiabilidadeTecnica, 4);
      assert.strictEqual(resultado.sugestao.observacoes, 'Hipótese plausível, falta validação.');
      const persistido = avaliacaoRepo.listarHistoricoDoUsuario(EMPRESA_A, mensagemAssistente.id, 1);
      assert.strictEqual(persistido.length, 0, 'pre-avaliacao NUNCA deve persistir nada em avaliacoes_investigacao');
    } finally {
      mock.restaurar();
    }
  }
  console.log('[1/7] Sucesso: JSON valido devolve sugestao, nada persistido: ok');

  // 2) JSON com texto extra ao redor (markdown/fences) -> ainda extrai e valida
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const mock = instalarMockHttps([
      { body: { choices: [{ message: { content: 'Aqui está minha análise:\n```json\n' + JSON.stringify({
        compreensaoProblema: 5, aproveitamentoEvidencias: 5, profundidadeTecnica: 5,
        orientacaoPratica: 5, confiabilidadeTecnica: 5, observacoes: 'Excelente.',
      }) + '\n```' }, finish_reason: 'stop' }], usage: {} } },
    ]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      });
      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.sugestao.notas.profundidadeTecnica, 5);
    } finally {
      mock.restaurar();
    }
  }
  console.log('[2/7] JSON com texto/markdown ao redor ainda e extraido corretamente: ok');

  // 3) Resposta sem JSON algum -> falha aberta, nunca lanca
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const mock = instalarMockHttps([
      { body: { choices: [{ message: { content: 'Desculpe, não consigo avaliar isso.' }, finish_reason: 'stop' }], usage: {} } },
    ]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      });
      assert.strictEqual(resultado.sucesso, false);
    } finally {
      mock.restaurar();
    }
  }
  console.log('[3/7] Resposta sem JSON -> sucesso:false, sem lancar: ok');

  // 4) JSON com nota fora de 0-5 -> rejeitado como invalido (falha aberta)
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const mock = instalarMockHttps([
      { body: { choices: [{ message: { content: JSON.stringify({
        compreensaoProblema: 9, aproveitamentoEvidencias: 3, profundidadeTecnica: 4,
        orientacaoPratica: 3, confiabilidadeTecnica: 4,
      }) }, finish_reason: 'stop' }], usage: {} } },
    ]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      });
      assert.strictEqual(resultado.sucesso, false, 'nota 9 (fora de 0-5) deve ser tratada como sugestao invalida, normalizar/clampar seria enganoso');
    } finally {
      mock.restaurar();
    }
  }
  console.log('[4/7] Nota fora de 0-5 tratada como sugestao invalida: ok');

  // 5) Provider indisponivel (erro de rede) -> falha aberta, nunca lanca
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const mock = instalarMockHttps([
      { erro: 'ECONNREFUSED' },
    ]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      });
      assert.strictEqual(resultado.sucesso, false);
    } finally {
      mock.restaurar();
    }
  }
  console.log('[5/7] Provider indisponivel -> sucesso:false, sem lancar: ok');

  // 6) Mensagem que nao e do assistente -> sucesso:false sem tentar chamar IA
  {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, { origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Caso.' });
    const msgUsuario = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'user', conteudo: 'Pergunta do cliente.' });
    const mock = instalarMockHttps([]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: msgUsuario.id,
      });
      assert.strictEqual(resultado.sucesso, false);
      assert.strictEqual(mock.chamadas.length, 0, 'nao deveria nem tentar chamar IA para mensagem que nao e assistant');
    } finally {
      mock.restaurar();
    }
  }
  console.log('[6/7] Mensagem nao-assistant rejeitada sem chamar IA: ok');

  // 7) Atendimento de outra empresa -> sucesso:false (isolamento multiempresa)
  {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const mock = instalarMockHttps([]);
    try {
      const resultado = await preAvaliacaoIaService.gerarPreAvaliacao(98702, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
      });
      assert.strictEqual(resultado.sucesso, false);
      assert.strictEqual(mock.chamadas.length, 0);
    } finally {
      mock.restaurar();
    }
  }
  console.log('[7/7] Isolamento multiempresa (empresa B nao acessa atendimento de A): ok');

  restaurarConfig();
  console.log('pre-avaliacao-ia.test.js: ok (7/7 cenarios validados)');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => {
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
  });
