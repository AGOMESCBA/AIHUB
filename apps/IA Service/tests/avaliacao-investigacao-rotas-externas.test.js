// Avaliacao Humana no namespace EXTERNO (login por telefone/WhatsApp, J2A) --
// mesmo service do namespace interno (avaliacao-investigacao-service.js), so
// trocando a origem da identidade (req.svcConsultorExterno em vez de
// req.session.user_id). Cobre: 401 sem sessao externa, gravacao com
// origem_identidade='consultor_externo', isolamento multiempresa, e que o
// consultorId externo nunca colide com usuarioId interno na mesma coluna
// (migration 43).
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-rotas-externas.test.js"

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-externa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const consultorRepo = require('../backend/repositories/consultor-repository');
const avaliacaoRepo = require('../backend/repositories/avaliacao-investigacao-repository');
const registrarRotasExterno = require('../backend/routes/externo-routes');

const EMPRESA_A = 98901;
const EMPRESA_B = 98902;
let sessaoExternaSeq = 0;

function criarAtendimentoComOrientacao(empresaId, texto = 'Hipótese provável de falha na rotina customizada.') {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Chamado de teste.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: texto,
  });
  return { atendimento, mensagemAssistente };
}

function criarSessaoExterna(empresaId) {
  const seq = ++sessaoExternaSeq;
  const consultor = consultorRepo.criarConsultor(empresaId, {
    idSoftexpert: `TEC-${empresaId}-${seq}`,
    telefone: `5565999${empresaId}${seq}`,
  });
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + 60 * 60 * 1000);
  database.getDB().prepare(`
    INSERT INTO svc_sessoes_externas (id, empresa_id, consultor_id, token_hash, expira_em, criado_em, ultimo_acesso_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), Number(empresaId), consultor.id,
    crypto.createHash('sha256').update(token).digest('hex'),
    expiraEm.toISOString(), agora.toISOString(), agora.toISOString(),
  );
  return { token, consultorId: consultor.id };
}

function notasBase(overrides = {}) {
  return {
    compreensaoProblema: 4, aproveitamentoEvidencias: 4, profundidadeTecnica: 4,
    orientacaoPratica: 4, confiabilidadeTecnica: 4, ...overrides,
  };
}

async function iniciarAppExterno() {
  const app = express();
  app.use(express.json());
  registrarRotasExterno(app);
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
    const appTeste = await iniciarAppExterno();
    server = appTeste.server;

    // 1) 401 sem token de sessão externa
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const resp = await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notas: notasBase() }),
      });
      assert.strictEqual(resp.status, 401, 'sem token de sessao externa deve ser rejeitado');
    }
    console.log('[1/6] 401 sem sessão externa: ok');

    // 2) Avaliação válida via sessão externa real -> 201, origem_identidade correta
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { token, consultorId } = criarSessaoExterna(EMPRESA_A);
      const resp = await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sessao-externa': token },
        body: JSON.stringify({ notas: notasBase(), observacoes: 'Avaliado via J2A.' }),
      });
      assert.strictEqual(resp.status, 201);
      const body = await resp.json();
      assert.strictEqual(body.evento.usuarioId, consultorId, 'usuarioId gravado deve ser o consultorId da sessao externa');

      const salvo = avaliacaoRepo.obterAvaliacaoAtualDoUsuario(EMPRESA_A, mensagemAssistente.id, consultorId);
      assert.strictEqual(salvo.origemIdentidade, 'consultor_externo', 'origem_identidade deve marcar consultor_externo, nunca ficar ambigua com usuario_iahub');
    }
    console.log('[2/6] Avaliação via sessão externa grava origem_identidade=consultor_externo: ok');

    // 3) usuarioId do corpo da requisição é ignorado (só a sessão externa vale)
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { token, consultorId } = criarSessaoExterna(EMPRESA_A);
      const resp = await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sessao-externa': token },
        body: JSON.stringify({ notas: notasBase(), usuarioId: 999999 }),
      });
      const body = await resp.json();
      assert.strictEqual(body.evento.usuarioId, consultorId, 'usuarioId do corpo deve ser ignorado -- so a sessao externa vale');
    }
    console.log('[3/6] usuarioId do corpo da requisição ignorado (sessão externa é a única fonte): ok');

    // 4) Isolamento multiempresa: sessão da empresa B não acessa atendimento da empresa A
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { token } = criarSessaoExterna(EMPRESA_B);
      const resp = await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sessao-externa': token },
        body: JSON.stringify({ notas: notasBase() }),
      });
      assert.strictEqual(resp.status, 404, 'sessao externa de outra empresa nao deve acessar atendimento de empresa diferente');
    }
    console.log('[4/6] Isolamento multiempresa via sessão externa: ok');

    // 5) GET /mensagens traz avaliacaoHumana embutida para o canal externo
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { token } = criarSessaoExterna(EMPRESA_A);
      await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sessao-externa': token },
        body: JSON.stringify({ notas: notasBase() }),
      });
      const respMensagens = await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens`, {
        headers: { 'x-sessao-externa': token },
      });
      const mensagens = await respMensagens.json();
      const msgRecarregada = mensagens.find(m => m.id === mensagemAssistente.id);
      assert.ok(msgRecarregada.respostaOperacional?.avaliacaoHumana?.minhaAvaliacaoAtual, 'avaliacaoHumana deve vir embutida em GET /mensagens no canal externo');
    }
    console.log('[5/6] avaliacaoHumana embutida em GET /mensagens (canal externo): ok');

    // 6) Sugestão por IA via canal externo nunca lança, mesmo sem provider configurado
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { token } = criarSessaoExterna(EMPRESA_A);
      const resp = await fetch(`${appTeste.baseUrl}/api/ia-service-externo/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao/sugestao`, {
        headers: { 'x-sessao-externa': token },
      });
      assert.strictEqual(resp.status, 200, 'rota de sugestao deve sempre responder 200, mesmo em falha');
      const body = await resp.json();
      assert.strictEqual(body.sucesso, false, 'sem provider configurado, sucesso deve ser false, nunca lancar erro de rede');
    }
    console.log('[6/6] Sugestão por IA via canal externo falha aberta (sucesso:false, nunca 500): ok');

    console.log('avaliacao-investigacao-rotas-externas.test.js: ok (6/6 cenários validados)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
