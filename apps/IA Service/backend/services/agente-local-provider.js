// Cliente HTTP do Agente Local — reaproveita o MESMO protocolo já validado
// pelo apps/IA Command/modules/erp/providers/ApiProxyProvider.js (POST /execute,
// SELECT-only, envelope AES-GCM opcional).
//
// O IA Service NÃO lê a config do agente do IA Command (bancos desacoplados,
// decisão da Etapa 1) — usa sua própria config (agente_local_config,
// fontes_historicas), mas fala o mesmo protocolo HTTP com o mesmo agente já
// instalado no servidor do cliente (é o mesmo processo Python do lado de lá).
//
// 2026-09: nunca cadastra/reenvia credencial de conexão SQL Server para o
// agente (isso já foi removido — connection_key aponta para uma conexão
// cadastrada MANUALMENTE no Agente Local, mesmo padrão do IA Command,
// connection-factory.js) — este módulo só executa SELECT (POST /execute)
// contra uma connection_key que já existe do lado do agente.

const https = require('https');
const http = require('http');
const { encryptPayload, decryptPayload, isEncryptedEnvelope } = require('./crypto-envelope');

const REQUEST_TIMEOUT_MS = 240000; // mesma janela usada pelo IA Command — queries pesadas no ERP

const _httpAgent = new http.Agent({ keepAlive: false });
const _httpsAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

function _request(url, method, body, token) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const _resolve = (v) => { if (!settled) { settled = true; resolve(v); } };
    const _reject = (e) => { if (!settled) { settled = true; reject(e); } };

    let parsed;
    try { parsed = new URL(url); } catch (_) { return _reject(new Error('URL do agente inválida.')); }

    const isHttps = parsed.protocol === 'https:';
    const payload = body ? JSON.stringify(body) : null;

    const req = (isHttps ? https : http).request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || ''}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      rejectUnauthorized: false,
      agent: isHttps ? _httpsAgent : _httpAgent,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 401) return _reject(new Error('Token do agente inválido ou não autorizado (HTTP 401).'));
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = `Agente retornou HTTP ${res.statusCode}`;
          try { msg = JSON.parse(data)?.detail || JSON.parse(data)?.error || msg; } catch (_) {}
          return _reject(new Error(msg));
        }
        try { _resolve(JSON.parse(data)); } catch (_) { _reject(new Error('Resposta do agente não é JSON válido.')); }
      });
    });

    req.on('error', (err) => _reject(new Error(`Falha ao conectar ao agente: ${err.message}`)));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.destroy(); _reject(new Error(`Timeout ao chamar o agente (${REQUEST_TIMEOUT_MS / 1000}s).`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Testa o /health (mesmo endpoint /apicommand usado pelo IA Command).
 */
async function testarAgente(url, token) {
  const parsed = new URL('/apicommand', url);
  await _request(parsed.toString(), 'GET', null, token);
  return true;
}

/**
 * Lista as conexões já cadastradas no Agente Local (GET /api/conexoes-listar,
 * autenticado pelo mesmo Bearer Token de /execute — 2026-09) — usado pela
 * tela de Fontes Históricas para o usuário ESCOLHER a connection_key num
 * dropdown em vez de digitar de cor, evitando digitar um nome diferente do
 * que está de fato cadastrado no agente (causa real de fonte "configurada"
 * mas nunca funcionar). Nunca retorna senha — o agente já mascara isso.
 */
async function listarConexoes(url, token, { empresaId } = {}) {
  const parsed = new URL('/api/conexoes-listar', url);
  if (empresaId) parsed.searchParams.set('empresa_id', String(empresaId));
  return _request(parsed.toString(), 'GET', null, token);
}

/**
 * Executa um SELECT via /execute. `params` são substituídos como @chave no
 * SQL antes do envio (mesmo padrão do ApiProxyProvider) — nunca concatenação
 * direta de string do chamador dentro desta função.
 */
function _resolverParams(sql, params) {
  let result = sql;
  for (const [key, value] of Object.entries(params || {})) {
    const placeholder = `@${key}`;
    let safe;
    if (value === null || value === undefined) safe = 'NULL';
    else if (typeof value === 'number') safe = String(value);
    else safe = `'${String(value).replace(/'/g, "''")}'`;
    result = result.replaceAll(placeholder, safe);
  }
  return result;
}

async function executarSelect(url, token, { sql, params, limit, connectionKey, cryptoAtivo, cryptoKey, empresaId }) {
  const sqlFinal = _resolverParams(sql, params);
  const requestId = require('crypto').randomUUID();
  const plainBody = {
    sql: sqlFinal,
    limit: Math.min(limit || 1000, 50000),
    uuid: requestId,
    connection_key: connectionKey,
    empresa_id: String(empresaId || ''),
    modulo: 'ia-service-historico',
    request_id: requestId,
    iat: Date.now(),
  };

  let body = plainBody;
  if (cryptoAtivo) {
    if (!cryptoKey) throw new Error('Criptografia do Agente Local ativa, mas a chave AES-256-GCM não está configurada.');
    body = encryptPayload(plainBody, cryptoKey, { kid: String(empresaId || 'default') });
  }

  const parsed = new URL('/execute', url);
  const resposta = await _request(parsed.toString(), 'POST', body, token);

  let data = resposta;
  if (cryptoAtivo) {
    if (!isEncryptedEnvelope(resposta)) throw new Error('Agente Local retornou resposta não criptografada com criptografia ativa.');
    data = decryptPayload(resposta, cryptoKey);
  } else if (isEncryptedEnvelope(resposta)) {
    throw new Error('Agente Local retornou resposta criptografada, mas a criptografia está inativa nesta fonte.');
  }

  if (data?.status === 'erro' || data?.ok === false) {
    const mensagem = data.erro || data.error || data.detail || 'Agente Local retornou erro ao executar o SELECT.';
    const origem = data.origem_conexao ? ` Origem da conexao: ${data.origem_conexao}.` : '';
    throw new Error(`${mensagem}${origem}`);
  }

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  throw new Error('Resposta do agente não contém "rows". Verifique o endpoint/connection_key configurados.');
}

module.exports = { testarAgente, listarConexoes, executarSelect };
