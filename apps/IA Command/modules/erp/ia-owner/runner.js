'use strict';

const fs = require('fs');
const path = require('path');
const connectionFactory = require('../providers/connection-factory');
const aiProviderClient = require('../ai-provider-client');
const sx2SqlNormalizer = require('../sx2-sql-normalizer');
const sx3SqlValidator = require('../sx3-sql-validator');
const entitySqlGuard = require('../entity-sql-guard');
const responseFormatter = require('../response-formatter');
const channelStore = require('../../whatsapp/channel-store');
const queryPlan = require('../query-plan');
const canonicalWhatsappFormat = require('../canonical-whatsapp-format');
const promptBuilder = require('./prompt-builder');
const entityResolver = require('../../ai/entity-resolver');

const PIPELINE_TRACE_FILE = path.join(__dirname, '..', '..', '..', '..', '..', 'logs', 'iac-whatsapp-pipeline.log');

function _traceIaOwner(evento, dados = {}) {
  try {
    const mem = process.memoryUsage();
    fs.mkdirSync(path.dirname(PIPELINE_TRACE_FILE), { recursive: true });
    fs.appendFileSync(
      PIPELINE_TRACE_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        evento,
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
        ...dados,
      }) + '\n',
      'utf8',
    );
  } catch (_) {}
}

// ── Cache de metadados ERP (configProtheus / SX2 / SX3) ────────────────────
const _metaCache = new Map();
const _META_TTL_MS = 5 * 60 * 1000;  // 5 minutos

function _metaCacheGet(key) {
  const item = _metaCache.get(key);
  if (!item || item.expiraEm < Date.now()) {
    if (item) _metaCache.delete(key);
    return null;
  }
  return item.valor;
}

function _metaCacheSet(key, valor) {
  _metaCache.set(key, { valor, expiraEm: Date.now() + _META_TTL_MS });
  return valor;
}

function invalidarMetaCache(empresaId) {
  const prefix = `:${empresaId}:`;
  for (const key of _metaCache.keys()) {
    if (key.includes(prefix)) _metaCache.delete(key);
  }
}

function baseTabelaSX2(nome) {
  return sx2SqlNormalizer.baseTabelaSX2(nome);
}

function tabelaFisicaSX2(sx2, base) {
  const alvo = String(base || '').trim().toUpperCase();
  return Object.keys(sx2 || {}).find(n => baseTabelaSX2(n) === alvo) || null;
}

function sufixoTabelaFisica(nome) {
  return sx2SqlNormalizer.sufixoTabelaSX2(nome);
}

function sufixosPorTabelaSX2(sx2) {
  const out = {};
  for (const tabela of Object.keys(sx2 || {})) {
    const base = baseTabelaSX2(tabela);
    const sufixo = sufixoTabelaFisica(tabela);
    if (base && sufixo) out[base] = sufixo;
  }
  return out;
}

function inferirSufixoSX2(sx2, fallback) {
  if (fallback) return fallback;
  const sufixos = [...new Set(Object.keys(sx2 || {}).map(sufixoTabelaFisica).filter(Boolean))];
  return sufixos.length === 1 ? sufixos[0] : null;
}

function dataAtualServidor() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const MESES_CRONOLOGICOS = 'janeiro|jan|fevereiro|fev|marco|mar\\u00e7o|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez';

function mensagemTemPeriodoRelativo(mensagem) {
  const texto = String(mensagem || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  // "do dia" / "no dia" seguidos de número são datas absolutas (ex: "do dia 10"), não relativas.
  const textoSemDiaAbsoluto = texto.replace(/\b(do|no)\s+dia\s+\d/g, '');
  // "maio de 2026", "janeiro de 2025" etc. são datas absolutas — remove antes de testar período relativo.
  const textoSemMesAbsoluto = textoSemDiaAbsoluto.replace(
    /\b(?:janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)\s+de\s+\d{4}\b/g,
    ''
  );
  return new RegExp(`\\b(hoje|ontem|do dia|no dia|dia atual|dia anterior|mes atual|deste mes|este mes|no mes|do mes|mes passado|ano atual|deste ano|este ano|do ano|no ano|ano passado|semana passada|ultima semana|ultimo mes|ultimo ano|${MESES_CRONOLOGICOS})\\b`).test(textoSemMesAbsoluto);
}

function limparPeriodosNaoAutoritativos(estadoAnterior = {}, mensagem = '') {
  if (!mensagemTemPeriodoRelativo(mensagem)) return estadoAnterior;
  const estado = { ...(estadoAnterior || {}) };
  estado.aviso_periodo_relativo = 'A mensagem atual contem periodo relativo; ignore periodos/contratos antigos e calcule usando contextoTecnico.data_atual.';
  estado.periodo = null;
  if (estado.contrato_orquestrador && typeof estado.contrato_orquestrador === 'object') {
    estado.contrato_orquestrador = {
      ...estado.contrato_orquestrador,
      periodo: null,
      contexto_usado: null,
      herdou_contexto: false,
    };
  }
  if (estado.contexto_ia_anterior && typeof estado.contexto_ia_anterior === 'object') {
    estado.contexto_ia_anterior = {
      ...estado.contexto_ia_anterior,
      periodo: null,
      periodo_mantido: false,
    };
  }
  return estado;
}

function escapeSqlLiteral(valor) {
  return String(valor || '').replace(/'/g, "''");
}

function limitarTexto(valor, max = 4000) {
  const texto = String(valor || '');
  return texto.length > max ? `${texto.slice(0, max)}...` : texto;
}

function mensagemErro(spec, tipo) {
  const msgs = spec.mensagensErro || {};
  const fallback = {
    ia_indisponivel: 'Nao consigo processar sua consulta no momento. Tente novamente em breve.',
    sql_invalido: 'Tivemos uma inconsistencia ao interpretar sua consulta. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado: 'Nao encontrei registros para essa consulta.',
    erro_erp: 'Nao consegui buscar essa informacao no sistema. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao: 'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  };
  return msgs[tipo] || fallback[tipo] || fallback.erro_erp;
}

function maxTentativasPrepararSql(entidadesResolvidas = []) {
  return 3;
}

function _linhasEntidadesRetry(entidadesResolvidas = []) {
  const entidades = Array.isArray(entidadesResolvidas) ? entidadesResolvidas : [];
  if (!entidades.length) return [];
  return [
    'Entidades obrigatorias ja resolvidas:',
    ...entidades
      .filter(entidade => entidade?.codigo)
      .map(entidade => {
        const tipo = String(entidade.tipo || 'entidade');
        const codigo = String(entidade.codigo || '');
        const loja = entidade._todos
          ? 'todas (_todos=true; nao filtre loja fixa)'
          : entidade.loja ? String(entidade.loja) : 'nao informada';
        const nome = entidade.nome ? ` | nome: ${entidade.nome}` : '';
        return `- ${tipo}: codigo ${codigo}; loja ${loja}${nome}`;
      }),
    '',
  ];
}

function buildRetryTecnicoIaOwner({ erro, entidadesResolvidas = [] } = {}) {
  const subtipo = String(erro?._tipo || '').trim();
  const mensagem = String(erro?.message || erro || '').trim();
  const linhasEntidades = _linhasEntidadesRetry(entidadesResolvidas);
  const base = [
    'RETRY TECNICO IA-OWNER',
    '',
    `Motivo da rejeicao: ${mensagem || subtipo || 'erro nao classificado'}`,
    '',
  ];

  let bloco;
  if (subtipo === 'contrato_entidade_invalido' || /entidades resolvidas|filtro de codigo|filtro da loja|por nome\/descricao/i.test(mensagem)) {
    bloco = [
      'Contrato obrigatorio:',
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL a partir da pergunta original.',
      '- Preserve periodo, metrica, tabelas e escopo tecnico.',
      '- Aplique as entidades resolvidas usando codigo interno.',
      '- Se _todos=true, filtre somente o codigo da entidade; nao filtre loja fixa.',
      '',
      'Nao fazer:',
      '- Nao filtrar por nome, descricao ou LIKE.',
      '- Nao remover periodo, metrica ou demais filtros ja corretos.',
    ];
  } else if (/D_E_L_E_T_|deletad/i.test(mensagem)) {
    bloco = [
      'Contrato obrigatorio:',
      "- Toda tabela no FROM/JOIN precisa de D_E_L_E_T_ = ' '.",
      "- Tabela principal: filtro no WHERE.",
      "- Tabelas em JOIN: filtro dentro do ON.",
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL a partir da pergunta original.',
      '- Preserve periodo, metrica, entidades resolvidas e filtros cadastrais.',
      '- Corrija TODOS os problemas listados no motivo da rejeicao em um unico SQL — nao apenas D_E_L_E_T_.',
      '- Antes de retornar: verifique D_E_L_E_T_ em todas as tabelas E releia o CONTRATO OBRIGATORIO DE SQL no contexto tecnico.',
    ];
  } else if (subtipo === 'contrato_query_plan_invalido' || /plano estruturado|campo_data_semantico|baixa\/movimento|baixa_movimento/i.test(mensagem)) {
    bloco = [
      'Contrato obrigatorio:',
      '- O SQL deve respeitar o query_plan enviado em contextoTecnico.',
      '- Quando query_plan.campo_data_semantico = baixa_movimento, filtre o periodo por baixa/movimento real, nao por emissao ou vencimento.',
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL a partir da pergunta original e do query_plan atual.',
      '- Preserve periodo, metrica, entidades resolvidas e agrupamentos solicitados.',
    ];
  } else if (subtipo === 'periodo_sql_inconsistente' || /periodo|temporal|data/i.test(mensagem)) {
    bloco = [
      'Contrato obrigatorio:',
      '- O periodo declarado no plano deve aparecer no SQL em campo temporal valido do modulo.',
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL aplicando explicitamente o periodo no WHERE/subquery correta.',
      '- Preserve metrica, entidades resolvidas e agrupamentos solicitados.',
    ];
  } else if (subtipo === 'contrato_sx3_invalido' || /SX3|Campo .* nao consta/i.test(mensagem)) {
    bloco = [
      'Contrato obrigatorio:',
      '- Use somente campos existentes no SX3/contexto tecnico atual.',
      '- Alias calculado em CTE/subquery deve ser referenciado pelo alias exportado, nao pela tabela original.',
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL substituindo campos invalidos por campos permitidos.',
      '- Preserve periodo, metrica e entidades resolvidas.',
    ];
  } else if (subtipo === 'sql_parametro_entidade_pendente' || /placeholder|parametro/i.test(mensagem)) {
    bloco = [
      'Contrato obrigatorio:',
      '- Nao deixe placeholders de entidade pendentes no SQL final.',
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL usando os codigos internos das entidades resolvidas.',
      '- Preserve periodo, metrica e escopo tecnico.',
    ];
  } else {
    bloco = [
      'Contrato obrigatorio:',
      '- O SQL deve respeitar o erro tecnico informado e o contexto tecnico atual.',
      ...linhasEntidades,
      'Tarefa:',
      '- Gere novo SQL do zero a partir da pergunta original.',
      '- Preserve periodo, metrica, entidades resolvidas, agrupamentos e tabelas corretas.',
      '- Corrija especificamente a violacao apontada no motivo da rejeicao.',
      '',
      'Nao fazer:',
      '- Nao copiar o SQL anterior sem revisar todos os contratos.',
    ];
  }

  return [
    ...base,
    ...bloco,
    '',
    'Retorne somente o JSON obrigatorio.',
  ].join('\n');
}

function subtipoEhInconsistenciaConsulta(subtipo) {
  return /^(?:contrato_|sql_|periodo_sql_|funcao_data_|filtro_|ia_indisponivel|sem_chave|cota_esgotada)/i.test(String(subtipo || ''));
}

function extrairJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const texto = String(raw || '').trim();
  try { return JSON.parse(texto); } catch (_) {}
  const semFence = texto.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(semFence); } catch (_) {}
  const match = semFence.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

function extrairSQL(raw) {
  const obj = extrairJson(raw);
  if (obj?.sql) return String(obj.sql).trim();
  const texto = String(raw || '').trim();
  const m = texto.match(/SET\s+ROWCOUNT[\s\S]+/i);
  return m ? m[0].trim() : null;
}

function configProtheus(empresaId) {
  const cacheKey = `cfg::${empresaId}::`;
  const cached = _metaCacheGet(cacheKey);
  if (cached) return cached;
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    let row = db.prepare('SELECT id, configuracoes FROM connections WHERE empresa_id = ? AND ativo = 1 LIMIT 1').get(empresaId);
    if (!row) {
      const sx2Row = db.prepare('SELECT connection_id FROM protheus_sx2 WHERE empresa_id = ? LIMIT 1').get(empresaId);
      if (sx2Row?.connection_id) row = db.prepare('SELECT id, configuracoes FROM connections WHERE id = ? AND ativo = 1').get(sx2Row.connection_id);
    }
    const cfg = row?.configuracoes ? JSON.parse(row.configuracoes) : {};
    return _metaCacheSet(cacheKey, { conexaoId: row?.id || null, sufixoTabela: cfg.sufixo_tabela || '010', filialPadrao: cfg.filial_padrao || null });
  } catch (_) {
    return { conexaoId: null, sufixoTabela: '010', filialPadrao: null };
  }
}

function modosSX2(tabelas, conexaoId, empresaId) {
  if (!conexaoId) return null;
  const cacheKey = `sx2::${empresaId}::${conexaoId}::${(tabelas || []).slice().sort().join(',')}`;
  const cached = _metaCacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const { getDB } = require('../../database');
    // Busca entradas da empresa + entradas globais da conexão (empresa_id NULL).
    // Entradas específicas da empresa têm prioridade sobre as globais.
    const rowsGlobal = getDB().prepare('SELECT chave, arquivo, modo FROM protheus_sx2 WHERE connection_id = ? AND (empresa_id IS NULL OR empresa_id = 0)').all(conexaoId);
    const rowsEmpresa = getDB().prepare('SELECT chave, arquivo, modo FROM protheus_sx2 WHERE connection_id = ? AND empresa_id = ?').all(conexaoId, empresaId);
    const bases = new Set(tabelas || []);
    const mapa = {};
    for (const row of [...rowsGlobal, ...rowsEmpresa]) {
      const arquivo = String(row.arquivo || row.chave || '').trim().toUpperCase();
      if (arquivo && bases.has(baseTabelaSX2(arquivo))) mapa[arquivo] = row.modo;
    }
    const resultado = Object.keys(mapa).length ? mapa : null;
    _metaCacheSet(cacheKey, resultado);
    return resultado;
  } catch (_) {
    return null;
  }
}

function completarSX2Permitidas(sx2, tabelas = [], sufixoTabela = '010') {
  const sufixo = String(sufixoTabela || '010').trim() || '010';
  const mapa = { ...(sx2 || {}) };
  const basesExistentes = new Set(Object.keys(mapa).map(baseTabelaSX2));
  for (const tabela of tabelas || []) {
    const base = String(tabela || '').trim().toUpperCase();
    if (!base || basesExistentes.has(base)) continue;
    mapa[`${base}${sufixo}`] = 'E';
    basesExistentes.add(base);
  }
  return Object.keys(mapa).length ? mapa : null;
}

function camposSX3(tabelas, conexaoId, empresaId, limite = 80, essenciais = {}) {
  const montarEssenciais = () => {
    const out = {};
    const sufixos = ['010', '020', '990'];
    for (const [base, campos] of Object.entries(essenciais || {})) {
      const b = String(base || '').toUpperCase();
      const rows = (campos || []).map(campo => ({ campo, tipo: null, tamanho: null, decimal: null, descricao: 'campo padrao essencial IA-OWNER' }));
      out[b] = rows;
      for (const suf of sufixos) out[`${b}${suf}`] = rows;
    }
    return Object.keys(out).length ? out : null;
  };
  if (!conexaoId) return { completo: null, validacao: null };
  const cacheKey = `sx3::${empresaId}::${conexaoId}::${(tabelas || []).slice().sort().join(',')}`;
  const cached = _metaCacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const { getDB } = require('../../database');
    const bases = [...new Set((tabelas || []).map(baseTabelaSX2).filter(Boolean))];
    if (!bases.length) {
      const essenciaisFallback = montarEssenciais();
      return { completo: essenciaisFallback, validacao: null };
    }
    const filtrosTabela = bases
      .map(() => '(UPPER(tabela) = ? OR UPPER(tabela) LIKE ?)')
      .join(' OR ');
    const paramsTabela = bases.flatMap(base => [base, `${base}%`]);
    const rows = getDB().prepare(`
      SELECT tabela, campo, tipo, tamanho, decimal, titulo, descricao
      FROM protheus_sx3
      WHERE connection_id = ? AND empresa_id = ?
        AND (${filtrosTabela})
      ORDER BY tabela, ordem, campo
    `).all(conexaoId, empresaId, ...paramsTabela);
    const basesSet = new Set(bases);
    const mapa = {};
    // mapaValidacao contém apenas campos confirmados pelo banco real — sem injeção de essenciais.
    // Usado exclusivamente pelo sx3SqlValidator para evitar aceitar campos que não existem no tenant.
    const mapaValidacao = {};
    for (const row of rows) {
      const tabela = String(row.tabela || '').toUpperCase().trim();
      if (!basesSet.has(baseTabelaSX2(tabela))) continue;
      if (!mapa[tabela]) { mapa[tabela] = []; mapaValidacao[tabela] = []; }
      const base = baseTabelaSX2(tabela);
      const essencial = new Set((essenciais[base] || []).map(c => String(c || '').toUpperCase()));
      const campoNorm = String(row.campo || '').toUpperCase();
      if (mapa[tabela].length >= limite && !essencial.has(campoNorm)) continue;
      if (mapa[tabela].some(c => String(c.campo || '').toUpperCase() === campoNorm)) continue;
      const entrada = {
        campo: row.campo,
        tipo: row.tipo,
        tamanho: row.tamanho,
        decimal: row.decimal,
        descricao: row.titulo || row.descricao || '',
      };
      mapa[tabela].push(entrada);
      mapaValidacao[tabela].push(entrada);
    }
    // Injeta campos essenciais do spec apenas no mapa completo (prompt).
    // O mapaValidacao permanece intacto com apenas o que o banco real possui.
    for (const [base, campos] of Object.entries(essenciais || {})) {
      const tabelasFisicas = Object.keys(mapa).filter(t => baseTabelaSX2(t) === String(base).toUpperCase());
      const alvos = tabelasFisicas.length ? tabelasFisicas : [String(base).toUpperCase()];
      for (const tabela of alvos) {
        if (!mapa[tabela]) mapa[tabela] = [];
        const existentes = new Set(mapa[tabela].map(c => String(c.campo || '').toUpperCase()));
        for (const campo of campos || []) {
          const c = String(campo || '').toUpperCase();
          if (c && !existentes.has(c)) mapa[tabela].push({ campo: c, tipo: null, tamanho: null, decimal: null, descricao: 'campo padrao essencial IA-OWNER' });
        }
      }
    }
    const essenciaisFallback = montarEssenciais();
    const resultado = {
      completo: Object.keys(mapa).length ? mapa : essenciaisFallback,
      // Se não há dados reais do banco, não há como validar — usa null para desabilitar validação SX3.
      // Isso preserva o comportamento anterior para tenants sem SX3 cadastrado.
      validacao: Object.keys(mapaValidacao).length ? mapaValidacao : null,
    };
    _metaCacheSet(cacheKey, resultado);
    return resultado;
  } catch (_) {
    const essenciaisFallback = montarEssenciais();
    return { completo: essenciaisFallback, validacao: null };
  }
}

