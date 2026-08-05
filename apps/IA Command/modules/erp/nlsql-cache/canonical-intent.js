'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = '1.0.0';
const SPEC_VERSION = 'intent-canonico-erp-v1';
const PROMPT_VERSION = 'ia-owner-v1';

const MODULOS = new Set(['financeiro', 'compras', 'faturamento', 'comissao', 'estoque', 'generico', 'cross_module']);

const FILTERS_COMUNS = new Set([
  'filial',
  'cliente',
  'cliente_id',
  'fornecedor',
  'fornecedor_id',
  'vendedor',
  'vendedor_id',
  'produto',
  'produto_id',
  'grupo_produto',
  'centro_custo',
  'natureza',
  'tes',
  'status',
  'status_titulo',
  'vencido',
  'carteira',
  'banco',
  'conta',
  'aprovador',
  'aprovador_id',
  'deposito',
  'deposito_id',
  'incluir_canceladas',
  'incluir_devolucoes',
]);

const GROUP_BY_COMUNS = new Set([
  'cliente',
  'fornecedor',
  'vendedor',
  'produto',
  'grupo_produto',
  'centro_custo',
  'natureza',
  'tes',
  'banco',
  'conta',
  'filial',
  'dia',
  'mes',
  'ano',
  'periodo',
  'aprovador',
  'deposito',
]);

const DATE_BASIS_POR_MODULO = {
  financeiro: new Set(['emissao', 'vencimento', 'vencimento_real', 'baixa', 'movimento', 'posicao_atual', 'projecao', 'desconhecido']),
  compras: new Set(['emissao', 'digitacao', 'pedido', 'previsao_entrega', 'aprovacao', 'desconhecido']),
  faturamento: new Set(['emissao', 'saida', 'devolucao', 'desconhecido']),
  comissao: new Set(['emissao', 'baixa', 'competencia', 'desconhecido']),
  estoque: new Set(['posicao_atual', 'movimento', 'emissao', 'desconhecido']),
  generico: new Set(['desconhecido']),
  cross_module: new Set(['desconhecido']),
};

function stableStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function moduloDaSpec(spec = {}, intent = {}) {
  const candidatos = [
    spec.nome,
    spec.handlerName,
    intent._moduloDinamico,
    String(intent.intencao || '').replace(/_dinamico$/i, ''),
  ].filter(Boolean);
  for (const candidato of candidatos) {
    const v = normalizarTexto(candidato).replace(/-ia-owner$/i, '').replace(/_dinamico$/i, '');
    if (MODULOS.has(v)) return v;
  }
  if (Array.isArray(spec.modulos) && spec.modulos.length > 1) return 'cross_module';
  return 'generico';
}

function normalizarPeriodo(periodo = {}) {
  const p = periodo && typeof periodo === 'object' ? periodo : {};
  return {
    tipo: p.tipo || p.kind || null,
    start: p.start || p.inicio || p.dataInicio || p.data_inicio || null,
    end: p.end || p.fim || p.dataFim || p.data_fim || null,
    granularidade: p.granularidade || p.grain || null,
    source: p.source || p.origem || null,
  };
}

function normalizarGroupBy(intent = {}) {
  const valores = Array.isArray(intent.group_by) && intent.group_by.length
    ? intent.group_by
    : Array.isArray(intent.agrupar_por_composto) && intent.agrupar_por_composto.length
      ? intent.agrupar_por_composto
      : intent.agrupar_por ? [intent.agrupar_por] : [];
  return [...new Set(valores.map(v => normalizarTexto(v).replace(/\s+/g, '_')).filter(Boolean))];
}

function normalizarFiltros(filtros = {}) {
  const out = {};
  for (const [chave, valor] of Object.entries(filtros || {})) {
    if (valor === undefined || valor === null || valor === '') continue;
    const k = normalizarTexto(chave).replace(/\s+/g, '_');
    if (!k) continue;
    if (Array.isArray(valor)) {
      out[k] = valor.map(v => String(v).trim()).filter(Boolean).sort();
    } else if (typeof valor === 'object') {
      out[k] = JSON.parse(stableStringify(valor));
    } else if (typeof valor === 'boolean' || typeof valor === 'number') {
      out[k] = valor;
    } else {
      out[k] = String(valor).trim();
    }
  }
  return out;
}

