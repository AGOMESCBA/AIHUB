'use strict';
// Teste isolado das rotas administrativas de whatsapp_response_config, simulando um
// mini-app Express em memoria (sem subir o servidor completo do IAHub) para exercitar
// os handlers reais (crud + validacao + isolamento por empresa) com requests fake.

const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');

const { inicializarDB, getDB } = require(path.join(ROOT, 'modules/database/index'));
inicializarDB();

const EMPRESA_A = -9996;
const EMPRESA_B = -9997;

function limpar() {
  getDB().prepare('DELETE FROM whatsapp_response_config WHERE empresa_id IN (?, ?)').run(EMPRESA_A, EMPRESA_B);
  getDB().prepare("DELETE FROM audit_log WHERE detalhes LIKE '%-999%'").run();
}
limpar();

// Mini-app fake: so precisa registrar handlers por metodo+path e permitir invoca-los.
function criarAppFake() {
  const rotas = { get: [], post: [], put: [], delete: [] };
  return {
    get: (p, ...handlers) => rotas.get.push({ p, handler: handlers[handlers.length - 1] }),
    post: (p, ...handlers) => rotas.post.push({ p, handler: handlers[handlers.length - 1] }),
    put: (p, ...handlers) => rotas.put.push({ p, handler: handlers[handlers.length - 1] }),
    delete: (p, ...handlers) => rotas.delete.push({ p, handler: handlers[handlers.length - 1] }),
    _rotas: rotas,
  };
}

function acharHandler(app, metodo, pathAlvo) {
  // Suporta paths com :id — casamento simples por segmentos.
  const segsAlvo = pathAlvo.split('/');
  for (const r of app._rotas[metodo]) {
    const segs = r.p.split('/');
    if (segs.length !== segsAlvo.length) continue;
    const ok = segs.every((s, i) => s.startsWith(':') || s === segsAlvo[i]);
    if (ok) return { handler: r.handler, params: _extrairParams(segs, segsAlvo) };
  }
  return null;
}
function _extrairParams(segsRota, segsReais) {
  const params = {};
  segsRota.forEach((s, i) => { if (s.startsWith(':')) params[s.slice(1)] = segsReais[i]; });
  return params;
}

function criarReqRes({ empresaId, body = {}, params = {} }) {
  let statusCode = 200;
  let jsonBody = null;
  const req = { session: { empresa_id: empresaId, user_id: 1, role: 'user', username: 'teste' }, body, params, ip: '127.0.0.1', socket: {} };
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; },
  };
  return { req, res, getStatus: () => statusCode, getJson: () => jsonBody };
}