// Achata o mapa do SX3 (por tabela fisica) em CAMPO -> titulo cadastrado, para o
// formatter canonico exibir nomes legiveis (ex: E2_VENCREA -> "Venc Real Tit") sem
// depender de heuristica regex ou de a IA escolher um alias amigavel no SELECT.
function labelsSx3ParaFormatacao(sx3Completo) {
  const out = {};
  for (const campos of Object.values(sx3Completo || {})) {
    for (const { campo, descricao } of campos || []) {
      const c = String(campo || '').toUpperCase();
      if (c && descricao && !out[c]) out[c] = descricao;
    }
  }
  return out;
}

function sx3EssencialParaPrompt(essenciais = {}) {
  const out = {};
  for (const [base, campos] of Object.entries(essenciais || {})) {
    out[String(base || '').toUpperCase()] = (campos || []).map(campo => ({
      campo: String(campo || '').toUpperCase(),
      tipo: null,
      tamanho: null,
      decimal: null,
      descricao: 'campo essencial para IA-OWNER',
    }));
  }
  return Object.keys(out).length ? out : null;
}

async function chamarIaOwner(spec, keys, cfg, userPrompt, opts = {}) {
  const systemPrompt = promptBuilder.buildSystemPrompt(spec, {
    modeloBaixasReceber: opts.modeloBaixasReceber,
    modeloBaixasPagar: opts.modeloBaixasPagar,
    mensagem: opts.mensagem,
  });
  const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
    json: true,
    maxTokens: spec.maxTokens || 3500,
    timeoutMs: spec.timeoutMs || 45000,
    temperature: 0,
    geminiCombinedPrompt: true,
    logPrefix: spec.logPrefix || 'IAOwner',
    ...opts,
  });
  const obj = extrairJson(raw);
  if (!obj || typeof obj !== 'object') throw new Error('IA-OWNER nao retornou JSON valido.');
  return { raw, obj, sql: obj.sql ? String(obj.sql).trim() : extrairSQL(raw), systemPrompt, userPrompt };
}

const _TIPOS_ENTIDADE_CADASTRAL = new Set([
  'cliente', 'fornecedor', 'vendedor', 'produto', 'grupo_produto',
  'marca', 'centro_custo', 'tes', 'transportadora', 'natureza', 'desconhecido',
]);

function normalizarEntidadesNecessarias(obj = {}) {
  return (Array.isArray(obj.entidades_necessarias) ? obj.entidades_necessarias : [])
    .map(e => ({
      tipo: String(e?.tipo || e?.tipo_sugerido || '').trim().toLowerCase(),
      tipo_sugerido: String(e?.tipo_sugerido || e?.tipo || '').trim().toLowerCase(),
      texto: String(e?.texto || '').trim(),
      origem: e?.origem || 'ia_owner',
    }))
    // Só tipos cadastrais são válidos — descarta condições operacionais como
    // "contas_pagas", "carteira", "contas_recebidas" que a IA pode declarar incorretamente.
    .filter(e => e.tipo && e.texto && _TIPOS_ENTIDADE_CADASTRAL.has(e.tipo));
}

function confirmacaoPodeEncerrarPlano(obj = {}) {
  return Boolean(obj.precisa_confirmacao && normalizarEntidadesNecessarias(obj).length === 0);
}

async function resolverEntidadesSeNecessario(spec, pedido, contexto) {
  if (typeof spec.resolverEntidades !== 'function' || !pedido.length) return { status: 'resolvido', entidades: [] };
  return spec.resolverEntidades({ pedidos: pedido, ...contexto });
}

function diagnosticoResolucaoEntidade(resolucao = {}) {
  if (!['ambigua', 'nao_encontrado'].includes(resolucao.status)) return null;
  return {
    status: resolucao.status,
    texto: resolucao.texto || resolucao.termo?.texto || null,
    origem: resolucao.origem || resolucao.termo?.origem || null,
    candidatos: Array.isArray(resolucao.candidatos) ? resolucao.candidatos : [],
    instrucao: 'A busca auxiliar do sistema nao resolveu esta entidade. Analise a pergunta original e gere o SQL pela IA usando apenas tabelas e sufixos do contexto tecnico atual.',
  };
}

