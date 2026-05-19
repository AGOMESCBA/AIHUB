const groqProvider   = require('./providers/groq');
const geminiProvider = require('./providers/gemini');
const deepseekProvider = require('./providers/deepseek');
const claudeProvider = require('./providers/claude');
const validator      = require('./schema-validator');
const localResolver  = require('./local-intent-resolver');
const { extrairRegrasNormalizacao } = require('./text-normalizer');
const crud           = require('../database/crud');

const PROVIDERS = {
  groq: groqProvider,
  gemini: geminiProvider,
  deepseek: deepseekProvider,
  claude: claudeProvider,
};

const DEFAULT_ORDER = ['groq', 'gemini', 'deepseek', 'claude'];
const CACHE_TTL_MS = 5 * 60 * 1000;
const CLASSIFICATION_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CLASSIFICATION_CACHE = 300;

const _cache = {
  keys: new Map(),
  intencoes: new Map(),
  sinonimos: new Map(),
  datasets: new Map(),
  classificacoes: new Map(),
};

function _cacheGet(map, key) {
  const k = String(key);
  const item = map.get(k);
  if (!item || item.expiraEm < Date.now()) {
    if (item) map.delete(k);
    return null;
  }
  return item.valor;
}

function _cacheSet(map, key, valor, ttl = CACHE_TTL_MS) {
  map.set(String(key), { valor, expiraEm: Date.now() + ttl });
  return valor;
}

function _clone(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function _classificationKey(empresaId, mensagem) {
  return `${empresaId}:${localResolver.normalizarTexto(mensagem)}`;
}

function _cacheClassification(key, intent) {
  _cacheSet(_cache.classificacoes, key, intent, CLASSIFICATION_CACHE_TTL_MS);
  if (_cache.classificacoes.size > MAX_CLASSIFICATION_CACHE) {
    const firstKey = _cache.classificacoes.keys().next().value;
    if (firstKey) _cache.classificacoes.delete(firstKey);
  }
}

function invalidateCache(empresaId = null) {
  if (empresaId == null) {
    Object.values(_cache).forEach(map => map.clear());
    return;
  }
  const prefix = `${empresaId}:`;
  _cache.keys.delete(String(empresaId));
  _cache.intencoes.delete(String(empresaId));
  _cache.sinonimos.delete(String(empresaId));
  _cache.datasets.delete(String(empresaId));
  for (const key of _cache.classificacoes.keys()) {
    if (key.startsWith(prefix)) _cache.classificacoes.delete(key);
  }
}

// Resolves API keys: IA Command SQLite config → IAHub configuracoes → env
async function _resolveKeys(empresaId) {
  const cached = _cacheGet(_cache.keys, empresaId);
  if (cached) return _clone(cached);

  const keys = { groq: null, gemini: null, deepseek: null, claude: null };
  let cfg = {};

  // 1. IA Command own config (SQLite)
  try {
    const { getDB } = require('../database');
    const db  = getDB();
    const row = db.prepare(`
      SELECT groq_api_key, gemini_api_key, deepseek_api_key, claude_api_key, provedor_primario, fallback_ordem, confianca_minima
      FROM ai_config
      WHERE empresa_id = ?
      LIMIT 1
    `).get(empresaId);
    cfg = row || {};
    if (row?.groq_api_key)   keys.groq   = row.groq_api_key;
    if (row?.gemini_api_key) keys.gemini = row.gemini_api_key;
    if (row?.deepseek_api_key) keys.deepseek = row.deepseek_api_key;
    if (row?.claude_api_key) keys.claude = row.claude_api_key;
  } catch (_) {}

  // 2. IAHub configuracoes (fallback)
  if (!keys.groq) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.groq = await getApiKey(empresaId, 'groq_api_key');
    } catch (_) {}
  }
  if (!keys.gemini) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.gemini = await getApiKey(empresaId, 'gemini_api_key');
    } catch (_) {}
  }
  if (!keys.deepseek) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.deepseek = await getApiKey(empresaId, 'deepseek_api_key');
    } catch (_) {}
  }
  if (!keys.claude) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.claude = await getApiKey(empresaId, 'claude_api_key');
    } catch (_) {}
  }

  // 3. Environment variables
  if (!keys.groq)   keys.groq   = process.env.GROQ_API_KEY  || null;
  if (!keys.gemini) keys.gemini = process.env.GEMINI_API_KEY || null;
  if (!keys.deepseek) keys.deepseek = process.env.DEEPSEEK_API_KEY || null;
  if (!keys.claude) keys.claude = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || null;

  // 4. Fallback global: se a empresa_id do canal não tem chave própria, usa qualquer config disponível
  if (!keys.groq && !keys.gemini && !keys.deepseek && !keys.claude) {
    try {
      const { getDB } = require('../database');
      const anyRow = getDB().prepare('SELECT * FROM ai_config LIMIT 1').get();
      if (anyRow) {
        if (anyRow.groq_api_key)     keys.groq     = anyRow.groq_api_key;
        if (anyRow.gemini_api_key)   keys.gemini   = anyRow.gemini_api_key;
        if (anyRow.deepseek_api_key) keys.deepseek = anyRow.deepseek_api_key;
        if (anyRow.claude_api_key)   keys.claude   = anyRow.claude_api_key;
        if (!cfg.provedor_primario)  cfg = anyRow;
        console.log(`[IA] Fallback: usando ai_config da empresa #${anyRow.empresa_id} para classificar empresa #${empresaId}`);
      }
    } catch (_) {}
  }

  return _clone(_cacheSet(_cache.keys, empresaId, { keys, cfg }));
}

