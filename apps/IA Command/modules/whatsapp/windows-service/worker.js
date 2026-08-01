'use strict';

/**
 * Processo standalone por canal WhatsApp — roda como Windows Service via NSSM.
 *
 * Variáveis de ambiente obrigatórias (injetadas pelo nssm-manager.js):
 *   IAC_CHANNEL_ID          — ID do canal no banco (ex: "abc-123")
 *   IAC_WORKER_PORT         — porta HTTP local deste worker (ex: "3101")
 *   IAC_APP_DIR             — caminho absoluto da raiz do IAHub (ex: "C:\Apps\iahub")
 *   IAC_HUB_CALLBACK_URL    — URL do endpoint /worker-event no processo principal
 *   IAC_HUB_INTERNAL_TOKEN  — token de segredo para autenticar o POST ao hub
 */

// ── Validação de variáveis de ambiente ────────────────────────────────────────
const IAC_APP_DIR    = process.env.IAC_APP_DIR;
const IAC_CHANNEL_ID = process.env.IAC_CHANNEL_ID;
const IAC_PORT       = parseInt(process.env.IAC_WORKER_PORT || '0', 10);
const IAC_HUB_URL    = process.env.IAC_HUB_CALLBACK_URL || 'http://localhost:3000/api/ia-command/whatsapp/worker-event';
const IAC_HUB_TOKEN  = process.env.IAC_HUB_INTERNAL_TOKEN || '';

if (!IAC_APP_DIR)    { console.error('[worker] FATAL: IAC_APP_DIR não definido.');    process.exit(1); }
if (!IAC_CHANNEL_ID) { console.error('[worker] FATAL: IAC_CHANNEL_ID não definido.'); process.exit(1); }
if (!IAC_PORT)       { console.error('[worker] FATAL: IAC_WORKER_PORT não definido.'); process.exit(1); }

// Garante que os require() relativos dentro de service.js resolvam corretamente
process.chdir(IAC_APP_DIR);

// ── Imports ───────────────────────────────────────────────────────────────────
const http = require('http');
const path = require('path');

function req(rel) { return require(path.join(IAC_APP_DIR, rel)); }

const dbModule       = req('apps/IA Command/modules/database/index.js');
const IACService     = req('apps/IA Command/modules/whatsapp/service.js');
const channelStore   = req('apps/IA Command/modules/whatsapp/channel-store.js');

// ── Log local ─────────────────────────────────────────────────────────────────
function log(tipo, msg) {
  process.stdout.write(`[${new Date().toISOString()}] [worker:${IAC_CHANNEL_ID}] [${tipo.toUpperCase()}] ${msg}\n`);
}

// ── Inicialização do banco ────────────────────────────────────────────────────
try {
  dbModule.inicializarDB();
  log('info', 'Banco SQLite inicializado.');
} catch (err) {
  console.error('[worker] FATAL: falha ao inicializar banco:', err.message);
  process.exit(1);
}

// ── Carregamento do canal ─────────────────────────────────────────────────────
let canal;
try {
  canal = channelStore.buscarCanal(IAC_CHANNEL_ID);
  if (!canal) throw new Error(`Canal "${IAC_CHANNEL_ID}" não encontrado no banco.`);
} catch (err) {
  console.error('[worker] FATAL:', err.message);
  process.exit(1);
}
log('info', `Canal: ${canal.nome} (auth: ${canal.auth_client_id})`);

// ── Instância do serviço WhatsApp ─────────────────────────────────────────────
const svc = new IACService();

// ── Bridge de eventos → processo principal (via HTTP) ─────────────────────────
// iac-qr só é enviado ao hub quando o frontend solicitar explicitamente (get-qr ou reconnect)
let _ultimoQr = null;

const EVENTOS_BRIDGE = ['iac-log', 'iac-status', 'iac-msg', 'iac-intent'];
for (const evento of EVENTOS_BRIDGE) {
  svc.on(evento, (payload) => _enfileirar(evento, payload));
}

// Envia o QR automaticamente assim que gerado — payload com channelId para o frontend saber a origem
svc.on('iac-qr', (url) => {
  _ultimoQr = url;
  _enfileirar('iac-qr', { channelId: IAC_CHANNEL_ID, url });
  _enfileirar('iac-log', { tipo: 'warning', msg: 'QR Code gerado — escaneie com o WhatsApp.' });
});

