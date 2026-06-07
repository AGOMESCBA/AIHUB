'use strict';

const { getDB } = require('../../database');

const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

// Tabelas relevantes por módulo (aliases Protheus sem sufixo)
const TABELAS_POR_MODULO = {
  financeiro: ['SE1', 'SE2', 'SE5', 'SE8', 'SA1', 'SA2', 'SA3', 'SA6', 'SED', 'FK1', 'FK2', 'FK5', 'FK6', 'FK7'],
  compras:    ['SF1', 'SD1', 'SC7', 'SA2', 'SB1', 'SBM', 'CTT', 'SED', 'SF4'],
  faturamento:['SF2', 'SD2', 'SA1', 'SA3', 'SB1', 'SBM', 'SF4', 'CTT'],
  comissao:   ['SE3', 'SA3', 'SA1', 'SE2'],
};

// Descrição de negócio resumida de cada tabela Protheus
const DESCRICAO_TABELA = {
  SE1: 'Contas a Receber — títulos/duplicatas a receber de clientes',
  SE2: 'Contas a Pagar — títulos/duplicatas a pagar a fornecedores',
  SE3: 'Comissões de vendedores',
  SE5: 'Movimentos bancários / caixa (baixas e lançamentos)',
  SE8: 'Cheques emitidos/recebidos',
  SF1: 'Cabeçalho de Notas Fiscais de Entrada (compras)',
  SF2: 'Cabeçalho de Notas Fiscais de Saída (vendas/faturamento)',
  SD1: 'Itens de Notas Fiscais de Entrada',
  SD2: 'Itens de Notas Fiscais de Saída',
  SC7: 'Pedidos / Ordens de Compra',
  SA1: 'Cadastro de Clientes (compartilhada)',
  SA2: 'Cadastro de Fornecedores (compartilhada)',
  SA3: 'Cadastro de Vendedores (compartilhada)',
  SA6: 'Cadastro de Bancos (compartilhada)',
  SB1: 'Cadastro de Produtos (compartilhada)',
  SBM: 'Grupos de Produtos (compartilhada)',
  SED: 'Naturezas financeiras (compartilhada)',
  SF4: 'Tipos de Entrada e Saída — TES (compartilhada)',
  CTT: 'Centros de Custo (compartilhada)',
  FK1: 'Movimentos de baixa financeira — CAP',
  FK2: 'Movimentos de baixa financeira — CAR',
  FK5: 'Rateios financeiros',
  FK6: 'Rateios de NF',
  FK7: 'Borderos de pagamento',
};

function _baseSX2(nome) {
  return String(nome || '').trim().toUpperCase().replace(/\d{3}$/, '');
}

function _carregarConexaoProtheus(empresaId) {
  try {
    const db = getDB();
    let row = db.prepare(
      "SELECT id, configuracoes FROM connections WHERE empresa_id = ? AND ativo = 1 ORDER BY padrao DESC LIMIT 1"
    ).get(empresaId);
    if (!row) {
      const sx2Row = db.prepare("SELECT connection_id FROM protheus_sx2 WHERE empresa_id = ? LIMIT 1").get(empresaId);
      if (sx2Row?.connection_id) {
        row = db.prepare("SELECT id, configuracoes FROM connections WHERE id = ? AND ativo = 1").get(sx2Row.connection_id);
      }
    }
    const cfg = row?.configuracoes ? JSON.parse(row.configuracoes || '{}') : {};
    return {
      conexaoId:    row?.id || null,
      sufixo:       cfg.sufixo_tabela || '010',
      filialPadrao: cfg.filial_padrao || '',
    };
  } catch (_) {
    return { conexaoId: null, sufixo: '010', filialPadrao: '' };
  }
}

function _carregarSX2(conexaoId, empresaId, tabelasBase) {
  if (!conexaoId) return {};
  try {
    const baseSet = new Set(tabelasBase.map(_baseSX2));
    const rows = getDB().prepare(
      'SELECT chave, arquivo, modo FROM protheus_sx2 WHERE connection_id = ? AND empresa_id = ?'
    ).all(conexaoId, empresaId);
    const mapa = {};
    for (const r of rows) {
      const arquivo = String(r.arquivo || r.chave || '').trim();
      if (arquivo && baseSet.has(_baseSX2(arquivo))) mapa[_baseSX2(arquivo)] = { arquivo, modo: r.modo };
    }
    return mapa;
  } catch (_) { return {}; }
}

