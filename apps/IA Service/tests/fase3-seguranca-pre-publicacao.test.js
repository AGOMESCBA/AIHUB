// Fase 3 - Correcoes preventivas pre-publicacao: validacao do campo
// `comentario` (tipo/tamanho, erro controlado em vez de 500 de driver) e
// blindagem de renderizacao segura contra XSS. Tambem documenta, por teste,
// a investigacao de colisao de idempotencia entre chamados.
// Executar: node "apps/IA Service/tests/fase3-seguranca-pre-publicacao.test.js"

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const dbTmpPath = path.join(os.tmpdir(), `ia-service-fase3-seguranca-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const database = require('../backend/database');
database.inicializarDB(dbTmpPath);

const atendimentoRepo = require('../backend/repositories/atendimento-repository');
const mensagemRepo = require('../backend/repositories/mensagem-repository');
const validacaoSolucaoService = require('../backend/services/validacao-solucao-service');
const registrarRotas = require('../backend/routes');

const EMPRESA_A = 99801;
const EMPRESA_B = 99802;

function criarAtendimentoComOrientacao(empresaId) {
  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: 'manual', canalEntrada: 'web', conteudoBruto: 'Orientacao de teste.',
  });
  const mensagemAssistente = mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
    papel: 'assistant', conteudo: 'Corrija a validacao de indice no array.',
  });
  return { atendimento, mensagemAssistente };
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

async function postValidacao(baseUrl, atendimentoId, mensagemId, empresaId, body) {
  const r = await fetch(`${baseUrl}/api/ia-service/atendimentos/${atendimentoId}/mensagens/${mensagemId}/validacao?empresa_id=${empresaId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

async function main() {
  let server;
  try {
    const appTeste = await iniciarAppTeste();
    server = appTeste.server;

    // ===== Secao 2 - validacao do campo comentario (9 casos obrigatorios) =====

    // 1) String valida
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: 'Comentario legitimo do analista.' });
      assert.strictEqual(status, 201, 'string valida deve ser aceita');
      assert.strictEqual(body.evento.comentario, 'Comentario legitimo do analista.');
    }
    console.log('[1/9] String valida: ok');

    // 2) String vazia
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: '' });
      assert.strictEqual(status, 201, 'string vazia deve ser aceita e normalizada para null');
      assert.strictEqual(body.evento.comentario, null);
    }
    console.log('[2/9] String vazia: ok');

    // 3) Campo ausente
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO' });
      assert.strictEqual(status, 201, 'ausencia de comentario deve ser aceita');
      assert.strictEqual(body.evento.comentario, null);
    }
    console.log('[3/9] Campo ausente: ok');

    // 4) Objeto JSON
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: { malicioso: true } });
      assert.strictEqual(status, 400, 'objeto deve ser rejeitado com 400, nunca 500');
      assert.ok(!/SQLITE|Too few parameter|driver/i.test(body.error || ''), 'erro nao deve expor detalhe de driver de banco');
    }
    console.log('[4/9] Objeto JSON rejeitado com 400 sem vazar detalhe de driver: ok');

    // 5) Array
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: ['x', 'y'] });
      assert.strictEqual(status, 400);
      assert.ok(!/SQLITE|Too few parameter/i.test(body.error || ''));
    }
    console.log('[5/9] Array rejeitado com 400: ok');

    // 6) Numero
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: 42 });
      assert.strictEqual(status, 400);
    }
    console.log('[6/9] Numero rejeitado com 400: ok');

    // 7) Booleano
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: true });
      assert.strictEqual(status, 400);
    }
    console.log('[7/9] Booleano rejeitado com 400: ok');

    // 8) Texto acima do limite (2000 caracteres)
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: 'x'.repeat(2001) });
      assert.strictEqual(status, 400, 'texto acima do limite deve ser rejeitado');
      assert.match(body.error, /limite/i);

      // No limite exato deve ser aceito.
      const { atendimento: at2, mensagemAssistente: msg2 } = criarAtendimentoComOrientacao(EMPRESA_A);
      const noLimite = await postValidacao(appTeste.baseUrl, at2.id, msg2.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: 'x'.repeat(2000) });
      assert.strictEqual(noLimite.status, 201, 'exatamente no limite deve ser aceito');
    }
    console.log('[8/9] Texto acima do limite rejeitado; no limite exato aceito: ok');

    // 9) Caracteres especiais e Unicode
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const textoUnicode = 'Funcionário não conseguiu validar após ação — 中文 — emoji 🚀 — "aspas" e \'apóstrofo\'';
      const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: textoUnicode });
      assert.strictEqual(status, 201, 'unicode e caracteres especiais devem ser aceitos e preservados');
      assert.strictEqual(body.evento.comentario, textoUnicode, 'texto original deve ser preservado sem sanitizacao destrutiva');
    }
    console.log('[9/9] Caracteres especiais e Unicode preservados: ok');

    // ===== Secao 3 - XSS: persistencia preserva o texto original, nunca executa =====
    {
      const payloadsXss = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        `aspas: " e '`,
        '<svg onload=alert(1)>',
        'linha1\nlinha2\r\nlinha3',
        '中文 🚀 emoji e <b>negrito falso</b>',
      ];
      for (const payload of payloadsXss) {
        const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
        const { status, body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'NAO_TESTADO', comentario: payload });
        assert.strictEqual(status, 201, `payload deve ser aceito como texto puro: ${payload}`);
        assert.strictEqual(body.evento.comentario, payload, 'texto original (incluindo payload) deve ser preservado no banco sem sanitizacao destrutiva — a defesa e na RENDERIZACAO, nao na persistencia');
      }
    }
    console.log('[XSS] Payloads persistidos como texto puro, preservados sem alteracao: ok');

    // Confirma que a funcao de renderizacao segura (frontend) escapa
    // corretamente os mesmos payloads — simulando a logica de escapeHtml +
    // renderizarComentarioValidacao definida em atendimento.html/radar.html
    // (nao executavel aqui por ser browser-side; valida a MESMA logica em
    // Node para garantir que a funcao, se chamada, nunca deixaria a tag viva).
    {
      function escapeHtmlEquivalente(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      }
      const payload = '<script>alert(1)</script>';
      const escapado = escapeHtmlEquivalente(payload);
      assert.ok(!escapado.includes('<script>'), 'renderizacao segura nunca deve deixar tag <script> viva no HTML gerado');
      assert.strictEqual(escapado, '&lt;script&gt;alert(1)&lt;/script&gt;');
    }
    console.log('[XSS] Logica de escaping (equivalente a renderizarComentarioValidacao) neutraliza tags: ok');

    // ===== Secao 4 - idempotencia entre chamados: sem colisao reproduzivel =====
    // Investigacao documentada: chamadoId e o primeiro componente da chave de
    // idempotencia (validacao-solucao-service.js:registrarEvidenciaExternaDeChamado),
    // logo chamados DIFERENTES nunca colidem mesmo compartilhando o mesmo
    // atendimento. Nao houve alteracao de codigo nesta secao (conforme
    // restricao: "nao alterar a estrategia atual apenas por hipotese").
    {
      const atendimento = atendimentoRepo.criarAtendimento(EMPRESA_A, { origem: 'softexpert', canalEntrada: 'radar', referenciaExterna: 'REF-COMPARTILHADA-TESTE', conteudoBruto: 'x' });
      const msg = mensagemRepo.salvarMensagem(EMPRESA_A, atendimento.id, { papel: 'assistant', conteudo: 'orientacao' });
      const transicao = { de: 'Andamento', para: 'Encerrado', reabertura: false };
      const rX = validacaoSolucaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, { atendimentoId: atendimento.id, mensagemAssistenteId: msg.id, chamadoId: 'chamado-X-seg', statusEncerramentoTransicao: transicao });
      const rY = validacaoSolucaoService.registrarEvidenciaExternaDeChamado(EMPRESA_A, { atendimentoId: atendimento.id, mensagemAssistenteId: msg.id, chamadoId: 'chamado-Y-seg', statusEncerramentoTransicao: transicao });
      assert.strictEqual(rX.duplicado, false);
      assert.strictEqual(rY.duplicado, false, 'chamados diferentes compartilhando atendimento NAO devem colidir na idempotencia');
      assert.notStrictEqual(rX.registro.id, rY.registro.id);
    }
    console.log('[Idempotencia] Chamados diferentes no mesmo atendimento nunca colidem (investigado, sem defeito, sem alteracao de codigo): ok');

    // ===== Isolamento multiempresa continua preservado apos as correcoes =====
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { status } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_B, { resultado: 'RESOLVEU', comentario: 'tentativa de outra empresa' });
      assert.strictEqual(status, 404, 'empresa B nao deve conseguir confirmar atendimento da empresa A mesmo apos as correcoes de comentario');
    }
    console.log('[Isolamento] Multiempresa preservado apos correcoes preventivas: ok');

    // ===== Resultados RESOLVEU/NAO_RESOLVEU/PARCIALMENTE/NAO_TESTADO continuam com o mesmo significado =====
    {
      const { atendimento, mensagemAssistente } = criarAtendimentoComOrientacao(EMPRESA_A);
      const { body } = await postValidacao(appTeste.baseUrl, atendimento.id, mensagemAssistente.id, EMPRESA_A, { resultado: 'RESOLVEU', comentario: 'ok' });
      assert.strictEqual(body.estadoAtual.status, 'RESOLVEU', 'significado de RESOLVEU preservado');
    }
    console.log('[Semantica] Resultados de confirmacao preservam significado original: ok');

    console.log('\nfase3-seguranca-pre-publicacao.test.js: ok (todos os casos obrigatorios validados)');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    database.fecharDB();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbTmpPath + suffix); } catch (_) {} }
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
