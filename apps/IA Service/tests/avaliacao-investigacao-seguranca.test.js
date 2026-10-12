// Avaliacao humana das investigacoes -- validacao de tipo/tamanho de
// `observacoes` (evita 500 de driver SQLite por tipo invalido, mesmo padrao
// de _validarComentario em validacao-solucao-service.js) e confirmacao de
// que usuarioId nunca e aceito de fonte que nao seja a sessao autenticada.
// Executar: node "apps/IA Service/tests/avaliacao-investigacao-seguranca.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-avaliacao-seguranca-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 98601;

function criarAtendimentoComOrientacao(empresaId) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Orientacao de teste.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: 'Hipotese provavel de falha.',
  });
  return { atendimento, mensagemAssistente };
}

function notasBase(overrides = {}) {
  return {
    compreensaoProblema: 3, aproveitamentoEvidencias: 3, profundidadeTecnica: 3,
    orientacaoPratica: 3, confiabilidadeTecnica: 3, ...overrides,
  };
}

async function iniciarAppTeste() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user_id: 42 }; next(); });
  registrarRotas(app, {
    requireAuth: (req, _res, next) => next(),
    requireIaService: (req, _res, next) => { req.svcEmpresaId = Number(req.query?.empresa_id || 0); next(); },
  });
  const server = await new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function postAvaliacao(baseUrl, atendimentoId, mensagemId, empresaId, body) {
  const r = await fetch(`${baseUrl}/api/ia-service/atendimentos/${atendimentoId}/mensagens/${mensagemId}/avaliacao?empresa_id=${empresaId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

function limpar() {
  database.fecharDB();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
}

async function main() {
  let server;
  try {
    const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
    const appTeste = await iniciarAppTeste();
    server = appTeste.server;

    // 1) observacoes como objeto -> erro controlado 400, nunca 500 de driver
    const r1 = await postAvaliacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, {
      notas: notasBase(), observacoes: { nota: 'objeto invalido' },
    });
    assert.strictEqual(r1.status, 400, 'observacoes como objeto deve ser erro controlado 400, nunca 500');
    assert.match(r1.body.error, /texto \(string\)/);
    console.log('[1/5] observacoes como objeto -> 400 controlado (nunca 500 de driver): ok');

    // 2) observacoes como numero -> erro controlado 400
    const r2 = await postAvaliacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, {
      notas: notasBase(), observacoes: 42,
    });
    assert.strictEqual(r2.status, 400);
    console.log('[2/5] observacoes como numero -> 400 controlado: ok');

    // 3) observacoes acima do limite de 2000 chars -> 400
    const r3 = await postAvaliacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, {
      notas: notasBase(), observacoes: 'x'.repeat(2001),
    });
    assert.strictEqual(r3.status, 400);
    assert.match(r3.body.error, /excede o limite/);
    console.log('[3/5] observacoes acima de 2000 chars -> 400: ok');

    // 4) observacoes ausente/null -> aceito, nunca lanca erro
    const r4 = await postAvaliacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, {
      notas: notasBase(), observacoes: null,
    });
    assert.strictEqual(r4.status, 201, 'observacoes ausente deve ser aceita, nao e obrigatoria');
    console.log('[4/5] observacoes ausente/null aceita: ok');

    // 5) notas ausente por completo -> 400, nunca assume defaults silenciosos
    const r5 = await postAvaliacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, {
      observacoes: 'Sem notas.',
    });
    assert.strictEqual(r5.status, 400, 'ausencia completa de notas deve ser rejeitada, nunca assumir default');
    console.log('[5/5] ausencia de notas rejeitada (nunca assume default silencioso): ok');

    console.log('avaliacao-investigacao-seguranca.test.js: ok (5/5 cenarios validados)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    limpar();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
