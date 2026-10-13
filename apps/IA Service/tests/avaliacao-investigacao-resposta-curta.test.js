// Resposta curta do atalho de turno (pergunta_processo / fora_de_escopo) nao
// e "pesquisa da IA": nao pode ser avaliada nem oferecer o link de avaliar --
// pedido do usuario, 2026-10 (pergunta de clima/data nao deve pedir avaliacao).
// Cobre: (1) marcador respostaCurta persiste e volta no dominio sem vazar no
// diagnostico; (2) backend rejeita a gravacao; (3) GET /mensagens expoe
// respostaOperacional.avaliavel=false; (4) mensagem normal segue avaliavel;
// (5) execucaoAvaliavel: erro_provider/QG bloqueado = false, sem execucao = true.
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-resposta-curta.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-resposta-curta-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const avaliacaoInvestigacaoService = require('../backend/services/avaliacao-investigacao-service');
const respostaOperacionalService = require('../backend/services/resposta-operacional-service');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 98701;

function notasBase() {
  return {
    compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4,
    orientacaoPratica: 4, confiabilidadeTecnica: 4,
  };
}

function criarMensagem(empresaId, extras = {}) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Chamado de teste.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: 'Resposta de teste.', ...extras,
  });
  return { atendimento, mensagemAssistente };
}

async function iniciarApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user_id: 42 }; next(); });
  registrarRotas(app, {
    requireAuth: (_req, _res, next) => next(),
    requireIaService: (req, _res, next) => { req.svcEmpresaId = Number(req.query?.empresa_id || 0); next(); },
  });
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  let server;
  try {
    // 1) Marcador persiste, volta no dominio e nao vaza para o diagnostico
    {
      const { mensagemAssistente } = criarMensagem(EMPRESA_A, { respostaCurta: 'fora_de_escopo' });
      assert.strictEqual(mensagemAssistente.respostaCurta, 'fora_de_escopo');
      assert.strictEqual(mensagemAssistente.diagnostico, null, 'marcador nao pode aparecer como diagnostico');
      const normal = criarMensagem(EMPRESA_A).mensagemAssistente;
      assert.strictEqual(normal.respostaCurta, null);
    }
    console.log('[1/5] Marcador respostaCurta persiste e nao vaza no diagnostico: ok');

    // 2) Backend rejeita avaliar resposta curta
    {
      const { atendimento, mensagemAssistente } = criarMensagem(EMPRESA_A, { respostaCurta: 'pergunta_processo' });
      await assert.rejects(
        avaliacaoInvestigacaoService.avaliarInvestigacao(EMPRESA_A, {
          atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
          notas: notasBase(), usuarioId: 1, origemIdentidade: 'usuario_iahub',
        }),
        /não veio de uma pesquisa da IA/,
      );
    }
    console.log('[2/5] Service rejeita avaliacao de resposta curta: ok');

    // 3) GET /mensagens expoe avaliavel=false (curta) e true (normal)
    {
      const app = await iniciarApp();
      server = app.server;
      const curta = criarMensagem(EMPRESA_A, { respostaCurta: 'fora_de_escopo' });
      const resp = await fetch(`${app.baseUrl}/api/ia-service/atendimentos/${curta.atendimento.id}/mensagens?empresa_id=${EMPRESA_A}`);
      assert.strictEqual(resp.status, 200);
      const lista = await resp.json();
      const m = lista.find(x => x.id === curta.mensagemAssistente.id);
      assert.strictEqual(m.respostaOperacional.avaliavel, false);

      const normal = criarMensagem(EMPRESA_A);
      const resp2 = await fetch(`${app.baseUrl}/api/ia-service/atendimentos/${normal.atendimento.id}/mensagens?empresa_id=${EMPRESA_A}`);
      const lista2 = await resp2.json();
      assert.strictEqual(lista2.find(x => x.id === normal.mensagemAssistente.id).respostaOperacional.avaliavel, true);
    }
    console.log('[3/5] GET /mensagens expoe avaliavel false (curta) / true (normal): ok');

    // 4) Mensagem normal com execucao concluida continua avaliavel
    {
      const { atendimento, mensagemAssistente } = criarMensagem(EMPRESA_A);
      execucaoRepo.salvarExecucao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemId: mensagemAssistente.id,
        provider: 'groq', model: 'llama-x', status: 'concluido', qualityGate: { aprovado: true },
      });
      const { evento } = await avaliacaoInvestigacaoService.avaliarInvestigacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        notas: notasBase(), usuarioId: 1, origemIdentidade: 'usuario_iahub',
      });
      assert.ok(evento.id);
    }
    console.log('[4/5] Resposta de investigacao concluida segue avaliavel: ok');

    // 5) Regra pura de elegibilidade
    assert.strictEqual(respostaOperacionalService.execucaoAvaliavel('concluido', null), true);
    assert.strictEqual(respostaOperacionalService.execucaoAvaliavel(undefined, null), true, 'sem execucao nao bloqueia por omissao');
    assert.strictEqual(respostaOperacionalService.execucaoAvaliavel('erro_provider', null), false);
    assert.strictEqual(respostaOperacionalService.execucaoAvaliavel('erro_imagem', null), false);
    assert.strictEqual(respostaOperacionalService.execucaoAvaliavel('revisao_necessaria_quality_gate', null), false);
    assert.strictEqual(respostaOperacionalService.execucaoAvaliavel('concluido', 'fora_de_escopo'), false);
    console.log('[5/5] Regra execucaoAvaliavel: ok');

    console.log('avaliacao-investigacao-resposta-curta.test.js: ok (5/5 cenarios validados)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { database.fecharDB(); } catch (_) { /* ignore */ }
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbTmpPath + ext); } catch (_) { /* ignore */ }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
