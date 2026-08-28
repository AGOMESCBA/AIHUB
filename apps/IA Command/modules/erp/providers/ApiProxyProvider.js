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
const {
  decryptPayload,
  encryptPayload,
  isEncryptedEnvelope,
} = require('../../security/aes-gcm-envelope');

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

// keepAlive:false — desde o Node 19 o agent global reutiliza conexoes TCP por padrao.
// Esses agentes rodam por horas contra o mesmo host (agente local do cliente, atras de
// NAT/firewall que pode derrubar conexoes ociosas sem enviar FIN/RST). Reaproveitar um
// socket assim faz o Node herdar o timer de inatividade da conexao antiga: observado em
// producao um "timeout de 240s" disparando em ~5s porque o socket reciclado ja estava
// silencioso ha ~235s de uma chamada anterior. Forcar conexao nova a cada chamada evita
// esse socket "zumbi" — o custo de handshake TCP extra e desprezivel frente ao tempo de
// uma query SQL no ERP.
const _httpAgent  = new http.Agent({ keepAlive: false });
const _httpsAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

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
      agent: isHttps ? _httpsAgent : _httpAgent,
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
          if (res.statusCode === 426 && /^Agente retornou HTTP 426$/i.test(msg)) {
            msg = 'Agente Local recusou a execucao (HTTP 426): criptografia obrigatoria no agente, mas a conexao do IA Command esta sem criptografia ativa.';
          }
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

function _aplicarTopPadraoSqlServer(sql, limite) {
  const n = Math.min(Math.max(Number(limite) || 10000, 1), 50000);
  const texto = String(sql || '');
  if (/\bOFFSET\b[\s\S]*\bFETCH\s+NEXT\b/i.test(texto)) return texto;
  const corrigido = texto.replace(/\bSELECT\s+TOP\s+(\(?\d+\)?)\s+DISTINCT\b/i, 'SELECT DISTINCT TOP $1');
  if (corrigido !== texto) return corrigido;
  if (/\bSELECT\s+(?:DISTINCT\s+)?TOP\s+\(?\d+\)?\b/i.test(texto)) return texto;

  return texto.replace(/\bSELECT\s+DISTINCT\b/i, `SELECT DISTINCT TOP ${n}`);
}

function _normalizarLimiteRanking(valor) {
  if (Number.isFinite(Number(valor))) return parseInt(valor, 10);
  const texto = String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mapa = {
    um: 1, uma: 1,
    dois: 2, duas: 2,
    tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
  };
  return mapa[texto.replace(/\s+/g, '')] || null;
}