async function rodar() {
  const app = criarAppFake();
  const noop = (req, res, next) => next && next();
  const registrar = require(path.join(ROOT, 'modules/whatsapp/whatsapp-response-config-routes'));
  registrar(app, { requireAuth: noop, requireIaCommand: noop });

  // 1. POST cria config para EMPRESA_A
  {
    const { req, res, getStatus, getJson } = criarReqRes({ empresaId: EMPRESA_A, body: { empresa_id: EMPRESA_A, limite_pergunta_anexo_caracteres: 7000, formato_padrao_anexo: 'pdf' } });
    const { handler } = acharHandler(app, 'post', '/api/ia-command/admin/whatsapp-response-config');
    await handler(req, res);
    assert.strictEqual(getStatus(), 201, 'criacao deve retornar 201');
    assert.strictEqual(getJson().limite_pergunta_anexo_caracteres, 7000);
    assert.strictEqual(getJson().formato_padrao_anexo, 'pdf');
  }

  // 2. POST duplicado para mesma empresa — deve retornar 409
  {
    const { req, res, getStatus, getJson } = criarReqRes({ empresaId: EMPRESA_A, body: { empresa_id: EMPRESA_A } });
    const { handler } = acharHandler(app, 'post', '/api/ia-command/admin/whatsapp-response-config');
    await handler(req, res);
    assert.strictEqual(getStatus(), 409, 'segunda criacao para mesma empresa deve ser rejeitada');
    assert(getJson().error);
  }

  // 3. formato_padrao_anexo invalido vira null (nao quebra, apenas ignora valor invalido)
  {
    const { req, res, getJson } = criarReqRes({ empresaId: EMPRESA_B, body: { empresa_id: EMPRESA_B, formato_padrao_anexo: 'zzz-invalido' } });
    const { handler } = acharHandler(app, 'post', '/api/ia-command/admin/whatsapp-response-config');
    await handler(req, res);
    assert.strictEqual(getJson().formato_padrao_anexo, null, 'valor invalido de formato deve virar null, nao quebrar');
  }

  // 4. GET listagem traz ambas as empresas com valores mesclados aos defaults
  {
    const { req, res, getJson } = criarReqRes({ empresaId: EMPRESA_A });
    const { handler } = acharHandler(app, 'get', '/api/ia-command/admin/whatsapp-response-config');
    await handler(req, res);
    const lista = getJson();
    const linhaA = lista.find(l => l.empresa_id === EMPRESA_A);
    assert(linhaA, 'listagem deve conter a empresa A');
    assert.strictEqual(linhaA.limite_pergunta_anexo_caracteres, 7000, 'campo customizado deve aparecer na listagem');
    assert.strictEqual(linhaA.limite_parte_whatsapp, 3500, 'campo nao customizado deve vir do default (mesclado)');
  }

  // 5. PUT edita a config da empresa A
  let idEmpresaA;
  {
    const rowA = getDB().prepare('SELECT id FROM whatsapp_response_config WHERE empresa_id = ?').get(EMPRESA_A);
    idEmpresaA = rowA.id;
    const { req, res, getJson } = criarReqRes({ empresaId: EMPRESA_A, params: { id: String(idEmpresaA) }, body: { limite_pergunta_anexo_caracteres: 3000 } });
    const { handler } = acharHandler(app, 'put', '/api/ia-command/admin/whatsapp-response-config/:id');
    await handler(req, res);
    assert.strictEqual(getJson().limite_pergunta_anexo_caracteres, 3000, 'PUT deve atualizar o campo');
  }

  // 6. PUT em id inexistente — 404
  {
    const { req, res, getStatus } = criarReqRes({ empresaId: EMPRESA_A, params: { id: '999999' }, body: { limite_pergunta_anexo_caracteres: 1000 } });
    const { handler } = acharHandler(app, 'put', '/api/ia-command/admin/whatsapp-response-config/:id');
    await handler(req, res);
    assert.strictEqual(getStatus(), 404);
  }

  // 7. DELETE remove a config da empresa A
  {
    const { req, res, getJson } = criarReqRes({ empresaId: EMPRESA_A, params: { id: String(idEmpresaA) } });
    const { handler } = acharHandler(app, 'delete', '/api/ia-command/admin/whatsapp-response-config/:id');
    await handler(req, res);
    assert.strictEqual(getJson().ok, true);
    const aindaExiste = getDB().prepare('SELECT id FROM whatsapp_response_config WHERE id = ?').get(idEmpresaA);
    assert.strictEqual(aindaExiste, undefined, 'registro deve ter sido excluido');
  }

  // 8. GET defaults retorna os valores default do sistema
  {
    const { req, res, getJson } = criarReqRes({ empresaId: EMPRESA_A });
    const { handler } = acharHandler(app, 'get', '/api/ia-command/admin/whatsapp-response-config-defaults');
    await handler(req, res);
    assert.strictEqual(getJson().limite_parte_whatsapp, 3500);
    assert.strictEqual(getJson().formato_padrao_anexo, 'excel');
  }

  limpar();
  console.log('whatsapp-response-config-routes.test.js: ok');
}

rodar().catch(err => {
  console.error('FALHOU:', err);
  process.exit(1);
});