const _fila = [];
let _enviando = false;

function _enfileirar(evento, payload) {
  _fila.push({ evento, payload, tentativas: 0 });
  _despachar();
}

function _despachar() {
  if (_enviando || _fila.length === 0) return;
  _enviando = true;
  const item = _fila[0];
  _postHub(item)
    .then(() => {
      _fila.shift();
      _enviando = false;
      _despachar();
    })
    .catch(() => {
      item.tentativas++;
      _enviando = false;
      if (item.tentativas >= 10) { _fila.shift(); _despachar(); return; }
      setTimeout(_despachar, Math.min(1000 * Math.pow(2, item.tentativas - 1), 30000));
    });
}

function _postHub(item) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ channelId: IAC_CHANNEL_ID, event: item.evento, payload: item.payload });
    const url  = new URL(IAC_HUB_URL);
    const opts = {
      hostname: url.hostname,
      port:     parseInt(url.port || '3000', 10),
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Worker-Token': IAC_HUB_TOKEN,
        'X-Channel-Id':   IAC_CHANNEL_ID,
      },
    };
    const r = http.request(opts, (res) => {
      res.resume();
      res.statusCode < 500 ? resolve() : reject(new Error(`hub ${res.statusCode}`));
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('timeout')); });
    r.write(body);
    r.end();
  });
}

