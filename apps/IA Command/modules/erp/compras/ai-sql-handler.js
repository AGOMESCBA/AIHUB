'use strict';

const https = require('https');
const connectionFactory = require('../providers/connection-factory');
const schema = require('./compras-schema');
const crud = require('../../database/crud');

// ── Configuração de providers ────────────────────────────────────────────────

const PROVIDER_CONFIGS = {
  groq: {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    tipo: 'openai_compat',
  },
  deepseek: {
    hostname: 'api.deepseek.com',
    path: '/v1/chat/completions',
    model: 'deepseek-chat',
    tipo: 'openai_compat',
  },
  openai: {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    model: 'gpt-4o-mini',
    tipo: 'openai_compat',
  },
  claude: {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    tipo: 'anthropic',
  },
  gemini: {
    hostname: 'generativelanguage.googleapis.com',
    path: null, // montado dinamicamente
    model: 'gemini-1.5-flash',
    tipo: 'gemini',
  },
};

const DEFAULT_ORDER = ['groq', 'gemini', 'deepseek', 'claude', 'openai'];

// ── Chamada HTTP genérica ────────────────────────────────────────────────────

function _httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname,
      path,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            const msg = parsed.error?.message || parsed.error?.error?.message || JSON.stringify(parsed.error);
            return reject(new Error(msg));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Resposta inválida do provider: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('Timeout de 30s excedido.')));
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Chamadas por provider ────────────────────────────────────────────────────

async function _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, opts = {}) {
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
    max_tokens: opts.maxTokens || 2000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const parsed = await _httpPost(cfg.hostname, cfg.path, { Authorization: `Bearer ${apiKey}` }, body);
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new Error('Resposta vazia do provider.');
  return content.trim();
}

async function _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, opts = {}) {
  const body = {
    model: cfg.model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: opts.maxTokens || 2000,
    temperature: 0,
  };
  const parsed = await _httpPost(cfg.hostname, cfg.path, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body);
  const content = parsed.content?.[0]?.text;
  if (!content) throw new Error('Resposta vazia do Anthropic.');
  return content.trim();
}

