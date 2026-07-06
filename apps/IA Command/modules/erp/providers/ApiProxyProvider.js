// Provider de execução via API REST remota.
// Usado quando a conexão é do tipo 'api_proxy' — IA Command envia o SQL
// para um endpoint REST instalado no servidor do ERP (ex: Protheus REST),
// que executa a query no banco e retorna os dados em JSON.
//
// Campos da conexão usados:
//   host     — URL base do servidor REST (ex: https://protheus.empresa.com:8080)
//   database — caminho do endpoint              (ex: /rest/api/iacommand/v1)
//   password — API Key / Bearer token

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const _LOG_FILE = path.join(__dirname, '..', '..', '..', '..', 'logs', 'agente-local.log');
function _logProxy(nivel, msg, dados = {}) {
  const linha = JSON.stringify({ ts: new Date().toISOString(), nivel, msg, origem: 'ApiProxyProvider', ...dados }) + '\n';
  try { fs.appendFileSync(_LOG_FILE, linha, 'utf8'); } catch (_) {}
  console.log(`[ApiProxy] [${nivel}] ${msg}`, dados);
}

function _buildUrl(conn, path) {
  const base     = (conn.host || '').replace(/\/$/, '');
  const endpoint = (conn.database || '/rest/api/iacommand/v1').replace(/\/$/, '');
  return `${base}${endpoint}${path}`;
}

const REQUEST_TIMEOUT_MS = 240000; // 240s — queries SQL pesadas (faturamento com muitos clientes pode ultrapassar 2min)

function _request(url, method, body, apiKey) {
  return new Promise((resolve, reject) => {
    // Flag para garantir que resolve/reject seja chamado apenas uma vez.
    // req.destroy() no timeout emite 'error' no socket, causando double-reject
    // que vira UnhandledPromiseRejection e derruba o processo Node.
    let settled = false;
    const _resolve = (val) => { if (!settled) { settled = true; resolve(val); } };
    const _reject  = (err) => { if (!settled) { settled = true; reject(err);  } };

    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const host    = parsed.hostname;
    const port    = parsed.port || (isHttps ? 443 : 80);
    const payload = body ? JSON.stringify(body) : null;

    _logProxy('INFO', 'requisicao_iniciada', {
      method,
      url,
      host,
      port,
      path:        parsed.pathname,
      sender:      body?.sender      || null,
      modulo:      body?.modulo      || null,
      empresa_id:  body?.empresa_id  || null,
      token_prefix: apiKey ? apiKey.substring(0, 8) + '...' : '(vazio)',
    });

    const options = {
      hostname: host,
      port,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey || ''}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      // Aceita certificados auto-assinados em ambientes internos
      rejectUnauthorized: false,
    };

    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        _logProxy(res.statusCode < 300 ? 'INFO' : 'WARN', 'requisicao_resposta', { url, http_status: res.statusCode });
        if (res.statusCode === 401) {
          return _reject(new Error('API Key inválida ou não autorizada (HTTP 401).'));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = `Agente retornou HTTP ${res.statusCode}`;
          try { msg = JSON.parse(data)?.error || msg; } catch (_) {}
          return _reject(new Error(msg));
        }
        try { _resolve(JSON.parse(data)); }
        catch (_) { _reject(new Error('Resposta do agente não é JSON válido.')); }
      });
    });

    req.on('error', (err) => {
      _logProxy('ERRO', 'requisicao_erro_rede', { url, host, port, erro: err.message, codigo: err.code });
      _reject(new Error(`Falha ao conectar ao agente: ${err.message}`));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      _logProxy('ERRO', 'requisicao_timeout', { url, host, port, timeout_ms: REQUEST_TIMEOUT_MS });
      req.destroy();
      _reject(new Error(`Timeout ao chamar o agente (${REQUEST_TIMEOUT_MS / 1000}s).`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// Substitui @p0, @p1 … pelos valores reais antes de enviar ao agente.
// Os valores vêm da classificação da IA (datas, códigos) — não de input direto do usuário.
function _resolverParams(sql, params) {
  let result = sql;
  for (const [key, value] of Object.entries(params || {})) {
    const placeholder = `@${key}`;
    let safe;
    if (value === null || value === undefined) {
      safe = 'NULL';
    } else if (typeof value === 'number') {
      safe = String(value);
    } else {
      // String: escapa aspas simples
      safe = `'${String(value).replace(/'/g, "''")}'`;
    }
    result = result.replaceAll(placeholder, safe);
  }
  return result;
}

async function executar(conn, query, params = {}) {
  const apiKey   = conn.password;
  const sqlFinal = _resolverParams(query, params);
  const url      = _buildUrl(conn, '/execute');

  const limit = Math.min(conn.limite_max || 10000, 50000);
  const data  = await _request(url, 'POST', {
    sql:        sqlFinal,
    limit,
    uuid:       crypto.randomUUID(),
    modulo:     conn._modulo      || '',
    operacao:   conn._operacao    || '',
    pergunta:   conn._pergunta    || '',
    sender:     conn._sender      || '',
    usuario:    conn._usuario     || '',
    empresa_id: conn._empresa_id  || '',
  }, apiKey);

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  throw new Error('Resposta do agente não contém "rows". Verifique o endpoint configurado.');
}

async function testar(conn) {
  const apiKey = conn.password;
  const url    = _buildUrl(conn, '/apicommand');
  await _request(url, 'GET', null, apiKey);
  return true;
}

// Fechar não se aplica a providers HTTP (sem pool permanente)
async function fechar() {}

module.exports = { executar, testar, fechar };