// ── Servidor HTTP local do worker ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      channelId: IAC_CHANNEL_ID,
      status:    svc.getStatus?.() ?? 'unknown',
      uptime:    process.uptime(),
      pid:       process.pid,
    }));
  }

  if (req.method === 'GET' && req.url === '/buffer') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      channelId: IAC_CHANNEL_ID,
      buffer:    svc.getLogBuffer?.() ?? [],
    }));
  }

  if (req.method === 'POST' && req.url === '/command') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { cmd } = JSON.parse(body || '{}');
        if (cmd === 'stop') {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
          await _encerrar();
        } else if (cmd === 'get-qr') {
          if (_ultimoQr) {
            // Já tem QR gerado — envia direto
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, hasQr: true }));
            _enfileirar('iac-qr', { channelId: IAC_CHANNEL_ID, url: _ultimoQr });
          } else if (svc.getStatus() !== 'starting') {
            // WhatsApp não está iniciando — inicia agora sem checar sessão para gerar QR
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, hasQr: false, iniciando: true }));
            log('info', 'QR solicitado — iniciando WhatsApp para gerar QR Code...');
            _iniciarParaQr();
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, hasQr: false }));
            log('info', 'QR solicitado — WhatsApp já está iniciando, aguarde...');
          }
        } else if (cmd === 'reconnect') {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
          log('info', 'Desconectando sessão atual e gerando novo QR Code...');
          _ultimoQr = null;
          try { await svc.disconnectSession(); } catch (_) {}
          // Remove sessão principal e quaisquer cópias em quarentena (session-iac_3, session-iac_3-quarantine-*)
          const authEntries = await fs.promises.readdir(AUTH_BASE).catch(() => []);
          const prefixo = `session-${canal.auth_client_id}`;
          await Promise.all(
            authEntries
              .filter(name => name === prefixo || name.startsWith(`${prefixo}.`) || name.startsWith(`${prefixo}-`))
              .map(name => {
                log('info', `Removendo sessão: ${name}`);
                return fs.promises.rm(path.join(AUTH_BASE, name), { recursive: true, force: true }).catch(() => {});
              })
          );
          await new Promise(r => setTimeout(r, 2000));
          await _iniciarParaQr();
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ erro: 'Comando desconhecido.' }));
        }
      } catch (_) {
        res.writeHead(400);
        res.end(JSON.stringify({ erro: 'Body inválido.' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/scheduled-question') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { empresaId, numero, pergunta, jobNome } = JSON.parse(body || '{}');
        if (!empresaId || !numero || !pergunta) {
          res.writeHead(400);
          return res.end(JSON.stringify({ erro: 'empresaId, numero e pergunta são obrigatórios.' }));
        }
        const resultado = await svc.executeScheduledQuestionOnce({ empresaId, numero, pergunta });
        await svc.sendScheduledQuestionDelivery({ empresaId, numero, resposta: resultado.resposta, ok: resultado.ok });
        const statusEmoji = resultado.ok === false ? '⚠️' : '✅';
        const nomeJob = jobNome ? `"${jobNome}"` : 'Agendamento';
        _enfileirar('iac-log', { tipo: resultado.ok === false ? 'warning' : 'success', msg: `${statusEmoji} ${nomeJob} enviado → ${numero}` });
        res.writeHead(200);
        res.end(JSON.stringify(resultado));
      } catch (err) {
        res.writeHead(err.message?.includes('nao esta conectado') ? 409 : 500);
        res.end(JSON.stringify({ erro: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/send-message') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { empresaId, numero, resposta, ok, jobNome } = JSON.parse(body || '{}');
        if (!empresaId || !numero || !resposta) {
          res.writeHead(400);
          return res.end(JSON.stringify({ erro: 'empresaId, numero e resposta são obrigatórios.' }));
        }
        await svc.sendScheduledQuestionDelivery({ empresaId, numero, resposta, ok });
        const statusEmoji = ok === false ? '⚠️' : '✅';
        const nomeJob = jobNome ? `"${jobNome}"` : 'Agendamento';
        _enfileirar('iac-log', { tipo: ok === false ? 'warning' : 'success', msg: `${statusEmoji} ${nomeJob} enviado → ${numero}` });
        res.writeHead(200);
        res.end(JSON.stringify({ enviado: true }));
      } catch (err) {
        res.writeHead(err.message?.includes('nao esta conectado') ? 409 : 500);
        res.end(JSON.stringify({ erro: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ erro: 'Não encontrado.' }));
});

server.listen(IAC_PORT, '127.0.0.1', () => {
  log('info', `Worker HTTP em 127.0.0.1:${IAC_PORT}`);
  _iniciar();
});

// ── Início do WhatsApp ────────────────────────────────────────────────────────
const fs   = require('fs');
const AUTH_BASE = path.join(IAC_APP_DIR, '.wwebjs_auth');

function _sessaoExiste(authClientId) {
  return fs.existsSync(path.join(AUTH_BASE, `session-${authClientId}`));
}

async function _iniciar() {
  const empresas = channelStore.listarEmpresasDoCanal(IAC_CHANNEL_ID);
  if (!empresas.length) { log('error', 'Nenhuma empresa vinculada. Abortando.'); process.exit(1); }

  if (!_sessaoExiste(canal.auth_client_id)) {
    log('warning', 'Sem sessão WhatsApp salva. Use "↺ Novo QR" para conectar.');
    _enfileirar('iac-status', { channelId: IAC_CHANNEL_ID, status: 'stopped' });
    _enfileirar('iac-log', { tipo: 'warning', msg: 'Sem sessão WhatsApp salva. Clique em "Novo QR" para conectar.' });
    return;
  }

  log('info', 'Sessão encontrada. Conectando ao WhatsApp...');
  _enfileirar('iac-log', { tipo: 'info', msg: 'Sessão encontrada. Conectando ao WhatsApp...' });
  try {
    await svc.start({ channel: canal, empresaId: empresas[0].empresa_id });
  } catch (err) {
    log('error', `Falha ao iniciar WhatsApp: ${err.message}`);
    process.exit(1);
  }
}

// Inicia o WhatsApp sem verificar sessão — gera QR para nova autenticação
async function _iniciarParaQr() {
  const empresas = channelStore.listarEmpresasDoCanal(IAC_CHANNEL_ID);
  if (!empresas.length) { log('error', 'Nenhuma empresa vinculada. Abortando.'); process.exit(1); }

  log('info', 'Iniciando WhatsApp para gerar QR Code — escaneie com o celular.');
  try {
    await svc.start({ channel: canal, empresaId: empresas[0].empresa_id });
  } catch (err) {
    log('error', `Falha ao iniciar WhatsApp para QR: ${err.message}`);
  }
}

// ── Encerramento gracioso ─────────────────────────────────────────────────────
async function _encerrar() {
  log('info', 'Encerrando...');
  try { await svc.stop(); } catch (_) {}
  server.close();
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', _encerrar);
process.on('SIGINT',  _encerrar);
process.on('uncaughtException',  (err) => log('error', `Exceção: ${err.message}`));
process.on('unhandledRejection', (r)   => log('error', `Rejeição: ${r}`));