function _limiteRankingDaPergunta(pergunta) {
  const texto = String(pergunta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const quantidade = '(\\d{1,4}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte)';
  const m = texto.match(new RegExp(`\\b(?:top\\s*|maior(?:es)?\\s+|menor(?:es)?\\s+|primeir[oa]s?\\s+|ultim[oa]s?\\s+)${quantidade}\\b`, 'i'))
    || texto.match(new RegExp(`\\b${quantidade}\\s+(?:maior(?:es)?|menor(?:es)?|primeir[oa]s?|ultim[oa]s?|clientes?|produtos?|fornecedores?|vendedores?)\\b`, 'i'));
  return m ? _normalizarLimiteRanking(m[1]) : null;
}

function _aplicarTopRankingSqlServer(sql, limiteRanking) {
  const n = _normalizarLimiteRanking(limiteRanking);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return sql;
  const texto = String(sql || '');
  if (/\bOFFSET\b[\s\S]*?\bFETCH\s+NEXT\b/i.test(texto)) return texto;
  const semSet = texto.replace(/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i, '');
  const prefixo = texto.slice(0, texto.length - semSet.length);
  if (/^\s*WITH\b/i.test(semSet)) return texto;
  if (/^\s*SELECT\s+DISTINCT\s+TOP\s+\(?\d+\)?\b/i.test(semSet)) {
    return prefixo + semSet.replace(/^\s*SELECT\s+DISTINCT\s+TOP\s+\(?\d+\)?\b/i, `SELECT DISTINCT TOP ${n}`);
  }
  if (/^\s*SELECT\s+TOP\s+\(?\d+\)?\b/i.test(semSet)) {
    return prefixo + semSet.replace(/^\s*SELECT\s+TOP\s+\(?\d+\)?\b/i, `SELECT TOP ${n}`);
  }
  if (/^\s*SELECT\s+DISTINCT\b/i.test(semSet)) {
    return prefixo + semSet.replace(/^\s*SELECT\s+DISTINCT\b/i, `SELECT DISTINCT TOP ${n}`);
  }
  return prefixo + semSet.replace(/^\s*SELECT\b/i, `SELECT TOP ${n}`);
}

async function executar(conn, query, params = {}) {
  const apiKey   = conn.password;
  const url      = _buildUrl(conn, '/execute');
  const cryptoAtivo = conn.crypto_ativo === true || conn.crypto_ativo === 1;

  const limit = Math.min(conn.limite_max || 10000, 50000);
  const sqlComRanking = _aplicarTopRankingSqlServer(
    _resolverParams(query, params),
    _limiteRankingDaPergunta(conn._pergunta)
  );
  const sqlFinal = _aplicarTopPadraoSqlServer(sqlComRanking, limit);
  const requestId = crypto.randomUUID();
  const plainBody = {
    sql:        sqlFinal,
    limit,
    uuid:       requestId,
    modulo:     conn._modulo      || '',
    operacao:   conn._operacao    || '',
    pergunta:   conn._pergunta    || '',
    sender:     conn._sender      || '',
    usuario:    conn._usuario     || '',
    empresa_id: conn._empresa_id  || '',
    dataset_id: conn._dataset_id || '',
    connection_id: conn._connection_id || '',
    connection_key: conn._connection_key || '',
    connection_nome: conn._connection_nome || '',
    sistema_origem: conn._connection_erp || '',
    iat:        Date.now(),
    request_id: requestId,
  };

  let body = plainBody;
  if (cryptoAtivo) {
    if (!conn.crypto_key) {
      _logProxy('ERRO', 'crypto_chave_ausente', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId });
      throw new Error('Criptografia do Agente Local ativa, mas a chave AES-256-GCM nao esta configurada.');
    }
    try {
      body = encryptPayload(plainBody, conn.crypto_key, { kid: String(conn._empresa_id || 'default') });
      _logProxy('INFO', 'crypto_request_envelope_gerado', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId });
    } catch (err) {
      _logProxy('ERRO', 'crypto_request_falha', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId, erro: err.message });
      throw err;
    }
  }

  const resposta = await _request(url, 'POST', body, apiKey);
  let data = resposta;

  if (cryptoAtivo) {
    if (!isEncryptedEnvelope(resposta)) {
      _logProxy('ERRO', 'crypto_resposta_em_claro_ou_invalida', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId });
      throw new Error('Agente Local retornou resposta nao criptografada com criptografia ativa.');
    }
    try {
      data = decryptPayload(resposta, conn.crypto_key);
      _logProxy('INFO', 'crypto_resposta_descriptografada', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId });
    } catch (err) {
      _logProxy('ERRO', 'crypto_resposta_falha_descriptografia', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId, erro: err.message });
      throw new Error('Falha ao descriptografar resposta do Agente Local.');
    }
  } else if (isEncryptedEnvelope(resposta)) {
    _logProxy('WARN', 'crypto_resposta_criptografada_com_modo_inativo', { url, empresa_id: conn._empresa_id || null, modulo: conn._modulo || null, request_id: requestId });
    throw new Error('Agente Local retornou resposta criptografada, mas a criptografia esta inativa no IA Command.');
  }

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

module.exports = { executar, testar, fechar, _test: { _aplicarTopPadraoSqlServer, _aplicarTopRankingSqlServer, _limiteRankingDaPergunta } };
