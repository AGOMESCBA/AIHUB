// Cliente HTTP do Agente Local — reaproveita o MESMO protocolo já validado
// pelo apps/IA Command/modules/erp/providers/ApiProxyProvider.js (POST /execute,
// SELECT-only, envelope AES-GCM opcional) e pela rota de sincronização de
// conexões (apps/IA Command/cloud_extension/agente-local-routes.js,
// POST /api/empresas/sync grava em `conexoes_dados` do agente Python).
//
// O IA Service NÃO lê a config do agente do IA Command (bancos desacoplados,
// decisão da Etapa 1) — usa sua própria config (agente_local_config,
// fontes_historicas), mas fala o mesmo protocolo HTTP com o mesmo agente já
// instalado no servidor do cliente (é o mesmo processo Python do lado de lá).

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
 * Registra/atualiza uma connection_key no agente (POST /api/empresas/sync),
 * incluindo a conexão SQL Server sob `conexao_erp` no payload — mesmo formato
 * que agente-local-routes.js do IA Command já usa e que o agente Python já
 * sabe persistir em `conexoes_dados` (empresa_id, connection_key, sistema_origem).
 */
async function sincronizarFonte(url, token, { empresaId, empresaNome, fonte, senhaPlana }) {
  const payload = {
    empresas: [{
      empresa_id: empresaId,
      nome: empresaNome || `Empresa #${empresaId}`,
      conexao_erp: {
        connection_key: fonte.connectionKey,
        sistema_origem: fonte.sistemaOrigem,
        nome: fonte.nome,
        db_host: fonte.dbHost,
        db_port: fonte.dbPort ? String(fonte.dbPort) : '1433',
        db_name: fonte.dbName || '',
        db_user: fonte.dbUser || '',
        db_pass: senhaPlana || '', // trafega em claro só neste payload (HTTPS+token); o agente critografa ao persistir
        db_driver: fonte.dbDriver || 'ODBC Driver 17 for SQL Server',
      },
    }],
  };
  const parsed = new URL('/api/empresas/sync', url);
  return _request(parsed.toString(), 'POST', payload, token);
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

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  throw new Error('Resposta do agente não contém "rows". Verifique o endpoint/connection_key configurados.');
}

module.exports = { testarAgente, sincronizarFonte, executarSelect };