function _carregarSX3(conexaoId, empresaId, tabelasBase) {
  if (!conexaoId) return {};
  try {
    // Filtramos por base name em JS porque o banco armazena nomes físicos (ex: SF2990)
    // e a query SQL com IN ('SF2', ...) não encontraria esses registros.
    const baseSet = new Set(tabelasBase.map(_baseSX2));
    const rows = getDB().prepare(`
      SELECT tabela, campo, tipo, tamanho, titulo, descricao
      FROM protheus_sx3
      WHERE connection_id = ? AND empresa_id = ?
      ORDER BY tabela, ordem, campo
    `).all(conexaoId, empresaId);
    const mapa = {};
    for (const r of rows) {
      const base = _baseSX2(r.tabela);
      if (!baseSet.has(base)) continue;
      if (!mapa[base]) mapa[base] = [];
      mapa[base].push({
        campo: r.campo,
        tipo: r.tipo,
        tamanho: r.tamanho,
        titulo: r.titulo || r.descricao || '',
      });
    }
    return mapa;
  } catch (_) { return {}; }
}

const PRIORIDADE_ENTIDADE_POR_MODULO = {
  faturamento: 'faturamento → cliente primeiro, depois produto → grupo_produto → vendedor',
  compras:     'compras → fornecedor primeiro, depois produto → grupo_produto',
  financeiro:  'financeiro → fornecedor primeiro (contas a pagar) ou cliente primeiro (contas a receber)',
  comissao:    'comissão → vendedor primeiro, depois cliente',
};

function _prioridadeEntidade(modulos = []) {
  const linhas = modulos.filter(m => PRIORIDADE_ENTIDADE_POR_MODULO[m]).map(m => `  ${PRIORIDADE_ENTIDADE_POR_MODULO[m]}`);
  return linhas.length ? linhas.join('\n') : '  cliente → fornecedor → produto → vendedor → grupo_produto → centro_custo';
}

function _modoCompartilhamento(modo) {
  const m = String(modo || 'E').toUpperCase();
  if (m === 'C') return 'compartilhada — JOIN sem filtro de filial';
  if (m === 'X') return 'exclusiva por empresa — JOIN filtrando empresa, sem filial';
  return 'exclusiva — JOIN filtrando empresa e filial';
}

