'use strict';

// Resolucao de filial/empresa organizacional como dimensao do pipeline de
// intencao/contexto, para conexoes Protheus no modelo LOBO_GUARA — ver
// docs/lobo-guara-consenso-arquitetura.md, secao "Filial Como Dimensao Do
// Pipeline". Este modulo so extrai/resolve; nunca gera ou toca SQL — quem
// consome o estado estruturado que ele produz e o lobo-guara-normalizer.
//
// Contrato de saida (igual ao documentado):
// { modo: 'todas'|'empresa'|'especifica'|'agrupamento'|'ambigua',
//   texto, chaves: [...], nomes: [...], origem: 'mensagem_atual'|'contexto_herdado'|'padrao' }
//
// Falha fechada: se a empresa nao estiver em LOBO_GUARA com perfil validado,
// retorna null — o chamador nao deve aplicar nenhum filtro nesse caso (o
// caminho TRADICIONAL/nao-validado segue sem esta dimensao, como hoje).

function _clonar(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function _normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

// Empresa esta configurada como LOBO_GUARA? (mesma leitura usada pelas rotas
// de dicionario — ver sys-company-routes.js::_modeloDadosEmpresa)
function _modeloDadosEmpresa(db, empresaId) {
  try {
    const row = db.prepare(
      "SELECT config FROM erp_config WHERE empresa_id = ? AND erp = 'protheus' AND connection_id IS NULL ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1"
    ).get(empresaId);
    const cfg = row?.config ? JSON.parse(row.config) : {};
    return cfg;
  } catch (_) {
    return {};
  }
}

// Resolve a connection_id real da empresa, tratando o caso de conexao via
// Agente Local (mesmo cuidado ja aplicado em middleware-routes.js apos o bug
// de "Invalid URL" — carregarConexao pode retornar objeto sem `id`, o real
// fica em `_connection_id`).
function _resolverConnectionId(empresaId) {
  const connectionFactory = require('../../providers/connection-factory');
  try {
    const conn = connectionFactory.carregarConexao(empresaId, { sistemaOrigem: 'protheus' });
    return conn.id || conn._connection_id || null;
  } catch (_) {
    return null;
  }
}

// Contexto pronto para resolver filial nesta empresa: modelo LOBO_GUARA +
// perfil validado. Falha fechada — qualquer coisa fora disso retorna null.
function contextoLoboGuara(db, empresaId) {
  const cfg = _modeloDadosEmpresa(db, empresaId);
  if (cfg.modelo_dados !== 'LOBO_GUARA') return null;

  const connectionId = _resolverConnectionId(empresaId);
  if (!connectionId) return null;

  const perfil = db.prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(connectionId);
  if (!perfil || !perfil.validated) return null;

  return { connectionId, empresaCodigoPadrao: String(cfg.empresa_codigo || '').trim() || null };
}

// Carrega a arvore (so nos de filial e empresa, ativos) de uma conexao.
function _carregarArvore(db, connectionId) {
  return db.prepare(`
    SELECT grupo_codigo, empresa_codigo, unidade_codigo, filial_codigo, filial_chave, tipo_no, nome
      FROM protheus_company_tree
     WHERE connection_id = ? AND ativo = 1 AND tipo_no IN ('empresa', 'filial')
  `).all(connectionId);
}

function _escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match por PALAVRA COMPLETA (fronteira \b), nunca substring pura — sem isso,
// nomes curtos de empresa/filial (ex.: "EMA") disparam falso positivo dentro
// de qualquer palavra maior que os contenha (ex.: "semana" contém "ema").
// Bug real encontrado em producao: "Faturamento da semana..." foi resolvido
// como menção à empresa EMA.
function _contemPalavra(mensagemNorm, termoNorm) {
  if (!termoNorm) return false;
  const re = new RegExp(`\\b${_escaparRegex(termoNorm)}\\b`, 'i');
  return re.test(mensagemNorm);
}

// Extrai candidatos de menção textual de filial/empresa contra a árvore —
// fuzzy simples por presença de PALAVRA COMPLETA (\b), suficiente para nomes
// próprios curtos (cidades, nomes de empresa, siglas de 3 letras como "EMA").
// A fronteira de palavra já evita o falso positivo real observado ("semana"
// não bate mais com "ema", porque \b exige que "ema" não esteja colada a
// outra letra) sem precisar de um limite mínimo de tamanho — um limite de
// tamanho quebraria siglas curtas legítimas (ex.: "EMA" tem 3 caracteres).
function _candidatosNaArvore(mensagemNorm, arvore) {
  const candidatos = [];
  for (const no of arvore) {
    const nomeNorm = _normalizar(no.nome);
    if (nomeNorm && _contemPalavra(mensagemNorm, nomeNorm)) {
      candidatos.push(no);
      continue;
    }
    // Nome com mais de uma palavra: aceita match pela primeira palavra
    // significativa (ex.: "PLANTIVO CAMPO VERDE" -> menciona "campo verde").
    const partes = nomeNorm.split(/\s+/).filter(p => p.length >= 4);
    if (partes.length > 1) {
      const rest = partes.slice(1).join(' ');
      if (rest && _contemPalavra(mensagemNorm, rest)) candidatos.push(no);
    }
  }
  return candidatos;
}

// Resolve a menção de filial/empresa a partir do texto da mensagem atual.
// Retorna o contrato estruturado, ou null se não há menção nenhuma (o
// chamador decide o modo 'todas'/padrão nesse caso).
function resolverDaMensagem(db, empresaId, mensagem) {
  const ctx = contextoLoboGuara(db, empresaId);
  if (!ctx) return null;

  const mensagemNorm = _normalizar(mensagem);
  if (!mensagemNorm) return null;

  const arvore = _carregarArvore(db, ctx.connectionId);
  if (!arvore.length) return null;

  const candidatos = _candidatosNaArvore(mensagemNorm, arvore);
  if (!candidatos.length) return null;

  const empresas = candidatos.filter(c => c.tipo_no === 'empresa');
  const filiais = candidatos.filter(c => c.tipo_no === 'filial');

  // Menção a uma empresa inteira (ex.: "vendas da Plantivo") -> modo 'empresa',
  // expande para todas as filiais dela (feito pelo normalizer, não aqui).
  if (empresas.length === 1 && !filiais.length) {
    return {
      modo: 'empresa',
      texto: mensagem,
      chaves: [empresas[0].empresa_codigo],
      nomes: [empresas[0].nome],
      origem: 'mensagem_atual',
    };
  }

  // Menção a uma filial específica.
  if (filiais.length === 1) {
    return {
      modo: 'especifica',
      texto: mensagem,
      chaves: [filiais[0].filial_chave],
      nomes: [filiais[0].nome],
      origem: 'mensagem_atual',
    };
  }

  // Múltiplas filiais/empresas mencionadas, ou combinação ambígua de tipos —
  // pelo UX acordado (docs, seção "UX de Filial"): perguntar, oferecendo
  // opção "Todas", nunca assumir automaticamente qual o usuário quis.
  const todosNomes = [...new Set(candidatos.map(c => c.nome).filter(Boolean))];
  return {
    modo: 'ambigua',
    texto: mensagem,
    chaves: candidatos.map(c => c.filial_chave || c.empresa_codigo).filter(Boolean),
    nomes: todosNomes,
    origem: 'mensagem_atual',
  };
}

// Expande um estado 'empresa' (chaves = [empresa_codigo]) para a lista real
// de filial_chave daquela empresa, usada pelo normalizer ao montar IN (...).
function expandirFiliaisDaEmpresa(db, connectionId, empresaCodigo) {
  const rows = db.prepare(`
    SELECT filial_chave FROM protheus_company_tree
     WHERE connection_id = ? AND ativo = 1 AND tipo_no = 'filial' AND empresa_codigo = ?
  `).all(connectionId, empresaCodigo);
  return rows.map(r => r.filial_chave).filter(Boolean);
}

module.exports = {
  contextoLoboGuara,
  resolverDaMensagem,
  expandirFiliaisDaEmpresa,
  _normalizar,
  _clonar,
  _contemPalavra,
  _candidatosNaArvore,
};