function _normalizarOrdem(cfg = {}) {
  const ordem = String(cfg.fallback_ordem || '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => PROVIDERS[p]);
  const base = ordem.length ? ordem : DEFAULT_ORDER;
  const primario = String(cfg.provedor_primario || '').trim().toLowerCase();
  const final = primario && PROVIDERS[primario]
    ? [primario, ...base.filter(p => p !== primario)]
    : base;
  return [...new Set(final)];
}

// Carrega intenções ativas do banco para a empresa e monta lista de nomes válidos
function _carregarIntencoes(empresaId) {
  const cached = _cacheGet(_cache.intencoes, empresaId);
  if (cached) return _clone(cached);

  try {
    const rows = crud.listar('intentions', { empresa_id: empresaId, ativo: 1 });
    const intencoes = rows.map(r => ({
      nome:            r.nome,
      descricao:       r.descricao   || '',
      frases_exemplo:  r.frases_exemplo || '',
      dataset_id:      r.dataset_id || null,
      modulo:          r.modulo || null,
      acao:            r.acao || null,
    }));
    return _clone(_cacheSet(_cache.intencoes, empresaId, intencoes));
  } catch (_) {
    return [];
  }
}

function _carregarDatasets(empresaId) {
  const cached = _cacheGet(_cache.datasets, empresaId);
  if (cached) return _clone(cached);

  try {
    const rows = crud.listar('datasets', { empresa_id: empresaId });
    const datasets = rows.map(r => ({
      id: r.id,
      nome: r.nome,
      campo_data: r.campo_data || 'data',
      colunas_metrica: r.colunas_metrica || '',
    }));
    return _clone(_cacheSet(_cache.datasets, empresaId, datasets));
  } catch (_) {
    return [];
  }
}

// Sinônimos padrão de fábrica — sempre injetados, sem necessidade de cadastro
const _SINONIMOS_SISTEMA = [
  // ── INTENÇÃO: Faturamento ──────────────────────────────────────────────────
  { termo: 'faturamento',            camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'faturado',               camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'vendas',                 camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'venda',                  camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'receita',                camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'movimento',              camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'notas',                  camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'NF',                     camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'nfe',                    camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'nf-e',                   camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'nota fiscal',            camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'saída',                  camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'saidas',                 camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'saídas',                 camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'emissão',                camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'emissao',                camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'fat',                    camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'resultado vendas',       camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'vendas realizadas',      camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'pedidos faturados',      camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  // ── INTENÇÃO: Compras ─────────────────────────────────────────────────────
  { termo: 'compras',                camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'fornecedores',           camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'entradas',               camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'entrada',                camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'recebimento',            camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'nf entrada',             camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'nota entrada',           camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'ordem de compra',        camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'pedido de compra',       camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  { termo: 'oc',                     camada: 'intencao', equivalencia: 'compras',        origem: 'sistema' },
  // ── INTENÇÃO: Contas a Pagar ──────────────────────────────────────────────
  { termo: 'contas a pagar',         camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'cap',                    camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'a pagar',                camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'vencimentos',            camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'duplicatas pagar',       camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'titulos pagar',          camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'títulos a pagar',        camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'boletos',                camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'obrigacoes',             camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  { termo: 'obrigações',             camada: 'intencao', equivalencia: 'contas_pagar',   origem: 'sistema' },
  // ── INTENÇÃO: Contas a Receber ────────────────────────────────────────────
  { termo: 'contas a receber',       camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'car',                    camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'a receber',              camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'duplicatas receber',     camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'titulos receber',        camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'cobranças',              camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'cobrancas',              camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'inadimplência',          camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'inadimplencia',          camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  { termo: 'inadimplentes',          camada: 'intencao', equivalencia: 'contas_receber', origem: 'sistema' },
  // ── INTENÇÃO: Fluxo de Caixa ──────────────────────────────────────────────
  { termo: 'fluxo de caixa',         camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'caixa',                  camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'fc',                     camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'saldo caixa',            camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'posicao caixa',          camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'posição caixa',          camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'movimentacao financeira',camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  { termo: 'movimentação financeira',camada: 'intencao', equivalencia: 'fluxo_caixa',    origem: 'sistema' },
  // ── COLUNA: Quantidade ────────────────────────────────────────────────────
  { termo: 'volume',                 camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'qtde',                   camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'qtd',                    camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'qte',                    camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'qt',                     camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'unidades',               camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'peças',                  camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'pecas',                  camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'itens',                  camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'tonelada',               camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'toneladas',              camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'Tonelada',               camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'ton',                    camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'TON',                    camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'Ton',                    camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'tn',                     camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'kg',                     camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'quilos',                 camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'kilos',                  camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'litros',                 camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'metros',                 camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'caixas',                 camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  { termo: 'sacas',                  camada: 'coluna',   equivalencia: 'quantidade',     origem: 'sistema' },
  // ── COLUNA: Faturamento / Valor ───────────────────────────────────────────
  { termo: 'valor total',            camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'valor venda',            camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'vlr total',              camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'vlr venda',              camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'vl total',               camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'receita bruta',          camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'valor bruto',            camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'bruto',                  camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'receita total',          camada: 'coluna',   equivalencia: 'faturamento',    origem: 'sistema' },
  // ── COLUNA: Margem ────────────────────────────────────────────────────────
  { termo: 'margem',                 camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'mg',                     camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'markup',                 camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'mark-up',                camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'lucro',                  camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'rentabilidade',          camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'lucro bruto',            camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'margem bruta',           camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  { termo: 'resultado',              camada: 'coluna',   equivalencia: 'margem',         origem: 'sistema' },
  // ── COLUNA: Custo ─────────────────────────────────────────────────────────
  { termo: 'custo',                  camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'cto',                    camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'cme',                    camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'custo médio',            camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'custo medio',            camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'custo unitário',         camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'custo unitario',         camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'cmv',                    camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'custo mercadoria',       camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
  { termo: 'custo produto',          camada: 'coluna',   equivalencia: 'custo',          origem: 'sistema' },
];

// Carrega sinônimos da empresa e mescla com os padrões do sistema
function _carregarSinonimos(empresaId) {
  const cached = _cacheGet(_cache.sinonimos, empresaId);
  if (cached) return _clone(cached);

  try {
    const rows = crud.listar('synonyms', { empresa_id: empresaId, ativo: 1 });
    // Se a empresa já foi semeada (tem registros origem=sistema), usa o BD como autoritativo
    if (rows.some(r => r.origem === 'sistema')) return _clone(_cacheSet(_cache.sinonimos, empresaId, rows));
    // Fallback: empresa ainda não semeada, injeta hardcoded + registros do usuário
    return _clone(_cacheSet(_cache.sinonimos, empresaId, [..._SINONIMOS_SISTEMA, ...rows]));
  } catch (_) {
    return _clone(_cacheSet(_cache.sinonimos, empresaId, [..._SINONIMOS_SISTEMA]));
  }
}

function _simplificarErro(msg) {
  if (!msg) return { tipo: 'indisponivel', pt: 'indisponível' };
  const m = msg.toLowerCase();
  if (m.includes('quota') || m.includes('rate limit') || m.includes('free_tier') || m.includes('exceeded'))
    return { tipo: 'cota_esgotada', pt: 'cota esgotada' };
  if (m.includes('unauthorized') || m.includes('invalid key') || m.includes('authentication'))
    return { tipo: 'chave_invalida', pt: 'chave inválida' };
  if (m.includes('timeout') || m.includes('timed out'))
    return { tipo: 'timeout', pt: 'tempo esgotado' };
  if (m.includes('econnrefused') || m.includes('enotfound') || m.includes('network'))
    return { tipo: 'sem_conexao', pt: 'sem conexão' };
  return { tipo: 'indisponivel', pt: 'indisponível' };
}

async function classificar(mensagem, empresaId, opts = {}) {
  const { contextoAnterior = null } = opts;
  const usarCacheClassificacao = !contextoAnterior;
  const cacheKey = usarCacheClassificacao ? _classificationKey(empresaId, mensagem) : null;
  if (cacheKey) {
    const cached = _cacheGet(_cache.classificacoes, cacheKey);
    if (cached) return { ..._clone(cached), _cache: true };
  }

  const intencoes = _carregarIntencoes(empresaId);
  const sinonimos = _carregarSinonimos(empresaId);
  const normalizacoes = extrairRegrasNormalizacao(sinonimos);
  const datasets = _carregarDatasets(empresaId);

  if (!intencoes.length || !datasets.length) {
    console.log(`[IA classificar] empresaId=${empresaId} | intencoes=${intencoes.length} | datasets=${datasets.length} | sem configuracao minima`);
    return {
      intencao:            'desconhecido',
      periodo:             { tipo: 'nenhum' },
      filtros:             {},
      agrupar_por:         null,
      ordenar_por:         null,
      limite:              null,
      confianca:           0,
      precisa_confirmacao: false,
      origem:              'texto',
      _provedor:           'nenhum',
      _erro:               'Empresa sem intencoes e datasets configurados.',
      _erroTipo:           'sem_configuracao',
      _erros:              [],
    };
  }

  const { keys, cfg } = await _resolveKeys(empresaId);
  const nomesPermitidos = intencoes.map(i => i.nome).concat(['desconhecido']);
  const ordem = _normalizarOrdem(cfg);
  const confiancaMinima = Number(cfg.confianca_minima ?? 0.6) || 0.6;
  console.log(`[IA classificar] empresaId=${empresaId} | intencoes=${intencoes.length} | sinonimos=${sinonimos.length} | ordem=${ordem.join(',')} | keys: groq=${!!keys.groq} gemini=${!!keys.gemini} deepseek=${!!keys.deepseek} claude=${!!keys.claude}`);

  const local = localResolver.resolverLocal(mensagem, intencoes, sinonimos, { datasets, normalizacoes });
  if (local) {
    if (cacheKey) _cacheClassification(cacheKey, local);
    return local;
  }

  const _erros = [];
  for (const provedor of ordem) {
    if (!keys[provedor]) continue;
    try {
      const raw = await PROVIDERS[provedor].classificarIntencao(mensagem, keys[provedor], intencoes, sinonimos, contextoAnterior);
      const result = validator.validar(raw, nomesPermitidos);
      if (result.valido) {
        const intent = { ...result.intent, _provedor: provedor, _fallback: provedor !== ordem[0] };
        if (intent.confianca < confiancaMinima) {
          return {
            ...intent,
            precisa_confirmacao: true,
            _baixaConfianca: true,
            _erro: `Interpretacao com confianca baixa (${Math.round(intent.confianca * 100)}%).`,
          };
        }
        if (cacheKey) _cacheClassification(cacheKey, intent);
        return intent;
      }
      const msg = `retornou intenção inválida: ${result.erros.join(', ')}`;
      console.warn(`[IA Command] ${provedor} ${msg}`);
      _erros.push({ provedor, erro: msg });
    } catch (e) {
      const proximo = ordem.find(p => p !== provedor && keys[p]);
      console.warn(`[IA Command] ${provedor} falhou${proximo ? `, tentando ${proximo}` : ''}:`, e.message);
      _erros.push({ provedor, erro: e.message });
    }
  }

  const _erroMsg = _erros.length
    ? _erros.map(e => `${e.provedor}: ${_simplificarErro(e.erro).pt}`).join(' | ')
    : 'Nenhuma chave de IA configurada.';

  const _erroTipo = _erros.length === 0
    ? 'sem_chave'
    : _erros.every(e => _simplificarErro(e.erro).tipo === 'cota_esgotada')
      ? 'cota_esgotada'
      : 'indisponivel';

  return {
    intencao:            'desconhecido',
    periodo:             { tipo: 'nenhum' },
    filtros:             {},
    agrupar_por:         null,
    ordenar_por:         null,
    limite:              null,
    confianca:           0,
    precisa_confirmacao: false,
    origem:              'texto',
    _provedor:           'nenhum',
    _erro:               _erroMsg,
    _erroTipo,
    _erros,
  };
}

function temConfiguracaoMinima(empresaId) {
  try {
    const intencoes = crud.listar('intentions', { empresa_id: empresaId, ativo: 1 });
    if (!intencoes.length) return false;
    const datasets = crud.listar('datasets', { empresa_id: empresaId });
    return datasets.length > 0;
  } catch (_) {
    return false;
  }
}

module.exports = { classificar, temConfiguracaoMinima, _SINONIMOS_SISTEMA, _resolveKeys, _normalizarOrdem, invalidateCache };