// Campos mínimos garantidos por tabela quando o SX3 não está cadastrado.
// Evita que a IA invente campos inexistentes (ex: F2_NUM, F2_VENCTO, F2_BASEICM).
// REGRA: só adicionar campos que existem em TODOS os ambientes Protheus padrão.
const CAMPOS_FALLBACK = {
  SF2: [
    { campo: 'F2_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'F2_DOC',     tipo: 'C', titulo: 'Número da NF (use F2_DOC, não F2_NUM)' },
    { campo: 'F2_SERIE',   tipo: 'C', titulo: 'Série' },
    { campo: 'F2_CLIENTE', tipo: 'C', titulo: 'Código do cliente' },
    { campo: 'F2_LOJA',    tipo: 'C', titulo: 'Loja do cliente' },
    { campo: 'F2_EMISSAO', tipo: 'D', titulo: 'Data de emissão (YYYYMMDD) — use F2_EMISSAO, não F2_VENCTO' },
    { campo: 'F2_VALBRUT', tipo: 'N', titulo: 'Valor bruto da NF' },
    { campo: 'F2_VALMERC', tipo: 'N', titulo: 'Valor das mercadorias' },
    { campo: 'F2_VALFAT',  tipo: 'N', titulo: 'Valor de faturamento' },
    { campo: 'F2_VEND1',   tipo: 'C', titulo: 'Código do vendedor' },
    { campo: 'F2_TPNF',    tipo: 'C', titulo: 'Tipo da NF (S=saída)' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica (filtrar = espaço)' },
  ],
  SD2: [
    { campo: 'D2_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'D2_DOC',     tipo: 'C', titulo: 'Número da NF' },
    { campo: 'D2_SERIE',   tipo: 'C', titulo: 'Série' },
    { campo: 'D2_CLIENTE', tipo: 'C', titulo: 'Código do cliente' },
    { campo: 'D2_LOJA',    tipo: 'C', titulo: 'Loja do cliente' },
    { campo: 'D2_COD',     tipo: 'C', titulo: 'Código do produto' },
    { campo: 'D2_QUANT',   tipo: 'N', titulo: 'Quantidade' },
    { campo: 'D2_TOTAL',   tipo: 'N', titulo: 'Valor total do item' },
    { campo: 'D2_VALBRUT', tipo: 'N', titulo: 'Valor bruto do item' },
    { campo: 'D2_PRCVEN',  tipo: 'N', titulo: 'Preço de venda' },
    { campo: 'D2_TES',     tipo: 'C', titulo: 'TES (tipo de entrada/saída)' },
    { campo: 'D2_CF',      tipo: 'C', titulo: 'CFOP' },
    { campo: 'D2_CCUSTO',  tipo: 'C', titulo: 'Centro de custo' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SE1: [
    { campo: 'E1_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'E1_NUM',     tipo: 'C', titulo: 'Número do título' },
    { campo: 'E1_CLIENTE', tipo: 'C', titulo: 'Código do cliente' },
    { campo: 'E1_LOJA',    tipo: 'C', titulo: 'Loja do cliente' },
    { campo: 'E1_VALOR',   tipo: 'N', titulo: 'Valor do título' },
    { campo: 'E1_SALDO',   tipo: 'N', titulo: 'Saldo a receber' },
    { campo: 'E1_VENCTO',  tipo: 'D', titulo: 'Data de vencimento (YYYYMMDD)' },
    { campo: 'E1_EMISSAO', tipo: 'D', titulo: 'Data de emissão (YYYYMMDD)' },
    { campo: 'E1_TIPO',    tipo: 'C', titulo: 'Tipo do título' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SE2: [
    { campo: 'E2_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'E2_NUM',     tipo: 'C', titulo: 'Número do título' },
    { campo: 'E2_FORNECE', tipo: 'C', titulo: 'Código do fornecedor' },
    { campo: 'E2_LOJA',    tipo: 'C', titulo: 'Loja do fornecedor' },
    { campo: 'E2_VALOR',   tipo: 'N', titulo: 'Valor do título' },
    { campo: 'E2_SALDO',   tipo: 'N', titulo: 'Saldo a pagar' },
    { campo: 'E2_VENCTO',  tipo: 'D', titulo: 'Data de vencimento (YYYYMMDD)' },
    { campo: 'E2_EMISSAO', tipo: 'D', titulo: 'Data de emissão (YYYYMMDD)' },
    { campo: 'E2_TIPO',    tipo: 'C', titulo: 'Tipo do título' },
    { campo: 'E2_NATUREZ', tipo: 'C', titulo: 'Natureza financeira' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SE3: [
    { campo: 'E3_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'E3_VEND1',   tipo: 'C', titulo: 'Código do vendedor' },
    { campo: 'E3_COMIS1',  tipo: 'N', titulo: 'Valor da comissão' },
    { campo: 'E3_VALOR',   tipo: 'N', titulo: 'Valor base da comissão' },
    { campo: 'E3_EMISSAO', tipo: 'D', titulo: 'Data de emissão (YYYYMMDD)' },
    { campo: 'E3_NUM',     tipo: 'C', titulo: 'Número do título associado' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SF1: [
    { campo: 'F1_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'F1_DOC',     tipo: 'C', titulo: 'Número da NF de entrada' },
    { campo: 'F1_SERIE',   tipo: 'C', titulo: 'Série' },
    { campo: 'F1_FORNECE', tipo: 'C', titulo: 'Código do fornecedor' },
    { campo: 'F1_LOJA',    tipo: 'C', titulo: 'Loja do fornecedor' },
    { campo: 'F1_EMISSAO', tipo: 'D', titulo: 'Data de emissão (YYYYMMDD)' },
    { campo: 'F1_VALBRUT', tipo: 'N', titulo: 'Valor bruto' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SD1: [
    { campo: 'D1_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'D1_DOC',     tipo: 'C', titulo: 'Número da NF' },
    { campo: 'D1_SERIE',   tipo: 'C', titulo: 'Série' },
    { campo: 'D1_FORNECE', tipo: 'C', titulo: 'Código do fornecedor' },
    { campo: 'D1_LOJA',    tipo: 'C', titulo: 'Loja do fornecedor' },
    { campo: 'D1_COD',     tipo: 'C', titulo: 'Código do produto' },
    { campo: 'D1_QUANT',   tipo: 'N', titulo: 'Quantidade' },
    { campo: 'D1_TOTAL',   tipo: 'N', titulo: 'Valor total' },
    { campo: 'D1_VALONE',  tipo: 'N', titulo: 'Valor unitário' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SC7: [
    { campo: 'C7_FILIAL',  tipo: 'C', titulo: 'Filial' },
    { campo: 'C7_NUM',     tipo: 'C', titulo: 'Número do pedido' },
    { campo: 'C7_PRODUTO', tipo: 'C', titulo: 'Código do produto' },
    { campo: 'C7_FORNECE', tipo: 'C', titulo: 'Código do fornecedor' },
    { campo: 'C7_EMISSAO', tipo: 'D', titulo: 'Data de emissão (YYYYMMDD)' },
    { campo: 'C7_QUANT',   tipo: 'N', titulo: 'Quantidade solicitada' },
    { campo: 'C7_PRECO',   tipo: 'N', titulo: 'Preço unitário' },
    { campo: 'C7_TOTAL',   tipo: 'N', titulo: 'Valor total' },
    { campo: 'D_E_L_E_T_', tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SA1: [
    { campo: 'A1_COD',    tipo: 'C', titulo: 'Código do cliente' },
    { campo: 'A1_LOJA',   tipo: 'C', titulo: 'Loja' },
    { campo: 'A1_NOME',   tipo: 'C', titulo: 'Razão social (use apenas no SELECT, nunca no WHERE)' },
    { campo: 'A1_NREDUZ', tipo: 'C', titulo: 'Nome reduzido' },
    { campo: 'A1_CGC',    tipo: 'C', titulo: 'CNPJ/CPF' },
    { campo: 'A1_MUN',    tipo: 'C', titulo: 'Município' },
    { campo: 'A1_EST',    tipo: 'C', titulo: 'Estado (UF)' },
    { campo: 'D_E_L_E_T_',tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SA2: [
    { campo: 'A2_COD',    tipo: 'C', titulo: 'Código do fornecedor' },
    { campo: 'A2_LOJA',   tipo: 'C', titulo: 'Loja' },
    { campo: 'A2_NOME',   tipo: 'C', titulo: 'Razão social (use apenas no SELECT, nunca no WHERE)' },
    { campo: 'A2_NREDUZ', tipo: 'C', titulo: 'Nome reduzido' },
    { campo: 'A2_CGC',    tipo: 'C', titulo: 'CNPJ/CPF' },
    { campo: 'D_E_L_E_T_',tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SA3: [
    { campo: 'A3_COD',    tipo: 'C', titulo: 'Código do vendedor' },
    { campo: 'A3_NOME',   tipo: 'C', titulo: 'Nome do vendedor (use apenas no SELECT, nunca no WHERE)' },
    { campo: 'D_E_L_E_T_',tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SB1: [
    { campo: 'B1_COD',    tipo: 'C', titulo: 'Código do produto' },
    { campo: 'B1_DESC',   tipo: 'C', titulo: 'Descrição (use apenas no SELECT, nunca no WHERE)' },
    { campo: 'B1_GRUPO',  tipo: 'C', titulo: 'Grupo de produto' },
    { campo: 'B1_UM',     tipo: 'C', titulo: 'Unidade de medida' },
    { campo: 'D_E_L_E_T_',tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
  SBM: [
    { campo: 'BM_GRUPO',  tipo: 'C', titulo: 'Código do grupo' },
    { campo: 'BM_DESC',   tipo: 'C', titulo: 'Descrição do grupo (apenas SELECT, não WHERE)' },
    { campo: 'D_E_L_E_T_',tipo: 'C', titulo: 'Flag de exclusão lógica' },
  ],
};

function _secaoTabela(base, sx2Info, sx3Campos) {
  const info = sx2Info[base] || {};
  const modo = info.modo || (
    ['SA1','SA2','SA3','SA6','SB1','SBM','SED','SF4','CTT'].includes(base) ? 'C' : 'E'
  );
  const descricao = DESCRICAO_TABELA[base] || base;
  const linhas = [
    `#### ${base}`,
    `- Negócio: ${descricao}`,
    `- Compartilhamento: ${_modoCompartilhamento(modo)}`,
  ];
  // Usa SX3 quando disponível; cai no fallback estático se vazio.
  const campos = (sx3Campos[base]?.length ? sx3Campos[base] : (CAMPOS_FALLBACK[base] || [])).slice(0, 20);
  if (campos.length) {
    const camposStr = campos
      .map(c => `  - ${c.campo} (${c.tipo || '?'}${c.tamanho ? `/${c.tamanho}` : ''}): ${c.titulo}`)
      .join('\n');
    linhas.push('- Campos principais:\n' + camposStr);
  }
  return linhas.join('\n');
}

/**
 * Constrói o system prompt para o chat SQL.
 * Resultado é cacheado por 10 minutos por (empresaId + módulos).
 *
 * @param {number} empresaId
 * @param {object} opts
 * @param {string[]|null} opts.modulos - Módulos ativos (null = todos)
 * @returns {string} System prompt completo
 */
function construir(empresaId, opts = {}) {
  const modulos = opts.modulos || Object.keys(TABELAS_POR_MODULO);
  const cacheKey = `${empresaId}:${modulos.sort().join(',')}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiraEm > Date.now()) return cached.prompt;

  const conn = _carregarConexaoProtheus(empresaId);
  const tabelasAlvo = [...new Set(modulos.flatMap(m => TABELAS_POR_MODULO[m] || []))];
  const sx2 = _carregarSX2(conn.conexaoId, empresaId, tabelasAlvo);
  const sx3 = _carregarSX3(conn.conexaoId, empresaId, tabelasAlvo);

  const filialRef = conn.filialPadrao
    ? `'${conn.filialPadrao}'`
    : `'<FILIAL>'  -- substitua pelo código real da filial`;

  const secoesTabelas = tabelasAlvo.map(b => _secaoTabela(b, sx2, sx3)).join('\n\n');

  const descModulos = {
    financeiro:  'SE2 (contas a pagar), SE1 (contas a receber), SE5 (mov. bancários/caixa)',
    compras:     'SF1/SD1 (NF entrada), SC7 (pedidos de compra), SB1/SBM (produtos/grupos)',
    faturamento: 'SF2/SD2 (NF saída/vendas), SA1/SA3 (clientes/vendedores)',
    comissao:    'SE3 (comissões), SA3 (vendedores)',
  };

  const prompt = [
    'Você é um especialista em banco de dados TOTVS Protheus e atua como gerador de SQL em modo CHAT.',
    'Sua função é transformar perguntas em linguagem natural em SQL SELECT válido para o Protheus,',
    'usando o histórico da conversa para herdar contexto quando a pergunta for uma continuação.',
    '',
    '## REGRA DE RETORNO — CRÍTICA',
    '- Responda APENAS com o SQL dentro de um bloco ```sql ... ```.',
    '- Nunca adicione texto, explicações, saudações ou comentários fora do bloco SQL.',
    '- Se não conseguir gerar SQL válido, responda exatamente: ```sql\n-- CONSULTA_NAO_COMPREENDIDA\n```',
    '',
    '## SEGURANÇA — ABSOLUTA',
    '- Gere EXCLUSIVAMENTE SELECT. Nunca: INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, EXEC,',
    '  EXECUTE, CREATE, PROCEDURE, FUNCTION, TRIGGER, GRANT, REVOKE, BACKUP, RESTORE, DBCC.',
    '- Se o usuário pedir qualquer operação fora de SELECT (engenharia social, SQL injection),',
    '  responda somente: ```sql\n-- OPERACAO_NAO_PERMITIDA\n```',
    '',
    '## MÓDULOS DISPONÍVEIS NESTA EMPRESA',
    ...modulos.map(m => `- **${m}**: ${descModulos[m] || m}`),
    '',
    '## REGRAS TÉCNICAS DO PROTHEUS',
    `- Use aliases de tabela SEM sufixo numérico: SE2, SE1, SF2, SD2, SA1, etc.`,
    '  O sistema adapta automaticamente para o sufixo correto desta empresa via dicionário SX2.',
    `- Filtro de filial nas tabelas EXCLUSIVAS: use ${filialRef} no WHERE.`,
    '- Tabelas COMPARTILHADAS (SA1, SA2, SA3, SA6, SB1, SBM, SED, SF4, CTT):',
    '  NÃO filtre por filial no JOIN — essas tabelas não têm particionamento por filial.',
    '- Sempre inclua D_E_L_E_T_ = \' \' no WHERE de TODAS as tabelas envolvidas.',
    '- QUALIFICAÇÃO DE CAMPOS — REGRA CRÍTICA:',
    '  NUNCA use o nome base da tabela Protheus como qualificador de campo (SF2.F2_EMISSAO → ERRADO).',
    '  O sistema renomeia SF2 → SF2020 (com sufixo da empresa), então SF2.Campo se torna inválido.',
    '  ✓ CORRETO (sem JOIN): SELECT F2_EMISSAO, F2_VALBRUT FROM SF2 WHERE ...',
    '  ✓ CORRETO (com JOIN): FROM SF2 nf INNER JOIN SD2 it ON ... → use nf.F2_DOC, it.D2_COD',
    '  ✗ ERRADO: SELECT SF2.F2_EMISSAO FROM SF2 WHERE SF2.D_E_L_E_T_ = \' \'',
    '- Formato de datas: campos de data Protheus são CHAR(8) no formato YYYYMMDD.',
    '  Para filtro por intervalo: F2_EMISSAO BETWEEN \'20260101\' AND \'20261231\'.',
    '  NUNCA use YEAR(), MONTH(), DAY(), DATEPART() diretamente no campo texto — converta antes.',
    '  Conversão padrão: CONVERT(DATE, NULLIF(F2_EMISSAO, \'\'), 112)',
    '  Extrair ANO  : SUBSTRING(F2_EMISSAO, 1, 4)  →  ex: \'2026\'',
    '  Extrair MES  : SUBSTRING(F2_EMISSAO, 5, 2)  ->  ex: \'01\' (MM)',
    '  Extrair ANO/MES: SUBSTRING(F2_EMISSAO, 1, 6)  ->  ex: \'202601\' (AAAAMM)',
    '  GROUP BY ano : GROUP BY SUBSTRING(F2_EMISSAO, 1, 4)',
    '  GROUP BY mes separado: GROUP BY SUBSTRING(F2_EMISSAO, 5, 2)',
    '  GROUP BY ano_mes      : GROUP BY SUBSTRING(F2_EMISSAO, 1, 6)',
    '  SELECT legível: SUBSTRING(F2_EMISSAO, 1, 4) AS ano',
    '                  SUBSTRING(F2_EMISSAO, 5, 2) AS mes',
    '                  SUBSTRING(F2_EMISSAO, 1, 6) AS ano_mes',
    '  Para MES separado: SUBSTRING(F2_EMISSAO, 5, 2) AS mes.',
    '  CORRECAO CRITICA: MES separado e SUBSTRING(F2_EMISSAO,5,2). ANO/MES e SUBSTRING(F2_EMISSAO,1,6).',
    '  Em YoY, ignore exemplos anteriores do historico que usem ano_mes, HAVING para mes ou BETWEEN continuo.',
    '  Para YoY/mesmo mes do ano anterior: use ano e mes separados e LAG(faturamento) OVER (PARTITION BY mes ORDER BY ano).',
    '- Limite resultados: use SET ROWCOUNT 50000 antes do SELECT (padrão máximo).',
    '- Valores monetários são decimais (ex: E2_VALOR, E1_VALOR, F2_VALBRUT).',
    '- Para joins entre cabeçalho e itens: SF1↔SD1 por (F1_FILIAL+F1_DOC+F1_SERIE+F1_FORNECE+F1_LOJA),',
    '  SF2↔SD2 por (F2_FILIAL+F2_DOC+F2_SERIE+F2_CLIENTE+F2_LOJA).',
    '- ATENÇÃO SF2: o número da NF é F2_DOC (NÃO F2_NUM). A data é F2_EMISSAO (NÃO F2_VENCTO).',
    '  Para valor de faturamento use F2_VALBRUT. NUNCA use F2_BASEICM, F2_BASEISS ou F2_BASEIPI.',
    '- Para campos numericos de valor, saldo, quantidade, total, soma ou contagem, retorne 0 em vez de NULL usando COALESCE ou ISNULL.',
    '  Exemplos: COALESCE(SUM(F2_VALBRUT), 0) AS faturamento; COALESCE(SUM(E2_SALDO), 0) AS saldo.',
    '  Excecao: percentuais de crescimento, variacao, medias ou divisoes sem denominador valido devem permanecer NULL para nao parecerem 0%.',
    '',
    '## REGRA DE AGRUPAMENTO — CRÍTICA',
    'Inclua GROUP BY APENAS quando o usuário pedir explicitamente uma dimensão de agrupamento.',
    '',
    'EXEMPLOS CORRETOS:',
    '  "faturamento do ano"    → SEM GROUP BY; filtrar o ano no WHERE com BETWEEN. Exemplo:',
    '                            SELECT SUM(F2_VALBRUT) AS faturamento FROM SF2',
    "                            WHERE D_E_L_E_T_ = ' ' AND F2_EMISSAO BETWEEN 'AAAA0101' AND 'AAAA1231'",
    '                            (use os valores do contexto [HOJE] injetado na mensagem)',
    '  "faturamento do mês"    → SEM GROUP BY; filtrar o mês no WHERE com BETWEEN. Exemplo:',
    '                            SELECT SUM(F2_VALBRUT) AS faturamento FROM SF2',
    "                            WHERE D_E_L_E_T_ = ' ' AND F2_EMISSAO BETWEEN 'AAAAMM01' AND 'AAAMMDD'",
    '                            (use os valores do contexto [HOJE] injetado na mensagem)',
    '  "faturamento por ano"   → GROUP BY SUBSTRING(F2_EMISSAO,1,4)',
    '                            SELECT SUBSTRING(F2_EMISSAO,1,4) AS ano, SUM(F2_VALBRUT) AS faturamento',
    '  "faturamento por mês"   → GROUP BY SUBSTRING(F2_EMISSAO,1,6)',
    '                            SELECT SUBSTRING(F2_EMISSAO,1,6) AS ano_mes, SUM(F2_VALBRUT) AS faturamento',
    '                            ORDER BY ano_mes',
    '  "faturamento por cliente" → GROUP BY F2_CLIENTE',
    '                              SELECT F2_CLIENTE, SUM(F2_VALBRUT) AS faturamento',
    '  "faturamento por produto"  → GROUP BY D2_COD (usar SD2 com JOIN em SF2)',
    '',
    'REGRA ESPECIAL YoY / ANO CONTRA ANO:',
    '  Se pedir crescimento comparado ao mesmo mes do ano anterior, mesmo mes em anos diferentes, YoY ou ano contra ano:',
    '  - Mesmo que o usuario diga "por mes", nesta excecao use ano + mes separados, nao ano_mes.',
    '  - NUNCA use ano_mes como particao do LAG.',
    '  - Evite projetar ano_mes em consultas YoY; projete ano e mes.',
    '  - NUNCA use BETWEEN continuo como 20250101 a 20260531 se a pergunta limitou meses 01 a 05.',
    '  - NUNCA filtre mes no HAVING; filtre no WHERE.',
    '  - Use SELECT ano, mes, metrica_principal e LAG(metrica_principal) OVER (PARTITION BY mes ORDER BY ano).',
    '  - Use WHERE SUBSTRING(F2_EMISSAO,1,4) IN (...) AND SUBSTRING(F2_EMISSAO,5,2) IN (...).',
    '',
    'ERROS PROIBIDOS:',
    '  ✗ GROUP BY F2_DOC, F2_SERIE (nunca agrupe por documento sem pedido explícito)',
    '  ✗ GROUP BY F2_EMISSAO (nunca agrupe por data sem "por dia" ou "por data")',
    '  ✗ GROUP BY F2_FILIAL (nunca agrupe por filial sem "por filial")',
    '  ✗ GROUP BY F2_CLIENTE (nunca agrupe por cliente sem "por cliente")',
    '',
    'REGRA DE OURO: campos usados no WHERE nunca precisam e NÃO devem entrar no GROUP BY.',
    'Se o usuário não disse "por X", o campo X não entra no GROUP BY.',
    '',
    '## FILTRO POR NOME DE ENTIDADE — PROIBIDO ABSOLUTO',
    'NUNCA use A1_NOME, A2_NOME, A3_NOME, B1_DESC ou BM_DESC no WHERE com = ou LIKE.',
    'Esses campos são APENAS para exibição no SELECT — filtrar por nome gera resultados errados',
    'porque o Protheus armazena e busca entidades pelo CÓDIGO (A1_COD, A2_COD, A3_COD, B1_COD).',
    '',
    'Se o usuário mencionar um nome de entidade (cliente, fornecedor, produto, vendedor, etc.)',
    'e você NÃO tiver o código Protheus interno correspondente, responda APENAS:',
    '  ```sql',
    '  -- ENTIDADE_DESCONHECIDA: <tipo>:<nome exato mencionado pelo usuário>',
    '  ```',
    'Tipos válidos: cliente | fornecedor | produto | vendedor | grupo_produto | centro_custo',
    '',
    'Prioridade de resolução por módulo (use o tipo correto para a pergunta):',
    _prioridadeEntidade(modulos),
    '',
    'Exemplo: "da Plantivo" em pergunta de faturamento → -- ENTIDADE_DESCONHECIDA: cliente:Plantivo',
    'Exemplo: "do fornecedor ABC" em pergunta de compras → -- ENTIDADE_DESCONHECIDA: fornecedor:ABC',
    '',
    '## MAPA DE TABELAS — SX2/SX3 DESTA EMPRESA',
    secoesTabelas,
    '',
    '## GESTÃO DE CONTEXTO (MODO CHAT)',
    '1. Analise SEMPRE a nova mensagem em relação ao histórico anterior da conversa.',
    '2. HERANÇA DE CONTEXTO: Se o usuário mantém o assunto e apenas refina',
    '   (ex: "detalhe por mês", "só os vencidos", "top 10", "por fornecedor"),',
    '   MANTENHA todos os filtros anteriores (período, filial, carteira, etc.) e',
    '   apenas ajuste o GROUP BY, ORDER BY ou WHERE da nova dimensão.',
    '3. RESET DE CONTEXTO: Se o usuário muda completamente de assunto',
    '   (ex: vinha falando de compras e pergunta sobre faturamento),',
    '   DESCARTE o contexto anterior e gere SQL novo focado na nova pergunta.',
    '4. HERANÇA DE PERÍODO: Se o usuário mencionou "2026" antes e agora diz "janeiro",',
    '   mantenha o ano 2026 — gere o mês dentro do ano herdado.',
    '5. O assistente vê o SQL que gerou anteriormente — use isso como referência exata do contexto.',
    '6. GRANULARIDADE ≠ PERÍODO — pedido de agrupamento NÃO altera o filtro de data herdado:',
    '   "por mês" / "por ano" / "por cliente" significa mudar o GROUP BY, NÃO substituir o BETWEEN.',
    '   Exemplo correto:',
    '     Turno anterior: WHERE F2_EMISSAO BETWEEN \'20260101\' AND \'20261231\'  (ano completo)',
    '     Pedido: "detalhe por mês"',
    '     ✓ CORRETO: WHERE F2_EMISSAO BETWEEN \'20260101\' AND \'20261231\' GROUP BY SUBSTRING(F2_EMISSAO,1,6)',
    '     ✗ ERRADO:  WHERE F2_EMISSAO BETWEEN \'20260501\' AND \'20260531\' GROUP BY SUBSTRING(F2_EMISSAO,1,6)',
    '                ↑ substituiu o período herdado por filtro_mes_corrente — PROIBIDO.',
    '   Nunca use filtro_mes_corrente no WHERE quando o usuário pedir agrupamento por mês.',
  ].join('\n');

  CACHE.set(cacheKey, { prompt, expiraEm: Date.now() + CACHE_TTL_MS });
  return prompt;
}

function invalidarCache(empresaId = null) {
  if (!empresaId) { CACHE.clear(); return; }
  for (const k of CACHE.keys()) {
    if (k.startsWith(`${empresaId}:`)) CACHE.delete(k);
  }
}

module.exports = { construir, invalidarCache, TABELAS_POR_MODULO };