function normalizarEntidades(entidades = []) {
  return (Array.isArray(entidades) ? entidades : [])
    .map(e => ({
      tipo: normalizarTexto(e?.tipo || e?.tipo_sugerido).replace(/\s+/g, '_') || null,
      codigo: e?.codigo == null ? null : String(e.codigo).trim(),
      loja: e?.loja == null ? null : String(e.loja).trim(),
      nome: e?.nome ? String(e.nome).trim() : null,
      origem: e?.origem || e?.termoBusca ? String(e.origem || 'resolver') : null,
      security: normalizarTexto(e?.tipo) === 'vendedor_fixo_seguranca',
    }))
    .filter(e => e.tipo)
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

function inferirMetricas(intent = {}, mensagem = '') {
  const metricas = [];
  const add = (valor) => {
    const v = normalizarTexto(String(valor || '').split(':')[0]).replace(/\s+/g, '_');
    if (v && !metricas.includes(v)) metricas.push(v);
  };
  if (Array.isArray(intent._metricasDetectadas)) intent._metricasDetectadas.forEach(add);
  add(intent.metric);
  add(intent.metrica);
  add(intent.ordenar_por);
  const texto = normalizarTexto(`${intent.intencao || ''} ${mensagem || ''}`);
  if (/\bfaturamento|vend/.test(texto)) add('faturamento');
  if (/\bcompr/.test(texto)) add('compras');
  if (/\b(recebid|receber)\b/.test(texto)) add('receber');
  if (/\b(pag|pagar)\b/.test(texto)) add('pagar');
  if (/\bcomiss/.test(texto)) add('comissao');
  if (/\bsaldo|estoque\b/.test(texto)) add('saldo');
  return metricas.length ? metricas : ['default'];
}

function inferirDateBasis(modulo, intent = {}, mensagem = '') {
  const texto = normalizarTexto(`${intent.date_basis || ''} ${intent.campo_data || ''} ${mensagem}`);
  if (/\bvenc/.test(texto)) return 'vencimento';
  if (/\bbaix|recebid|pag[oa]s?|pagamento|moviment/.test(texto)) return modulo === 'financeiro' ? 'baixa' : 'movimento';
  if (/\bdigit/.test(texto)) return 'digitacao';
  if (/\baprov/.test(texto)) return 'aprovacao';
  if (/\bestoque|saldo atual|posicao atual/.test(texto)) return 'posicao_atual';
  if (/\bcompet/.test(texto)) return 'competencia';
  if (/\bemiss|fatur|compr|vend/.test(texto)) return 'emissao';
  return 'desconhecido';
}

function buscarSecurityScope({ empresaId, numeroWa }) {
  const scope = {
    erp_tipo: null,
    erp_id: null,
    cod_aprov_erp: null,
    cod_cliente_erp: null,
  };
  if (!empresaId || !numeroWa) return scope;
  try {
    const { getDB } = require('../../database');
    const channelStore = require('../../whatsapp/channel-store');
    const variantes = channelStore.variantesNumeroBrasil(numeroWa);
    const lid = channelStore.extrairLid(numeroWa);
    if (!variantes.length) return scope;
    const placeholders = variantes.map(() => '?').join(',');
    const row = getDB().prepare(`
      SELECT erp_tipo, erp_id, cod_aprov_erp, cod_cliente_erp
        FROM whatsapp_allowed_numbers
       WHERE empresa_id = ?
         AND ativo = 1
         AND (numero IN (${placeholders}) OR wa_lid = ?)
       LIMIT 1
    `).get(Number(empresaId), ...variantes, lid);
    if (!row) return scope;
    return {
      erp_tipo: row.erp_tipo ? String(row.erp_tipo).trim().toLowerCase() : null,
      erp_id: row.erp_id ? String(row.erp_id).trim().toUpperCase() : null,
      cod_aprov_erp: row.cod_aprov_erp ? String(row.cod_aprov_erp).trim().toUpperCase() : null,
      cod_cliente_erp: row.cod_cliente_erp ? String(row.cod_cliente_erp).trim().toUpperCase() : null,
    };
  } catch (_) {
    return scope;
  }
}

function validarContrato(intentCanonico = {}) {
  const erros = [];
  const modulo = intentCanonico.module;
  if (!MODULOS.has(modulo)) erros.push(`Modulo nao suportado: ${modulo || '(vazio)'}`);
  if (!intentCanonico.intent) erros.push('Campo intent obrigatorio ausente.');
  if (!Array.isArray(intentCanonico.metric) || !intentCanonico.metric.length) erros.push('Campo metric deve ser lista nao vazia.');
  const bases = DATE_BASIS_POR_MODULO[modulo] || DATE_BASIS_POR_MODULO.generico;
  if (!bases.has(intentCanonico.date_basis)) erros.push(`date_basis invalido para ${modulo}: ${intentCanonico.date_basis}`);
  for (const g of intentCanonico.group_by || []) {
    if (!GROUP_BY_COMUNS.has(g)) erros.push(`group_by nao catalogado: ${g}`);
  }
  for (const f of Object.keys(intentCanonico.filters || {})) {
    if (!FILTERS_COMUNS.has(f)) erros.push(`filtro nao catalogado: ${f}`);
  }
  if (!intentCanonico.security_scope || typeof intentCanonico.security_scope !== 'object') {
    erros.push('security_scope obrigatorio ausente.');
  }
  return { ok: erros.length === 0, erros };
}

function gerarIntentCanonico({ spec = {}, intent = {}, empresaId, mensagem, entidadesResolvidas = [], modelo = null, plano = null } = {}) {
  const module = moduloDaSpec(spec, intent);
  const period = normalizarPeriodo(plano?.periodo || intent._periodoCanonicoResolvido || intent.periodo || {});
  const filters = normalizarFiltros({ ...(intent.filtros || {}), ...(plano?.filtros || {}) });
  const groupBy = normalizarGroupBy({ ...intent, ...(plano?.group_by ? { group_by: plano.group_by } : {}) });
  const canonico = {
    schema_version: spec.schemaVersion || SCHEMA_VERSION,
    spec_version: spec.specVersion || SPEC_VERSION,
    prompt_version: spec.promptVersion || PROMPT_VERSION,
    model: modelo || spec.model || null,
    module,
    intent: String(intent.intencao || spec.defaultIntent || `${module}_dinamico` || 'desconhecido'),
    metric: inferirMetricas({ ...intent, ...(plano || {}) }, mensagem),
    date_basis: inferirDateBasis(module, intent, mensagem),
    group_by: groupBy,
    period,
    filters,
    entities: normalizarEntidades(entidadesResolvidas.length ? entidadesResolvidas : intent._entidadesResolvidas),
    empresa_id: empresaId == null ? null : Number(empresaId),
    security_scope: buscarSecurityScope({ empresaId, numeroWa: intent._remetente || intent.numero_wa || null }),
  };
  const validation = validarContrato(canonico);
  canonico.validation = validation;

  const estrutural = {
    schema_version: canonico.schema_version,
    spec_version: canonico.spec_version,
    prompt_version: canonico.prompt_version,
    module: canonico.module,
    intent: canonico.intent,
    metric: canonico.metric,
    date_basis: canonico.date_basis,
    group_by: canonico.group_by,
    filter_keys: Object.keys(canonico.filters).sort(),
    entity_types: canonico.entities.map(e => ({
      tipo: e.tipo,
      tem_loja: e.loja != null,
      security: !!e.security,
    })),
    security_scope: canonico.security_scope,
    empresa_id: canonico.empresa_id,
  };

  return {
    canonical: canonico,
    canonicalHash: hash(canonico),
    structural: estrutural,
    cacheKey: hash(estrutural),
  };
}

module.exports = {
  SCHEMA_VERSION,
  SPEC_VERSION,
  PROMPT_VERSION,
  gerarIntentCanonico,
  validarContrato,
  stableStringify,
  _test: {
    normalizarPeriodo,
    normalizarFiltros,
    normalizarGroupBy,
    inferirMetricas,
    inferirDateBasis,
    moduloDaSpec,
  },
};
