const groqProvider     = require('./providers/groq');
const geminiProvider   = require('./providers/gemini');
const deepseekProvider = require('./providers/deepseek');
const claudeProvider   = require('./providers/claude');
const openaiProvider   = require('./providers/openai');
const validator        = require('./schema-validator');
const localResolver    = require('./local-intent-resolver');
const { extrairRegrasNormalizacao } = require('./text-normalizer');
const { identificarPeriodoTexto } = require('./period-resolver');
const unsupportedRequest = require('./unsupported-request');
const crud             = require('../database/crud');
const { getDB }        = require('../database');
const orchestrator     = require('./orchestrator-service');

const PROVIDERS = {
  groq: groqProvider,
  gemini: geminiProvider,
  deepseek: deepseekProvider,
  claude: claudeProvider,
  openai: openaiProvider,
};

const DEFAULT_ORDER = ['groq', 'openai', 'gemini', 'deepseek', 'claude'];
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

  const keys = { groq: null, gemini: null, deepseek: null, claude: null, openai: null };
  let cfg = {};

  // 1. IA Command own config (SQLite)
  try {
    const { getDB } = require('../database');
    const db  = getDB();
    const row = db.prepare(`
      SELECT groq_api_key, gemini_api_key, deepseek_api_key, claude_api_key, openai_api_key, provedor_primario, fallback_ordem, confianca_minima, claude_modelo, gemini_modelo
      FROM ai_config
      WHERE empresa_id = ?
      LIMIT 1
    `).get(empresaId);
    cfg = row || {};
    if (row?.groq_api_key)     keys.groq     = row.groq_api_key;
    if (row?.gemini_api_key)   keys.gemini   = row.gemini_api_key;
    if (row?.deepseek_api_key) keys.deepseek = row.deepseek_api_key;
    if (row?.claude_api_key)   keys.claude   = row.claude_api_key;
    if (row?.openai_api_key)   keys.openai   = row.openai_api_key;
  } catch (_) {}

  // 2. IAHub configuracoes (fallback)
  if (!keys.groq) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.groq = await getApiKey('groq_api_key', empresaId);
    } catch (_) {}
  }
  if (!keys.gemini) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.gemini = await getApiKey('gemini_api_key', empresaId);
    } catch (_) {}
  }
  if (!keys.deepseek) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.deepseek = await getApiKey('deepseek_api_key', empresaId);
    } catch (_) {}
  }
  if (!keys.claude) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.claude = await getApiKey('claude_api_key', empresaId);
    } catch (_) {}
  }
  if (!keys.openai) {
    try {
      const { getApiKey } = require('../../../../modules/configuracoes/database');
      keys.openai = await getApiKey('openai_api_key', empresaId);
    } catch (_) {}
  }

  // 3. Environment variables
  if (!keys.groq)     keys.groq     = process.env.GROQ_API_KEY    || null;
  if (!keys.gemini)   keys.gemini   = process.env.GEMINI_API_KEY  || null;
  if (!keys.deepseek) keys.deepseek = process.env.DEEPSEEK_API_KEY || null;
  if (!keys.claude)   keys.claude   = process.env.CLAUDE_API_KEY  || process.env.ANTHROPIC_API_KEY || null;
  if (!keys.openai)   keys.openai   = process.env.OPENAI_API_KEY  || null;

  // 4. Fallback global: se a empresa_id do canal não tem chave própria, usa qualquer config disponível
  if (!keys.groq && !keys.gemini && !keys.deepseek && !keys.claude && !keys.openai) {
    try {
      const { getDB } = require('../database');
      const anyRow = getDB().prepare('SELECT * FROM ai_config LIMIT 1').get();
      if (anyRow) {
        if (anyRow.groq_api_key)     keys.groq     = anyRow.groq_api_key;
        if (anyRow.gemini_api_key)   keys.gemini   = anyRow.gemini_api_key;
        if (anyRow.deepseek_api_key) keys.deepseek = anyRow.deepseek_api_key;
        if (anyRow.claude_api_key)   keys.claude   = anyRow.claude_api_key;
        if (anyRow.openai_api_key)   keys.openai   = anyRow.openai_api_key;
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
  const base = ordem.length
    ? [...ordem, ...DEFAULT_ORDER.filter(p => !ordem.includes(p))]
    : DEFAULT_ORDER;
  const primario = String(cfg.provedor_primario || '').trim().toLowerCase();
  const final = primario && PROVIDERS[primario]
    ? [primario, ...base.filter(p => p !== primario)]
    : base;
  return [...new Set(final)];
}

const TERMOS_ESCOPO_DINAMICO = {
  faturamento: [
    'faturamento', 'faturado', 'vendas', 'venda', 'receita',
    'movimento', 'notas', 'nf', 'nfe', 'nf-e', 'nota fiscal',
    'saida', 'saidas', 'emissao', 'fat', 'resultado vendas',
    'vendas realizadas', 'pedidos faturados', 'carregada', 'carregado',
    'carga', 'entrega futura', 'nota mae', 'nota mãe', 'venda futura',
    'movimentacao total', 'movimentação total', 'todas as saidas',
    'todas as saídas', 'sem filtro fiscal',
  ],
  compras: [
    'compra', 'compras', 'comprado', 'comprei', 'fornecedor', 'fornecedores',
    'entrada', 'entradas', 'recebimento', 'nf entrada', 'nota entrada',
    'nota fiscal entrada', 'pedido de compra', 'pedidos de compra',
    'ordem de compra', 'ordens de compra', 'oc',
  ],
  financeiro: [
    'financeiro', 'contas a pagar', 'contas pagar', 'pagar', 'a pagar',
    'pagamento', 'pagamentos', 'pagamento realizado', 'pagamentos realizados',
    'pagamento efetuado', 'pagamentos efetuados', 'pagamento liquidado', 'pagamentos liquidados',
    'contas pagas', 'contas liquidadas', 'contas baixadas', 'pago', 'pagos', 'pagas',
    'contas a receber', 'contas receber', 'receber', 'a receber',
    'recebimento', 'recebimentos', 'recebimento realizado', 'recebimentos realizados',
    'recebimento efetuado', 'recebimentos efetuados', 'recebimento liquidado', 'recebimentos liquidados',
    'contas recebidas', 'recebido', 'recebidos', 'recebidas',
    'fluxo de caixa', 'fluxo de caixa realizado', 'fluxo de caixa projetado',
    'caixa', 'saldo', 'saldo bancario', 'saldos bancarios', 'banco', 'bancos',
    'vencimento', 'vencimentos',
    'duplicata', 'duplicatas', 'titulos', 'titulo', 'boletos',
    'inadimplencia', 'inadimplentes', 'cobranca', 'cobrancas',
  ],
  estoque: [
    'estoque', 'saldo em estoque', 'saldo de estoque', 'posicao de estoque',
    'estoque disponivel', 'estoque reservado', 'estoque empenhado',
    'requisicao', 'requisitado', 'transferencia de estoque', 'transferencias de estoque',
    'perda de estoque', 'perdas de estoque', 'avaria', 'avarias',
    'apontamento de producao', 'ajuste de inventario', 'curva abc', 'giro de estoque',
    'cobertura de estoque',
  ],
};

const INTENCOES_DINAMICAS_PADRAO = [
  {
    nome: 'compras_dinamico',
    descricao: 'Consultas dinâmicas de compras via IA (Text-to-SQL Protheus)',
    modulo: 'compras',
    frases_exemplo: [
      'quanto comprei no mês',
      'compras do período',
      'top fornecedores',
      'nf de entrada',
      'compras por produto',
      'compras por grupo de produto',
    ].join('\n'),
  },
  {
    nome: 'financeiro_dinamico',
    descricao: 'Consultas dinâmicas do financeiro via IA (Text-to-SQL Protheus)',
    modulo: 'financeiro',
    frases_exemplo: [
      'contas a pagar do ano',
      'contas a receber do mês',
      'saldo a pagar por fornecedor',
      'saldo a receber por cliente',
      'pagamentos realizados por fornecedor',
      'recebimentos realizados por cliente',
      'contas pagas no periodo',
      'contas recebidas no periodo',
      'títulos vencidos',
      'total pago no período',
      'total recebido no período',
      'juros e multa recebidos',
      'RA e PA em aberto',
      'saldo bancario',
      'saldos bancarios',
      'saldo bancario por banco',
      'fluxo de caixa do ano',
      'fluxo de caixa do mês',
      'fluxo de caixa por período',
      'fluxo de caixa realizado',
      'fluxo de caixa projetado',
      'caixa do mês',
      'entradas e saídas do período',
      'recebimentos versus pagamentos',
      'posição financeira',
    ].join('\n'),
  },
  {
    nome: 'faturamento_dinamico',
    descricao: 'Consultas dinamicas de faturamento via IA (Text-to-SQL Protheus)',
    modulo: 'faturamento',
    frases_exemplo: [
      'faturamento do mes',
      'vendas por cliente',
      'faturamento por produto',
      'top vendedores',
      'notas de saida',
      'receita por filial',
      'quantidade carregada no dia',
      'quantidade de nota mae para entrega futura',
      'movimentacao total de saida',
    ].join('\n'),
  },
  {
    nome: 'comissao_dinamico',
    descricao: 'Consultas dinâmicas de comissões via IA (Text-to-SQL Protheus SE3)',
    modulo: 'comissao',
    frases_exemplo: [
      'minhas comissões do mês',
      'comissões a receber',
      'comissões pagas no período',
      'total de comissão por vendedor',
      'comissões em aberto',
      'comissão por cliente',
      'percentual de comissão',
      'minhas comissões do ano',
    ].join('\n'),
  },
];

function _garantirIntencoesDinamicasPadrao(empresaId) {
  try {
    const existentes = crud.listar('intentions', { empresa_id: empresaId });
    const porNome = new Map(existentes.map(i => [String(i.nome || '').toLowerCase(), i]));
    let criou = false;
    for (const def of INTENCOES_DINAMICAS_PADRAO) {
      const existente = porNome.get(def.nome);
      if (existente) {
        const patch = {};
        if (String(existente.acao || '').toLowerCase() !== 'ai_text_to_sql') patch.acao = 'ai_text_to_sql';
        if (String(existente.modulo || '').toLowerCase() !== def.modulo) patch.modulo = def.modulo;
        if (existente.ativo === 0) patch.ativo = 1;
        // Sincroniza frases_exemplo quando o código tiver frases que o banco não tem
        const frasesDb = String(existente.frases_exemplo || '');
        const frasesNovos = def.frases_exemplo.split('\n').filter(f => f && !frasesDb.includes(f));
        if (frasesNovos.length) patch.frases_exemplo = def.frases_exemplo;
        if (Object.keys(patch).length) {
          crud.atualizar('intentions', existente.id, patch);
          criou = true;
          console.log(`[IA] Intenção dinâmica ${def.nome} atualizada na empresa #${empresaId}`);
        }
        continue;
      }
      crud.criar('intentions', {
        empresa_id: empresaId,
        nome: def.nome,
        descricao: def.descricao,
        modulo: def.modulo,
        acao: 'ai_text_to_sql',
        dataset_id: null,
        frases_exemplo: def.frases_exemplo,
        ativo: 1,
      });
      criou = true;
      console.log(`[IA] Intenção dinâmica ${def.nome} auto-criada para empresa #${empresaId}`);
    }
    if (criou) _cache.intencoes.delete(String(empresaId));
  } catch (e) {
    console.warn(`[IA] Falha ao garantir intenções dinâmicas para empresa #${empresaId}:`, e.message);
  }
}

function _dominioIntentAiSql(i = {}) {
  const base = localResolver.normalizarTexto([
    i.modulo,
    i.nome,
    i.descricao,
  ].filter(Boolean).join(' '));
  if (_containsTerm(base, 'compras') || _containsTerm(base, 'compra')) return 'compras';
  if (_containsTerm(base, 'financeiro') || _containsTerm(base, 'contas pagar') || _containsTerm(base, 'contas receber') || _containsTerm(base, 'fluxo caixa')) return 'financeiro';
  if (_containsTerm(base, 'faturamento') || _containsTerm(base, 'vendas') || _containsTerm(base, 'venda')) return 'faturamento';
  if (_containsTerm(base, 'estoque')) return 'estoque';
  return localResolver.normalizarTexto(i.modulo || i.nome || '').split(/\s|_/).filter(Boolean)[0] || 'dinamico';
}

function _intencoesAiSqlDinamicas(intencoes = []) {
  return intencoes.filter(i =>
    String(i.acao || '').toLowerCase() === 'ai_text_to_sql'
  );
}

// Palavras muito genéricas que não devem virar termo-chave sozinhas (ruído de qualquer frase).
const _STOPWORDS_FRASE_EXEMPLO = new Set([
  'quanto', 'quantos', 'quantas', 'qual', 'quais', 'como', 'onde', 'quando',
  'este', 'esta', 'esse', 'essa', 'atual', 'periodo', 'mes', 'ano', 'dia',
  'total', 'todos', 'todas', 'para', 'pelo', 'pela', 'sobre', 'entre',
]);

function _termosDeFrasesExemplo(frasesExemplo, normalizacoes = []) {
  const termos = new Set();
  String(frasesExemplo || '')
    .split('\n')
    .map(f => f.trim())
    .filter(Boolean)
    .forEach(frase => {
      const texto = localResolver.normalizarTexto(frase, normalizacoes);
      // Bigramas e palavras isoladas relevantes — frases de exemplo já são o vocabulário
      // de negócio que o cadastrante do domínio (Protheus, SoftExpert, etc) definiu.
      const palavras = texto.split(/\s+/).filter(t => t.length >= 4 && !_STOPWORDS_FRASE_EXEMPLO.has(t));
      palavras.forEach(p => termos.add(p));
      for (let i = 0; i < palavras.length - 1; i++) termos.add(`${palavras[i]} ${palavras[i + 1]}`);
    });
  return termos;
}

// Termos "fortes": o nome do modulo em si e sinonimos cadastrados EXPLICITAMENTE para esta
// intencao. Sao sinal intencional e devem decidir sozinhos entre sistemas/dominios diferentes.
// Termos "fracos": vocabulario auxiliar (descricao, palavras/bigramas extraidos automaticamente
// das frases_exemplo, termos genericos do dicionario Protheus) — uteis so para desempate
// dentro do MESMO sistema, nunca para decidir entre sistemas distintos (evita que uma
// expressao comum tipo "em aberto", presente por acaso numa frase de outro dominio, roube
// pontuacao de uma pergunta que já bateu no nome do modulo certo).
function _termosFortesIntentAiSql(intent = {}, sinonimos = [], normalizacoes = []) {
  const dominio = _dominioIntentAiSql(intent);
  const termos = new Set();

  const moduloTexto = localResolver.normalizarTexto(intent.modulo, normalizacoes).replace(/_/g, ' ');
  moduloTexto.split(/\s+/).filter(Boolean).forEach(t => termos.add(t));
  if (moduloTexto) termos.add(moduloTexto);

  for (const s of sinonimos || []) {
    if (s?.ativo === 0 || String(s.camada || '').toLowerCase() !== 'intencao') continue;
    const equivalencia = localResolver.normalizarTexto(s.equivalencia, normalizacoes).replace(/_/g, ' ');
    const nome = localResolver.normalizarTexto(intent.nome, normalizacoes).replace(/_/g, ' ');
    const modulo = localResolver.normalizarTexto(intent.modulo, normalizacoes).replace(/_/g, ' ');
    if (equivalencia && (nome.includes(equivalencia) || modulo.includes(equivalencia) || equivalencia.includes(dominio))) {
      termos.add(localResolver.normalizarTexto(s.termo, normalizacoes));
    }
  }

  return [...termos].filter(Boolean);
}

function _termosFracosIntentAiSql(intent = {}, normalizacoes = []) {
  const dominio = _dominioIntentAiSql(intent);
  const termos = new Set(TERMOS_ESCOPO_DINAMICO[dominio] || []);

  for (const parte of [intent.nome, intent.descricao]) {
    const texto = localResolver.normalizarTexto(parte, normalizacoes).replace(/_/g, ' ');
    texto.split(/\s+/).filter(t => t.length >= 4 && !['dinamico', 'consulta', 'consultas'].includes(t))
      .forEach(t => termos.add(t));
  }

  for (const termo of _termosDeFrasesExemplo(intent.frases_exemplo, normalizacoes)) termos.add(termo);

  return [...termos].map(t => localResolver.normalizarTexto(t, normalizacoes)).filter(Boolean);
}

// Mantida por compatibilidade com quem ainda consome a lista "achatada" (fortes + fracos).
function _termosIntentAiSql(intent = {}, sinonimos = [], normalizacoes = []) {
  return [
    ..._termosFortesIntentAiSql(intent, sinonimos, normalizacoes),
    ..._termosFracosIntentAiSql(intent, normalizacoes),
  ];
}

function _normalizarMensagemDinamica(mensagem, normalizacoes = []) {
  return localResolver.normalizarTexto(mensagem, normalizacoes)
    .replace(/\bdocumetnos\b/g, 'documentos')
    .replace(/\bdocumetno\b/g, 'documento');
}

// Keywords primarias hard-coded do Protheus — mantidas por compatibilidade/precisao fina do
// dominio mais maduro do produto. Sistemas novos (SoftExpert, etc) recebem o mesmo bonus
// decisivo de forma generica via _termosFortesIntentAiSql (nome do modulo + sinonimos
// cadastrados), sem precisar de entrada nesta lista.
const BONUS_DOMINIO_PRIMARIO = 10;
const KEYWORDS_PRIMARIAS = {
  compras: ['compras', 'compra', 'pedido compra', 'pedidos compra', 'nota entrada', 'notas entrada', 'ordem compra'],
  faturamento: ['faturamento', 'fatura', 'nota fiscal', 'notas fiscais', 'venda', 'vendas', 'nf', 'carregada', 'carregado', 'entrega futura', 'nota mae', 'nota mãe', 'movimentacao total', 'movimentação total'],
  financeiro: ['financeiro', 'contas pagar', 'contas receber', 'pagamento', 'pagamentos', 'pago', 'pagos', 'pagas', 'recebimento', 'recebimentos', 'recebido', 'recebidos', 'recebidas', 'contas pagas', 'contas recebidas', 'fluxo caixa', 'lancamento', 'titulo', 'titulos', 'duplicata', 'duplicatas'],
  comissao: ['comissao', 'comissoes', 'comissionamento'],
  estoque: ['estoque', 'saldo em estoque', 'posicao de estoque', 'requisicao', 'transferencia de estoque', 'giro de estoque', 'curva abc'],
};

function _ranquearIntencoesAiSql(mensagem, intencoes = [], sinonimos = [], normalizacoes = []) {
  const texto = _normalizarMensagemDinamica(mensagem, normalizacoes);
  const candidatas = _intencoesAiSqlDinamicas(intencoes);
  if (!texto || !candidatas.length) return [];

  return candidatas.map(intent => {
    const dominio = _dominioIntentAiSql(intent);
    const termosFortes = _termosFortesIntentAiSql(intent, sinonimos, normalizacoes);
    const termosFracos = _termosFracosIntentAiSql(intent, normalizacoes);
    const scoreFracos = termosFracos.reduce((acc, termo) => acc + (_containsTerm(texto, termo) ? Math.max(1, termo.split(/\s+/).length) : 0), 0);
    const bateForte = termosFortes.some(termo => _containsTerm(texto, termo));
    const keywords = (KEYWORDS_PRIMARIAS[dominio] || []).map(k => localResolver.normalizarTexto(k, normalizacoes));
    const bonusDominio = (bateForte || keywords.some(k => _containsTerm(texto, k))) ? BONUS_DOMINIO_PRIMARIO : 0;
    return { intent, dominio, score: scoreFracos + bonusDominio, scoreForte: bonusDominio };
  }).sort((a, b) => b.score - a.score);
}

function _intencaoAiSqlPreferencial(mensagem, intencoes = [], sinonimos = [], normalizacoes = []) {
  const texto = _normalizarMensagemDinamica(mensagem, normalizacoes);
  const candidatas = _intencoesAiSqlDinamicas(intencoes);
  if (!texto || !candidatas.length) return null;

  const financeiroPorDocumentoPago = /\b(documentos?|titulos?|duplicatas?)\b/.test(texto)
    && /\b(pago|pagos|pagas|pagamento|pagamentos|baixado|baixados|liquidado|liquidados)\b/.test(texto);
  const financeiroPorDocumentoRecebido = /\b(documentos?|titulos?|duplicatas?)\b/.test(texto)
    && /\b(recebido|recebidos|recebidas|recebimento|recebimentos|baixado|baixados|liquidado|liquidados)\b/.test(texto);
  if (financeiroPorDocumentoPago || financeiroPorDocumentoRecebido) {
    const financeiro = candidatas.find(intent => _dominioIntentAiSql(intent) === 'financeiro');
    if (financeiro) return financeiro;
  }

  // Palavras-chave primárias de cada domínio — presença explícita na mensagem vale bônus alto
  const BONUS_DOMINIO_PRIMARIO = 10;
  const KEYWORDS_PRIMARIAS = {
    compras: ['compras', 'compra', 'pedido compra', 'pedidos compra', 'nota entrada', 'notas entrada', 'ordem compra'],
    faturamento: ['faturamento', 'fatura', 'nota fiscal', 'notas fiscais', 'venda', 'vendas', 'nf', 'carregada', 'carregado', 'entrega futura', 'nota mae', 'nota mãe', 'movimentacao total', 'movimentação total'],
    financeiro: ['financeiro', 'contas pagar', 'contas receber', 'pagamento', 'pagamentos', 'pago', 'pagos', 'pagas', 'recebimento', 'recebimentos', 'recebido', 'recebidos', 'recebidas', 'contas pagas', 'contas recebidas', 'fluxo caixa', 'lancamento', 'titulo', 'titulos', 'duplicata', 'duplicatas'],
    comissao: ['comissao', 'comissoes', 'comissionamento'],
    estoque: ['estoque', 'saldo em estoque', 'posicao de estoque', 'requisicao', 'transferencia de estoque', 'giro de estoque', 'curva abc'],
  };

  const ranqueadas = candidatas.map(intent => {
    const dominio = _dominioIntentAiSql(intent);
    const termos = _termosIntentAiSql(intent, sinonimos, normalizacoes);
    const scoreTermos = termos.reduce((acc, termo) => acc + (_containsTerm(texto, termo) ? Math.max(1, termo.split(/\s+/).length) : 0), 0);

    // Bônus se keyword primária do domínio aparece explicitamente na mensagem
    const keywords = (KEYWORDS_PRIMARIAS[dominio] || []).map(k => localResolver.normalizarTexto(k, normalizacoes));
    const bonusDominio = keywords.some(k => _containsTerm(texto, k)) ? BONUS_DOMINIO_PRIMARIO : 0;

    return { intent, score: scoreTermos + bonusDominio };
  }).sort((a, b) => b.score - a.score);

  return ranqueadas[0]?.score > 0 ? ranqueadas[0].intent : null;
}

function _mensagemDinamicaAmbigua(mensagem, intencoes = [], sinonimos = [], normalizacoes = []) {
  const texto = _normalizarMensagemDinamica(mensagem, normalizacoes);
  const relevantes = _ranquearIntencoesAiSql(mensagem, intencoes, sinonimos, normalizacoes).filter(r => r.score > 0);
  const temDocumentoGenerico = /\b(documentos?|notas?|nf|nfe|nota fiscal|documentos fiscais?|titulos?|duplicatas?)\b/.test(texto);
  const temAcaoFinanceira = /\b(pago|pagos|pagas|pagamento|pagamentos|recebido|recebidos|recebidas|recebimento|recebimentos|baixado|baixados|liquidado|liquidados)\b/.test(texto);
  // "contas a pagar/receber" + "titulo/pagos" é inequivocamente financeiro — não é ambíguo.
  const temAnchoraFinanceira = /\b(contas? ?(a ?)?(pagar|receber)|contas? (pagas?|recebidas?|baixadas?|liquidadas?)|cap|car)\b/.test(texto);
  if (temDocumentoGenerico && temAcaoFinanceira && !temAnchoraFinanceira) return true;
  if (relevantes.length < 2) return false;
  return relevantes[0].score - relevantes[1].score <= 3;
}

// Detecta perguntas que cruzam múltiplas fontes de dados ou combinam operações de domínios
// distintos — essas perguntas exigem interpretação pela IA, não o bypass determinístico local.
function _mensagemEhComplexaDemaisParaBypass(mensagem) {
  const texto = mensagem.toLowerCase();

  // Operações explícitas de combinação (soma E subtração juntas) entre entidades distintas
  const temSoma      = /\b(somando|somar|adicionar|mais)\b/.test(texto);
  const temSubtracao = /\b(subtraindo|subtrair|subtra[íi]|menos|descontando)\b/.test(texto);
  if (temSoma && temSubtracao) return true;

  // Conta quantas fontes de dados distintas a mensagem menciona
  const fontes = [
    /\bcontas?\s+(?:a\s+)?pagar\b/,
    /\bcontas?\s+(?:a\s+)?receber\b/,
    /\bcontas?\s+banc[aá]rias?\b|\bsaldo\s+banc[aá]rio\b|\bcaixa\b/,
    /\bfaturamento\b|\bvendas?\b/,
    /\bcompras?\b|\bestoque\b/,
    /\bcomiss[oõ]es?\b/,
  ];
  if (fontes.filter(re => re.test(texto)).length >= 2) return true;

  return false;
}

function _deveBypassDinamico(mensagem, intencoes = [], sinonimos = [], normalizacoes = [], opts = {}) {
  const intencao = _intencaoAiSqlPreferencial(mensagem, intencoes, sinonimos, normalizacoes);
  if (!intencao) return { usar: false, intencao: null, motivo: 'sem_match' };
  // Perguntas complexas (multi-fonte ou operações combinadas) nunca devem ser resolvidas
  // pelo bypass local — independente de ter chave de IA disponível.
  if (_mensagemEhComplexaDemaisParaBypass(mensagem)) {
    return { usar: false, intencao, motivo: 'complexidade_requer_ia' };
  }
  if (opts.temChaveIA && _mensagemDinamicaAmbigua(mensagem, intencoes, sinonimos, normalizacoes)) {
    return { usar: false, intencao, motivo: 'ambigua_enviar_ia' };
  }
  return { usar: true, intencao, motivo: 'alta_confianca_local' };
}

function _mensagemPareceAiSqlDinamico(mensagem, intencoes = [], sinonimos = [], normalizacoes = []) {
  return !!_intencaoAiSqlPreferencial(mensagem, intencoes, sinonimos, normalizacoes);
}

function _mensagemPareceComprasAiSql(mensagem, sinonimos = [], normalizacoes = []) {
  const texto = localResolver.normalizarTexto(mensagem, normalizacoes);
  if (!texto) return false;
  if ((TERMOS_ESCOPO_DINAMICO.compras || []).some(termo => _containsTerm(texto, localResolver.normalizarTexto(termo)))) {
    return true;
  }

  return (sinonimos || []).some(s => {
    if (s?.ativo === 0) return false;
    if (String(s.camada || '').toLowerCase() !== 'intencao') return false;
    if (localResolver.normalizarTexto(s.equivalencia, normalizacoes) !== 'compras') return false;
    return _containsTerm(texto, localResolver.normalizarTexto(s.termo, normalizacoes));
  });
}

function _intentAiSqlDireto(intencao, mensagem, normalizacoes = []) {
  const periodo = identificarPeriodoTexto(mensagem, { normalizacoes });
  const dominio = _dominioIntentAiSql(intencao);
  // "Sem periodo = mes atual" e um padrao de negocio do Protheus (faturamento, compras etc.
  // sao sempre um recorte temporal). Sistemas fora do Protheus (ex: SoftExpert/ITSM) tratam
  // perguntas de estado atual ("chamados em aberto e em atraso") sem periodo implicito.
  const erp = String(intencao?.erp || 'protheus').trim().toLowerCase();
  return {
    intencao:            intencao?.nome || 'compras_dinamico',
    periodo:             periodo?.tipo && periodo.tipo !== 'nenhum'
      ? periodo
      : { tipo: (dominio === 'financeiro' || erp !== 'protheus') ? 'nenhum' : 'mes_atual' },
    filtros:             {},
    agrupar_por:         null,
    ordenar_por:         null,
    limite:              null,
    confianca:           0.95,
    precisa_confirmacao: false,
    origem:              'ia_dialogo',
    _provedor:           'escopo_dinamico',
    _motor:              'ia_dialogo_dinamico',
    _dynamicAiScope:     true,
    _moduloDinamico:     intencao?.modulo || dominio,
    _mensagemOriginal:   mensagem,
  };
}

function _appendTrace(intent = {}, evento = {}) {
  const trace = Array.isArray(intent._trace) ? intent._trace.slice(0, 30) : [];
  trace.push({
    etapa: evento.etapa || 'classificacao',
    acao: evento.acao || 'avaliar',
    motor: evento.motor || intent._motor || intent._provedor || null,
    intencao: evento.intencao || intent.intencao || null,
    detalhe: evento.detalhe || null,
  });
  return { ...intent, _trace: trace.filter(Boolean) };
}

function _containsTerm(texto, termo) {
  if (!termo) return false;
  const escaped = String(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(texto);
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
      erp:             r.erp || 'protheus',
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
      sql_base: r.sql_base || '',
      campos: r.campos || '',
      agrupamentos: r.agrupamentos || '',
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
  { termo: 'carregada',              camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'carregado',              camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'carga',                  camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'entrega futura',         camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'nota mae',               camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'nota mãe',               camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'venda futura',           camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'movimentacao total',     camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'movimentação total',     camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'todas as saidas',        camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'todas as saídas',        camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
  { termo: 'sem filtro fiscal',      camada: 'intencao', equivalencia: 'faturamento',    origem: 'sistema' },
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
  const usarCacheClassificacao = !contextoAnterior && !(Array.isArray(opts.historicoResumido) && opts.historicoResumido.length);
  const cacheKey = usarCacheClassificacao ? _classificationKey(empresaId, mensagem) : null;
  if (cacheKey) {
    const cached = _cacheGet(_cache.classificacoes, cacheKey);
    if (cached) return { ..._clone(cached), _cache: true };
  }

  _garantirIntencoesDinamicasPadrao(empresaId);
  const intencoes = _carregarIntencoes(empresaId);
  const sinonimos = _carregarSinonimos(empresaId);
  const normalizacoes = extrairRegrasNormalizacao(sinonimos);
  const datasets = _carregarDatasets(empresaId);

  const intencaoAiSql = _intencaoAiSqlPreferencial(mensagem, intencoes, sinonimos, normalizacoes);
  const temAiSql = intencoes.some(i => String(i.acao || '').toLowerCase() === 'ai_text_to_sql');
  if (!intencoes.length || (!datasets.length && !temAiSql)) {
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

  // Roteador de sistema: só entra em ação quando a empresa tem intenções ai_text_to_sql de
  // mais de um sistema (erp) cadastradas — ex: Protheus + SoftExpert. Com um único sistema
  // (o caso comum hoje), retorna esse sistema sem nenhum calculo extra e o fluxo segue 100%
  // igual ao anterior a esta checagem.
  const systemRouter = require('./system-router');
  let sistemaAlvo = systemRouter.resolverSistema(mensagem, intencoes, sinonimos, normalizacoes);

  // Agendamento não tem usuário no loop para responder a um pedido de confirmação — o job já
  // declara seu modulo no cadastro (ex: "chamados", "faturamento"), entao usamos esse dado,
  // que o proprio usuario forneceu ao criar o agendamento, para desempatar em vez de bloquear.
  // Generico para qualquer sistema/modulo cadastrado, sem lista fixa por sistema.
  if (sistemaAlvo.ambiguo && opts._systemOrigin === 'agendamento' && opts._agendamentoModulo) {
    const moduloJob = String(opts._agendamentoModulo).trim().toLowerCase();
    const candidatoPorModulo = sistemaAlvo.candidatos.find(
      c => String(c.modulo || '').trim().toLowerCase() === moduloJob
    );
    if (candidatoPorModulo) {
      sistemaAlvo = { sistema: candidatoPorModulo.sistema, ambiguo: false, candidatos: [] };
    }
  }

  if (sistemaAlvo.ambiguo) {
    const opcoes = sistemaAlvo.candidatos
      .map(c => `${c.modulo || c.sistema} (${c.sistema})`)
      .join(' ou ');
    return {
      intencao:            'desconhecido',
      periodo:             { tipo: 'nenhum' },
      filtros:             {},
      agrupar_por:         null,
      ordenar_por:         null,
      limite:              null,
      confianca:           0,
      precisa_confirmacao: true,
      origem:              'texto',
      _provedor:           'sistema',
      _erro:               `Nao ficou claro se a pergunta e sobre ${opcoes}. Pode reformular indicando o assunto?`,
      _erroTipo:           'sistema_ambiguo',
      _erros:              [],
      _trace: [{ etapa: 'classificacao', acao: 'sistema_ambiguo', detalhe: JSON.stringify(sistemaAlvo.candidatos) }],
    };
  }
  if (sistemaAlvo.sistema && sistemaAlvo.sistema !== 'protheus') {
    // Sistema não-Protheus com correspondência clara: usa sempre o caminho determinístico
    // (o mesmo bypass local já usado quando não há chave de IA) — não passa pelo orquestrador
    // Protheus, que é especializado nas regras de negocio daquele sistema.
    const decisaoBypass = _deveBypassDinamico(mensagem, intencoes, sinonimos, normalizacoes, { temChaveIA: false });
    if (decisaoBypass.usar && systemRouter._erpDaIntencao(decisaoBypass.intencao) === sistemaAlvo.sistema) {
      return _appendTrace(
        { ..._intentAiSqlDireto(decisaoBypass.intencao, mensagem, normalizacoes), _bypassMotivo: `sistema_${sistemaAlvo.sistema}` },
        {
          acao: 'bypass_multi_sistema',
          motor: 'sistema',
          intencao: decisaoBypass.intencao?.nome,
          detalhe: `erp=${sistemaAlvo.sistema}`,
        }
      );
    }
  }

  // Escopos dinâmicos: detecção rápida por termos do módulo — bypassa local resolver e IA externa.
  // Este é o caminho principal para compras, faturamento, financeiro e comissão.
  const { keys, cfg } = await _resolveKeys(empresaId);
  const temChave = Object.values(keys).some(Boolean);

  if (temAiSql && !temChave) {
    const decisaoBypass = _deveBypassDinamico(mensagem, intencoes, sinonimos, normalizacoes, { temChaveIA: temChave });
    if (decisaoBypass.usar) {
      return _appendTrace(
        { ..._intentAiSqlDireto(decisaoBypass.intencao, mensagem, normalizacoes), _bypassMotivo: decisaoBypass.motivo },
        {
          acao: 'fallback_dinamico_sem_chave',
          motor: 'sistema',
          intencao: decisaoBypass.intencao?.nome,
          detalhe: `sem_chave_ia; ${decisaoBypass.motivo}`,
        }
      );
    }
  }

  // IA externa é primária para todos os demais casos — local resolver é apenas fallback de último
  // recurso quando todas as chaves falharem ou não estiverem configuradas.
  const nomesPermitidos = intencoes.map(i => i.nome).concat(['desconhecido']);
  const ordem = _normalizarOrdem(cfg);
  const confiancaMinima = Number(cfg.confianca_minima ?? 0.6) || 0.6;
  console.log(`[IA classificar] empresaId=${empresaId} | intencoes=${intencoes.length} | sinonimos=${sinonimos.length} | ordem=${ordem.join(',')} | keys: groq=${!!keys.groq} gemini=${!!keys.gemini} deepseek=${!!keys.deepseek} claude=${!!keys.claude} openai=${!!keys.openai}`);

  const _erros = [];
  if (temAiSql && temChave) {
    const orq = await orchestrator.orquestrar({
      mensagem,
      empresaId,
      keys,
      cfg,
      ordem,
      intencoes,
      historicoResumido: opts.historicoResumido || [],
      contextoAnterior,
      tenantAliases: opts.tenantAliases || [],
    });
    if (orq.ok) {
      let intent = _appendTrace(
        { ...orq.intent, _provedor: orq.provedor, _fallback: orq.provedor !== ordem[0] },
        {
          acao: 'orquestracao_ia',
          motor: orq.provedor,
          modulo: orq.contrato?.modulo || null,
          intencao: orq.intent?.intencao,
          detalhe: `confianca=${orq.intent?.confianca ?? 'n/a'}; herdou_contexto=${!!orq.contrato?.herdou_contexto}`,
        }
      );
      intent = unsupportedRequest.aplicarBloqueioSeNecessario(intent, mensagem, { intencoes, datasets });
      if (intent._erroTipo === 'dataset_sem_informacao') return intent;
      // intencao=desconhecido (fora dos modulos com spec dedicado) segue direto para o
      // intent-router.js SEM bloquear aqui: o router decide (via _parecePerguntaErp) entre
      // acionar o fallback erp_generico (dominios sem spec proprio, ex: RH, producao; e
      // rede de seguranca residual para estoque caso a classificacao falhe em reconhece-lo)
      // ou retornar "desconhecido" pedindo reformulacao. Bloquear aqui impediria o fallback
      // erp_generico de ser alcancado.
      if (intent.confianca < confiancaMinima && intent.intencao !== 'desconhecido') {
        return _appendTrace({
          ...intent,
          precisa_confirmacao: true,
          _baixaConfianca: true,
          _erro: `Orquestracao com confianca baixa (${Math.round(intent.confianca * 100)}%).`,
        }, { acao: 'bloqueio_baixa_confianca', motor: 'sistema', detalhe: `minima=${confiancaMinima}` });
      }
      if (cacheKey) _cacheClassification(cacheKey, intent);
      return intent;
    }
    _erros.push(...(orq.erros || [{ provedor: 'orquestrador', erro: orq.erro }]));
    console.warn(`[IA Orquestradora] falhou, usando classificador legado como fallback: ${orq.erro}`);
  }

  if (temChave) {
    for (const provedor of ordem) {
      if (!keys[provedor]) continue;
      try {
        const modeloConfigurado = provedor === 'claude' ? cfg.claude_modelo
          : provedor === 'gemini' ? cfg.gemini_modelo
          : null;
        const raw = await PROVIDERS[provedor].classificarIntencao(mensagem, keys[provedor], intencoes, sinonimos, contextoAnterior, modeloConfigurado);
        const result = validator.validar(raw, nomesPermitidos);
        if (result.valido) {
          let intent = _appendTrace(
            { ...result.intent, _provedor: provedor, _fallback: provedor !== ordem[0] },
            {
              acao: 'classificacao_ia',
              motor: provedor,
              intencao: result.intent?.intencao,
              detalhe: `confianca=${result.intent?.confianca ?? 'n/a'}`,
            }
          );
          intent = unsupportedRequest.aplicarBloqueioSeNecessario(intent, mensagem, { intencoes, datasets });
          if (intent._erroTipo === 'dataset_sem_informacao') return intent;
          if (intent.confianca < confiancaMinima) {
            return _appendTrace({
              ...intent,
              precisa_confirmacao: true,
              _baixaConfianca: true,
              _erro: `Interpretacao com confianca baixa (${Math.round(intent.confianca * 100)}%).`,
            }, { acao: 'bloqueio_baixa_confianca', motor: 'sistema', detalhe: `minima=${confiancaMinima}` });
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
  }

  // Fallback: resolvedor local — usado apenas quando todas as chaves de IA falharam
  if (_erros.length || !temChave) {
    const local = localResolver.resolverLocal(mensagem, intencoes, sinonimos, { datasets, normalizacoes });
    if (local) {
      const bloqueado = unsupportedRequest.aplicarBloqueioSeNecessario(local, mensagem, { intencoes, datasets });
      if (bloqueado !== local) return bloqueado;
      const intentLocal = _appendTrace(
        { ...local, _fallbackLocal: true },
        {
          acao: 'fallback_local',
          motor: 'sistema',
          intencao: local.intencao,
          detalhe: temChave ? 'ia_falhou' : 'sem_chave_ia',
        }
      );
      if (cacheKey) _cacheClassification(cacheKey, intentLocal);
      return intentLocal;
    }
    if (temAiSql && intencaoAiSql) {
      // Perguntas complexas não podem ser resolvidas pelo fallback determinístico.
      // Retorna desconhecido para que o sistema informe ao usuário que a IA está indisponível.
      if (_mensagemEhComplexaDemaisParaBypass(mensagem)) {
        const _erroMsgComplexo = _erros.length
          ? _erros.map(e => `${e.provedor}: ${_simplificarErro(e.erro).pt}`).join(' | ')
          : 'Nenhuma chave de IA configurada.';
        const _erroTipoComplexo = !_erros.length
          ? 'sem_chave'
          : _erros.every(e => _simplificarErro(e.erro).tipo === 'cota_esgotada') ? 'cota_esgotada' : 'indisponivel';
        return _appendTrace({
          intencao: 'desconhecido', periodo: { tipo: 'nenhum' }, filtros: {}, agrupar_por: null,
          ordenar_por: null, limite: null, confianca: 0, precisa_confirmacao: false, origem: 'texto',
          _provedor: 'nenhum', _erro: _erroMsgComplexo, _erroTipo: _erroTipoComplexo, _erros,
        }, { acao: 'bloqueio_complexidade', motor: 'sistema', intencao: 'desconhecido', detalhe: 'consulta_complexa_ia_indisponivel' });
      }
      return _appendTrace({
        ..._intentAiSqlDireto(intencaoAiSql, mensagem, normalizacoes),
        _fallbackLocal: true,
        _bypassMotivo: temChave ? 'ia_falhou_fallback_deterministico' : 'sem_chave_fallback_deterministico',
      }, {
        acao: 'fallback_dinamico',
        motor: 'sistema',
        intencao: intencaoAiSql?.nome,
        detalhe: temChave ? 'ia_falhou_fallback_deterministico' : 'sem_chave_fallback_deterministico',
      });
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
    const temAiSql  = intencoes.some(i => i.acao === 'ai_text_to_sql');
    console.log(`[IA temConfigMin] empresaId=${empresaId} | intencoes=${intencoes.length} | temAiSql=${temAiSql}`);
    if (!intencoes.length) return false;
    if (temAiSql) {
      const db = getDB();
      const temSx2 = Number(db.prepare(
        'SELECT COUNT(*) AS total FROM protheus_sx2 WHERE empresa_id = ?'
      ).get(empresaId)?.total || 0) > 0;
      const agente = db.prepare(
        `SELECT agente_local_ativo, agente_local_url, agente_local_token
           FROM ai_config WHERE empresa_id = ? LIMIT 1`
      ).get(empresaId);
      const temAgente = Boolean(agente?.agente_local_ativo && agente?.agente_local_url && agente?.agente_local_token);
      const temConexao = Number(db.prepare(
        'SELECT COUNT(*) AS total FROM connections WHERE empresa_id = ? AND ativo = 1'
      ).get(empresaId)?.total || 0) > 0;
      const apta = temSx2 && (temAgente || temConexao);
      console.log(`[IA temConfigMin] empresaId=${empresaId} | sx2=${temSx2} | agente=${temAgente} | conexao=${temConexao} | apta=${apta}`);
      return apta;
    }
    const datasets = crud.listar('datasets', { empresa_id: empresaId });
    console.log(`[IA temConfigMin] empresaId=${empresaId} | datasets=${datasets.length}`);
    return datasets.length > 0;
  } catch (err) {
    console.error(`[IA temConfigMin] empresaId=${empresaId} | erro:`, err.message);
    return false;
  }
}

module.exports = {
  classificar,
  temConfiguracaoMinima,
  _SINONIMOS_SISTEMA,
  _resolveKeys,
  _normalizarOrdem,
  _intencaoAiSqlPreferencial,
  _ranquearIntencoesAiSql,
  _mensagemDinamicaAmbigua,
  _deveBypassDinamico,
  _mensagemPareceAiSqlDinamico,
  _mensagemPareceComprasAiSql,
  _intentAiSqlDireto,
  _garantirIntencoesDinamicasPadrao,
  invalidateCache,
};
