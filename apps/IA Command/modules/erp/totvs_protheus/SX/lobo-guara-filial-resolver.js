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

// Le empresa_codigo (usado so como default de exibicao) do erp_config —
// nao decide mais se o filtro liga (ver contextoLoboGuara).
function _empresaCodigoPadrao(db, empresaId) {
  try {
    const row = db.prepare(
      "SELECT config FROM erp_config WHERE empresa_id = ? AND erp = 'protheus' AND connection_id IS NULL ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1"
    ).get(empresaId);
    const cfg = row?.config ? JSON.parse(row.config) : {};
    return String(cfg.empresa_codigo || '').trim() || null;
  } catch (_) {
    return null;
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

// Contexto pronto para resolver filial nesta empresa: existe arvore curada e
// confirmada (protheus_company_profile.validated=1), com pelo menos um no
// cadastrado — independente do rotulo TRADICIONAL/LOBO_GUARA em modelo_dados
// (esse campo deixou de ser o gate; ele so descrevia se a empresa faz parte
// de um grupo com varias empresas juridicas, nao se tem controle de filial).
// Falha fechada — qualquer coisa fora disso retorna null, e o chamador nao
// aplica filtro nenhum (comportamento igual ao de hoje para quem nao tem
// arvore validada).
function contextoLoboGuara(db, empresaId) {
  const connectionId = _resolverConnectionId(empresaId);
  if (!connectionId) return null;

  const perfil = db.prepare('SELECT * FROM protheus_company_profile WHERE connection_id = ?').get(connectionId);
  if (!perfil || !perfil.validated) return null;

  const temArvore = db.prepare(
    "SELECT 1 FROM protheus_company_tree WHERE connection_id = ? AND ativo = 1 AND tipo_no IN ('empresa','filial') LIMIT 1"
  ).get(connectionId);
  if (!temArvore) return null;

  return { connectionId, empresaCodigoPadrao: _empresaCodigoPadrao(db, empresaId) };
}

// Carrega a arvore (so nos de filial e empresa, ativos) de uma conexao.
// So inclui empresas Protheus com vinculo explicito a uma empresa cliente do
// IAHub (empresa_iahub_vinculo_id, ver migration v91) — empresa Protheus que
// existe no grupo Lobo Guara mas nunca foi vinculada a um cadastro proprio no
// IAHub (ex.: sem canal WhatsApp/config dedicada) fica automaticamente fora
// da selecao, sem exigir uma acao manual de "bloquear" por empresa nova.
function _carregarArvore(db, connectionId) {
  const codigosVinculados = new Set(
    db.prepare(`
      SELECT DISTINCT empresa_codigo FROM protheus_company_tree
       WHERE connection_id = ? AND ativo = 1 AND tipo_no = 'empresa' AND empresa_iahub_vinculo_id IS NOT NULL
    `).all(connectionId).map(r => r.empresa_codigo)
  );
  const nos = db.prepare(`
    SELECT grupo_codigo, empresa_codigo, unidade_codigo, filial_codigo, filial_chave, tipo_no, nome
      FROM protheus_company_tree
     WHERE connection_id = ? AND ativo = 1 AND tipo_no IN ('empresa', 'filial')
  `).all(connectionId);
  return nos.filter(no => codigosVinculados.has(no.empresa_codigo));
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

// Arvore agrupada (empresa -> filiais) para a UI de selecao do chat embutido
// (arvore com checkboxes, IA Command). Reaproveita _carregarArvore (mesma
// query usada pela resolucao textual) — mesma fonte de verdade, sem duplicar
// leitura da protheus_company_tree.
function arvoreAgrupadaParaSelecao(db, connectionId) {
  const nos = _carregarArvore(db, connectionId);
  const empresasPorCodigo = new Map();
  for (const no of nos) {
    if (no.tipo_no !== 'empresa') continue;
    empresasPorCodigo.set(no.empresa_codigo, {
      empresaProtheusCodigo: no.empresa_codigo,
      nome: no.nome,
      filiais: [],
    });
  }
  for (const no of nos) {
    if (no.tipo_no !== 'filial') continue;
    const empresa = empresasPorCodigo.get(no.empresa_codigo);
    if (!empresa) continue; // filial orfa (sem no de empresa ativo) — nao exibida
    empresa.filiais.push({ filialChave: no.filial_chave, nome: no.nome });
  }
  return [...empresasPorCodigo.values()];
}

// Caso real confirmado com dado de producao (Plantivo/SA1, ver
// docs/lobo-guara-consenso-arquitetura.md): uma tabela pode ser EXCLUSIVA por
// empresa (X2_MODOEMP=E) mesmo sendo compartilhada entre filiais (X2_MODO=C).
//
// Quando isso ocorre, o campo de filial gravado nessa tabela NAO tem o mesmo
// tamanho/formato de filial_chave (M0_CODFIL, mascara completa do M0_LEIAUTE
// do grupo — ex.: 6 digitos 'EEUUFF'). Confirmado com dado real da Plantivo:
// M0_LEIAUTE='EEUUFF', F2_FILIAL (exclusiva) tem 6 digitos e bate com
// filial_chave ('010101'), mas A1_FILIAL (exclusiva so por empresa) tem
// APENAS 2 digitos ('01') — o Protheus grava so o segmento de empresa (EE) da
// mascara quando os demais niveis sao compartilhados, entao o valor real
// nunca bate com filial_chave completa.
//
// Por isso o filtro correto para essas tabelas usa `empresa_codigo` (2
// digitos, ja confiavel e gravado na arvore) — nunca filial_chave completa,
// e nunca decompor via SUBSTRING/mascara (variavel por instalacao, fragil).
// Recebe a lista de filial_chave ja resolvida para o SQL (de qualquer modo:
// especifica/empresa) e devolve os codigos de empresa donas (nao filiais).
function empresasDonasDasFiliais(db, connectionId, filiaisChave) {
  const chaves = [...new Set((filiaisChave || []).filter(Boolean))];
  if (!chaves.length) return [];

  const placeholders = chaves.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT DISTINCT empresa_codigo FROM protheus_company_tree
     WHERE connection_id = ? AND ativo = 1 AND tipo_no = 'filial' AND filial_chave IN (${placeholders})
  `).all(connectionId, ...chaves);

  return rows.map(r => r.empresa_codigo).filter(Boolean);
}

module.exports = {
  contextoLoboGuara,
  resolverDaMensagem,
  expandirFiliaisDaEmpresa,
  empresasDonasDasFiliais,
  arvoreAgrupadaParaSelecao,
  _normalizar,
  _clonar,
  _contemPalavra,
  _candidatosNaArvore,
};
