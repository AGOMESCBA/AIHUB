'use strict';

const connectionFactory = require('../providers/connection-factory');
const aiProviderClient = require('../ai-provider-client');
const sx2SqlNormalizer = require('../sx2-sql-normalizer');
const sx3SqlValidator = require('../sx3-sql-validator');
const entitySqlGuard = require('../entity-sql-guard');
const responseFormatter = require('../response-formatter');
const promptBuilder = require('./prompt-builder');
const entityResolver = require('../../ai/entity-resolver');

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
  return new RegExp(`\\b(hoje|ontem|do dia|no dia|dia atual|dia anterior|mes atual|deste mes|este mes|no mes|do mes|mes passado|ano atual|deste ano|este ano|do ano|no ano|ano passado|semana passada|ultima semana|ultimo mes|ultimo ano|${MESES_CRONOLOGICOS})\\b`).test(texto);
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
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    let row = db.prepare('SELECT id, configuracoes FROM connections WHERE empresa_id = ? AND ativo = 1 LIMIT 1').get(empresaId);
    if (!row) {
      const sx2Row = db.prepare('SELECT connection_id FROM protheus_sx2 WHERE empresa_id = ? LIMIT 1').get(empresaId);
      if (sx2Row?.connection_id) row = db.prepare('SELECT id, configuracoes FROM connections WHERE id = ? AND ativo = 1').get(sx2Row.connection_id);
    }
    const cfg = row?.configuracoes ? JSON.parse(row.configuracoes) : {};
    return { conexaoId: row?.id || null, sufixoTabela: cfg.sufixo_tabela || '010', filialPadrao: cfg.filial_padrao || null };
  } catch (_) {
    return { conexaoId: null, sufixoTabela: '010', filialPadrao: null };
  }
}

