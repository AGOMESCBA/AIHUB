// Avaliacao humana das investigacoes -- testes de rota HTTP (autorizacao,
// validacao de notas, isolamento multiempresa, embutimento na listagem de
// mensagens). Complementa avaliacao-investigacao-persistencia.test.js.
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-rotas-http.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-http-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 98401;
const EMPRESA_B = 98402;

function notasBase(overrides = {}) {
  return {
    compreensaoProblema: 5, aproveitamentoEvidencias: 5, profundidadeTecnica: 5,
    orientacaoPratica: 5, confiabilidadeTecnica: 4, ...overrides,
  };
}

async function iniciarAppTeste({ comUsuario = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = comUsuario ? { user_id: 42 } : {};
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
  let server, serverSemUsuario;
  try {
    const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, {
      origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Erro em rotina customizada.',
    });
    const mensagemAssistente = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, {
      papel: 'assistant', conteudo: 'Hipotese provavel de falha.',
    });

    const appTeste = await iniciarAppTeste();
    server = appTeste.server;

    // 1) 401 sem usuario autenticado
    const appSemUsuario = await iniciarAppTeste({ comUsuario: false });
    serverSemUsuario = appSemUsuario.server;
    const resp1 = await fetch(`${appSemUsuario.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase() }),
    });
    assert.strictEqual(resp1.status, 401, 'avaliacao sem usuario identificado deve ser rejeitada');
    console.log('[1/8] 401 sem usuario autenticado: ok');

    // 2) Avaliacao valida via rota HTTP -> 201
    const resp2 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase(), observacoes: 'Investigou bem, mas nao citou a fonte.', erroTecnicoCritico: false }),
    });
    assert.strictEqual(resp2.status, 201);
    const body2 = await resp2.json();
    assert.strictEqual(body2.avaliacaoAtual.notaTotal, 24);
    assert.strictEqual(body2.avaliacaoAtual.faixa, 'EXCELENTE');
    console.log('[2/8] Avaliacao valida via rota HTTP: ok');

    // 3) usuarioId enviado no corpo da requisicao e ignorado (so req.session.user_id vale)
    const resp3 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase(), usuarioId: 999999 }),
    });
    const body3 = await resp3.json();
    assert.strictEqual(body3.evento.usuarioId, 42, 'usuarioId do corpo da requisicao deve ser ignorado -- so a sessao vale');
    console.log('[3/8] usuarioId do corpo da requisicao ignorado: ok');

    // 4) Nota fora de 0-5 -> 400
    const resp4 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase({ profundidadeTecnica: 9 }) }),
    });
    assert.strictEqual(resp4.status, 400, 'nota fora de 0-5 deve ser rejeitada');
    console.log('[4/8] Nota fora de 0-5 -> 400: ok');

    // 5) Nota nao-inteira -> 400
    const resp5 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase({ compreensaoProblema: 3.5 }) }),
    });
    assert.strictEqual(resp5.status, 400, 'nota nao-inteira deve ser rejeitada');
    console.log('[5/8] Nota nao-inteira -> 400: ok');

    // 6) GET de mensagens ja traz avaliacaoHumana embutida
    const resp6 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens?empresa_id=${EMPRESA_A}`);
    const mensagens = await resp6.json();
    const msgRecarregada = mensagens.find(m => m.id === mensagemAssistente.id);
    assert.strictEqual(msgRecarregada.respostaOperacional.avaliacaoHumana.minhaAvaliacaoAtual.notaTotal, 24, 'avaliacao deve sobreviver ao reload da listagem de mensagens');
    console.log('[6/8] avaliacaoHumana embutida em GET /mensagens: ok');

    // 7) Isolamento multiempresa: empresa B nao pode avaliar atendimento da empresa A
    const resp7 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_B}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase() }),
    });
    assert.strictEqual(resp7.status, 404, 'empresa B nao deve conseguir avaliar atendimento da empresa A');
    console.log('[7/8] Isolamento multiempresa via rota: ok');

    // 8) Todas as avaliacoes da mensagem (segundo consultor avalia tambem)
    await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao?empresa_id=${EMPRESA_A}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notas: notasBase({ compreensaoProblema: 1 }) }),
    });
    const resp8 = await fetch(`${appTeste.baseUrl}/api/ia-service/atendimentos/${atendimento.id}/mensagens/${mensagemAssistente.id}/avaliacao/todas?empresa_id=${EMPRESA_A}`);
    const todas = await resp8.json();
    assert.strictEqual(todas.length, 1, 'mesmo usuario reavaliando conta como 1 avaliacao atual, nao 2');
    console.log('[8/8] Rota de todas as avaliacoes retorna 1 por usuario distinto: ok');

    console.log('avaliacao-investigacao-rotas-http.test.js: ok (todos os asserts passaram)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (serverSemUsuario) await new Promise(resolve => serverSemUsuario.close(resolve));
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