async function _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, opts = {}) {
  const path = `/v1beta/models/${cfg.model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: opts.maxTokens || 2000 },
  };
  const parsed = await _httpPost(cfg.hostname, path, {}, body);
  const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Resposta vazia do Gemini.');
  return content.trim();
}

async function _chamarProvedor(provedor, apiKey, systemPrompt, userPrompt, opts = {}) {
  const cfg = PROVIDER_CONFIGS[provedor];
  if (!cfg) throw new Error(`Provider desconhecido: ${provedor}`);
  if (cfg.tipo === 'openai_compat') return _chamarOpenAICompat(cfg, apiKey, systemPrompt, userPrompt, opts);
  if (cfg.tipo === 'anthropic')    return _chamarAnthropic(cfg, apiKey, systemPrompt, userPrompt, opts);
  if (cfg.tipo === 'gemini')       return _chamarGemini(cfg, apiKey, systemPrompt, userPrompt, opts);
  throw new Error(`Tipo de provider não suportado: ${cfg.tipo}`);
}

// ── Resolução de chaves e ordem (reutiliza lógica do intent-service) ─────────

async function _resolverKeysEOrdem(empresaId) {
  const intentService = require('../../ai/intent-service');
  return intentService._resolveKeys(empresaId);
}

function _normalizarOrdem(cfg = {}) {
  const intentService = require('../../ai/intent-service');
  return intentService._normalizarOrdem(cfg);
}

// ── Chamada com fallback entre providers ─────────────────────────────────────

async function _chamarIA(keys, cfg, systemPrompt, userPrompt, opts = {}) {
  const ordem = _normalizarOrdem(cfg);
  const erros = [];

  for (const provedor of ordem) {
    if (!keys[provedor]) continue;
    try {
      return await _chamarProvedor(provedor, keys[provedor], systemPrompt, userPrompt, opts);
    } catch (e) {
      erros.push({ provedor, msg: e.message });
      console.warn(`[ComprasAI] ${provedor} falhou:`, e.message);
    }
  }

  const cotaEsgotada = erros.length > 0 && erros.every(e =>
    /quota|rate.?limit|free_tier|exceeded|429/i.test(e.msg)
  );
  const semChave = erros.length === 0;

  throw Object.assign(
    new Error(erros.map(e => `${e.provedor}: ${e.msg}`).join(' | ') || 'Nenhum provider disponível'),
    { _cotaEsgotada: cotaEsgotada, _semChave: semChave }
  );
}

// ── Extração e validação do SQL ──────────────────────────────────────────────

function _extrairSQL(resposta) {
  // Tenta JSON: { "sql": "..." }
  try {
    const obj = JSON.parse(resposta);
    if (obj.sql && typeof obj.sql === 'string') return obj.sql.trim();
  } catch (_) {}

  // Tenta bloco markdown ```sql ... ```
  const mdMatch = resposta.match(/```sql\s*([\s\S]+?)```/i);
  if (mdMatch) return mdMatch[1].trim();

  // Tenta bloco genérico ``` ... ```
  const genericMatch = resposta.match(/```\s*(SET\s+ROWCOUNT[\s\S]+?)```/i);
  if (genericMatch) return genericMatch[1].trim();

  // Tenta encontrar SET ROWCOUNT ou SELECT direto
  const directMatch = resposta.match(/(SET\s+ROWCOUNT[\s\S]+?;?\s*SELECT[\s\S]+)/i)
    || resposta.match(/(SELECT[\s\S]+)/i);
  if (directMatch) return directMatch[1].trim();

  return null;
}

const BANNED_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'EXEC', 'EXECUTE', 'XP_', 'SP_EXECUTESQL'];

function _validarSQL(sql) {
  if (!sql) return false;
  const upper = sql.replace(/\/\*[\s\S]*?\*\//g, '').toUpperCase();
  // Deve conter SELECT
  if (!/SELECT\s/i.test(upper)) return false;
  // Não deve conter comandos perigosos
  if (BANNED_KEYWORDS.some(k => new RegExp(`\\b${k}\\b`).test(upper))) return false;
  return true;
}

// ── Formatação fallback (sem IA) ─────────────────────────────────────────────

function _formatarFallback(rows, mensagem) {
  if (!rows || rows.length === 0) {
    return 'Não encontrei registros para essa consulta no período informado.';
  }

  const BRL = (v) => {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const NUM = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  const isMonetario = (k) => /valor|total|preco|custo|vlr|vl_/i.test(k);
  const isNumerico  = (k, v) => !isNaN(parseFloat(v)) && !/(cod|filial|doc|serie|data|dt_)/i.test(k);

  const linhas = rows.slice(0, 20).map((row, i) => {
    const partes = Object.entries(row)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => {
        if (isMonetario(k)) return `${k}: *${BRL(v)}*`;
        if (isNumerico(k, v)) return `${k}: *${NUM(v)}*`;
        return `${k}: ${v}`;
      });
    return `${i + 1}. ${partes.join(' | ')}`;
  });

  const sufixo = rows.length > 20 ? `\n\n_...e mais ${rows.length - 20} registros._` : '';
  return `📦 *Resultado — Compras*\n\n${linhas.join('\n')}${sufixo}`;
}

// ── Mensagens de erro amigáveis ──────────────────────────────────────────────

function _mensagemErro(tipo) {
  const msgs = {
    cota_esgotada:   'Estou com muitas consultas agora. Tente novamente em alguns instantes.',
    ia_indisponivel: 'Não consigo processar sua consulta no momento. Tente novamente em breve.',
    sql_invalido:    'Não consegui interpretar sua pergunta para buscar os dados. Pode reformular de outra forma?',
    sem_resultado:   'Não encontrei registros para essa consulta no período informado.',
    erro_erp:        'Não consegui buscar essa informação no sistema. Tente um período menor ou filtros mais específicos.',
    sem_conexao:     'Esta empresa não possui uma conexão com o ERP configurada. Solicite ao administrador.',
  };
  return msgs[tipo] || 'Não consegui responder sua consulta agora. Tente novamente em instantes.';
}

// ── Auto-registro da intenção por empresa ────────────────────────────────────

function _garantirIntencao(empresaId) {
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    const existe = db.prepare(
      "SELECT id FROM intentions WHERE empresa_id = ? AND nome = 'compras_dinamico' LIMIT 1"
    ).get(empresaId);

    if (!existe) {
      crud.criar('intentions', {
        empresa_id:     empresaId,
        nome:           'compras_dinamico',
        descricao:      'Consultas dinâmicas de compras via IA (Text-to-SQL Protheus)',
        modulo:         'compras',
        acao:           'ai_text_to_sql',
        dataset_id:     null,
        frases_exemplo: [
          'quanto comprei no mês',
          'compras do período',
          'top fornecedores',
          'nf de entrada',
          'entradas do período',
          'compras por produto',
          'compras por grupo de produto',
          'valor das compras',
          'pedidos de compra',
          'ordem de compra',
          'compras por filial',
        ].join('\n'),
        ativo: 1,
      });
      const { invalidateCache } = require('../../ai/intent-service');
      invalidateCache(empresaId);
      console.log(`[ComprasAI] Intenção compras_dinamico auto-criada para empresa #${empresaId}`);
    }
  } catch (e) {
    console.warn(`[ComprasAI] Falha ao garantir intenção para empresa #${empresaId}:`, e.message);
  }
}