function modosSX2(tabelas, conexaoId, empresaId) {
  if (!conexaoId) return null;
  try {
    const { getDB } = require('../../database');
    const rows = getDB().prepare('SELECT chave, arquivo, modo FROM protheus_sx2 WHERE connection_id = ? AND empresa_id = ?').all(conexaoId, empresaId);
    const bases = new Set(tabelas || []);
    const mapa = {};
    for (const row of rows) {
      const arquivo = String(row.arquivo || row.chave || '').trim().toUpperCase();
      if (arquivo && bases.has(baseTabelaSX2(arquivo))) mapa[arquivo] = row.modo;
    }
    return Object.keys(mapa).length ? mapa : null;
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
  if (!conexaoId) return null;
  try {
    const { getDB } = require('../../database');
    const rows = getDB().prepare(`
      SELECT tabela, campo, tipo, tamanho, decimal, titulo, descricao
      FROM protheus_sx3
      WHERE connection_id = ? AND empresa_id = ?
      ORDER BY tabela, ordem, campo
    `).all(conexaoId, empresaId);
    const bases = new Set(tabelas || []);
    const mapa = {};
    for (const row of rows) {
      const tabela = String(row.tabela || '').toUpperCase().trim();
      if (!bases.has(baseTabelaSX2(tabela))) continue;
      if (!mapa[tabela]) mapa[tabela] = [];
      const base = baseTabelaSX2(tabela);
      const essencial = new Set((essenciais[base] || []).map(c => String(c || '').toUpperCase()));
      const campoNorm = String(row.campo || '').toUpperCase();
      if (mapa[tabela].length >= limite && !essencial.has(campoNorm)) continue;
      if (mapa[tabela].some(c => String(c.campo || '').toUpperCase() === campoNorm)) continue;
      mapa[tabela].push({
        campo: row.campo,
        tipo: row.tipo,
        tamanho: row.tamanho,
        decimal: row.decimal,
        descricao: row.titulo || row.descricao || '',
      });
    }
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
    return Object.keys(mapa).length ? mapa : montarEssenciais();
  } catch (_) {
    return montarEssenciais();
  }
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
  const systemPrompt = promptBuilder.buildSystemPrompt(spec);
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

function normalizarEntidadesNecessarias(obj = {}) {
  return (Array.isArray(obj.entidades_necessarias) ? obj.entidades_necessarias : [])
    .map(e => ({
      tipo: String(e?.tipo || e?.tipo_sugerido || '').trim().toLowerCase(),
      tipo_sugerido: String(e?.tipo_sugerido || e?.tipo || '').trim().toLowerCase(),
      texto: String(e?.texto || '').trim(),
      origem: e?.origem || 'ia_owner',
    }))
    .filter(e => e.tipo && e.texto);
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
    .map(entidade => ({
      texto: entidade.termoBusca || entidade.texto || entidade.nome,
      tipo: entidade.tipo,
      tipo_sugerido: entidade.tipo,
      origem: 'filtro_estruturado',
    }))
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

function entidadeResolvidaCompativel(termo, entidades = []) {
  const texto = normalizarTextoEntidade(termo?.texto);
  const tipo = String(termo?.tipo_sugerido || termo?.tipo || '').trim().toLowerCase();
  if (!texto) return false;
  return (entidades || []).some(entidade => {
    const tipoEntidade = String(entidade?.tipo || '').trim().toLowerCase();
    if (tipo && tipo !== 'desconhecido' && tipo !== tipoEntidade) return false;
    const nome = normalizarTextoEntidade(entidade?.nome || entidade?.texto || entidade?.descricao);
    return nome && (nome.includes(texto) || texto.includes(nome));
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

function mensagemDeclaraEmpresaExplicitamente(mensagem, valor) {
  const texto = normalizarTextoEntidade(mensagem);
  const alvo = normalizarTextoEntidade(valor);
  if (!texto || !alvo) return false;
  const posEmpresa = texto.search(/\bempresas?\b/);
  const posAlvo = texto.indexOf(alvo);
  return posEmpresa >= 0 && posAlvo > posEmpresa;
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
  if (!valor || temTenantValidado || mensagemDeclaraEmpresaExplicitamente(mensagem, valor) || intent._herdouContextoOrquestrador) return intent;

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

async function extrairTermosEntidadesAntesIa(spec, keys, cfg, mensagem, intent, entidadesResolvidas = []) {
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
  let termosIa = [];
  try {
    const raw = await aiProviderClient.chamarIA(
      keys,
      cfg,
      entityResolver.buildExtractionSystemPrompt(),
      entityResolver.buildExtractionUserPrompt(mensagem, spec.nome || 'erp'),
      { json: true, maxTokens: 500, temperature: 0, logPrefix: `${spec.logPrefix || 'IAOwner'}-entidades` }
    );
    termosIa = entityResolver.normalizarEntidadesIA(raw);
  } catch (e) {
    console.warn(`[${spec.logPrefix || 'IAOwner'}] Extracao previa de entidades falhou; usando termos deterministicas:`, e.message);
  }
  return deduplicarTermosEntidade([...termosFiltros, ...explicitos, ...termosIa], intent, entidadesResolvidas)
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
    periodo: intent.periodo || null,
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
      return { ...co, filtros: filtrosLimpos, agrupamentos: coAg };
    })(),
    contexto_ia_anterior: intent._contextoIAAnterior || null,
    ultimo_sql: intent._sqlCanonicoOriginal || intent._sql_canonico || null,
    ultima_resposta: intent._ultimaResposta || null,
  };
}

function buildContextoTecnico({ spec, empresaId, protheus, sx2, sx3Prompt, middlewareCfg, filial }) {
  return {
    empresaId,
    data_atual: dataAtualServidor(),
    tabelas_permitidas: spec.tabelas || [],
    sx2,
    sufixoTabela: inferirSufixoSX2(sx2, protheus.sufixoTabela),
    sufixosPorTabela: sufixosPorTabelaSX2(sx2),
    sx3: sx3Prompt,
    filial: filial || protheus.filialPadrao || 'TODAS',
    filialPadrao: protheus.filialPadrao || null,
    modeloDados: middlewareCfg.modelo_dados || 'TRADICIONAL',
    campoFilial: middlewareCfg.campo_filial || null,
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

  const fins = ['HAVING', 'ORDER BY']
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

function validarEscopoSubqueryExterno(sql = '') {
  const texto = String(sql || '').trim();
  // Só verifica quando a query tem FROM subquery (tabela derivada): FROM (SELECT...)
  const posFrom = localizarKeywordNivelZero(texto, 'FROM');
  if (posFrom < 0) return { ok: true, erros: [] };
  let i = posFrom + 4;
  while (i < texto.length && /\s/.test(texto[i])) i++;
  if (texto[i] !== '(') return { ok: true, erros: [] };

  const { select, group } = extrairSelectEGroupByNivelZero(texto);
  if (!select) return { ok: true, erros: [] };
  const parteExterna = (select || '') + ' ' + (group || '');

  const aliases = ['SF2','SD2','SF1','SD1','SA1','SA2','SA3','SB1','SBM','SF4','CTT',
                   'SE1','SE2','SE3','SE5','SE8','SED','SA6','SC7','SE3'];
  for (const alias of aliases) {
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

function validarSqlIaOwnerBasico(sql, spec = {}, sx2 = {}) {
  const texto = String(sql || '').trim();
  const erros = [];
  if (!/^SET\s+ROWCOUNT\s+\d+\s*;\s*SELECT\b/i.test(texto)) {
    erros.push('SQL deve iniciar com SET ROWCOUNT N; SELECT ...');
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
    if (regex && regex.test(texto)) erros.push(regra.mensagem || 'SQL rejeitado por regra tecnica do modulo.');
  }
  if (/\b[A-Z]{2,4}\d{3,4}\s*\./i.test(texto)) {
    erros.push('Use alias base para qualificar campos (SD1.D1_TOTAL), nunca tabela fisica como qualificador (SD1990.D1_TOTAL).');
  }
  const escopoCheck = validarEscopoSubqueryExterno(texto);
  if (!escopoCheck.ok) {
    erros.push(...escopoCheck.erros);
  } else {
    erros.push(...validarSelectContraGroupBy(texto).erros);
  }

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

function _buildContextoConsulta(intent, periodoResolvido = null) {
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

  const partes = [filtroPeriodo, filtroEnt].filter(Boolean);
  return partes.length ? partes.join(' | ') : null;
}

async function formatarResposta(spec, mensagem, rows, keys, cfg, intent, periodoResolvido = null) {
  if (typeof spec.formatarResposta === 'function') return spec.formatarResposta({ mensagem, rows, keys, cfg });
  if (!rows || !rows.length) return mensagemErro(spec, 'sem_resultado');
  const whatsappFormat = require('../whatsapp-format-prompt');
  const contextoConsulta = _buildContextoConsulta(intent, periodoResolvido);

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
  const direto = whatsappFormat.buildFormatDirect(mensagem, rows, { contextoConsulta, nomeModulo, anoFirst })
    || whatsappFormat.buildFormatAnoMesDireto(rows, { contextoConsulta, nomeModulo })
    || whatsappFormat.buildFormatSimplesTemporal(rows, { contextoConsulta, nomeModulo, anoFirst });
  if (direto) return direto;

  try {
    return await aiProviderClient.chamarIA(
      keys,
      cfg,
      whatsappFormat.buildFormatSystemPrompt(),
      whatsappFormat.buildFormatUserPrompt(mensagem, rows, { contextoConsulta }),
      { json: false, maxTokens: 6000, temperature: 0.1, logPrefix: `${spec.logPrefix || 'IAOwner'}-format` }
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

async function prepararSql({ spec, sql, sx2, sx3, protheus, middlewareCfg, entidades, filial }) {
  const validacaoBasica = validarSqlIaOwnerBasico(sql, spec, sx2);
  if (!validacaoBasica.ok) {
    throw Object.assign(new Error(`SQL rejeitado por contrato IA-OWNER: ${validacaoBasica.erros.join(' | ')}`), { _tipo: 'contrato_ia_owner_invalido', _sql: sql });
  }
  let out = sx3SqlValidator.normalizarReferenciasAliasSql(sql);
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
  const sx3Validacao = sx3SqlValidator.validarCamposSqlContraSX3(out, sx3);
  if (!sx3Validacao.ok) throw Object.assign(new Error(`SQL rejeitado por SX3: ${sx3Validacao.erros.join(' | ')}`), { _tipo: 'contrato_sx3_invalido', _sql: out });
  if (spec.sanitizarFiltrosFilialSX2 !== false) {
    out = sx2SqlNormalizer.sanitizarFiltrosFilialSX2(out, sx2, { filialSolicitada: filial && filial !== 'TODAS', logPrefix: spec.logPrefix });
  }
  const mw = spec.sqlMiddleware.processar(out, middlewareCfg);
  if (mw.bloqueado) throw Object.assign(new Error(mw.motivo_bloqueio || 'SQL bloqueado pelo middleware.'), { _tipo: 'sql_bloqueado' });
  return { sqlCanonico: out, sqlFinal: mw.sql_processado, parametros: params.aplicados || [] };
}

async function executar(spec, intent, empresaId) {
  const t0 = Date.now();
  const mensagem = intent._mensagemOriginal || intent.intencao || spec.defaultMessage || 'consulta';

  let keys, cfg;
  try {
    ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId));
  } catch (e) {
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- erro: ${e.message}`, duracao_ms: Date.now() - t0 };
  }
  if (!Object.values(keys || {}).some(Boolean)) {
    return { tipo: 'erro', subtipo: 'sem_chave', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: '-- Nenhuma chave de IA configurada.', duracao_ms: Date.now() - t0 };
  }

  let intentEfetivo = intent;
  let contextoTecnicoExtra = {};
  if (typeof spec.prepararIntent === 'function') {
    const prep = spec.prepararIntent({ intent, empresaId, mensagem });
    if (prep?.retorno) return { ...prep.retorno, duracao_ms: prep.retorno.duracao_ms || (Date.now() - t0) };
    if (prep?.intent) intentEfetivo = prep.intent;
    if (prep?.contextoTecnicoExtra) contextoTecnicoExtra = prep.contextoTecnicoExtra;
  }
  intentEfetivo = normalizarFiltroEmpresaComoEntidade(spec, intentEfetivo, mensagem);
  intentEfetivo = limparFiltrosEntidadeHerdadosDaConsultaAtual(spec, intentEfetivo, mensagem);

  const protheus = configProtheus(empresaId);
  const sx2 = completarSX2Permitidas(modosSX2(spec.tabelas, protheus.conexaoId, empresaId), spec.tabelas, protheus.sufixoTabela);
  const sx3 = camposSX3(spec.tabelas, protheus.conexaoId, empresaId, spec.sx3PromptLimit || 80, spec.camposSx3Essenciais || {});
  const sx3Prompt = sx3EssencialParaPrompt(spec.camposSx3Essenciais || {}) || sx3;
  const middlewareCfg = spec.sqlMiddleware.carregarConfig(empresaId);
  const filial = intentEfetivo.filtros?.filial || protheus.filialPadrao || 'TODAS';
  const historico = Array.isArray(intentEfetivo._historicoResumido) ? intentEfetivo._historicoResumido : [];
  const estadoAnterior = limparPeriodosNaoAutoritativos(buildEstadoAnterior(intentEfetivo), mensagem);
  const contextoTecnico = { ...buildContextoTecnico({ spec, empresaId, protheus, sx2, sx3Prompt, middlewareCfg, filial }), ...contextoTecnicoExtra };
  const tabelaFisica = (sx2Arg, base) => tabelaFisicaSX2(sx2Arg, base) || `${String(base || '').trim().toUpperCase()}${inferirSufixoSX2(sx2Arg, protheus.sufixoTabela)}`;
  const helpers = { connectionFactory, tabelaFisicaSX2: tabelaFisica, escapeSqlLiteral, baseTabelaSX2 };

  let entidadesResolvidas = (Array.isArray(intentEfetivo._entidadesResolvidas) ? intentEfetivo._entidadesResolvidas : [])
    .filter(entidade => !termoEhEmpresaIAHub({ texto: entidade?.nome || entidade?.texto || entidade?.descricao }, intentEfetivo));
  const diagnosticosEntidades = [];
  const termosEntidadesPrevias = await extrairTermosEntidadesAntesIa(spec, keys, cfg, mensagem, intentEfetivo, entidadesResolvidas);
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
    if (diagnostico) diagnosticosEntidades.push(diagnostico);
    entidadesResolvidas = deduplicarEntidadesResolvidas([...entidadesResolvidas, ...(resolucaoPrevia.entidades || [])]);
  }
  if (diagnosticosEntidades.length) {
    contextoTecnico.entidades_nao_resolvidas_pelo_sistema = diagnosticosEntidades;
  }
  entidadesResolvidas = deduplicarEntidadesResolvidas(entidadesResolvidas);
  let plano;
  let userPrompt = promptBuilder.buildUserPrompt({ mensagem, historico, estadoAnterior, contextoTecnico, entidadesResolvidas });
  const auditoriaBase = {
    handler: spec.handlerName || spec.nome || 'ia-owner',
    origem: 'ia_owner',
    empresa_id: empresaId,
    prompt_system: promptBuilder.buildSystemPrompt(spec),
    prompt_user: userPrompt,
    sql_ia_bruto: null,
    sql_apos_sx3: null,
    sql_apos_sx2: null,
    sql_apos_parametros: null,
    sql_apos_contrato: null,
    sql_final_executado: null,
    plano_ia_owner: null,
    resposta_ia_bruta: null,
  };

  try {
    plano = await chamarIaOwner(spec, keys, cfg, userPrompt);
    auditoriaBase.prompt_system = plano.systemPrompt || auditoriaBase.prompt_system;
    auditoriaBase.prompt_user = plano.userPrompt || userPrompt;
    auditoriaBase.sql_ia_bruto = plano.sql || null;
    auditoriaBase.plano_ia_owner = plano.obj || null;
    auditoriaBase.resposta_ia_bruta = plano.raw || null;
  } catch (e) {
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(spec, 'ia_indisponivel'), sql_gerado: `-- IA-OWNER falhou: ${limitarTexto(e.message, 1000)}`, _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
  }

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
        plano = await chamarIaOwner(spec, keys, cfg, userPrompt);
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
        plano = await chamarIaOwner(spec, keys, cfg, userPrompt);
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
      plano = await chamarIaOwner(spec, keys, cfg, userPrompt);
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

  if (!plano.sql) {
    return { tipo: 'erro', subtipo: 'sql_nao_extraido', resposta_direta: mensagemErro(spec, 'sql_invalido'), sql_gerado: JSON.stringify(plano.obj, null, 2), _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0, _ia_owner_plano: plano.obj };
  }

  let preparado;
  let sqlOriginalIa = plano.sql;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      preparado = await prepararSql({ spec, sql: plano.sql, sx2, sx3, protheus, middlewareCfg, entidades: entidadesResolvidas, filial });
      auditoriaBase.sql_apos_sx3 = sx3SqlValidator.normalizarReferenciasAliasSql(plano.sql);
      auditoriaBase.sql_apos_sx2 = preparado.sqlCanonico;
      auditoriaBase.sql_apos_parametros = preparado.sqlCanonico;
      auditoriaBase.sql_apos_contrato = preparado.sqlCanonico;
      auditoriaBase.sql_final_executado = preparado.sqlFinal;
      const conn = connectionFactory.carregarConexao(empresaId);
      conn._pergunta   = mensagem;
      conn._sender     = intent._remetente || '';
      conn._modulo     = spec.nome         || '';
      conn._operacao   = intent.intencao   || '';
      conn._empresa_id = empresaId         || '';
      const rows = await connectionFactory.executar(conn, preparado.sqlFinal, {});
      const resposta = rows && rows.length
        ? await formatarResposta(spec, mensagem, rows, keys, cfg, intent, plano.obj.periodo || null)
        : mensagemErro(spec, 'sem_resultado');
      const respostaDireta = interpolarRespostaPlanejada(plano.obj.resposta_planejada, rows) || resposta;
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
      if (tentativa >= 2) {
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
        tentativa: 'O SQL anterior falhou/rejeitado. Corrija o SQL preservando a decisao semantica da sua resposta anterior. Obrigatorio: comece com SET ROWCOUNT 50000; SELECT, use tabelas fisicas SX2 em FROM/JOIN com alias base, qualifique campos pelo alias base, remova subqueries cadastrais vazias e nao use SELECT TOP.',
        erroSql: e.message,
        sqlComErro: preparado?.sqlFinal || e._sql || plano.sql,
      });
      plano = await chamarIaOwner(spec, keys, cfg, retryPrompt, { maxTokens: spec.maxTokens || 3500 });
      auditoriaBase.prompt_user = plano.userPrompt || retryPrompt;
      auditoriaBase.sql_ia_bruto = plano.sql || auditoriaBase.sql_ia_bruto;
      auditoriaBase.plano_ia_owner = plano.obj || auditoriaBase.plano_ia_owner;
      auditoriaBase.resposta_ia_bruta = plano.raw || auditoriaBase.resposta_ia_bruta;
      if (plano.sql) sqlOriginalIa = plano.sql;
    }
  }
  // Caminho atingido se chamarIaOwner() lançou exceção dentro do catch da tentativa 1.
  return { tipo: 'erro', subtipo: 'erro_erp', resposta_direta: mensagemErro(spec, 'erro_erp'), sql_gerado: plano?.sql || '', _sql_auditoria: auditoriaBase, duracao_ms: Date.now() - t0 };
}

async function executarSqlDireto(spec, sqlCanonico, intent, empresaId) {
  const t0 = Date.now();
  const protheus = configProtheus(empresaId);
  const sx2 = completarSX2Permitidas(modosSX2(spec.tabelas, protheus.conexaoId, empresaId), spec.tabelas, protheus.sufixoTabela);
  const sx3 = camposSX3(spec.tabelas, protheus.conexaoId, empresaId, spec.sx3PromptLimit || 80, spec.camposSx3Essenciais || {});
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
    sql_apos_sx2: sqlCanonicoAdaptadoTemplate,
    sql_apos_parametros: null,
    sql_apos_contrato: null,
    sql_final_executado: null,
    plano_ia_owner: null,
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
  let preparado = null;
  try {
    preparado = await prepararSql({ spec, sql: sqlCanonico, sx2, sx3, protheus, middlewareCfg, entidades, filial: intent.filtros?.filial || 'TODAS' });
    auditoriaBase.sql_apos_sx3 = sx3SqlValidator.normalizarReferenciasAliasSql(sqlCanonico);
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
      ? await formatarResposta(spec, intent._mensagemOriginal || 'consulta', rows, keys, cfg, intent)
      : mensagemErro(spec, 'sem_resultado');
    const respostaDireta = interpolarRespostaPlanejada(template, rows) || resposta;
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
      auditoriaBase.sql_apos_sx2 = preparado.sqlCanonico;
      auditoriaBase.sql_apos_parametros = preparado.sqlCanonico;
      auditoriaBase.sql_apos_contrato = preparado.sqlCanonico;
      auditoriaBase.sql_final_executado = preparado.sqlFinal;
    }
    const sqlErro = preparado?.sqlFinal || e._sql || sqlCanonico;
    console.warn(`[${spec.logPrefix || 'IAOwner'}] executarSqlDireto falhou para empresa #${empresaId}: subtipo=${e._tipo || 'erro_erp'} | erro=${limitarTexto(e.message, 300)}`);
    const subtipo = e._tipo || 'erro_erp';
    return {
      tipo: 'erro',
      subtipo,
      resposta_direta: mensagemErro(spec, subtipoEhInconsistenciaConsulta(subtipo) ? 'sql_invalido' : 'erro_erp'),
      sql_gerado: `${sqlErro}\n\n-- ERRO: ${limitarTexto(e.message, 1000)}`,
      _sql_auditoria: auditoriaBase,
      duracao_ms: Date.now() - t0,
    };
  }
}

module.exports = {
  executar,
  executarSqlDireto,
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
    validarSelectContraGroupBy,
    sx3EssencialParaPrompt,
    completarSX2Permitidas,
    diagnosticoResolucaoEntidade,
    termoEhEmpresaIAHub,
    mensagemMencionaValorEntidade,
    mensagemDeclaraEmpresaExplicitamente,
    tipoEntidadePadraoParaFiltroEmpresa,
    normalizarFiltroEmpresaComoEntidade,
    limparFiltrosEntidadeHerdadosDaConsultaAtual,
    deduplicarTermosEntidade,
    extrairTermosEntidadesAntesIa,
  },
};
