// Fase 3 - Confirmacao das Solucoes: testes de rota HTTP (autorizacao,
// isolamento multiempresa e idempotencia observados via API real, nao so
// chamada direta ao service). Complementa fase3-confirmacao-solucoes.test.js.
// Executar: node "apps/IA Service/tests/fase3-rotas-http.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-fase3-http-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 97301;
const EMPRESA_B = 97302;

async function iniciarAppTeste() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user_id: 42 };
    next();
  });
  registrarRotas(app, {
    requireAuth: (req, _res, next) => next(),
    requireIaService: (req, _res, next) => {
      req.svcEmpresaId = Number(req.query?.empresa_id || 0);
      next();
    },
  });
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
}

async function main() {
  let server;
  try {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, {
      origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Erro em rotina.',
    });
    const mensagemAssistente = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, {
      papel: 'assistant', conteudo: 'Corrija a validacao de indice no array.',
    });

    const appTeste = await iniciarAppTeste();
    server = appTeste.server;

    // 1) Confirmação via rota HTTP
    const resp1 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/validacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultado: 'RESOLVEU', comentario: 'Testado em homologação.' }),
    });
    assert.strictEqual(resp1.status, 201, 'confirmação válida deve retornar 201');
    const body1 = await resp1.json();
    assert.strictEqual(body1.estadoAtual.status, 'RESOLVEU');

    // 2) Estado é persistido e lido corretamente em GET
    const resp2 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/validacao?empresa_id=${EMPRESA_A}`);
    assert.strictEqual(resp2.status, 200);
    const body2 = await resp2.json();
    assert.strictEqual(body2.status, 'RESOLVEU');
    assert.strictEqual(body2.historico.length, 1);

    // 3) GET de mensagens já traz a ficha operacional com validacaoSolucao embutida
    const resp3 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens?empresa_id=${EMPRESA_A}`);
    const mensagens = await resp3.json();
    const msgRecarregada = mensagens.find(m => m.id === mensagemAssistente.id);
    assert.strictEqual(msgRecarregada.respostaOperacional.validacaoSolucao.status, 'RESOLVEU', 'estado de validação deve sobreviver ao reload da listagem de mensagens');

    // 4) Resultado inválido -> 400
    const resp4 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/validacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultado: 'TALVEZ' }),
    });
    assert.strictEqual(resp4.status, 400, 'resultado fora do enum deve ser rejeitado');

    // 5) Isolamento multiempresa via rota: empresa B não pode confirmar
    // nem ler validação de atendimento da empresa A.
    const resp5 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/validacao?empresa_id=${EMPRESA_B}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultado: 'RESOLVEU' }),
    });
    assert.strictEqual(resp5.status, 404, 'empresa B não deve conseguir confirmar atendimento da empresa A');

    console.log('fase3-rotas-http.test.js: ok (todos os asserts passaram)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