// ── Sufixo da tabela por empresa ─────────────────────────────────────────────

function _sufixoTabela(empresaId) {
  try {
    const { getDB } = require('../../database');
    const row = getDB().prepare(
      "SELECT configuracoes FROM connections WHERE empresa_id = ? AND ativo = 1 LIMIT 1"
    ).get(empresaId);
    const cfg = row?.configuracoes ? JSON.parse(row.configuracoes) : {};
    return cfg.sufixo_tabela || '010';
  } catch (_) {
    return '010';
  }
}

// ── Handler principal ────────────────────────────────────────────────────────

async function executar(intent, empresaId) {
  _garantirIntencao(empresaId);

  // Resolve chaves e config da IA para esta empresa
  let keys, cfg;
  try {
    ({ keys, cfg } = await _resolverKeysEOrdem(empresaId));
  } catch (e) {
    console.error('[ComprasAI] Falha ao resolver chaves:', e.message);
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: _mensagemErro('ia_indisponivel') };
  }

  const temIA = Object.values(keys).some(Boolean);
  if (!temIA) {
    return { tipo: 'erro', subtipo: 'sem_chave', resposta_direta: _mensagemErro('ia_indisponivel') };
  }

  // Monta contexto para o prompt
  const sufixo = _sufixoTabela(empresaId);
  const contexto = {
    sufixoTabela: sufixo,
    periodo: intent.periodo || null,
    filtros: intent.filtros || {},
    filial:  intent.filtros?.filial || null,
  };

  const mensagem = intent._mensagemOriginal || intent.intencao || 'consulta de compras';

  // ── Passo 1: Gerar SQL ───────────────────────────────────────────────────────
  let sql;
  try {
    const systemSql = schema.buildSqlSystemPrompt();
    const userSql   = schema.buildSqlUserPrompt(mensagem, contexto);
    const respostaSql = await _chamarIA(keys, cfg, systemSql, userSql, { json: true, maxTokens: 2000 });
    sql = _extrairSQL(respostaSql);
    console.log(`[ComprasAI] SQL gerado (empresa #${empresaId}):`, sql?.slice(0, 200));
  } catch (e) {
    const tipo = e._cotaEsgotada ? 'cota_esgotada' : 'ia_indisponivel';
    console.error('[ComprasAI] Falha na geração de SQL:', e.message);
    return { tipo: 'erro', subtipo: tipo, resposta_direta: _mensagemErro(tipo) };
  }

  if (!sql || !_validarSQL(sql)) {
    console.warn('[ComprasAI] SQL inválido ou inseguro, descartado.');
    return { tipo: 'erro', subtipo: 'sql_invalido', resposta_direta: _mensagemErro('sql_invalido') };
  }

  // ── Passo 2: Executar SQL no ERP ─────────────────────────────────────────────
  let rows;
  try {
    const conn = connectionFactory.carregarConexao(empresaId);
    rows = await connectionFactory.executar(conn, sql, {});
  } catch (e) {
    const semConexao = /nenhuma conex|no connection|connect/i.test(e.message);
    console.error('[ComprasAI] Falha ao executar SQL no ERP:', e.message);
    return {
      tipo: 'erro',
      subtipo: semConexao ? 'sem_conexao' : 'erro_erp',
      resposta_direta: _mensagemErro(semConexao ? 'sem_conexao' : 'erro_erp'),
    };
  }

  if (!rows || rows.length === 0) {
    return { tipo: 'sucesso_ai_sql', resposta_direta: _mensagemErro('sem_resultado'), rows: [] };
  }

  // ── Passo 3: Formatar resposta com IA ────────────────────────────────────────
  let resposta;
  try {
    const systemFmt = schema.buildFormatSystemPrompt();
    const userFmt   = schema.buildFormatUserPrompt(mensagem, rows);
    resposta = await _chamarIA(keys, cfg, systemFmt, userFmt, { json: false, maxTokens: 1500 });
  } catch (e) {
    console.warn('[ComprasAI] IA de formatação falhou, usando fallback:', e.message);
    resposta = _formatarFallback(rows, mensagem);
  }

  return { tipo: 'sucesso_ai_sql', resposta_direta: resposta, rows };
}

module.exports = { executar };