function pedidosEntidadesParaResolverNoTenant(entidades = []) {
  return (Array.isArray(entidades) ? entidades : [])
    .filter(entidade => entidade?._resolverNoTenantAtual)
    .map(entidade => {
      const textoRaw = entidade.termoBusca || entidade.texto || entidade.nome;
      // Remove sufixos parentéticos preservando case original (busca cadastral pode ser case-sensitive)
      const texto = String(textoRaw || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || textoRaw;
      return { texto, tipo: entidade.tipo, tipo_sugerido: entidade.tipo, origem: 'filtro_estruturado' };
    })
    .filter(pedido => pedido.texto && pedido.tipo);
}

function normalizarTextoEntidade(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termosEmpresasIAHub(intent = {}) {
  return [
    ...(Array.isArray(intent._empresasMencionadasTextos) ? intent._empresasMencionadasTextos : []),
    intent._empresaMencionadaTexto,
  ].map(normalizarTextoEntidade).filter(Boolean);
}

function termoEhEmpresaIAHub(termo, intent = {}) {
  const texto = normalizarTextoEntidade(termo?.texto || termo);
  if (!texto) return false;
  return termosEmpresasIAHub(intent).some(empresa => texto === empresa || texto.includes(empresa) || empresa.includes(texto));
}

function _normalizarNomeEntidadeBase(valor) {
  // Remove sufixos parentéticos adicionados pelo sistema: "(todos)", "(todos os registros)", etc.
  return normalizarTextoEntidade(String(valor || '').replace(/\s*\([^)]*\)\s*$/, '').trim());
}

function entidadeResolvidaCompativel(termo, entidades = []) {
  const texto = normalizarTextoEntidade(termo?.texto);
  const tipo = String(termo?.tipo_sugerido || termo?.tipo || '').trim().toLowerCase();
  if (!texto) return false;
  return (entidades || []).some(entidade => {
    const tipoEntidade = String(entidade?.tipo || '').trim().toLowerCase();
    const nomeBase = _normalizarNomeEntidadeBase(entidade?.nome || entidade?.texto || entidade?.descricao);
    const nome = normalizarTextoEntidade(entidade?.nome || entidade?.texto || entidade?.descricao);
    const nomeMatch = (nomeBase && (nomeBase.includes(texto) || texto.includes(nomeBase)))
        || (nome && (nome.includes(texto) || texto.includes(nome)));
    if (!nomeMatch) return false;
    // Usuário escolheu "_todos" para esta entidade: resolvida independente do tipo extraído
    // (extração prévia pode classificar "empresa Aster" como tipo "empresa" em vez de "cliente")
    if (entidade?._todos) return true;
    if (tipo && tipo !== 'desconhecido' && tipo !== tipoEntidade) return false;
    return true;
  });
}

function mensagemMencionaValorEntidade(mensagem, valor) {
  const texto = normalizarTextoEntidade(mensagem);
  const alvo = normalizarTextoEntidade(valor);
  return Boolean(texto && alvo && (` ${texto} `).includes(` ${alvo} `));
}

function mensagemIniciaConsultaExplicitaDeModulo(mensagem) {
  const texto = normalizarTextoEntidade(mensagem);
  return /\b(faturamento|vendas|compras|comissao|financeiro|contas a pagar|contas a receber)\b/.test(texto);
}


function tipoEntidadePadraoParaFiltroEmpresa(spec, intent = {}) {
  if (spec.nome === 'financeiro') {
    const carteira = normalizarTextoEntidade(intent._orquestradorContrato?.carteira || intent.filtros?.carteira);
    if (carteira === 'pagar') return 'fornecedor';
    if (carteira === 'receber') return 'cliente';
  }
  return spec.entityCatalog?.TIPOS_POR_CONTEXTO?.[0] || null;
}

function normalizarFiltroEmpresaComoEntidade(spec, intent = {}, mensagem = '') {
  const valor = typeof intent.filtros?.empresa === 'string' ? intent.filtros.empresa.trim() : '';
  const temTenantValidado = Boolean(
    intent._empresaMencionadaId
    || (Array.isArray(intent._empresasMencionadasIds) && intent._empresasMencionadasIds.length)
    || intent._empresaMencionadaTexto
    || (Array.isArray(intent._empresasMencionadasTextos) && intent._empresasMencionadasTextos.length)
  );
  // Se o orquestrador declarou que herdou contexto, filtros.empresa é escopo de tenant preservado
  // de um turno anterior onde foi validado — não reclassificar como entidade cadastral.
  if (!valor || temTenantValidado || intent._herdouContextoOrquestrador) return intent;

  const tipoPadrao = tipoEntidadePadraoParaFiltroEmpresa(spec, intent);
  if (!tipoPadrao || !spec.entityCatalog?.DEFINICOES?.[tipoPadrao]) return intent;

  const filtros = { ...(intent.filtros || {}) };
  delete filtros.empresa;
  if (!filtros[tipoPadrao]) filtros[tipoPadrao] = valor;

  const explicitos = { ...(intent._filtroEntidadeExplicitaMensagem || {}) };
  delete explicitos.empresa;
  explicitos[tipoPadrao] = filtros[tipoPadrao];

  const contrato = intent._orquestradorContrato
    ? { ...intent._orquestradorContrato, filtros: { ...(intent._orquestradorContrato.filtros || {}), [tipoPadrao]: filtros[tipoPadrao] } }
    : intent._orquestradorContrato;
  if (contrato?.filtros) delete contrato.filtros.empresa;

  return {
    ...intent,
    filtros,
    _filtroEntidadeExplicitaMensagem: explicitos,
    _orquestradorContrato: contrato,
    _filtroEmpresaReclassificadoComoEntidade: { tipo: tipoPadrao, texto: valor },
  };
}

function limparFiltrosEntidadeHerdadosDaConsultaAtual(spec, intent = {}, mensagem = '') {
  if (!intent._herdouFiltros || !mensagemIniciaConsultaExplicitaDeModulo(mensagem)) return intent;

  const definicoes = spec.entityCatalog?.DEFINICOES || {};
  const explicitos = intent._filtroEntidadeExplicitaMensagem || {};
  const filtros = { ...(intent.filtros || {}) };
  const tiposRemovidos = new Set();

  for (const campo of Object.keys(definicoes)) {
    const valor = filtros[campo];
    if (!valor || explicitos[campo] || mensagemMencionaValorEntidade(mensagem, valor)) continue;
    delete filtros[campo];
    tiposRemovidos.add(String(campo).toLowerCase());
  }

  if (!tiposRemovidos.size) return intent;

  const filtrarEntidades = entidades => (Array.isArray(entidades) ? entidades : [])
    .filter(entidade => !tiposRemovidos.has(String(entidade?.tipo || '').toLowerCase()));
  const entidadesPorEmpresa = {};
  for (const [empresa, entidades] of Object.entries(intent._entidadesResolvidasPorEmpresa || {})) {
    const filtradas = filtrarEntidades(entidades);
    if (filtradas.length) entidadesPorEmpresa[empresa] = filtradas;
  }
  const contrato = intent._orquestradorContrato
    ? {
      ...intent._orquestradorContrato,
      filtros: Object.fromEntries(Object.entries(intent._orquestradorContrato.filtros || {})
        .filter(([campo]) => !tiposRemovidos.has(String(campo).toLowerCase()))),
    }
    : intent._orquestradorContrato;

  return {
    ...intent,
    filtros,
    _orquestradorContrato: contrato,
    _entidadesResolvidas: filtrarEntidades(intent._entidadesResolvidas),
    _entidadesResolvidasPorEmpresa: entidadesPorEmpresa,
    _filtrosEntidadeHerdadosIgnorados: [...tiposRemovidos],
  };
}

function deduplicarTermosEntidade(termos = [], intent = {}, entidadesResolvidas = []) {
  const vistos = new Set();
  return termos.filter(termo => {
    const texto = String(termo?.texto || '').trim();
    const chave = normalizarTextoEntidade(texto);
    if (!texto || termoEhEmpresaIAHub(termo, intent) || entidadeResolvidaCompativel(termo, entidadesResolvidas) || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function deduplicarEntidadesResolvidas(entidades = []) {
  const vistos = new Set();
  return (Array.isArray(entidades) ? entidades : []).filter(entidade => {
    const chave = `${String(entidade?.tipo || '').toLowerCase()}|${String(entidade?.codigo || '')}|${String(entidade?.loja || '')}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// Remove termos que são aliases de tenants IAHub do canal.
// Razão: "J2A" ou "C3I" na mensagem é escopo de execução multiempresa, não entidade cadastral.
// Só descarta se o termo bater exatamente (case-insensitive) com um alias de tenant do canal.
// Se não bater com nenhum tenant, o termo segue para resolução cadastral normalmente.
function _filtrarTermosTenant(termos, channelId) {
  if (!channelId || !termos.length) return termos;
  try {
    const empresas = channelStore.listarEmpresasDoCanal(channelId);
    const aliasesTenant = new Set(
      empresas
        .flatMap(e => String(e.aliases || '').split(',').map(a => a.trim().toLowerCase()))
        .filter(Boolean)
    );
    if (!aliasesTenant.size) return termos;
    return termos.filter(t => !aliasesTenant.has(String(t.texto || '').toLowerCase().trim()));
  } catch (_) {
    return termos;
  }
}

async function extrairTermosEntidadesAntesIa(spec, keys, cfg, mensagem, intent, entidadesResolvidas = [], empresaId = null) {
  if (!spec.resolverEntidadesAntesDaIa || typeof spec.resolverEntidades !== 'function') return [];
  const definicoes = spec.entityCatalog?.DEFINICOES || {};
  const explicitosMensagem = intent._filtroEntidadeExplicitaMensagem || {};
  const termosFiltros = Object.entries(intent.filtros || {})
    .filter(([campo, valor]) => (
      definicoes[campo]
      && typeof valor === 'string'
      && valor.trim()
      && (
        !intent._herdouFiltros
        || explicitosMensagem[campo]
        || mensagemMencionaValorEntidade(mensagem, valor)
      )
    ))
    .map(([campo, valor]) => ({ texto: valor.trim(), tipo_sugerido: campo, tipo: campo, confianca: 1, origem: 'filtro_estruturado' }));
  const explicitos = entityResolver.extrairExplicitos(mensagem);
  const termosAteAgora = [...termosFiltros, ...explicitos];

  // Chama IA apenas quando os termos determinísticos são insuficientes ou há ambiguidade.
  // Se filtros estruturados + explícitos já identificaram entidades, IA não acrescenta.
  const _AMBIGUO = /\b(cliente|fornecedor|produto|vendedor|transportadora)\s+\w/i;
  const precisaIaEntidades = termosAteAgora.length === 0 || _AMBIGUO.test(mensagem);

  let termosIa = [];
  if (precisaIaEntidades) {
    try {
      const raw = await aiProviderClient.chamarIA(
        keys,
        cfg,
        entityResolver.buildExtractionSystemPrompt(),
        entityResolver.buildExtractionUserPrompt(mensagem, spec.nome || 'erp'),
        {
          json: true,
          maxTokens: 500,
          temperature: 0,
          logPrefix: `${spec.logPrefix || 'IAOwner'}-entidades`,
          empresaId,
          numeroWa: intent._remetente || null,
          canalId: intent._channelId || intent._canalId || null,
          usageOrigem: 'ia-owner',
          usageOperacao: `${spec.nome || 'erp'}_entidades`,
        }
      );
      termosIa = entityResolver.normalizarEntidadesIA(raw);
    } catch (e) {
      console.warn(`[${spec.logPrefix || 'IAOwner'}] Extracao previa de entidades falhou; usando termos deterministicas:`, e.message);
    }
  }
  return deduplicarTermosEntidade([...termosAteAgora, ...termosIa], intent, entidadesResolvidas)
    .map(termo => ({
      ...termo,
      tipo: String(termo.tipo || termo.tipo_sugerido || 'desconhecido').trim().toLowerCase(),
      tipo_sugerido: String(termo.tipo_sugerido || termo.tipo || 'desconhecido').trim().toLowerCase(),
    }));
}

// Remove filtros que sao interpretacoes temporais pre-computadas pelo orquestrador sem ancora de data_atual.
// Esses campos (anos, meses, dias como arrays numericos) sao responsabilidade exclusiva da IA-OWNER,
// que tem acesso a data_atual no contexto tecnico e e a unica autoridade semantica sobre periodos.
// Passar arrays de anos/meses calculados a montante induz a IA-OWNER a ancorar em valores errados.
const FILTROS_TEMPORAIS_PROIBIDOS = new Set(['anos', 'meses', 'dias', 'years', 'months']);

function _removerFiltrosTemporaisOrquestrador(filtros = {}) {
  return Object.fromEntries(
    Object.entries(filtros).filter(([chave, valor]) => {
      if (FILTROS_TEMPORAIS_PROIBIDOS.has(String(chave).toLowerCase()) && Array.isArray(valor)) return false;
      return true;
    })
  );
}

function buildEstadoAnterior(intent = {}) {
  const temEmpresasIAHub = (Array.isArray(intent._empresasMencionadasTextos) && intent._empresasMencionadasTextos.length) || intent._empresaMencionadaTexto;
  const agrupamentosRaw = Array.isArray(intent.group_by) ? intent.group_by : (intent.agrupar_por ? [intent.agrupar_por] : []);
  // Remove "empresa" dos agrupamentos quando ha empresas IAHub mencionadas — e metadata de exibicao, nao GROUP BY SQL
  const agrupamentos = temEmpresasIAHub
    ? agrupamentosRaw.filter(a => String(a || '').toLowerCase() !== 'empresa')
    : agrupamentosRaw;
  return {
    aviso: 'Evidencia nao autoritativa. A IA-OWNER deve confirmar pela mensagem atual e historico antes de herdar qualquer campo.',
    intent: intent.intencao || null,
    modulo: intent._moduloDinamico || intent._orquestradorContrato?.modulo || null,
    filtros: (() => {
      const f = _removerFiltrosTemporaisOrquestrador(intent.filtros || {});
      if (!temEmpresasIAHub) return f;
      const { empresa: _e, ...resto } = f;
      return resto;
    })(),
    agrupamentos,
    empresas_iahub_mencionadas: Array.isArray(intent._empresasMencionadasTextos) && intent._empresasMencionadasTextos.length
      ? intent._empresasMencionadasTextos
      : (intent._empresaMencionadaTexto ? [intent._empresaMencionadaTexto] : []),
    // empresas_iahub_mencionadas_ids foi removido: IDs internos IAHub causavam F2_CLIENTE='N' quando
    // a IA confundia o inteiro (ex: 1) com código Protheus de entidade cadastral.
    aviso_empresas_iahub: (Array.isArray(intent._empresasMencionadasTextos) && intent._empresasMencionadasTextos.length) || intent._empresaMencionadaTexto
      ? 'Os nomes em empresas_iahub_mencionadas sao escopo de tenant IAHub; nao filtre SA1/SA2/cliente/fornecedor por esses nomes.'
      : null,
    contrato_orquestrador: (() => {
      const co = intent._orquestradorContrato;
      if (!co) return null;
      const filtrosLimpos = _removerFiltrosTemporaisOrquestrador(
        temEmpresasIAHub ? (() => { const { empresa: _ce, ...r } = co.filtros || {}; return r; })() : (co.filtros || {})
      );
      const coAg = Array.isArray(co.agrupamentos)
        ? (temEmpresasIAHub ? co.agrupamentos.filter(a => String(a || '').toLowerCase() !== 'empresa') : co.agrupamentos)
        : co.agrupamentos;
      const { periodo: _p, justificativa: _j, ...coSemPeriodo } = co;
      return { ...coSemPeriodo, filtros: filtrosLimpos, agrupamentos: coAg };
    })(),
    contexto_ia_anterior: intent._contextoIAAnterior || null,
    ultimo_sql: intent._sqlCanonicoOriginal || intent._sql_canonico || null,
    ultima_resposta: intent._ultimaResposta || null,
  };
}

// Bases FK que só devem aparecer no sx2 enviado à IA se realmente existirem no SX2 do tenant.
const FK_BASES_CONDICIONAIS = new Set(['FK1', 'FK2', 'FK5', 'FK6', 'FK7', 'FKA', 'FKB']);

function buildContextoTecnico({ spec, empresaId, protheus, sx2, sx2Puro, sx3Prompt, middlewareCfg, filial }) {
  // sx2Puro = mapa direto do SX2 do IAHub (null quando nada cadastrado).
  // Se null → tenant sem SX2 cadastrado → FK não existe → modelo SE5.
  const temFK1 = sx2Puro != null && !!tabelaFisicaSX2(sx2Puro, 'FK1');
  const temFK2 = sx2Puro != null && !!tabelaFisicaSX2(sx2Puro, 'FK2');

  // Remove do sx2 exposto à IA as tabelas FK injetadas por completarSX2Permitidas
  // quando elas não estão no sx2Puro. Evita que a IA use FK1/FK2 por ver FK1010 no mapa.
  const basesPuro = new Set(Object.keys(sx2Puro || {}).map(baseTabelaSX2));
  const sx2Exposto = Object.fromEntries(
    Object.entries(sx2 || {}).filter(([nome]) => {
      const base = baseTabelaSX2(nome);
      return !FK_BASES_CONDICIONAIS.has(base) || basesPuro.has(base);
    })
  );

  // Filtra tabelas_permitidas e sx3 pelo mesmo critério: FK condicionais só se existirem no SX2 puro.
  const tabelasPermitidas = (spec.tabelas || []).filter(t => {
    const base = String(t || '').trim().toUpperCase();
    return !FK_BASES_CONDICIONAIS.has(base) || basesPuro.has(base);
  });
  const sx3Exposto = sx3Prompt && typeof sx3Prompt === 'object'
    ? Object.fromEntries(
        Object.entries(sx3Prompt).filter(([t]) => {
          const base = baseTabelaSX2(t);
          return !FK_BASES_CONDICIONAIS.has(base) || basesPuro.has(base);
        })
      )
    : sx3Prompt;

  return {
    empresaId,
    data_atual: dataAtualServidor(),
    tabelas_permitidas: tabelasPermitidas,
    sx2: sx2Exposto,
    sufixoTabela: inferirSufixoSX2(sx2, protheus.sufixoTabela),
    sufixosPorTabela: Object.fromEntries(
      Object.entries(sufixosPorTabelaSX2(sx2)).filter(([base]) => {
        return !FK_BASES_CONDICIONAIS.has(base.toUpperCase()) || basesPuro.has(base.toUpperCase());
      })
    ),
    sx3: sx3Exposto,
    filial: filial || protheus.filialPadrao || 'TODAS',
    filialPadrao: protheus.filialPadrao || null,
    modeloDados: middlewareCfg.modelo_dados || 'TRADICIONAL',
    campoFilial: middlewareCfg.campo_filial || null,
    modelo_baixas_receber: temFK1 ? 'FK1' : 'SE5',
    modelo_baixas_pagar: temFK2 ? 'FK2' : 'SE5',
  };
}

function dividirExpressoesSql(lista = '') {
  const itens = [];
  let inicio = 0;
  let nivel = 0;
  let aspas = false;
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    if (c === "'" && lista[i - 1] !== '\\') aspas = !aspas;
    if (aspas) continue;
    if (c === '(') nivel++;
    if (c === ')') nivel = Math.max(0, nivel - 1);
    if (c === ',' && nivel === 0) {
      itens.push(lista.slice(inicio, i).trim());
      inicio = i + 1;
    }
  }
  itens.push(lista.slice(inicio).trim());
  return itens.filter(Boolean);
}

function localizarKeywordNivelZero(sql = '', keyword, inicio = 0) {
  const texto = String(sql || '');
  const alvo = String(keyword || '').toUpperCase();
  let nivel = 0;
  let aspas = false;
  for (let i = Math.max(0, inicio); i <= texto.length - alvo.length; i++) {
    const c = texto[i];
    if (c === "'" && texto[i - 1] !== '\\') aspas = !aspas;
    if (aspas) continue;
    if (c === '(') {
      nivel++;
      continue;
    }
    if (c === ')') {
      nivel = Math.max(0, nivel - 1);
      continue;
    }
    if (nivel !== 0) continue;
    if (texto.slice(i, i + alvo.length).toUpperCase() !== alvo) continue;
    const antes = i > 0 ? texto[i - 1] : ' ';
    const depois = texto[i + alvo.length] || ' ';
    if (!/[A-Z0-9_]/i.test(antes) && !/[A-Z0-9_]/i.test(depois)) return i;
  }
  return -1;
}

function extrairSelectEGroupByNivelZero(sql = '') {
  const texto = String(sql || '');
  const posSelect = localizarKeywordNivelZero(texto, 'SELECT');
  if (posSelect < 0) return {};
  const posFrom = localizarKeywordNivelZero(texto, 'FROM', posSelect + 6);
  if (posFrom < 0) return {};
  const posGroup = localizarKeywordNivelZero(texto, 'GROUP BY', posFrom + 4);
  if (posGroup < 0) return { select: texto.slice(posSelect + 6, posFrom) };

  const fins = ['HAVING', 'ORDER BY', 'UNION']
    .map(k => localizarKeywordNivelZero(texto, k, posGroup + 8))
    .filter(pos => pos >= 0);
  const posPontoVirgula = texto.indexOf(';', posGroup + 8);
  if (posPontoVirgula >= 0) fins.push(posPontoVirgula);
  const fimGroup = fins.length ? Math.min(...fins) : texto.length;
  return {
    select: texto.slice(posSelect + 6, posFrom),
    group: texto.slice(posGroup + 8, fimGroup),
  };
}

function extrairConteudosOver(sql = '') {
  const texto = String(sql || '');
  const conteudos = [];
  const re = /\bOVER\s*\(/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    let inicio = texto.indexOf('(', m.index);
    let nivel = 0;
    let aspas = false;
    for (let i = inicio; i < texto.length; i++) {
      const c = texto[i];
      if (c === "'" && texto[i - 1] !== '\\') aspas = !aspas;
      if (aspas) continue;
      if (c === '(') nivel++;
      if (c === ')') {
        nivel--;
        if (nivel === 0) {
          conteudos.push(texto.slice(inicio + 1, i));
          re.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  return conteudos;
}

function extrairExpressoesWindow(conteudoOver = '') {
  const texto = String(conteudoOver || '');
  const partes = [];
  const posPartition = localizarKeywordNivelZero(texto, 'PARTITION BY');
  const posOrder = localizarKeywordNivelZero(texto, 'ORDER BY');
  if (posPartition >= 0) {
    const fim = posOrder >= 0 && posOrder > posPartition ? posOrder : texto.length;
    partes.push(texto.slice(posPartition + 12, fim));
  }
  if (posOrder >= 0) partes.push(texto.slice(posOrder + 8));
  return partes.flatMap(parte => dividirExpressoesSql(parte).map(expr => expr.replace(/\s+(ASC|DESC)\s*$/i, '').trim()).filter(Boolean));
}

// Remove conteúdo dentro de parênteses (preserva literais de string).
// Usado para checar aliases no nível externo sem falsos positivos vindos
// de subqueries escalares dentro de COALESCE((...)) ou SUM(...).
function _stripParenContent(text) {
  let out = '';
  let nivel = 0;
  let aspas = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === "'") aspas = !aspas;
    if (aspas) { if (nivel === 0) out += c; continue; }
    if (c === '(') { nivel++; continue; }
    if (c === ')') { nivel--; continue; }
    if (nivel === 0) out += c;
  }
  return out;
}

function validarEscopoSubqueryExterno(sql = '') {
  const texto = String(sql || '').trim();
  // Só verifica quando a query tem FROM subquery (tabela derivada): FROM (SELECT...)
  const posFrom = localizarKeywordNivelZero(texto, 'FROM');
  if (posFrom < 0) return { ok: true, erros: [] };
  let i = posFrom + 4;
  while (i < texto.length && /\s/.test(texto[i])) i++;
  if (texto[i] !== '(') return { ok: true, erros: [] };

  // Encontrar o ')' de fechamento da tabela derivada para isolar os JOINs externos
  let nivel = 0;
  let posClose = -1;
  for (let j = i; j < texto.length; j++) {
    if (texto[j] === '(') nivel++;
    else if (texto[j] === ')') { nivel--; if (nivel === 0) { posClose = j; break; } }
  }

  // Coletar aliases definidos nos JOINs EXTERNOS (após o fechamento da subquery).
  // Ex: FROM (...) BASE JOIN SA1020 SA1 ON ... → SA1 é válido no SELECT/GROUP BY externo.
  const aliasesExternos = new Set();
  if (posClose >= 0) {
    const textoDepoisSubquery = texto.slice(posClose + 1);
    const reJoinExterno = /\bJOIN\s+[A-Z_][A-Z0-9_]*\s+([A-Z_][A-Z0-9_]*)\b/gi;
    let jm;
    while ((jm = reJoinExterno.exec(textoDepoisSubquery)) !== null) {
      aliasesExternos.add(jm[1].toUpperCase());
    }
  }

  const { select, group } = extrairSelectEGroupByNivelZero(texto);
  if (!select) return { ok: true, erros: [] };

  // Strip parênteses para não flagear aliases DENTRO de subqueries escalares
  // no SELECT externo (ex: COALESCE((SELECT SUM(SF2.F2_VALBRUT) ...), 0)).
  const parteExterna = _stripParenContent((select || '') + ' ' + (group || ''));

  const aliases = ['SF2','SD2','SF1','SD1','SA1','SA2','SA3','SB1','SBM','SF4','CTT',
                   'SE1','SE2','SE3','SE5','SE8','SED','SA6','SC7','SE3'];
  for (const alias of aliases) {
    // Pular aliases que são definidos nos JOINs externos — esses são legítimos no SELECT externo
    if (aliasesExternos.has(alias)) continue;
    const re = new RegExp(`\\b${alias}\\s*\\.\\s*[A-Z][A-Z0-9_]*`, 'i');
    const m = parteExterna.match(re);
    if (m) {
      return { ok: false, erros: [
        `Violacao de escopo de subquery: "${m[0]}" referenciado na query externa mas pertence ao escopo interno. ` +
        `Na query externa (FROM (...) AS h), use APENAS aliases exportados pela subquery — ex: h.ano, h.faturamento_mes. ` +
        `NUNCA referencie ${alias}.* fora da subquery. ` +
        `Corrija: substitua "${m[0]}" por h.<alias_correto> no SELECT e GROUP BY externos.`,
      ]};
    }
  }
  return { ok: true, erros: [] };
}

function validarSelectContraGroupBy(sql = '') {
  const texto = String(sql || '');
  const { select, group } = extrairSelectEGroupByNivelZero(texto);
  if (!select || !group) return { ok: true, erros: [] };

  const normalizar = valor => String(valor || '').replace(/\s+/g, '').replace(/^\((.*)\)$/s, '$1').toUpperCase();
  const grupos = dividirExpressoesSql(group).map(normalizar);
  const gruposCamposRaw = new Set(
    grupos.filter(item => /^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/.test(item))
  );
  const erros = [];
  const validarExpressao = (item, origem = 'SELECT') => {
    const itemNormalizado = normalizar(item);
    if (grupos.includes(itemNormalizado)) return;
    const campos = [...String(item || '').matchAll(/\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/gi)]
      .map(m => `${m[1]}.${m[2]}`.toUpperCase());
    if (campos.length && campos.every(campo => gruposCamposRaw.has(campo))) return;
    erros.push(`Expressao nao agregada do ${origem} ausente no GROUP BY: ${item}`);
  };
  for (const itemBruto of dividirExpressoesSql(select)) {
    const item = itemBruto
      .replace(/^\s*DISTINCT\s+/i, '')
      .replace(/\s+AS\s+[A-Z_][A-Z0-9_]*\s*$/i, '')
      .trim();
    for (const over of extrairConteudosOver(item)) {
      for (const expr of extrairExpressoesWindow(over)) validarExpressao(expr, 'OVER');
    }
    if (!item || /\b(SUM|COUNT|AVG|MIN|MAX|STRING_AGG)\s*\(/i.test(item) || /^['"\d]/.test(item)) continue;
    validarExpressao(item, 'SELECT');
  }
  return { ok: erros.length === 0, erros };
}

function _extrairDerivedTableInfo(sql) {
  const texto = String(sql || '').trim();
  const posFrom = localizarKeywordNivelZero(texto, 'FROM');
  if (posFrom < 0) return null;
  let i = posFrom + 4;
  while (i < texto.length && /\s/.test(texto[i])) i++;
  if (texto[i] !== '(') return null;

  let nivel = 0;
  let aspas = false;
  let fim = -1;
  for (let j = i; j < texto.length; j++) {
    const c = texto[j];
    if (c === "'") aspas = !aspas;
    if (aspas) continue;
    if (c === '(') nivel++;
    if (c === ')') { nivel--; if (nivel === 0) { fim = j; break; } }
  }
  if (fim < 0) return null;

  const conteudoSubquery = texto.slice(i + 1, fim);
  let pos = fim + 1;
  while (pos < texto.length && /\s/.test(texto[pos])) pos++;
  if (texto.slice(pos, pos + 2).toUpperCase() === 'AS') {
    pos += 2;
    while (pos < texto.length && /\s/.test(texto[pos])) pos++;
  }
  const aliasMatch = texto.slice(pos).match(/^([A-Z_][A-Z0-9_]*)/i);
  if (!aliasMatch) return null;
  return { conteudoSubquery, alias: aliasMatch[1].toUpperCase() };
}

function _aliasesExportadosPorSubquery(subquerySql) {
  const { select } = extrairSelectEGroupByNivelZero(subquerySql);
  if (!select || /^\s*\*\s*$/.test(select.trim())) return null;
  const aliases = new Set();
  for (const itemBruto of dividirExpressoesSql(select)) {
    const item = itemBruto.replace(/^\s*DISTINCT\s+/i, '').trim();
    const asMatch = item.match(/\bAS\s+([A-Z_][A-Z0-9_]*)\s*$/i);
    if (asMatch) { aliases.add(asMatch[1].toUpperCase()); continue; }
    const dotMatch = item.match(/[A-Z_][A-Z0-9_]*\s*\.\s*([A-Z_][A-Z0-9_]*)\s*$/i);
    if (dotMatch) { aliases.add(dotMatch[1].toUpperCase()); continue; }
    const simpleMatch = item.match(/^([A-Z_][A-Z0-9_]*)\s*$/i);
    if (simpleMatch) aliases.add(simpleMatch[1].toUpperCase());
  }
  return aliases.size ? aliases : null;
}

function validarAliasesDerivadosExternos(sql) {
  const info = _extrairDerivedTableInfo(sql);
  if (!info) return { ok: true, erros: [] };
  const { conteudoSubquery, alias } = info;
  const exportados = _aliasesExportadosPorSubquery(conteudoSubquery);
  if (!exportados) return { ok: true, erros: [] };

  const { select, group } = extrairSelectEGroupByNivelZero(sql);
  const parteExterna = (select || '') + ' ' + (group || '');
  const re = new RegExp(`\\b${alias}\\s*\\.\\s*([A-Z_][A-Z0-9_]*)`, 'gi');
  const erros = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(parteExterna)) !== null) {
    const coluna = m[1].toUpperCase();
    if (coluna === '*' || vistos.has(coluna)) continue;
    vistos.add(coluna);
    if (!exportados.has(coluna)) {
      erros.push(
        `Coluna "${alias}.${coluna.toLowerCase()}" referenciada na query externa mas nao exportada pela subquery. ` +
        `Aliases exportados: [${[...exportados].map(a => a.toLowerCase()).join(', ')}]. ` +
        `Adicione ao SELECT da subquery — ex: SUBSTRING(campo, 1, 4) AS ${coluna.toLowerCase()}.`
      );
    }
  }
  return { ok: erros.length === 0, erros };
}

// Extrai os corpos de cada CTE de um bloco WITH...AS(...), ...
function _extrairCorposCTE(sql) {
  const texto = String(sql || '').trim();
  const resultado = [];
  const posWith = localizarKeywordNivelZero(texto, 'WITH');
  if (posWith < 0) return resultado;
  let pos = posWith + 4;
  while (pos < texto.length) {
    while (pos < texto.length && /\s/.test(texto[pos])) pos++;
    const trecho = texto.slice(pos);
    const nomeMatch = trecho.match(/^([A-Z_][A-Z0-9_]*)\s+AS\s*\(/i);
    if (!nomeMatch) break;
    const nome = nomeMatch[1];
    const offsetParens = nomeMatch[0].lastIndexOf('(');
    pos += offsetParens;
    let nivel = 0, aspas = false, fim = -1;
    for (let i = pos; i < texto.length; i++) {
      const c = texto[i];
      if (c === "'") aspas = !aspas;
      if (aspas) continue;
      if (c === '(') nivel++;
      if (c === ')') { nivel--; if (nivel === 0) { fim = i; break; } }
    }
    if (fim < 0) break;
    resultado.push({ nome, corpo: texto.slice(pos + 1, fim) });
    pos = fim + 1;
    while (pos < texto.length && /\s/.test(texto[pos])) pos++;
    if (pos < texto.length && texto[pos] === ',') { pos++; } else { break; }
  }
  return resultado;
}

// Detecta CTEs com função de agregação E expressão não-agregada sem GROUP BY.
// Esse padrão causa Msg 8120 no SQL Server em modo estrito e gera resultado errado
// em modos permissivos (coluna arbitrária ao invés de grouped).
function validarCTEsAgregadosSemGroupBy(sql = '') {
  const corpos = _extrairCorposCTE(sql);
  const erros = [];
  for (const { nome, corpo } of corpos) {
    const { select, group } = extrairSelectEGroupByNivelZero(corpo);
    if (!select || group) continue;
    if (!/\b(SUM|COUNT|AVG|MIN|MAX|STRING_AGG)\s*\(/i.test(select)) continue;
    for (const itemBruto of dividirExpressoesSql(select)) {
      const item = itemBruto
        .replace(/^\s*DISTINCT\s+/i, '')
        .replace(/\s+AS\s+[A-Z_][A-Z0-9_]*\s*$/i, '')
        .trim();
      if (!item) continue;
      if (/\b(SUM|COUNT|AVG|MIN|MAX|STRING_AGG)\s*\(/i.test(item)) continue;
      if (/^['"\d]/.test(item)) continue;
      erros.push(
        `CTE "${nome}": expressao nao-agregada "${item.slice(0, 80)}" no SELECT sem GROUP BY. ` +
        `Isso gera erro Msg 8120 no SQL Server. ` +
        `Adicione GROUP BY se quiser agrupar por periodo/entidade, ou remova o campo se a CTE for escalar.`
      );
    }
  }
  return { ok: erros.length === 0, erros };
}

// Detecta CTEs definidas com WITH ... AS (...) que nunca são referenciadas em FROM/JOIN.
// Padrão clássico de bug: IA cria CTE com ROW_NUMBER, mas a query externa continua
// usando FROM tabela_fisica em vez de FROM nome_cte. O campo computado (rn, rnk, etc.)
// não existe na tabela física → Msg 8120 ou rejeição SX3.
// Esta validação captura o erro mais cedo e gera mensagem precisa para o retry da IA.
function validarCTEsDefinidaUsada(sql = '') {
  const texto = String(sql || '').trim();
  if (!/\bWITH\b/i.test(texto)) return { ok: true, erros: [] };

  // Extrair nomes: WITH nome AS ( e ), nome AS (
  const nomes = new Set();
  let m;
  const reInicio = /\bWITH\s+(\w+)\s+AS\s*\(/gi;
  const reCont   = /\)\s*,\s*(\w+)\s+AS\s*\(/gi;
  while ((m = reInicio.exec(texto)) !== null) nomes.add(m[1].toUpperCase());
  while ((m = reCont.exec(texto)) !== null)   nomes.add(m[1].toUpperCase());
  if (!nomes.size) return { ok: true, erros: [] };

  const erros = [];
  for (const nome of nomes) {
    // Válido se aparece em FROM nome ou JOIN nome em qualquer ponto do SQL
    // (inclui referência dentro de outro CTE — ex: WITH A AS (...), B AS (... FROM A ...))
    const usadoEmFromJoin = new RegExp(`\\b(?:FROM|JOIN)\\s+${nome}\\b`, 'i').test(texto);
    const usadoEmListaFrom = new RegExp(`,\\s*${nome}\\b(?!\\s+AS\\s*\\()`, 'i').test(texto);
    if (!usadoEmFromJoin && !usadoEmListaFrom) {
      erros.push(
        `CTE "${nome}" foi definida mas nao e usada em FROM/JOIN. ` +
        `A query principal deve usar "FROM ${nome} <alias>" em vez de referenciar a tabela fisica diretamente. ` +
        `Corrija: na query externa, substitua o bloco "FROM <tabela_fisica> <alias>" por "FROM ${nome} <alias>" ` +
        `e remova o JOIN desnecessario com a tabela fisica.`
      );
    }
  }
  return { ok: erros.length === 0, erros };
}

function validarJoinSD1SF1Completo(sql = '') {
  const texto = String(sql || '');
  const erros = [];
  const reJoin = /\bJOIN\s+[A-Z_][A-Z0-9_]*\s+(SD1|SF1)\b\s+ON\s+/gi;
  let match;
  while ((match = reJoin.exec(texto)) !== null) {
    const aliasJoin = String(match[1] || '').toUpperCase();
    const inicioOn = reJoin.lastIndex;
    const fins = ['JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION']
      .map(k => localizarKeywordNivelZero(texto, k, inicioOn))
      .filter(pos => pos >= 0);
    const fimOn = fins.length ? Math.min(...fins) : texto.length;
    const on = texto.slice(inicioOn, fimOn);
    if (aliasJoin === 'SF1' && !/\bSD1\s*\.\s*D1_/i.test(on)) continue;
    if (aliasJoin === 'SD1' && !/\bSF1\s*\.\s*F1_/i.test(on)) continue;

    const temFornecedor = /\bSD1\s*\.\s*D1_FORNECE\s*=\s*SF1\s*\.\s*F1_FORNECE\b|\bSF1\s*\.\s*F1_FORNECE\s*=\s*SD1\s*\.\s*D1_FORNECE\b/i.test(on);
    const temLoja = /\bSD1\s*\.\s*D1_LOJA\s*=\s*SF1\s*\.\s*F1_LOJA\b|\bSF1\s*\.\s*F1_LOJA\s*=\s*SD1\s*\.\s*D1_LOJA\b/i.test(on);
    if (!temFornecedor || !temLoja) {
      erros.push('JOIN SD1->SF1 incompleto: a condicao ON deve incluir SD1.D1_FORNECE = SF1.F1_FORNECE e SD1.D1_LOJA = SF1.F1_LOJA para evitar duplicidade no SUM.');
    }
  }
  return { ok: erros.length === 0, erros };
}

function validarJoinSD2SF2Completo(sql = '') {
  const texto = String(sql || '');
  const erros = [];
  const reJoin = /\bJOIN\s+[A-Z_][A-Z0-9_]*\s+(SD2|SF2)\b\s+ON\s+/gi;
  let match;
  while ((match = reJoin.exec(texto)) !== null) {
    const aliasJoin = String(match[1] || '').toUpperCase();
    const inicioOn = reJoin.lastIndex;
    const fins = ['JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION']
      .map(k => localizarKeywordNivelZero(texto, k, inicioOn))
      .filter(pos => pos >= 0);
    const fimOn = fins.length ? Math.min(...fins) : texto.length;
    const on = texto.slice(inicioOn, fimOn);
    if (aliasJoin === 'SF2' && !/\bSD2\s*\.\s*D2_/i.test(on)) continue;
    if (aliasJoin === 'SD2' && !/\bSF2\s*\.\s*F2_/i.test(on)) continue;

    const temCliente = /\bSD2\s*\.\s*D2_CLIENTE\s*=\s*SF2\s*\.\s*F2_CLIENTE\b|\bSF2\s*\.\s*F2_CLIENTE\s*=\s*SD2\s*\.\s*D2_CLIENTE\b/i.test(on);
    const temLoja = /\bSD2\s*\.\s*D2_LOJA\s*=\s*SF2\s*\.\s*F2_LOJA\b|\bSF2\s*\.\s*F2_LOJA\s*=\s*SD2\s*\.\s*D2_LOJA\b/i.test(on);
    if (!temCliente || !temLoja) {
      erros.push('JOIN SD2->SF2 incompleto: a condicao ON deve incluir SD2.D2_CLIENTE = SF2.F2_CLIENTE e SD2.D2_LOJA = SF2.F2_LOJA para evitar duplicidade no SUM.');
    }
  }
  return { ok: erros.length === 0, erros };
}

function escaparRegexLiteral(valor = '') {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function condicaoIgualSql(trecho = '', aliasA, campoA, aliasB, campoB) {
  const a = escaparRegexLiteral(aliasA);
  const b = escaparRegexLiteral(aliasB);
  const ca = escaparRegexLiteral(campoA);
  const cb = escaparRegexLiteral(campoB);
  return new RegExp(
    `\\b${a}\\s*\\.\\s*${ca}\\s*=\\s*${b}\\s*\\.\\s*${cb}\\b|` +
    `\\b${b}\\s*\\.\\s*${cb}\\s*=\\s*${a}\\s*\\.\\s*${ca}\\b`,
    'i'
  ).test(String(trecho || ''));
}

function localizarFimOnRelativo(sql = '', inicio = 0) {
  const texto = String(sql || '');
  let nivel = 0;
  let aspas = false;
  const keywords = ['JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION'];
  for (let i = Math.max(0, inicio); i < texto.length; i++) {
    const c = texto[i];
    if (c === "'" && texto[i - 1] !== '\\') aspas = !aspas;
    if (aspas) continue;
    if (c === '(') {
      nivel++;
      continue;
    }
    if (c === ')') {
      if (nivel === 0) return i;
      nivel--;
      continue;
    }
    if (nivel !== 0) continue;
    for (const keyword of keywords) {
      if (texto.slice(i, i + keyword.length).toUpperCase() !== keyword) continue;
      const antes = i > 0 ? texto[i - 1] : ' ';
      const depois = texto[i + keyword.length] || ' ';
      if (!/[A-Z0-9_]/i.test(antes) && !/[A-Z0-9_]/i.test(depois)) return i;
    }
  }
  return texto.length;
}

function completarContratoRelacionalSD1SF1(sql = '') {
  let texto = String(sql || '');
  const contratosAplicados = [];
  const reJoin = /\bJOIN\s+[A-Z_][A-Z0-9_]*\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*)\b\s+ON\s+/gi;
  let match;

  while ((match = reJoin.exec(texto)) !== null) {
    const aliasJoin = String(match[1] || '').toUpperCase();
    if (!/^S[DF]1(?:_[A-Z0-9_]+)?$/.test(aliasJoin)) continue;

    const inicioOn = reJoin.lastIndex;
    const fimOn = localizarFimOnRelativo(texto, inicioOn);
    const on = texto.slice(inicioOn, fimOn);
    const aliasSD1 = (on.match(/\b(SD1(?:_[A-Z0-9_]+)?)\s*\.\s*D1_/i) || [])[1];
    const aliasSF1 = (on.match(/\b(SF1(?:_[A-Z0-9_]+)?)\s*\.\s*F1_/i) || [])[1];
    if (!aliasSD1 || !aliasSF1) continue;

    const temChaveBase =
      condicaoIgualSql(on, aliasSD1, 'D1_FILIAL', aliasSF1, 'F1_FILIAL') &&
      condicaoIgualSql(on, aliasSD1, 'D1_DOC', aliasSF1, 'F1_DOC') &&
      condicaoIgualSql(on, aliasSD1, 'D1_SERIE', aliasSF1, 'F1_SERIE');
    if (!temChaveBase) continue;

    const adicionais = [];
    if (!condicaoIgualSql(on, aliasSD1, 'D1_FORNECE', aliasSF1, 'F1_FORNECE')) {
      adicionais.push(`${aliasSD1}.D1_FORNECE = ${aliasSF1}.F1_FORNECE`);
    }
    if (!condicaoIgualSql(on, aliasSD1, 'D1_LOJA', aliasSF1, 'F1_LOJA')) {
      adicionais.push(`${aliasSD1}.D1_LOJA = ${aliasSF1}.F1_LOJA`);
    }
    if (!adicionais.length) continue;

    const antes = texto.slice(0, fimOn).replace(/\s*$/, '');
    const depois = texto.slice(fimOn);
    const complemento = adicionais.map(cond => `\n    AND ${cond}`).join('');
    texto = `${antes}${complemento}${depois}`;
    contratosAplicados.push('SD1_SF1_FORNECE_LOJA');
    reJoin.lastIndex = antes.length + complemento.length;
  }

  return {
    sql: texto,
    alterou: texto !== String(sql || ''),
    contratosAplicados: [...new Set(contratosAplicados)],
  };
}

// Extrai os corpos de todas as subqueries escalares do SQL (parênteses que contêm SELECT).
// Retorna array de strings com o conteúdo interno de cada (SELECT ...).
function _extrairSubqueriesEscalares(sql) {
  const texto = String(sql || '');
  const resultado = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "'") { aspas = !aspas; continue; }
    if (aspas) continue;
    if (c !== '(') continue;
    // Verifica se o que vem após o '(' é SELECT (ignorando espaços)
    let j = i + 1;
    while (j < texto.length && /\s/.test(texto[j])) j++;
    if (texto.slice(j, j + 6).toUpperCase() !== 'SELECT') continue;
    // Coleta o conteúdo até o ')' balanceado
    let nivel = 1;
    let k = i + 1;
    let aspasDentro = false;
    while (k < texto.length && nivel > 0) {
      const d = texto[k];
      if (d === "'") { aspasDentro = !aspasDentro; k++; continue; }
      if (aspasDentro) { k++; continue; }
      if (d === '(') nivel++;
      else if (d === ')') nivel--;
      k++;
    }
    resultado.push(texto.slice(i + 1, k - 1));
  }
  return resultado;
}

// Valida que dentro de cada subquery escalar os qualificadores de campo batem com o alias
// declarado no FROM. Detecta o surto clássico onde a IA declara FROM SE1020 SE1 mas usa
// E1.E1_SALDO como qualificador — o SQL Server rejeita com "could not be bound".
// Genérico: usa spec.tabelas de qualquer módulo (financeiro, faturamento, compras, comissão).
function validarAliasesSubqueriesEscalares(sql, spec = {}) {
  const basesPermitidas = new Set((spec.tabelas || []).map(t => String(t || '').toUpperCase()));
  if (!basesPermitidas.size) return { ok: true, erros: [] };

  const _SQL_KEYWORDS = new Set([
    'ON','WHERE','AND','OR','NOT','IN','IS','NULL','BETWEEN','LIKE','EXISTS',
    'SELECT','FROM','JOIN','GROUP','ORDER','HAVING','CASE','WHEN','THEN','ELSE','END',
    'INNER','LEFT','RIGHT','FULL','CROSS','UNION','ALL','DISTINCT','AS','SET','WITH',
    'ROW_NUMBER','OVER','PARTITION','BY','DESC','ASC','SUBSTRING','ISNULL','COALESCE',
    'CONVERT','CAST','DATEADD','DATEDIFF','GETDATE','LEN','TRIM','UPPER','LOWER',
    'MAX','MIN','SUM','COUNT','AVG','TOP','ROWCOUNT',
  ]);

  const subqueries = _extrairSubqueriesEscalares(sql);
  const erros = [];

  for (const corpo of subqueries) {
    // Mapeia alias declarado → base canônica para todas as tabelas do módulo dentro desta subquery
    const aliasParaBase = new Map(); // aliasDeclarado → base
    const reFrom = /\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/gi;
    let m;
    while ((m = reFrom.exec(corpo)) !== null) {
      const tabelaFisica = String(m[1] || '').toUpperCase();
      const aliasDeclarado = String(m[2] || '').toUpperCase();
      const base = baseTabelaSX2(tabelaFisica);
      if (!basesPermitidas.has(base)) continue;
      const aliasEfetivo = aliasDeclarado && !_SQL_KEYWORDS.has(aliasDeclarado) ? aliasDeclarado : base;
      aliasParaBase.set(aliasEfetivo, { base, tabelaFisica });
    }
    if (!aliasParaBase.size) continue;

    // Coleta todos os qualificadores PREFIX.campo usados no corpo
    const reCampos = /\b([A-Z][A-Z0-9_]*)\s*\.\s*[A-Z][A-Z0-9_]*/gi;
    let mc;
    const qualificadoresVistos = new Set();
    while ((mc = reCampos.exec(corpo)) !== null) {
      const qual = String(mc[1] || '').toUpperCase();
      if (_SQL_KEYWORDS.has(qual)) continue;
      if (aliasParaBase.has(qual)) continue; // qualificador é um alias declarado → ok
      if (qualificadoresVistos.has(qual)) continue;
      qualificadoresVistos.add(qual);

      // Verifica se este qualificador é a base canônica de uma tabela cujo alias é diferente
      // Ex: tabela SE1020 declarada com alias SE1, mas campos qualificados como E1.E1_SALDO
      // (E1 não é alias, nem base — é o prefixo natural do campo sem o S inicial)
      // Para capturar: procura se existe algum alias cujo base bate com esse qualificador
      // ou se o qualificador poderia ser a base real sem o alias correto.
      for (const [aliasDeclarado, { base, tabelaFisica }] of aliasParaBase) {
        // Caso 1: qualificador é a própria base (SE1, SE2) mas alias declarado é diferente
        if (qual === base && aliasDeclarado !== base) {
          erros.push(
            `Subquery escalar: campo qualificado como "${qual}." mas o alias declarado e "${aliasDeclarado}" ` +
            `(FROM ${tabelaFisica} ${aliasDeclarado}). ` +
            `Substitua "${qual}." por "${aliasDeclarado}." dentro desta subquery.`
          );
          break;
        }
        // Caso 2: qualificador é o prefixo do campo sem 'S' inicial (E1, E2, F2, D1, etc.)
        // e a base correspondente seria S+qual (SE1, SE2, SF2, SD1...)
        if (`S${qual}` === base || `S${qual}` === aliasDeclarado) {
          erros.push(
            `Subquery escalar: campo qualificado como "${qual}." mas o alias declarado e "${aliasDeclarado}" ` +
            `(FROM ${tabelaFisica} ${aliasDeclarado}). ` +
            `Substitua "${qual}." por "${aliasDeclarado}." dentro desta subquery.`
          );
          break;
        }
      }
    }
  }

  return { ok: erros.length === 0, erros };
}

function validarSqlIaOwnerBasico(sql, spec = {}, sx2 = {}, mensagem = '') {
  const texto = String(sql || '').trim();
  const erros = [];
  if (!/^SET\s+ROWCOUNT\s+\d+\s*;\s*(?:WITH\b|SELECT\b)/i.test(texto)) {
    erros.push('SQL deve iniciar com SET ROWCOUNT N; SELECT ... ou SET ROWCOUNT N; WITH ... (CTE)');
  }
  if (/\bSELECT\s+TOP\s+\d+/i.test(texto)) {
    erros.push('Nao use SELECT TOP; use apenas SET ROWCOUNT como limite global.');
  }
  if (/\bIN\s*\(\s*SELECT\s+[A-Z0-9_]+\s+FROM\s+(?:SA2|SB1|SBM|SF4|SED|CTT)\d*[\s\S]{0,300}\bIS\s+NOT\s+NULL\s*\)/i.test(texto)) {
    erros.push('Subquery cadastral IN (SELECT ... IS NOT NULL) e filtro inutil; remova.');
  }
  if (/\bCASE\s+WHEN\s+SF4\s*\.\s*F4_CODIGO\s+IS\s+NOT\s+NULL\s+THEN\s+-\s*SD1\s*\.\s*D1_TOTAL/i.test(texto)) {
    erros.push('Devolucao de compra nao deve ser identificada por SF4.F4_CODIGO em SD1; use SF2/SD2 com SF2.F2_TIPO = D e UNION ALL.');
  }
  for (const regra of spec.sqlPatternsProibidos || []) {
    const regex = regra?.regex instanceof RegExp ? regra.regex : null;
    if (regex && regex.test(texto)) {
      erros.push(regra.mensagem || 'SQL rejeitado por regra tecnica do modulo.');
    } else if (typeof regra?.validar === 'function') {
      const msg = regra.validar(texto, mensagem);
      if (msg) erros.push(msg);
    }
  }
  if (/\b[A-Z]{2,4}\d{3,4}\s*\./i.test(texto)) {
    erros.push('Use alias base para qualificar campos (SD1.D1_TOTAL), nunca tabela fisica como qualificador (SD1990.D1_TOTAL).');
  }
  const escopoCheck = validarEscopoSubqueryExterno(texto);
  if (!escopoCheck.ok) {
    erros.push(...escopoCheck.erros);
  } else {
    erros.push(...validarSelectContraGroupBy(texto).erros);
    erros.push(...validarAliasesDerivadosExternos(texto).erros);
  }
  erros.push(...validarCTEsAgregadosSemGroupBy(texto).erros);
  erros.push(...validarCTEsDefinidaUsada(texto).erros);
  erros.push(...validarAliasesSubqueriesEscalares(texto, spec).erros);

  const basesPermitidas = new Set((spec.tabelas || []).map(t => String(t || '').toUpperCase()));
  const keywords = new Set(['ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'JOIN', 'CROSS']);
  const re = /\b(FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)(?:\s+(?:AS\s+)?([A-Z_][A-Z0-9_]*))?/gi;
  let m;
  const referenciasTabela = [];
  while ((m = re.exec(texto)) !== null) {
    const clausula = String(m[1] || '').toUpperCase();
    const tabela = String(m[2] || '').toUpperCase();
    const base = baseTabelaSX2(tabela);
    const alias = String(m[3] || '').toUpperCase();
    if (!basesPermitidas.has(base)) continue;
    referenciasTabela.push({ clausula, tabela, base, alias });
    if (!alias || keywords.has(alias)) {
      erros.push(`${clausula} ${tabela} deve declarar alias ${base}. Ex: ${clausula} ${tabela} ${base}`);
      continue;
    }
    if (alias !== base && !alias.startsWith(`${base}_`)) {
      erros.push(`${clausula} ${tabela} deve usar alias ${base} ou ${base}_<sufixo> em self-join, nao ${alias}.`);
    }
  }
  for (const ref of referenciasTabela) {
    if (!ref.alias || keywords.has(ref.alias)) continue;
    const reDelete = new RegExp(`\\b${ref.alias}\\s*\\.\\s*D_E_L_E_T_\\s*=\\s*'\\s'`, 'i');
    if (!reDelete.test(texto)) {
      const local = ref.clausula === 'JOIN' ? 'na condicao ON do JOIN' : 'no WHERE';
      erros.push(`${ref.clausula} ${ref.tabela} ${ref.alias} deve filtrar ${ref.alias}.D_E_L_E_T_ = ' ' ${local}.`);
    }
  }

  const tabelasFisicas = Object.keys(sx2 || {});
  if (tabelasFisicas.length) {
    for (const fisica of tabelasFisicas) {
      const base = baseTabelaSX2(fisica);
      if (!basesPermitidas.has(base)) continue;
      const reFisicaSemAlias = new RegExp(`\\b(?:FROM|JOIN)\\s+${fisica}\\s*(?:\\b(?:ON|WHERE|GROUP|ORDER|HAVING|INNER|LEFT|RIGHT|FULL|JOIN)\\b|$)`, 'i');
      if (reFisicaSemAlias.test(texto)) erros.push(`Tabela fisica ${fisica} precisa de alias ${base}.`);
    }
  }

  return { ok: erros.length === 0, erros };
}

function normalizarAliasesBaseAusentes(sql, spec = {}) {
  let out = String(sql || '');
  const bases = (spec.tabelas || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean);
  const proximos = 'ON|WHERE|GROUP|ORDER|HAVING|INNER|LEFT|RIGHT|FULL|CROSS|JOIN|UNION';
  for (const base of bases) {
    const re = new RegExp(`\\b(FROM|JOIN)\\s+(${_escapeRegexLiteral(base)}\\d*)\\s*(?=\\b(?:${proximos})\\b|$)`, 'gi');
    out = out.replace(re, (_match, clausula, tabela) => `${clausula} ${tabela} ${base} `);
  }
  return out;
}

function _escapeRegexLiteral(valor) {
  return String(valor || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extrairBasesTabelasFromJoin(sql = '') {
  const texto = String(sql || '').toUpperCase();
  const nomesCte = new Set();
  const reCte = /(?:\bWITH|,)\s+([A-Z_][A-Z0-9_]*)\s+AS\s*\(/gi;
  let cteMatch;
  while ((cteMatch = reCte.exec(texto)) !== null) {
    nomesCte.add(String(cteMatch[1] || '').toUpperCase());
  }

  const bases = new Set();
  const re = /\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const tabela = String(m[1] || '').toUpperCase();
    if (!tabela || nomesCte.has(tabela)) continue;
    bases.add(baseTabelaSX2(tabela));
  }
  return [...bases].filter(Boolean);
}

function _camposPeriodoObrigatorios(spec = {}) {
  const campos = spec.camposPeriodoObrigatorios || spec.camposDataPeriodo || [];
  return Array.isArray(campos)
    ? campos.map(c => String(c || '').trim().toUpperCase()).filter(Boolean)
    : [];
}

function sqlTemFiltroPeriodoEmCampo(sql, campo) {
  const texto = String(sql || '');
  const campoRe = `(?:[A-Z][A-Z0-9_]*\\.)?${_escapeRegexLiteral(campo)}`;
  const padroes = [
    new RegExp(`\\b${campoRe}\\s+BETWEEN\\s*'\\d{8}'\\s+AND\\s*'\\d{8}'`, 'i'),
    new RegExp(`\\b${campoRe}\\s*(?:=|>=|<=|>|<)\\s*'\\d{4,8}'`, 'i'),
    new RegExp(`\\b${campoRe}\\s+IN\\s*\\(`, 'i'),
    new RegExp(`\\b${campoRe}\\s+LIKE\\s*'\\d{4,8}%?'`, 'i'),
    new RegExp(`\\b(?:SUBSTRING|LEFT|RIGHT)\\s*\\(\\s*${campoRe}[\\s\\S]{0,120}\\)\\s*(?:=|IN\\s*\\(|BETWEEN|>=|<=|>|<)`, 'i'),
  ];
  return padroes.some(re => re.test(texto));
}

function validarPeriodoDeclaradoNoSql(sql, spec = {}, periodo = null) {
  const dataInicio = String(periodo?.dataInicio || '').trim();
  const dataFim = String(periodo?.dataFim || '').trim();
  const campos = _camposPeriodoObrigatorios(spec);
  if (!/^\d{8}$/.test(dataInicio) || !/^\d{8}$/.test(dataFim) || !campos.length) {
    return { ok: true, erros: [] };
  }
  const temFiltroPeriodo = campos.some(campo => sqlTemFiltroPeriodoEmCampo(sql, campo));
  if (temFiltroPeriodo) return { ok: true, erros: [] };
  return {
    ok: false,
    erros: [
      `O plano declarou periodo ${dataInicio} a ${dataFim}, mas o SQL nao aplicou filtro temporal em nenhum campo de data do modulo (${campos.join(', ')}). Gere novamente incluindo o filtro de periodo no WHERE/subquery correta.`,
    ],
  };
}

function construirQueryPlanTecnico({ spec, mensagem, periodo, filtros, entidades } = {}) {
  const planoBase = queryPlan.buildQueryPlan({
    modulo: spec?.nome || 'dinamico',
    mensagem,
    periodo: periodo || { tipo: 'nenhum' },
    filtros: filtros || {},
    entidades: entidades || [],
  });
  return queryPlan.reconciliarPlanoComMensagem(planoBase, mensagem);
}

function _extrairLabelIntencao(mensagem) {
  if (!mensagem) return null;
  const t = String(mensagem)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

  const temMaior = /\b(maior|mais alto|mais elevado|melhor)\b/.test(t);
  const temMenor = /\b(menor|mais baixo|pior)\b/.test(t);
  const topMatch = t.match(/\btop\s*(\d+)\b/);
  const temQuem  = /\b(quem|qual)\b.{0,40}\b(mais|menos|maior|menor|melhor|pior)\b/.test(t);

  if (topMatch) return `Top ${topMatch[1]}`;

  if (temMaior && temMenor) return 'Maior e menor';

  if (temMaior || temMenor || temQuem) {
    const ref = temMaior ? 'Maior' : 'Menor';
    if (/\b(cliente|comprador)\b/.test(t))        return `${ref} cliente`;
    if (/\bvendedor\b/.test(t))                   return `${ref} vendedor`;
    if (/\bfornecedor\b/.test(t))                 return `${ref} fornecedor`;
    if (/\b(produto|item|mercadoria)\b/.test(t))  return `${ref} produto`;
    if (/\b(mes|month)\b/.test(t))               return temMaior ? 'Melhor mês' : 'Pior mês';
    if (/\bano\b/.test(t))                       return temMaior ? 'Melhor ano' : 'Pior ano';
    return `${ref} valor`;
  }

  if (/\b(comparar?|comparativo|versus|vs\.?)\b/.test(t) ||
      /\b\d{4}\b.{0,10}\b(e|vs|x|versus)\b.{0,10}\b\d{4}\b/.test(t)) return 'Comparativo';

  if (/\b(evolucao|historico|tendencia|ao longo|crescimento|variacao)\b/.test(t)) return 'Evolução';

  // Carteiras financeiras — checadas antes de Total/Mensal para evitar conflito com "pagamos/recebemos"
  const temRecebido = /\b(recebidas?|recebido|recebimentos?|recebemos)\b/.test(t);
  const temPago     = /\b(pagas?|pago|pagamentos?|pagamos)\b/.test(t);
  if (temRecebido && temPago) return 'Contas recebidas e pagas';
  if (temRecebido && !temPago) return 'Contas recebidas';
  if (temPago && !temRecebido) return 'Contas pagas';

  // Média antes de Mensal: "faturamento médio mensal" deve retornar Média, não Mensal
  if (/\b(media|medio|ticket medio|preco medio|valor medio)\b/.test(t)) return 'Média';

  if (/\bpor (mes|month)\b|\bmensal(mente)?\b/.test(t)) return 'Mensal';
  if (/\bpor ano\b|\banual(mente)?\b/.test(t))          return 'Anual';

  if (/\btotal geral\b|\bquanto (faturamos|compramos)\b/.test(t)) return 'Total';

  if (/\b(listar?|detalhar?|mostrar?|exibir?|quais (sao|foram|estao|tem))\b/.test(t)) return 'Listagem';

  return null;
}

function _buildContextoConsulta(intent, periodoResolvido = null, mensagem = null) {
  if (!intent) return null;

  const entidades = Array.isArray(intent._entidadesResolvidas) ? intent._entidadesResolvidas : [];
  const _labelTipo = t => ({ cliente: 'Cliente', fornecedor: 'Fornecedor', vendedor: 'Vendedor', produto: 'Produto', grupo_produto: 'Grupo', centro_custo: 'C.Custo' }[t] || t);
  let filtroEnt = entidades.filter(e => e && e.nome && e.tipo).map(e => `${_labelTipo(e.tipo)}: ${e.nome}`).join(', ');
  // Fallback: entidade não resolvida mas presente nos filtros do orquestrador/intent
  if (!filtroEnt) {
    const ff = intent._orquestradorContrato?.filtros || intent.filtros || {};
    filtroEnt = ['cliente', 'fornecedor', 'vendedor', 'produto']
      .filter(c => ff[c] && typeof ff[c] === 'string' && ff[c].trim())
      .map(c => `${_labelTipo(c)}: ${ff[c].trim()}`)
      .join(', ');
  }

  // Usa o período resolvido pela IA-OWNER (plano.obj.periodo) com fallback para intent.periodo.
  // Isso evita que o formatter alucine anos (ex: 2023) quando o SQL retorna apenas
  // mes="04" sem coluna de ano — o contexto explícito ancora o formatter no ano correto.
  let filtroPeriodo = null;
  const p = periodoResolvido || intent.periodo;
  if (p && (p.dataInicio || p.data_inicio) && (p.dataFim || p.data_fim)) {
    const ini = String(p.dataInicio || p.data_inicio), fim = String(p.dataFim || p.data_fim);
    if (/^\d{8}$/.test(ini) && /^\d{8}$/.test(fim)) {
      const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const anoIni = ini.slice(0, 4), mesIni = parseInt(ini.slice(4, 6), 10);
      const anoFim = fim.slice(0, 4), mesFim = parseInt(fim.slice(4, 6), 10);
      const mIni = mesIni >= 1 && mesIni <= 12 ? MESES_ABR[mesIni - 1] : null;
      const mFim = mesFim >= 1 && mesFim <= 12 ? MESES_ABR[mesFim - 1] : null;
      if (anoIni === anoFim && ini.endsWith('0101') && fim.endsWith('1231')) {
        filtroPeriodo = `Ano ${anoIni}`;
      } else if (mIni && mFim && anoIni === anoFim) {
        filtroPeriodo = `${mIni} a ${mFim}/${anoFim}`;
      } else if (mIni && mFim) {
        filtroPeriodo = `${mIni}/${anoIni} a ${mFim}/${anoFim}`;
      }
    }
  }

  const labelIntencao = _extrairLabelIntencao(mensagem);
  const partes = [labelIntencao, filtroPeriodo, filtroEnt].filter(Boolean);
  return partes.length ? partes.join(' | ') : null;
}

function _buildContextoFormatacao(mensagem = '', contextoConsulta = null) {
  const texto = String(mensagem || '').trim();
  if (!texto) return contextoConsulta;
  return texto;
}

async function formatarResposta(spec, mensagem, rows, keys, cfg, intent, periodoResolvido = null, protheus = null, empresaId = null) {
  if (typeof spec.formatarResposta === 'function') return spec.formatarResposta({ mensagem, rows, keys, cfg });
  if (!rows || !rows.length) return mensagemErro(spec, 'sem_resultado');
  const whatsappFormat = require('../whatsapp-format-prompt');
  const contextoConsulta = _buildContextoConsulta(intent, periodoResolvido, mensagem);

  if (protheus?.conexaoId && empresaId) {
    const { completo: sx3Completo } = camposSX3(spec.tabelas, protheus.conexaoId, empresaId, spec.sx3PromptLimit || 80, spec.camposSx3Essenciais || {});
    canonicalWhatsappFormat.setLabelsSx3(labelsSx3ParaFormatacao(sx3Completo));
  } else {
    canonicalWhatsappFormat.setLabelsSx3(null);
  }

  const _NOME_DISPLAY = { faturamento: 'Faturamento', compras: 'Compras', financeiro: 'Financeiro', comissao: 'Comissão' };
  const nomeModulo = _NOME_DISPLAY[(spec.nome || '').replace('_dinamico', '')] || null;

  // Detecta se o usuário pediu agrupamento ano-primeiro (ex: "por ano e mês", agrupamentos=['ano','mes'])
  const _grps = Array.isArray(intent.group_by) ? intent.group_by
    : (intent.agrupar_por ? [intent.agrupar_por] : []);
  const _iAno = _grps.indexOf('ano'), _iMes = _grps.findIndex(g => g === 'mes' || g === 'month');
  const anoFirst = (
    (_iAno >= 0 && _iMes >= 0 && _iAno < _iMes) ||           // agrupamentos=['ano','mes']
    (_iAno >= 0 && _iMes < 0) ||                              // só 'ano' nos agrupamentos
    /\bpor\s+ano\s+e\s+m[eê]s\b|\banual.*m[eê]s|\bano\s+e\s+m[eê]s\b/i.test(mensagem || '')
  );

  // Tenta formatters programáticos antes de chamar IA (sem limite de tokens, sem truncamento)
  const contextoFormatacao = _buildContextoFormatacao(mensagem, contextoConsulta);
  const canonico = canonicalWhatsappFormat.renderSingle(rows, { contextoConsulta: contextoFormatacao, nomeModulo });
  if (canonico) {
    if (intent) intent._formatacaoCaminho = 'canonico';
    return canonico;
  }

  const direto = whatsappFormat.buildFormatDirect(mensagem, rows, { contextoConsulta: contextoFormatacao, nomeModulo, anoFirst })
    || whatsappFormat.buildFormatAnoMesDireto(rows, { contextoConsulta: contextoFormatacao, nomeModulo })
    || whatsappFormat.buildFormatCompetenciaEntidade(rows, { contextoConsulta: contextoFormatacao, nomeModulo, anoFirst })
    || whatsappFormat.buildFormatSimplesTemporal(rows, { contextoConsulta: contextoFormatacao, nomeModulo, anoFirst })
    || whatsappFormat.buildFormatComparativoSimples(rows, { contextoConsulta: contextoFormatacao });
  if (direto) {
    if (intent) intent._formatacaoCaminho = 'direto';
    return direto;
  }

  if (intent) intent._formatacaoCaminho = 'ia';
  try {
    return await aiProviderClient.chamarIA(
      keys,
      cfg,
      whatsappFormat.buildFormatSystemPrompt(),
      whatsappFormat.buildFormatUserPrompt(mensagem, rows, { contextoConsulta: contextoFormatacao }),
      {
        json: false,
        maxTokens: 6000,
        temperature: 0.1,
        logPrefix: `${spec.logPrefix || 'IAOwner'}-format`,
        empresaId,
        numeroWa: intent?._remetente || null,
        canalId: intent?._channelId || intent?._canalId || null,
        usageOrigem: 'ia-owner',
        usageOperacao: `${spec.nome || 'erp'}_formatacao`,
      }
    );
  } catch (e) {
    const brl = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return rows.slice(0, 20).map((row, i) => {
      const campos = Object.entries(row).map(([k, v]) => /valor|total|saldo|preco|custo/i.test(k) ? `${k}: *${brl(v)}*` : `${k}: ${v}`).join(' | ');
      return `${i + 1}. ${campos}`;
    }).join('\n');
  }
}

function chaveRespostaPlanejadaEhMetrica(chave) {
  return /valor|total|saldo|preco|custo|faturamento|compras|comissao|receita|bruto|liquido|quantidade|qtd/i.test(String(chave || ''));
}

function formatarValorRespostaPlanejada(chave, valor) {
  if (valor == null && chaveRespostaPlanejadaEhMetrica(chave)) valor = 0;
  if (valor == null) return '';
  const n = typeof valor === 'number'
    ? valor
    : (typeof valor === 'string' && valor.trim() !== '' && !isNaN(Number(valor)) ? Number(valor) : null);
  if (n != null && chaveRespostaPlanejadaEhMetrica(chave)) {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (n != null) return n.toLocaleString('pt-BR');
  return String(valor);
}

function interpolarRespostaPlanejada(template, rows = []) {
  const texto = String(template || '');
  if (!texto.trim()) return null;
  // Queries multi-linha devem usar o formatter completo (whatsapp-format-prompt)
  if (rows && rows.length > 1) return null;
  const primeiraLinha = rows && rows.length ? rows[0] : {};
  const valores = {};
  for (const [k, v] of Object.entries(primeiraLinha || {})) {
    valores[String(k).toLowerCase()] = { chave: k, valor: v };
  }
  const saida = texto.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, chave) => {
    const chaveNorm = String(chave || '').toLowerCase();
    let item = valores[chaveNorm];
    // Fuzzy: se não achou exato, tenta parcial (ex: {faturamento} → media_faturamento)
    if (!item) {
      const fuzzy = Object.keys(valores).filter(k => k.includes(chaveNorm) || chaveNorm.includes(k));
      if (fuzzy.length === 1) item = valores[fuzzy[0]];
      // Último recurso: única coluna numérica da linha quando placeholder é métrica
      if (!item && chaveRespostaPlanejadaEhMetrica(chave)) {
        const numericas = Object.values(valores).filter(v => typeof v.valor === 'number' || (typeof v.valor === 'string' && !isNaN(Number(v.valor))));
        if (numericas.length === 1) item = numericas[0];
      }
    }
    if (!item) {
      if (chaveRespostaPlanejadaEhMetrica(chave)) return formatarValorRespostaPlanejada(chave, 0);
      return match;
    }
    return formatarValorRespostaPlanejada(item.chave, item.valor);
  });
  return /\{[a-zA-Z0-9_]+\}/.test(saida) ? null : saida;
}

async function prepararSql({ spec, sql, sx2, sx3, protheus, middlewareCfg, entidades, filial, periodo, planoConsulta, mensagem }) {
  const sqlEntradaNormalizado = normalizarAliasesBaseAusentes(sql, spec);
  const validacaoBasica = validarSqlIaOwnerBasico(sqlEntradaNormalizado, spec, sx2, mensagem);
  if (!validacaoBasica.ok) {
    // Acumula também erros do query_plan para que o retry receba todos os problemas de uma vez,
    // evitando ciclos onde a IA corrige só o D_E_L_E_T_ mas mantém UNION ALL ou estrutura errada.
    const errosCombinados = [...validacaoBasica.erros];
    if (planoConsulta) {
      const validacaoPlanoAntecipada = queryPlan.validarSqlContraPlano(sqlEntradaNormalizado, planoConsulta);
      for (const e of validacaoPlanoAntecipada.erros) {
        if (!errosCombinados.includes(e)) errosCombinados.push(e);
      }
    }
    throw Object.assign(new Error(`SQL rejeitado por contrato IA-OWNER: ${errosCombinados.join(' | ')}`), { _tipo: 'contrato_ia_owner_invalido', _sql: sqlEntradaNormalizado });
  }
  const validacaoPeriodo = validarPeriodoDeclaradoNoSql(sqlEntradaNormalizado, spec, periodo);
  if (!validacaoPeriodo.ok) {
    throw Object.assign(new Error(`SQL rejeitado por periodo inconsistente: ${validacaoPeriodo.erros.join(' | ')}`), { _tipo: 'periodo_sql_inconsistente', _sql: sqlEntradaNormalizado });
  }
  let out = sx3SqlValidator.normalizarReferenciasAliasSql(sqlEntradaNormalizado);
  const contratosRelacionais = completarContratoRelacionalSD1SF1(out);
  out = contratosRelacionais.sql;
  const sqlAposContratosRelacionais = out;
  out = sx2SqlNormalizer.adaptarSqlCanonicoPorSX2(out, sx2, { logPrefix: spec.logPrefix, sufixoFallback: inferirSufixoSX2(sx2, protheus.sufixoTabela) });
  out = entitySqlGuard.removerHintsNoLock(out);
  if (Array.isArray(spec.dimensionLeftJoinBases) && spec.dimensionLeftJoinBases.length) {
    out = entitySqlGuard.converterInnerParaLeftJoinDimensionais(out, spec.dimensionLeftJoinBases);
  }
  const params = entitySqlGuard.aplicarParametrosEntidadesSql(out, entidades);
  if (!params.ok) throw Object.assign(new Error(`Parametros de entidade pendentes: ${params.pendentes.map(p => p.placeholder).join(', ')}`), { _tipo: 'sql_parametro_entidade_pendente' });
  out = params.sql;
  // Para cada tipo de entidade: se ao menos uma entidade desse tipo ja esta no SQL, valida
  // apenas as aplicadas — evita falso positivo quando entidades extras do mesmo tipo foram
  // acumuladas (historico ou declaracao redundante da IA-OWNER) mas a IA usou so uma delas.
  // Se nenhuma entidade do tipo estiver no SQL, mantém todas para detectar filtro esquecido.
  const tiposAplicadosSql = new Set(
    entidades
      .filter(e => entitySqlGuard.sqlTemFiltroEntidade(out, e))
      .map(e => String(e?.tipo || '').toLowerCase())
  );
  const entidadesValidacao = entidades.filter(e => {
    const tipo = String(e?.tipo || '').toLowerCase();
    return tiposAplicadosSql.has(tipo) ? entitySqlGuard.sqlTemFiltroEntidade(out, e) : true;
  });
  const validacaoEntidades = entitySqlGuard.validarSqlEntidadesResolvidas(out, { entidades: entidadesValidacao }, spec.entityCatalog?.DEFINICOES || {});
  if (!validacaoEntidades.ok) {
    throw Object.assign(new Error(`SQL nao aplicou entidades resolvidas: ${validacaoEntidades.erros.join(' | ')}`), { _tipo: 'contrato_entidade_invalido', _sql: out });
  }
  // Guard de seguranca (defesa em profundidade): rejeita qualquer SQL que filtre vendedor
  // por codigo diferente do vendedor_fixo_seguranca, mesmo que a IA tenha contornado o
  // bloqueio antecipado via OR/subquery/JOIN adicional.
  const entidadeSegurancaSql = (entidades || []).find(e => String(e?.tipo || '').toLowerCase() === 'vendedor_fixo_seguranca');
  if (entidadeSegurancaSql) {
    const validacaoVendedor = entitySqlGuard.validarExclusividadeVendedorSeguranca(out, entidadeSegurancaSql);
    if (!validacaoVendedor.ok) {
      throw Object.assign(new Error(`Violacao de seguranca: ${validacaoVendedor.erros.join(' | ')}`), { _tipo: 'acesso_negado_vendedor', _sql: out });
    }
  }
  const sx3Validacao = sx3SqlValidator.validarCamposSqlContraSX3(out, sx3);
  if (!sx3Validacao.ok) {
    const errosSx3 = sx3Validacao.erros.map(err => {
      // Enriquece o erro quando o campo rejeitado é alias calculado de um CTE.
      // Sem este contexto, a IA não sabe que precisa trocar FROM tabela_fisica por FROM cte_nome.
      const mCampo = err.match(/Campo \w+\.(\w+) nao consta no SX3/i);
      if (mCampo && /\bWITH\b/i.test(out)) {
        const campo = mCampo[1].toUpperCase();
        if (new RegExp(`\\bAS\\s+${campo}\\b`, 'i').test(out)) {
          const cteMatch = out.match(/\bWITH\s+(\w+)\s+AS\s*\(/i);
          const cteNome = cteMatch ? cteMatch[1] : 'o_cte';
          return `${err} O campo "${campo}" e alias calculado no CTE "${cteNome}". Na query externa, substitua "FROM <tabela_fisica> <alias>" por "FROM ${cteNome} <alias>".`;
        }
      }
      return err;
    });
    throw Object.assign(new Error(`SQL rejeitado por SX3: ${errosSx3.join(' | ')}`), { _tipo: 'contrato_sx3_invalido', _sql: out });
  }
  if (spec.sanitizarFiltrosFilialSX2 !== false) {
    out = sx2SqlNormalizer.sanitizarFiltrosFilialSX2(out, sx2, { filialSolicitada: filial && filial !== 'TODAS', logPrefix: spec.logPrefix });
  }
  const validacaoPlano = queryPlan.validarSqlContraPlano(out, planoConsulta);
  if (!validacaoPlano.ok) {
    throw Object.assign(new Error(`SQL rejeitado pelo query_plan: ${validacaoPlano.erros.join(' | ')}`), { _tipo: 'contrato_query_plan_invalido', _sql: out });
  }
  const mw = spec.sqlMiddleware.processar(out, middlewareCfg);
  if (mw.bloqueado) throw Object.assign(new Error(mw.motivo_bloqueio || 'SQL bloqueado pelo middleware.'), { _tipo: 'sql_bloqueado' });
  return {
    sqlCanonico: out,
    sqlFinal: mw.sql_processado,
    parametros: params.aplicados || [],
    sqlAposContratosRelacionais,
    contratosRelacionaisAplicados: contratosRelacionais.contratosAplicados || [],
  };
}

async function executar(spec, intent, empresaId) {
  const t0 = Date.now();
  const mensagem = intent._mensagemOriginal || intent.intencao || spec.defaultMessage || 'consulta';
  _traceIaOwner('ia_owner_executar_inicio', {
    empresa_id: empresaId,
    modulo: spec.nome || spec.handlerName || null,
    intencao: intent?.intencao || null,
    escopo: intent?._escopoExecucao || null,
  });

  let keys, cfg;
  try {
    _traceIaOwner('ia_owner_keys_inicio', { empresa_id: empresaId });
    ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId));
    _traceIaOwner('ia_owner_keys_fim', {
      empresa_id: empresaId,
      providers: Object.keys(keys || {}).filter(k => keys?.[k]).join(','),
    });
  } catch (e) {
    _traceIaOwner('ia_owner_keys_erro', { empresa_id: empresaId, erro: e?.message || String(e) });
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- erro: ${e.message}`, duracao_ms: Date.now() - t0 };
  }
  if (!Object.values(keys || {}).some(Boolean)) {
    return { tipo: 'erro', subtipo: 'sem_chave', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: '-- Nenhuma chave de IA configurada.', duracao_ms: Date.now() - t0 };
  }

  let intentEfetivo = intent;
  let contextoTecnicoExtra = {};
  let entidadeSeguranca = null;
  if (typeof spec.prepararIntent === 'function') {
    const prep = spec.prepararIntent({ intent, empresaId, mensagem });
    if (prep?.retorno) return { ...prep.retorno, duracao_ms: prep.retorno.duracao_ms || (Date.now() - t0) };
    if (prep?.intent) intentEfetivo = prep.intent;
    if (prep?.contextoTecnicoExtra) contextoTecnicoExtra = prep.contextoTecnicoExtra;
    if (prep?.entidadeSeguranca) entidadeSeguranca = prep.entidadeSeguranca;
  }
  intentEfetivo = normalizarFiltroEmpresaComoEntidade(spec, intentEfetivo, mensagem);
  intentEfetivo = limparFiltrosEntidadeHerdadosDaConsultaAtual(spec, intentEfetivo, mensagem);

  _traceIaOwner('ia_owner_metadata_inicio', { empresa_id: empresaId });
  const protheus = configProtheus(empresaId);
  // sx2Puro = apenas o que está cadastrado no SX2 do IAHub (sem injeção de completarSX2Permitidas).
  // Usado para detectar se FK1/FK2 realmente existem no tenant — completarSX2Permitidas injeta FK
  // mesmo quando não está cadastrado no SX2, o que causaria o modelo errado.
  let tabelasMetadados = [...new Set((spec.tabelas || []).map(baseTabelaSX2).filter(Boolean))];
  let sx2Puro = modosSX2(tabelasMetadados, protheus.conexaoId, empresaId);
  let sx2 = completarSX2Permitidas(sx2Puro, tabelasMetadados, protheus.sufixoTabela);
  let { completo: sx3, validacao: sx3Validacao } = camposSX3(tabelasMetadados, protheus.conexaoId, empresaId, spec.sx3PromptLimit || 80, spec.camposSx3Essenciais || {});
  _traceIaOwner('ia_owner_metadata_fim', {
    empresa_id: empresaId,
    conexao_id: protheus.conexaoId || null,
    sx2: sx2 ? Object.keys(sx2).length : 0,
    sx3: sx3 ? Object.keys(sx3).length : 0,
  });
  let sx3Prompt = sx3EssencialParaPrompt(spec.camposSx3Essenciais || {}) || sx3;
  const middlewareCfg = spec.sqlMiddleware.carregarConfig(empresaId);
  const filial = intentEfetivo.filtros?.filial || protheus.filialPadrao || 'TODAS';
  const historico = Array.isArray(intentEfetivo._historicoResumido) ? intentEfetivo._historicoResumido : [];
  const estadoAnterior = limparPeriodosNaoAutoritativos(buildEstadoAnterior(intentEfetivo), mensagem);
  let contextoTecnico = { ...buildContextoTecnico({ spec, empresaId, protheus, sx2, sx2Puro, sx3Prompt, middlewareCfg, filial }), ...contextoTecnicoExtra };
  const tabelaFisica = (sx2Arg, base) => tabelaFisicaSX2(sx2Arg, base) || `${String(base || '').trim().toUpperCase()}${inferirSufixoSX2(sx2Arg, protheus.sufixoTabela)}`;
  const helpers = { connectionFactory, tabelaFisicaSX2: tabelaFisica, escapeSqlLiteral, baseTabelaSX2 };
  const expandirMetadadosParaSql = (sqlAtual) => {
    const basesSql = extrairBasesTabelasFromJoin(sqlAtual);
    const extras = basesSql.filter(base => !tabelasMetadados.includes(base));
    if (!extras.length) return;
    tabelasMetadados = [...new Set([...tabelasMetadados, ...extras])];
    sx2Puro = modosSX2(tabelasMetadados, protheus.conexaoId, empresaId);
    sx2 = completarSX2Permitidas(sx2Puro, tabelasMetadados, protheus.sufixoTabela);
    const sx3Atualizado = camposSX3(tabelasMetadados, protheus.conexaoId, empresaId, spec.sx3PromptLimit || 80, spec.camposSx3Essenciais || {});
    sx3 = sx3Atualizado.completo;
    sx3Validacao = sx3Atualizado.validacao;
    sx3Prompt = sx3EssencialParaPrompt(spec.camposSx3Essenciais || {}) || sx3;
    contextoTecnico = { ...buildContextoTecnico({ spec: { ...spec, tabelas: tabelasMetadados }, empresaId, protheus, sx2, sx2Puro, sx3Prompt, middlewareCfg, filial }), ...contextoTecnicoExtra };
    _traceIaOwner('ia_owner_metadata_expandido_sql', {
      empresa_id: empresaId,
      extras: extras.join(','),
      tabelas_total: tabelasMetadados.length,
      sx2: sx2 ? Object.keys(sx2).length : 0,
      sx3: sx3 ? Object.keys(sx3).length : 0,
    });
  };

  let entidadesResolvidas = (Array.isArray(intentEfetivo._entidadesResolvidas) ? intentEfetivo._entidadesResolvidas : [])
    .filter(entidade => !termoEhEmpresaIAHub({ texto: entidade?.nome || entidade?.texto || entidade?.descricao }, intentEfetivo));
  // Entidade de segurança (vendedor_fixo_seguranca) precede as entidades de negócio:
  // ela é injetada pelo sistema, não pelo usuário, e deve ser parametrizada no SQL canônico
  // para que cada empresa seguidora use o código ERP correto sem nova chamada à IA.
  if (entidadeSeguranca) {
    entidadesResolvidas = [entidadeSeguranca, ...entidadesResolvidas.filter(e => e?.tipo !== 'vendedor_fixo_seguranca')];
  }
  const diagnosticosEntidades = [];
  _traceIaOwner('ia_owner_entidades_pre_inicio', { empresa_id: empresaId });
  const termosEntidadesPrevias = _filtrarTermosTenant(
    await extrairTermosEntidadesAntesIa(spec, keys, cfg, mensagem, intentEfetivo, entidadesResolvidas, empresaId),
    intentEfetivo._channelId
  );
  _traceIaOwner('ia_owner_entidades_pre_fim', {
    empresa_id: empresaId,
    termos: termosEntidadesPrevias.length,
  });
  if (termosEntidadesPrevias.length) {
    const resolucaoPrevia = await resolverEntidadesSeNecessario(spec, termosEntidadesPrevias, {
      empresaId,
      sx2,
      periodo: intentEfetivo.periodo,
      filial,
      estadoAnterior,
      helpers,
    });
    const diagnostico = diagnosticoResolucaoEntidade(resolucaoPrevia);
    if (diagnostico) {
      if (diagnostico.status === 'ambigua' && typeof spec.formatarPerguntaAmbiguidade === 'function') {
        return {
          tipo: 'pergunta_entidade',
          _intentPendente: intentEfetivo,
          _opcoesEntidade: diagnostico.candidatos,
          resposta_direta: spec.formatarPerguntaAmbiguidade(diagnostico.texto, diagnostico.candidatos, { ehVendedorRestrito: Boolean(entidadeSeguranca) }),
          sql_gerado: `-- Aguardando escolha de entidade: ${diagnostico.texto}`,
          duracao_ms: Date.now() - t0,
        };
      }
      diagnosticosEntidades.push(diagnostico);
    }
    entidadesResolvidas = deduplicarEntidadesResolvidas([...entidadesResolvidas, ...(resolucaoPrevia.entidades || [])]);
  }
  if (diagnosticosEntidades.length) {
    contextoTecnico.entidades_nao_resolvidas_pelo_sistema = diagnosticosEntidades;
  }
  entidadesResolvidas = deduplicarEntidadesResolvidas(entidadesResolvidas);
  // Bloqueio antecipado de seguranca: se ha entidade de seguranca de vendedor (vendedorFixo,
  // injetada pelo sistema a partir do remetente) e o usuario pediu/resolveu um vendedor de
  // negocio com codigo DIFERENTE, nega o acesso antes de chamar a IA — sem gastar uma chamada
  // de API e sem dar a IA a chance de tentar conciliar os dois codigos em uma unica consulta.
  if (entidadeSeguranca) {
    const outroVendedor = entidadesResolvidas.find(
      e => String(e?.tipo || '').toLowerCase() === 'vendedor' && String(e.codigo) !== String(entidadeSeguranca.codigo)
    );
    if (outroVendedor) {
      return {
        tipo: 'erro',
        subtipo: 'acesso_negado_vendedor',
        resposta_direta: 'Você só pode consultar suas próprias comissões. Para ver dados de outro vendedor, peça para um gestor consultar.',
        sql_gerado: `-- bloqueado: vendedor ${entidadeSeguranca.codigo} tentou acessar dados do vendedor ${outroVendedor.codigo}`,
        duracao_ms: Date.now() - t0,
      };
    }
  }
  const modeloOpts = {
    modeloBaixasReceber: contextoTecnico.modelo_baixas_receber,
    modeloBaixasPagar: contextoTecnico.modelo_baixas_pagar,
    mensagem,
    empresaId,
    numeroWa: intentEfetivo._remetente || null,
    canalId: intentEfetivo._channelId || intentEfetivo._canalId || null,
    usageOrigem: 'ia-owner',
    usageOperacao: spec.nome || spec.handlerName || 'sql',
  };
  let plano;
  let userPrompt = promptBuilder.buildUserPrompt({ mensagem, historico, estadoAnterior, contextoTecnico, entidadesResolvidas });
  const auditoriaBase = {
    handler: spec.handlerName || spec.nome || 'ia-owner',
    origem: 'ia_owner',
    empresa_id: empresaId,
    prompt_system: promptBuilder.buildSystemPrompt(spec, modeloOpts),
    prompt_user: userPrompt,
    sql_ia_bruto: null,
    sql_apos_sx3: null,
    sql_apos_contratos_relacionais: null,
    contratos_relacionais_aplicados: [],
    sql_apos_sx2: null,
    sql_apos_parametros: null,
    sql_apos_contrato: null,
    sql_final_executado: null,
    plano_ia_owner: null,
    query_plan: null,
    resposta_ia_bruta: null,
  };

  try {
    _traceIaOwner('ia_owner_chamar_ia_inicio', { empresa_id: empresaId, tentativa: 1 });
    plano = await chamarIaOwner(spec, keys, cfg, userPrompt, modeloOpts);
    _traceIaOwner('ia_owner_chamar_ia_fim', {
      empresa_id: empresaId,
      tentativa: 1,
      tem_sql: !!plano?.sql,
      precisa_confirmacao: !!plano?.obj?.precisa_confirmacao,
    });
    auditoriaBase.prompt_system = plano.systemPrompt || auditoriaBase.prompt_system;
    auditoriaBase.prompt_user = plano.userPrompt || userPrompt;
    auditoriaBase.sql_ia_bruto = plano.sql || null;
    auditoriaBase.plano_ia_owner = plano.obj || null;
    auditoriaBase.resposta_ia_bruta = plano.raw || null;
  } catch (e) {
    _traceIaOwner('ia_owner_chamar_ia_erro', { empresa_id: empresaId, tentativa: 1, erro: e?.message || String(e) });
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- IA-OWNER falhou: ${limitarTexto(e.message, 1000)}`, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
  }

  let planoConsulta = construirQueryPlanTecnico({
    spec,
    mensagem,
    periodo: plano.obj?.periodo,
    filtros: plano.obj?.filtros || intentEfetivo.filtros || {},
    entidades: entidadesResolvidas,
  });
  // Propaga o modelo de baixas detectado para o plano, para que formatQueryPlanForPrompt
  // gere a instrução com o modelo correto para este tenant (FK1/FK2 ou SE5).
  planoConsulta.modelo_baixas_receber = contextoTecnico.modelo_baixas_receber;
  planoConsulta.modelo_baixas_pagar = contextoTecnico.modelo_baixas_pagar;
  contextoTecnico.query_plan = planoConsulta;
  contextoTecnico.query_plan_texto = queryPlan.formatQueryPlanForPrompt(planoConsulta);
  auditoriaBase.query_plan = planoConsulta;

  if (confirmacaoPodeEncerrarPlano(plano.obj)) {
    return {
      tipo: 'erro',
      subtipo: 'confirmacao_necessaria',
      resposta_direta: plano.obj.pergunta_confirmacao || 'Preciso que voce confirme o periodo, filtro ou detalhe da consulta.',
      sql_gerado: JSON.stringify(plano.obj, null, 2),
      _sql_auditoria: auditoriaBase,
      duracao_ms: Date.now() - t0,
      _ia_owner_plano: plano.obj,
    };
  }

  const entidadesDeclaradasPelaIa = normalizarEntidadesNecessarias(plano.obj);
  const pedidoEntidades = deduplicarTermosEntidade(entidadesDeclaradasPelaIa, intentEfetivo, entidadesResolvidas);
  if (pedidoEntidades.length) {
    const resolucao = await resolverEntidadesSeNecessario(spec, pedidoEntidades, { empresaId, sx2, periodo: plano.obj.periodo, filial, helpers });
    const diagnostico = diagnosticoResolucaoEntidade(resolucao);
    if (diagnostico) {
      if (diagnostico.status === 'ambigua' && typeof spec.formatarPerguntaAmbiguidade === 'function') {
        return {
          tipo: 'pergunta_entidade',
          _intentPendente: intentEfetivo,
          _opcoesEntidade: diagnostico.candidatos,
          resposta_direta: spec.formatarPerguntaAmbiguidade(diagnostico.texto, diagnostico.candidatos, { ehVendedorRestrito: Boolean(entidadeSeguranca) }),
          sql_gerado: `-- Aguardando escolha de entidade: ${diagnostico.texto}`,
          _sql_auditoria: auditoriaBase,
          duracao_ms: Date.now() - t0,
        };
      }
      contextoTecnico.entidades_nao_resolvidas_pelo_sistema = [
        ...(contextoTecnico.entidades_nao_resolvidas_pelo_sistema || []),
        diagnostico,
      ];
      userPrompt = promptBuilder.buildUserPrompt({
        mensagem,
        historico,
        estadoAnterior,
        contextoTecnico,
        entidadesResolvidas,
        tentativa: 'ULTIMO RECURSO: o sistema nao conseguiu resolver inequivocamente a entidade solicitada. Resolva pela IA e gere o SQL final a partir da pergunta original, sem inventar codigos fixos e usando somente tabelas/sufixos do contexto tecnico atual.',
      });
      try {
        plano = await chamarIaOwner(spec, keys, cfg, userPrompt, modeloOpts);
        auditoriaBase.prompt_user = plano.userPrompt || userPrompt;
        auditoriaBase.sql_ia_bruto = plano.sql || auditoriaBase.sql_ia_bruto;
        auditoriaBase.plano_ia_owner = plano.obj || auditoriaBase.plano_ia_owner;
        auditoriaBase.resposta_ia_bruta = plano.raw || auditoriaBase.resposta_ia_bruta;
      } catch (e) {
        return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- IA-OWNER falhou no ultimo recurso de entidade: ${limitarTexto(e.message, 1000)}`, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
      }
    } else {
      entidadesResolvidas = deduplicarEntidadesResolvidas([...entidadesResolvidas, ...(resolucao.entidades || [])]);
      userPrompt = promptBuilder.buildUserPrompt({
        mensagem,
        historico,
        estadoAnterior,
        contextoTecnico,
        entidadesResolvidas,
        tentativa: 'Entidades cadastrais foram resolvidas. Gere SQL final usando codigos internos e exibindo nomes/descricoes.',
      });
      try {
        plano = await chamarIaOwner(spec, keys, cfg, userPrompt, modeloOpts);
        auditoriaBase.prompt_user = plano.userPrompt || userPrompt;
        auditoriaBase.sql_ia_bruto = plano.sql || auditoriaBase.sql_ia_bruto;
        auditoriaBase.plano_ia_owner = plano.obj || auditoriaBase.plano_ia_owner;
        auditoriaBase.resposta_ia_bruta = plano.raw || auditoriaBase.resposta_ia_bruta;
      } catch (e) {
        return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- IA-OWNER falhou apos entidades: ${limitarTexto(e.message, 1000)}`, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
      }
    }
  } else if (plano.obj.precisa_confirmacao && entidadesDeclaradasPelaIa.length && entidadesResolvidas.length) {
    userPrompt = promptBuilder.buildUserPrompt({
      mensagem,
      historico,
      estadoAnterior,
      contextoTecnico,
      entidadesResolvidas,
      tentativa: 'A entidade solicitada ja foi resolvida pelo sistema. Nao solicite confirmacao generica; gere o SQL final usando os codigos internos fornecidos.',
    });
    try {
      plano = await chamarIaOwner(spec, keys, cfg, userPrompt, modeloOpts);
      auditoriaBase.prompt_user = plano.userPrompt || userPrompt;
      auditoriaBase.sql_ia_bruto = plano.sql || auditoriaBase.sql_ia_bruto;
      auditoriaBase.plano_ia_owner = plano.obj || auditoriaBase.plano_ia_owner;
      auditoriaBase.resposta_ia_bruta = plano.raw || auditoriaBase.resposta_ia_bruta;
    } catch (e) {
      return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- IA-OWNER falhou apos entidade ja resolvida: ${limitarTexto(e.message, 1000)}`, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
    }
  }

  if (plano.obj.precisa_confirmacao) {
    return {
      tipo: 'erro',
      subtipo: 'confirmacao_necessaria',
      resposta_direta: plano.obj.pergunta_confirmacao || 'Preciso que voce confirme o periodo, filtro ou detalhe da consulta.',
      sql_gerado: JSON.stringify(plano.obj, null, 2),
      _sql_auditoria: auditoriaBase,
      duracao_ms: Date.now() - t0,
      _ia_owner_plano: plano.obj,
    };
  }

  if (!plano.sql || String(plano.sql).trim() === 'null') {
    return { tipo: 'erro', subtipo: 'sql_nao_extraido', resposta_direta: mensagemErro(spec, 'sql_invalido'), sql_gerado: JSON.stringify(plano.obj, null, 2), _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0, _ia_owner_plano: plano.obj };
  }

  let preparado;
  let sqlOriginalIa = plano.sql;
  const maxTentativas = maxTentativasPrepararSql(entidadesResolvidas);
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      expandirMetadadosParaSql(plano.sql);
      _traceIaOwner('ia_owner_preparar_sql_inicio', { empresa_id: empresaId, tentativa });
      preparado = await prepararSql({ spec: { ...spec, tabelas: tabelasMetadados }, sql: plano.sql, sx2, sx3: sx3Validacao, protheus, middlewareCfg, entidades: entidadesResolvidas, filial, periodo: plano.obj.periodo, planoConsulta, mensagem });
      _traceIaOwner('ia_owner_preparar_sql_fim', {
        empresa_id: empresaId,
        tentativa,
        sql_chars: String(preparado?.sqlFinal || '').length,
      });
      auditoriaBase.sql_apos_sx3 = sx3SqlValidator.normalizarReferenciasAliasSql(plano.sql);
      auditoriaBase.sql_apos_contratos_relacionais = preparado.sqlAposContratosRelacionais;
      auditoriaBase.contratos_relacionais_aplicados = preparado.contratosRelacionaisAplicados;
      auditoriaBase.sql_apos_sx2 = preparado.sqlCanonico;
      auditoriaBase.sql_apos_parametros = preparado.sqlCanonico;
      auditoriaBase.sql_apos_contrato = preparado.sqlCanonico;
      auditoriaBase.sql_final_executado = preparado.sqlFinal;
      const conn = connectionFactory.carregarConexao(empresaId);
      _traceIaOwner('ia_owner_erp_executar_inicio', {
        empresa_id: empresaId,
        tentativa,
        tipo_conexao: conn?.tipo || null,
        conexao_id: conn?.id || null,
      });
      conn._pergunta   = mensagem;
      conn._sender     = intent._remetente || '';
      conn._modulo     = spec.nome         || '';
      conn._operacao   = intent.intencao   || '';
      conn._empresa_id = empresaId         || '';
      const rows = await connectionFactory.executar(conn, preparado.sqlFinal, {});
      _traceIaOwner('ia_owner_erp_executar_fim', {
        empresa_id: empresaId,
        tentativa,
        rows: Array.isArray(rows) ? rows.length : null,
      });
      const resposta = rows && rows.length
        ? await formatarResposta(spec, mensagem, rows, keys, cfg, intent, plano.obj.periodo || null, protheus, empresaId)
        : mensagemErro(spec, 'sem_resultado');
      // Formatter programático tem prioridade sobre template planejado pela IA (evita Total Geral errado em comparativos)
      const _wf = require('../whatsapp-format-prompt');
      const _comparativo = rows?.length
        ? _wf.buildFormatComparativoSimples(rows, {
            contextoConsulta: _buildContextoConsulta(intent, plano.obj.periodo || null, mensagem),
          })
        : null;
      const respostaCanonica = intent?._formatacaoCaminho === 'canonico' ? resposta : null;
      const respostaDireta = _comparativo || respostaCanonica || interpolarRespostaPlanejada(plano.obj.resposta_planejada, rows) || resposta;
      return {
        tipo: 'sucesso_ai_sql',
        resposta_direta: responseFormatter.normalizarAgrupamentosPais(respostaDireta),
        rows: rows || [],
        sql_gerado: preparado.sqlFinal,
        periodo_resolvido: plano.obj.periodo || null,
        _sql_canonico: preparado.sqlCanonico,
        _sql_canonico_origem: 'ia_owner',
        _sql_canonico_original: sqlOriginalIa,
        _sql_canonico_empresa_origem: empresaId,
        _sql_canonico_parametros: preparado.parametros,
        _sql_auditoria: auditoriaBase,
        _entidadesResolvidas: entidadesResolvidas,
        _ia_owner_plano: plano.obj,
        trace: [{ etapa: 'ia_owner', acao: 'executado', modulo: spec.nome, detalhe: `tentativa=${tentativa}; linhas=${(rows || []).length}` }],
        duracao_ms: Date.now() - t0,
      };
    } catch (e) {
      const semConexao = /nenhuma conex|no connection|connect/i.test(e.message || '');
      if (semConexao) {
        return { tipo: 'erro', subtipo: 'sem_conexao', resposta_direta: mensagemErro(spec, 'sem_conexao'), sql_gerado: preparado?.sqlFinal || plano.sql, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
      }
      // Violacao de seguranca (vendedor tentando acessar dados de outro vendedor): falha
      // direto, sem retry. Dar a IA outra chance de gerar SQL para o mesmo pedido e um risco
      // de seguranca, nao um erro tecnico corrigivel.
      if (e._tipo === 'acesso_negado_vendedor') {
        return {
          tipo: 'erro',
          subtipo: 'acesso_negado_vendedor',
          resposta_direta: 'Você só pode consultar suas próprias comissões. Para ver dados de outro vendedor, peça para um gestor consultar.',
          sql_gerado: `${e._sql || plano.sql}\n\n-- ERRO: ${limitarTexto(e.message, 1000)}`,
          _sql_auditoria: auditoriaBase,
          duracao_ms: Date.now() - t0,
        };
      }
      if (tentativa >= maxTentativas) {
        const sqlErro = preparado?.sqlFinal || e._sql || plano.sql;
        const subtipo = e._tipo || 'erro_erp';
        return { tipo: 'erro', subtipo, resposta_direta: mensagemErro(spec, subtipoEhInconsistenciaConsulta(subtipo) ? 'sql_invalido' : 'erro_erp'), sql_gerado: `${sqlErro}\n\n-- ERRO: ${limitarTexto(e.message, 1000)}`, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0, _ia_owner_plano: plano.obj };
      }
      const retryPrompt = promptBuilder.buildUserPrompt({
        mensagem,
        historico,
        estadoAnterior,
        contextoTecnico,
        entidadesResolvidas,
        tentativa: buildRetryTecnicoIaOwner({ erro: e, entidadesResolvidas }),
        erroSql: e.message,
        sqlComErro: preparado?.sqlFinal || e._sql || plano.sql,
      });
      plano = await chamarIaOwner(spec, keys, cfg, retryPrompt, { ...modeloOpts, maxTokens: spec.maxTokens || 3500 });
      auditoriaBase.prompt_user = plano.userPrompt || retryPrompt;
      auditoriaBase.sql_ia_bruto = plano.sql || auditoriaBase.sql_ia_bruto;
      auditoriaBase.plano_ia_owner = plano.obj || auditoriaBase.plano_ia_owner;
      auditoriaBase.resposta_ia_bruta = plano.raw || auditoriaBase.resposta_ia_bruta;
      planoConsulta = construirQueryPlanTecnico({
        spec,
        mensagem,
        periodo: plano.obj?.periodo,
        filtros: plano.obj?.filtros || intentEfetivo.filtros || {},
        entidades: entidadesResolvidas,
      });
      planoConsulta.modelo_baixas_receber = contextoTecnico.modelo_baixas_receber;
      planoConsulta.modelo_baixas_pagar = contextoTecnico.modelo_baixas_pagar;
      contextoTecnico.query_plan = planoConsulta;
      contextoTecnico.query_plan_texto = queryPlan.formatQueryPlanForPrompt(planoConsulta);
      auditoriaBase.query_plan = planoConsulta;
      if (plano.sql) sqlOriginalIa = plano.sql;
    }
  }
  // Caminho atingido se chamarIaOwner() lançou exceção dentro do catch da tentativa 1.
  return { tipo: 'erro', subtipo: 'erro_erp', resposta_direta: mensagemErro(spec, 'erro_erp'), sql_gerado: plano?.sql || '', _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
}

async function executarSqlDireto(spec, sqlCanonico, intent, empresaId) {
  const t0 = Date.now();
  const mensagem = intent._mensagemOriginal || intent.intencao || spec.defaultMessage || 'consulta';
  const _sqlTrim = String(sqlCanonico || '').trim();
  if (!_sqlTrim || _sqlTrim === 'null') {
    return { tipo: 'erro', subtipo: 'sql_nao_extraido', resposta_direta: mensagemErro(spec, 'sql_invalido'), sql_gerado: null, _sql_auditoria: { origem: 'ia_owner_reuso', sql_final_executado: null }, duracao_ms: Date.now() - t0 };
  }
  const protheus = configProtheus(empresaId);
  const sx2 = completarSX2Permitidas(modosSX2(spec.tabelas, protheus.conexaoId, empresaId), spec.tabelas, protheus.sufixoTabela);
  const { validacao: sx3Validacao } = camposSX3(spec.tabelas, protheus.conexaoId, empresaId, spec.sx3PromptLimit || 80, spec.camposSx3Essenciais || {});
  const middlewareCfg = spec.sqlMiddleware.carregarConfig(empresaId);
  const sqlCanonicoNormalizado = sx3SqlValidator.normalizarReferenciasAliasSql(sqlCanonico);
  const sqlCanonicoAdaptadoTemplate = sx2SqlNormalizer.adaptarSqlCanonicoPorSX2(
    sqlCanonicoNormalizado,
    sx2,
    { logPrefix: spec.logPrefix, sufixoFallback: inferirSufixoSX2(sx2, protheus.sufixoTabela) },
  );
  const auditoriaBase = {
    handler: spec.handlerName || spec.nome || 'ia-owner',
    origem: 'ia_owner_reuso',
    empresa_id: empresaId,
    prompt_system: null,
    prompt_user: null,
    sql_ia_bruto: sqlCanonico || null,
    sql_canonico_recebido: sqlCanonico || null,
    sx2,
    sufixoTabela: inferirSufixoSX2(sx2, protheus.sufixoTabela),
    sql_apos_sx3: sqlCanonicoNormalizado,
    sql_apos_contratos_relacionais: null,
    contratos_relacionais_aplicados: [],
    sql_apos_sx2: sqlCanonicoAdaptadoTemplate,
    sql_apos_parametros: null,
    sql_apos_contrato: null,
    sql_final_executado: null,
    plano_ia_owner: null,
    query_plan: null,
    resposta_ia_bruta: null,
  };
  let entidades = Array.isArray(intent._entidadesResolvidas) ? intent._entidadesResolvidas : [];
  const entidadesParaResolverNoTenant = entidades.filter(entidade => entidade?._resolverNoTenantAtual);
  if (entidadesParaResolverNoTenant.length) {
    const tabelaFisica = (sx2Arg, base) => tabelaFisicaSX2(sx2Arg, base) || `${String(base || '').trim().toUpperCase()}${inferirSufixoSX2(sx2Arg, protheus.sufixoTabela)}`;
    const helpers = { connectionFactory, tabelaFisicaSX2: tabelaFisica, escapeSqlLiteral, baseTabelaSX2 };
    const pedidos = pedidosEntidadesParaResolverNoTenant(entidades);
    const resolucaoLocal = await resolverEntidadesSeNecessario(spec, pedidos, {
      empresaId,
      sx2,
      periodo: intent.periodo,
      filial: intent.filtros?.filial || protheus.filialPadrao || 'TODAS',
      estadoAnterior: buildEstadoAnterior(intent),
      helpers,
    });
    if (resolucaoLocal.status !== 'resolvido' || !(resolucaoLocal.entidades || []).length) {
      const diagnostico = diagnosticoResolucaoEntidade(resolucaoLocal);
      return {
        tipo: 'erro',
        subtipo: resolucaoLocal.status === 'ambigua' ? 'entidade_ambigua_tenant' : 'entidade_nao_encontrada_tenant',
        resposta_direta: `Nao consegui resolver *${diagnostico?.texto || pedidos[0]?.texto || 'a entidade'}* no cadastro desta empresa.`,
        sql_gerado: sqlCanonico,
        _sql_canonico: sqlCanonicoAdaptadoTemplate,
        _sql_auditoria: auditoriaBase,
        duracao_ms: Date.now() - t0,
      };
    }
    entidades = [
      ...entidades.filter(entidade => !entidade?._resolverNoTenantAtual),
      ...resolucaoLocal.entidades,
    ];
  }
  const _erroAgenteTemporal = (msg) => /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout ao chamar/i.test(msg || '');
  const MAX_TENTATIVAS_DIRETO = 2;
  let preparado = null;
  for (let tentativaDireto = 1; tentativaDireto <= MAX_TENTATIVAS_DIRETO; tentativaDireto++) {
    try {
      if (tentativaDireto > 1) {
        await new Promise(r => setTimeout(r, 2000));
        console.warn(`[${spec.logPrefix || 'IAOwner'}] executarSqlDireto retry ${tentativaDireto}/${MAX_TENTATIVAS_DIRETO} para empresa #${empresaId} após erro de agente.`);
      }
      const planoConsulta = construirQueryPlanTecnico({
        spec,
        mensagem,
        periodo: intent._periodoCanonicoResolvido || intent.periodo,
        filtros: intent.filtros || {},
        entidades,
      });
      auditoriaBase.query_plan = planoConsulta;
      preparado = await prepararSql({ spec, sql: sqlCanonico, sx2, sx3: sx3Validacao, protheus, middlewareCfg, entidades, filial: intent.filtros?.filial || 'TODAS', periodo: intent._periodoCanonicoResolvido || intent.periodo, planoConsulta, mensagem });
      auditoriaBase.sql_apos_sx3 = sx3SqlValidator.normalizarReferenciasAliasSql(sqlCanonico);
      auditoriaBase.sql_apos_contratos_relacionais = preparado.sqlAposContratosRelacionais;
      auditoriaBase.contratos_relacionais_aplicados = preparado.contratosRelacionaisAplicados;
      auditoriaBase.sql_apos_sx2 = preparado.sqlCanonico;
      auditoriaBase.sql_apos_parametros = preparado.sqlCanonico;
      auditoriaBase.sql_apos_contrato = preparado.sqlCanonico;
      auditoriaBase.sql_final_executado = preparado.sqlFinal;
      const conn = connectionFactory.carregarConexao(empresaId);
      conn._pergunta   = intent._mensagemOriginal || '';
      conn._sender     = intent._remetente        || '';
      conn._modulo     = spec.nome                || '';
      conn._operacao   = intent.intencao          || '';
      conn._empresa_id = empresaId                || '';
      const rows = await connectionFactory.executar(conn, preparado.sqlFinal, {});
      const { keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId);
      const template = intent._respostaPlanejadaCanonica || intent._iaOwnerRespostaPlanejada || null;
      const resposta = rows && rows.length
        ? await formatarResposta(spec, intent._mensagemOriginal || 'consulta', rows, keys, cfg, intent, intent._periodoCanonicoResolvido || null, protheus, empresaId)
        : mensagemErro(spec, 'sem_resultado');
      // Formatter programático tem prioridade sobre template canônico herdado (evita Total Geral errado em comparativos)
      const _wfD = require('../whatsapp-format-prompt');
      const _comparativoD = rows?.length
        ? _wfD.buildFormatComparativoSimples(rows, {
            contextoConsulta: _buildContextoConsulta(intent, intent._periodoCanonicoResolvido || null, intent._mensagemOriginal || 'consulta'),
          })
        : null;
      const respostaCanonicaD = intent?._formatacaoCaminho === 'canonico' ? resposta : null;
      const respostaDireta = _comparativoD || respostaCanonicaD || interpolarRespostaPlanejada(template, rows) || resposta;
      return {
        tipo: 'sucesso_ai_sql',
        resposta_direta: responseFormatter.normalizarAgrupamentosPais(respostaDireta),
        rows: rows || [],
        sql_gerado: preparado.sqlFinal,
        _sql_canonico: preparado.sqlCanonico,
        _sql_canonico_origem: 'ia_owner_reuso',
        _sql_canonico_original: sqlCanonico,
        _sql_canonico_empresa_origem: empresaId,
        _sql_canonico_parametros: preparado.parametros,
        _sql_auditoria: auditoriaBase,
        _entidadesResolvidas: entidades,
        duracao_ms: Date.now() - t0,
      };
    } catch (e) {
      if (preparado) {
        auditoriaBase.sql_apos_contratos_relacionais = preparado.sqlAposContratosRelacionais;
        auditoriaBase.contratos_relacionais_aplicados = preparado.contratosRelacionaisAplicados;
        auditoriaBase.sql_apos_sx2 = preparado.sqlCanonico;
        auditoriaBase.sql_apos_parametros = preparado.sqlCanonico;
        auditoriaBase.sql_apos_contrato = preparado.sqlCanonico;
        auditoriaBase.sql_final_executado = preparado.sqlFinal;
      }
      // Erro de agente temporário (pool ODBC ocupado, socket reset): tenta novamente
      if (tentativaDireto < MAX_TENTATIVAS_DIRETO && _erroAgenteTemporal(e.message)) {
        console.warn(`[${spec.logPrefix || 'IAOwner'}] executarSqlDireto empresa #${empresaId}: erro de agente temporário (${limitarTexto(e.message, 100)}). Aguardando retry...`);
        continue;
      }
      const sqlErro = preparado?.sqlFinal || e._sql || sqlCanonico;
      console.warn(`[${spec.logPrefix || 'IAOwner'}] executarSqlDireto falhou para empresa #${empresaId}: subtipo=${e._tipo || 'erro_erp'} | erro=${limitarTexto(e.message, 300)}`);
      const subtipo = e._tipo || 'erro_erp';
      return {
        tipo: 'erro',
        subtipo,
        resposta_direta: subtipo === 'acesso_negado_vendedor'
          ? 'Você só pode consultar suas próprias comissões. Para ver dados de outro vendedor, peça para um gestor consultar.'
          : mensagemErro(spec, subtipoEhInconsistenciaConsulta(subtipo) ? 'sql_invalido' : 'erro_erp'),
        sql_gerado: `${sqlErro}\n\n-- ERRO: ${limitarTexto(e.message, 1000)}`,
        _sql_auditoria: auditoriaBase,
        duracao_ms: Date.now() - t0,
      };
    }
  }
  // Nunca alcançado — satisfaz o analisador de fluxo
  const subtipo = 'erro_erp';
  return { tipo: 'erro', subtipo, resposta_direta: mensagemErro(spec, 'erro_erp'), sql_gerado: sqlCanonico, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
}

module.exports = {
  executar,
  executarSqlDireto,
  invalidarMetaCache,
  _test: {
    extrairJson,
    extrairSQL,
    buildEstadoAnterior,
    buildContextoTecnico,
    confirmacaoPodeEncerrarPlano,
    pedidosEntidadesParaResolverNoTenant,
    mensagemTemPeriodoRelativo,
    limparPeriodosNaoAutoritativos,
    dataAtualServidor,
    formatarValorRespostaPlanejada,
    interpolarRespostaPlanejada,
    validarSqlIaOwnerBasico,
    normalizarAliasesBaseAusentes,
    validarPeriodoDeclaradoNoSql,
    sqlTemFiltroPeriodoEmCampo,
    construirQueryPlanTecnico,
    _buildContextoFormatacao,
    validarSelectContraGroupBy,
    validarAliasesDerivadosExternos,
    validarCTEsAgregadosSemGroupBy,
    validarCTEsDefinidaUsada,
    validarAliasesSubqueriesEscalares,
    _extrairSubqueriesEscalares,
    completarContratoRelacionalSD1SF1,
    _extrairCorposCTE,
    sx3EssencialParaPrompt,
    completarSX2Permitidas,
    diagnosticoResolucaoEntidade,
    termoEhEmpresaIAHub,
    mensagemMencionaValorEntidade,
    tipoEntidadePadraoParaFiltroEmpresa,
    normalizarFiltroEmpresaComoEntidade,
    limparFiltrosEntidadeHerdadosDaConsultaAtual,
    maxTentativasPrepararSql,
    buildRetryTecnicoIaOwner,
    deduplicarTermosEntidade,
    extrairTermosEntidadesAntesIa,
    normalizarEntidadesNecessarias,
    _buildContextoConsulta,
    _extrairLabelIntencao,
    // Expõe buildContextoTecnico para testes sem depender de banco/protheus
    buildContextoTecnicoTest: ({ spec, sx2 = {}, sx2Puro, sx3Prompt } = {}) => buildContextoTecnico({
      spec: spec || {},
      empresaId: 0,
      protheus: { sufixoTabela: null },
      sx2,
      sx2Puro,
      sx3Prompt: sx3Prompt || null,
      middlewareCfg: {},
      filial: null,
    }),
  },
};
