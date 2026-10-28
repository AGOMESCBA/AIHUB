// Nunca oferecer/gravar Avaliacao Humana numa resposta que o proprio
// Quality Gate ja marcou como bloqueada para revisao (status
// 'revisao_necessaria_quality_gate' em investigacao_execucoes) -- pedido
// explicito do usuario, 2026-10: nao faz sentido avaliar como investigacao
// algo que o sistema ja rejeitou e que diz explicitamente "nao deve ser
// usada como parecer tecnico".
// Cobre: (1) backend rejeita a GRAVACAO mesmo que alguem chame a rota
// direto (defesa em profundidade, nao so esconder o botao); (2)
// GET /mensagens expoe qualityGateBloqueado=true na ficha operacional;
// (3) resposta normal (nao bloqueada) continua podendo ser avaliada.
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-quality-gate-bloqueado.test.js"

require('./helpers/rotinas-svc-liberadas'); // rotas exigem rotina svc-* (2026-10-28)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-qg-bloqueado-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const execucaoRepo = require('../backend/repositories/investigacao-execucao-repository');
const avaliacaoInvestigacaoService = require('../backend/services/avaliacao-investigacao-service');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 98601;

function criarAtendimentoComOrientacao(empresaId, texto = 'Hipótese provável de falha na rotina customizada.') {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Chamado de teste.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: texto,
  });
  return { atendimento, mensagemAssistente };
}

function registrarExecucao(empresaId, atendimentoId, mensagemId, status) {
  return execucaoRepo.salvarExecucao(empresaId, {
    atendimentoId, mensagemId, provider: 'groq', model: 'llama-x', status,
    qualityGate: status === 'revisao_necessaria_quality_gate' ? { aprovado: false, falhas: [{ codigo: 'RESEARCH_WITHOUT_GAP' }] } : { aprovado: true },
  });
}

function notasBase() {
  return {
    compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4,
    orientacaoPratica: 4, confiabilidadeTecnica: 4,
  };
}

async function iniciarAppInterno() {
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

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
}

async function main() {
  let server;
  try {
    // 1) Service rejeita a gravação de avaliação numa resposta bloqueada (defesa em profundidade)
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      registrarExecucao(EMPRESA_A, atendimento.id, mensagemAssistente.id, 'revisao_necessaria_quality_gate');
      try {
        await avaliacaoInvestigacaoService.avaliarInvestigacao(EMPRESA_A, {
          atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
          notas: notasBase(), usuarioId: 1, origemIdentidade: 'usuario_iahub',
        });
        assert.fail('deveria rejeitar avaliação de resposta bloqueada pelo Quality Gate');
      } catch (err) {
        assert.match(err.message, /bloqueada pelo Quality Gate/);
        assert.strictEqual(err.status, 400);
      }
    }
    console.log('[1/4] Service rejeita avaliação de resposta bloqueada pelo Quality Gate: ok');

    // 2) Resposta SEM bloqueio continua podendo ser avaliada normalmente
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      registrarExecucao(EMPRESA_A, atendimento.id, mensagemAssistente.id, 'concluido');
      const { evento } = await avaliacaoInvestigacaoService.avaliarInvestigacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        notas: notasBase(), usuarioId: 1, origemIdentidade: 'usuario_iahub',
      });
      assert.ok(evento.id, 'resposta concluida normalmente deve poder ser avaliada');
    }
    console.log('[2/4] Resposta não bloqueada continua avaliável normalmente: ok');

    // 3) Mensagem sem NENHUMA execução registrada (ex. importada, nunca gerada por IA) continua avaliável
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { evento } = await avaliacaoInvestigacaoService.avaliarInvestigacao(EMPRESA_A, {
        atendimentoId: atendimento.id, mensagemAssistenteId: mensagemAssistente.id,
        notas: notasBase(), usuarioId: 1, origemIdentidade: 'usuario_iahub',
      });
      assert.ok(evento.id, 'mensagem sem execucao registrada (ex. auditoria incompleta) nao deve ser bloqueada por omissão');
    }
    console.log('[3/4] Mensagem sem execução registrada não é bloqueada por omissão: ok');

    // 4) GET /mensagens expõe qualityGateBloqueado=true na ficha operacional
    {
      const appTeste = await iniciarAppInterno();
      server = appTeste.server;
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      registrarExecucao(EMPRESA_A, atendimento.id, mensagemAssistente.id, 'revisao_necessaria_quality_gate');

      const resp = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens?empresa_id=${EMPRESA_A}`);
      const mensagens = await resp.json();
      const msg = mensagens.find(m => m.id === mensagemAssistente.id);
      assert.strictEqual(msg.respostaOperacional.qualityGateBloqueado, true, 'ficha operacional deve expor qualityGateBloqueado=true');
    }
    console.log('[4/4] GET /mensagens expõe qualityGateBloqueado=true corretamente: ok');

    console.log('avaliacao-investigacao-quality-gate-bloqueado.test.js: ok (4/4 cenários validados)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
