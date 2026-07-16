'use strict';

const aiProviderClient = require('./ai-provider-client');
const connectionFactory = require('./providers/connection-factory');
const responseFormatter = require('./response-formatter');
const { resolverVendedorFixoPorEmpresa } = require('./vendedor-seguranca');

function _json(raw) {
  if (raw && typeof raw === 'object') return raw;
  const texto = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(texto); } catch (_) {}
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

function _q(identificador) {
  const nome = String(identificador || '').trim().replace(/^[\[`"]|[\]`"]$/g, '').replace(/[^\w]/g, '');
  if (!nome) return '';
  return `[${nome.replace(/]/g, ']]')}]`;
}

function _campos(dataset) {
  try {
    const lista = JSON.parse(dataset.campos_semanticos_json || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch (_) {
    return [];
  }
}

function _metricas(dataset) {
  return String(dataset.colunas_metrica || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function _campoPorPadrao(campos = [], regex) {
  return (campos || [])
    .map(c => String(c.coluna || '').trim())
    .find(nome => regex.test(nome)) || null;
}

function _campoVendedor(campos = []) {
  const nomes = campos.map(c => String(c.coluna || '').trim()).filter(Boolean);
  return nomes.find(n => /^vendedor$/i.test(n))
    || nomes.find(n => /cod.*vendedor|vendedor.*cod/i.test(n))
    || nomes.find(n => /^ear$/i.test(n))
    || null;
}

function _buildSystemPrompt(dataset, { campos, metricas, campoData, suboperacaoDetectada } = {}) {
  const campoFaturamento = _campoPorPadrao(campos, /^faturamento$/i) || 'FATURAMENTO';
  const campoQuantidade = _campoPorPadrao(campos, /^quantidade$/i) || 'QUANTIDADE';
  const campoValorDevolvido = _campoPorPadrao(campos, /valor.*devolv|devolv.*valor/i) || 'VALOR_DEVOLVIDO';
  const campoQuantidadeDevolvida = _campoPorPadrao(campos, /quantidade.*devolv|qtd.*devolv|devolv.*quantidade/i) || 'QUANTIDADE_DEVOLVIDA';
  const camposTexto = campos.map(c => {
    const sinonimos = c.sinonimos ? ` Sinonimos: ${c.sinonimos}.` : '';
    return `- ${c.coluna} (${c.tipo || 'campo'}): ${c.descricao || c.coluna}.${sinonimos}`;
  }).join('\n');

  return [
    'Voce e o IA-OWNER semantico do IA Command para o modulo faturamento.',
    'Sua tarefa e gerar SQL Server usando SOMENTE a tabela logica chamada base.',
    'A tabela base ja e uma view canonica de negocio; nao use tabelas Protheus, SX2, SX3, SF2, SD2, SA1, SB1, SA3, SF4 ou nomes fisicos.',
    '',
    'Retorne SOMENTE JSON valido, sem markdown, neste formato:',
    '{',
    '  "periodo": {"tipo": string, "dataInicio": "YYYYMMDD|null", "dataFim": "YYYYMMDD|null", "origem": string, "motivo": string},',
    '  "sql": "SELECT ... FROM base ...",',
    '  "resposta_planejada": string|null',
    '}',
    '',
    'Regras obrigatorias:',
    '- Gere apenas SELECT. Nunca WITH, INSERT, UPDATE, DELETE, DROP, ALTER, EXEC, DECLARE, MERGE ou SELECT INTO.',
    '- O SQL deve começar com SELECT e deve consultar FROM base.',
    '- Use somente colunas documentadas abaixo.',
    '- Para datas, use o campo temporal informado e compare com datas SQL Server. O campo pode estar em formato datetime.',
    '- Quando a pergunta mencionar "do mes", "este mes", "mes atual" ou nao informar outro periodo, filtre pelo mes/ano da Data atual usando YEAR(campo_data) e MONTH(campo_data).',
    '- Quando a pergunta pedir agrupamento por cliente/produto/vendedor, mantenha o filtro de periodo solicitado; agrupamento nunca substitui filtro de periodo.',
    '- Para agrupamento mensal use YEAR(campo_data) e MONTH(campo_data), ou CONVERT(char(7), campo_data, 120) AS competencia.',
    '- Para metricas somadas, use COALESCE(SUM(campo), 0) para retornar zero quando nao houver movimentos.',
    `- Para faturamento, use a metrica ${campoFaturamento} quando existir.`,
    `- Faturamento liquido = ${campoFaturamento} - ${campoValorDevolvido}, quando a pergunta mencionar devolucao, devolucoes, liquido ou abatendo devolucoes.`,
    `- Quantidade liquida = ${campoQuantidade} - ${campoQuantidadeDevolvida}, quando a pergunta mencionar devolucao, devolucoes, liquido ou abatendo devolucoes.`,
    "- Remessa: use CFOP iniciado por '59' ou '69', salvo regra semantica mais especifica no dataset.",
    "- Transferencia: use CFOP IN ('5151','6151','5152','6152','5155','6155','5156','6156'), salvo regra semantica mais especifica no dataset.",
    "- Entrega futura / nota mae: use CFOP IN ('5117','6117'), salvo regra semantica mais especifica no dataset.",
    "- Carregada / movimentou estoque: use GERA_ESTOQUE = 'S' quando a coluna existir.",
    "- Gerou financeiro / duplicata: use GERA_FINANCEIRO = 'S' quando a coluna existir.",
    '- Para perguntas por cliente/produto/vendedor, agrupe pelo campo correspondente e some as metricas.',
    '- Para crescimento, calcule valor e percentual com LAG quando apropriado.',
    '- Para media mensal, retorne uma linha com AVG dos totais mensais: use uma subconsulta que soma por competencia e depois SELECT AVG(total_mensal). Nao retorne a lista de meses salvo se a pergunta pedir detalhe por mes.',
    '',
    `Dataset: ${dataset.nome}`,
    `View: ${dataset.view_nome || dataset.nome}`,
    `Descricao: ${dataset.view_descricao || 'Nao informada'}`,
    `Suboperacao detectada: ${suboperacaoDetectada || 'vendas'}`,
    `Campo de data padrao: ${campoData || 'EMISSAO'}`,
    `Metricas padrao: ${metricas.join(', ') || 'nao informadas'}`,
    '',
    'Campos disponiveis:',
    camposTexto || '- Nenhum campo documentado.',
    '',
    dataset.regras_semanticas ? `Regras semanticas do dataset:\n${dataset.regras_semanticas}` : '',
    dataset.exemplos_perguntas ? `Exemplos cadastrados:\n${dataset.exemplos_perguntas}` : '',
    dataset.limitacoes ? `Limitacoes:\n${dataset.limitacoes}` : '',
  ].filter(Boolean).join('\n');
}

function _buildUserPrompt({ mensagem, dataAtual, historico, estadoAnterior, entidadeSeguranca }) {
  return [
    `Data atual: ${dataAtual}`,
    `Mensagem do usuario: ${mensagem || ''}`,
    '',
    'Historico resumido:',
    JSON.stringify(historico || [], null, 2),
    '',
    'Estado anterior:',
    JSON.stringify(estadoAnterior || null, null, 2),
    entidadeSeguranca ? [
      '',
      'Restricao de seguranca ja aplicada pelo sistema na CTE base:',
      `- vendedor autorizado: ${entidadeSeguranca.codigo} (${entidadeSeguranca.nome || ''})`,
      '- Nao tente remover, contornar ou ampliar essa restricao.',
    ].join('\n') : '',
    '',
    'Gere o SQL final sobre FROM base e retorne o JSON obrigatorio.',
  ].filter(Boolean).join('\n');
}

function _validarSelectBase(sql, camposPermitidos) {
  const texto = String(sql || '').trim();
  const erros = [];
  if (!/^select\b/i.test(texto)) erros.push('SQL deve iniciar com SELECT.');
  if (!/\bfrom\s+base\b/i.test(texto)) erros.push('SQL deve consultar FROM base.');
  if (/\b(insert|update|delete|drop|alter|truncate|exec|execute|declare|merge|create|with|select\s+into)\b/i.test(texto)) {
    erros.push('SQL contem comando nao permitido.');
  }
  const fontes = [...texto.matchAll(/\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*|\[[^\]]+\])/gi)]
    .map(m => String(m[1] || '').replace(/^\[|\]$/g, '').toLowerCase());
  for (const fonte of fontes) {
    if (fonte !== 'base') erros.push(`Fonte nao permitida no dataset semantico: ${fonte}`);
  }
  if (/\b(SF2|SD2|SF1|SD1|SA1|SA3|SB1|SBM|SF4|CTT|ACY)\b/i.test(texto)) {
    erros.push('SQL tentou usar tabela Protheus no caminho semantico.');
  }
  const permitidos = new Set((camposPermitidos || []).map(c => String(c || '').toUpperCase()));
  const refs = [...texto.matchAll(/\[([^\]]+)\]|\bbase\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/gi)]
    .map(m => (m[1] || m[2] || '').toUpperCase())
    .filter(Boolean);
  for (const ref of refs) {
    if (!permitidos.has(ref)) erros.push(`Campo nao documentado no dataset: ${ref}`);
  }
  return { ok: erros.length === 0, erros };
}

function _aplicarTop(sql, limite) {
  const n = Math.max(1, Math.min(Number(limite) || 1000, 10000));
  if (/^select\s+top\s+\(?\d+\)?\b/i.test(sql)) return sql;
  return String(sql || '').replace(/^select\b/i, `SELECT TOP ${n}`);
}

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _fmtNumero(v) {
  return _num(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function _fmtMoeda(v) {
  return _num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _ehMetrica(col, valor) {
  const c = String(col || '').toLowerCase();
  if (/competencia|ano_mes|periodo|data|emissao|ano$|mes$|dia$|codigo|cod_|^id$|_id$/.test(c)) return false;
  if (/fatur|valor|receita|total|quant|qtd|dev|devolv|crescimento|variacao|media|preco/.test(c)) return true;
  return typeof valor === 'number';
}

function _label(col) {
  return String(col || '').replace(/_/g, ' ').toLowerCase();
}

function _formatarValor(col, valor) {
  if (/percent|perc|pct|%/i.test(col)) return `${_fmtNumero(valor)}%`;
  return /quant|qtd/i.test(col) && !/valor/i.test(col) ? _fmtNumero(valor) : _fmtMoeda(valor);
}

function _formatarRespostaSemantica(rows, mensagem) {
  if (!rows || !rows.length) return 'Nenhum dado encontrado para sua consulta.';
  const first = rows[0] || {};
  const cols = Object.keys(first);
  const metricas = cols.filter(c => _ehMetrica(c, first[c]));
  const dimensoes = cols.filter(c => !metricas.includes(c));

  if (rows.length === 1) {
    const r = rows[0];
    const linhasMetricas = metricas.map(c => `*${_label(c)}*: ${_formatarValor(c, r[c])}`);
    const linhasDim = dimensoes
      .filter(c => r[c] !== null && r[c] !== undefined && String(r[c]).trim() !== '')
      .map(c => `${_label(c)}: ${r[c]}`);
    return [`*Resultado*`, ...linhasDim, ...linhasMetricas].join('\n');
  }

  const linhas = rows.slice(0, 10).map((r, idx) => {
    const titulo = dimensoes
      .filter(c => r[c] !== null && r[c] !== undefined && String(r[c]).trim() !== '')
      .slice(0, 3)
      .map(c => String(r[c]).trim())
      .join(' | ') || `Linha ${idx + 1}`;
    const mets = metricas
      .slice(0, 3)
      .map(c => `${_label(c)}: *${_formatarValor(c, r[c])}*`)
      .join('; ');
    return `${idx + 1}. *${titulo}*${mets ? ` — ${mets}` : ''}`;
  });

  const totalizadores = metricas.slice(0, 3).map(c => {
    const total = rows.reduce((s, r) => s + _num(r[c]), 0);
    return `*Total ${_label(c)}*: ${_formatarValor(c, total)}`;
  });

  const cabecalho = String(mensagem || '').trim() || 'Resultado';
  return [
    `*${cabecalho}*`,
    '',
    ...linhas,
    ...(rows.length > 10 ? [`... e mais ${rows.length - 10} registro(s)`] : []),
    '',
    ...totalizadores,
  ].filter(l => l !== null && l !== undefined).join('\n');
}

function _normalizarRowsMultiempresa(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const [col, valor] of Object.entries(row)) {
      const c = String(col || '');
      if (/^empresa$/i.test(c)) continue;
      if (/^(faturamento|faturamento_total|total_faturamento)$/i.test(c)) {
        out.faturamento = valor;
        continue;
      }
      if (/^(quantidade|quantidade_total|total_quantidade)$/i.test(c)) {
        out.quantidade = valor;
        continue;
      }
      out[col] = valor;
    }
    return out;
  });
}

function _sqlBaseSeguro(dataset, entidadeSeguranca, campos) {
  const vendedor = entidadeSeguranca ? _campoVendedor(campos) : null;
  if (!vendedor) return dataset.sql_base;
  const codigo = String(entidadeSeguranca.codigo || '').replace(/'/g, "''");
  return [
    'SELECT *',
    'FROM (',
    dataset.sql_base,
    ') AS _dataset_base',
    `WHERE ${_q(vendedor)} = '${codigo}'`,
  ].join('\n');
}

function _dataAtual() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function executar(dataset, intent, empresaId, opts = {}) {
  const t0 = Date.now();
  const mensagem = intent._mensagemOriginal || intent.intencao || 'consulta de faturamento';
  const campos = _campos(dataset);
  const campoData = dataset.campo_data || 'EMISSAO';
  const metricas = _metricas(dataset);

  let entidadeSeguranca = null;
  const remetente = intent._remetente || null;
  if (remetente) {
    const resolucao = resolverVendedorFixoPorEmpresa(remetente, empresaId);
    if (resolucao.estado === 'nao_cadastrado') {
      return {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu numero nao esta cadastrado como vendedor ou gestor no IA Command. Para acessar dados de faturamento, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers para empresa_id=${empresaId}`,
        duracao_ms: Date.now() - t0,
      };
    }
    if (resolucao.estado === 'vendedor_sem_codigo') {
      return {
        tipo: 'erro',
        subtipo: 'erp_id_nao_configurado',
        resposta_direta: 'Seu cadastro nao possui um codigo de vendedor ERP configurado. Solicite ao gestor do IA Command que preencha o campo Codigo ERP nas suas configuracoes de acesso.',
        sql_gerado: `-- erro: erp_id vazio para vendedor\n-- mensagem: ${mensagem}`,
        duracao_ms: Date.now() - t0,
      };
    }
    if (resolucao.estado === 'vendedor') {
      entidadeSeguranca = { codigo: resolucao.codigo, nome: resolucao.nome };
      if (!_campoVendedor(campos)) {
        return {
          tipo: 'erro',
          subtipo: 'dataset_sem_campo_seguranca',
          resposta_direta: 'O dataset semantico de faturamento nao possui campo de vendedor para aplicar a seguranca do seu perfil.',
          sql_gerado: '-- erro: dataset sem campo VENDEDOR para seguranca',
          duracao_ms: Date.now() - t0,
        };
      }
    }
  }

  let keys, cfg;
  try {
    ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId));
  } catch (e) {
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: 'Nao consigo processar sua consulta no momento. Tente novamente em breve.', sql_gerado: `-- erro: ${e.message}`, duracao_ms: Date.now() - t0 };
  }
  if (!Object.values(keys || {}).some(Boolean)) {
    return { tipo: 'erro', subtipo: 'sem_chave', resposta_direta: 'Nao consigo processar sua consulta no momento. Tente novamente em breve.', sql_gerado: '-- Nenhuma chave de IA configurada.', duracao_ms: Date.now() - t0 };
  }

  const systemPrompt = _buildSystemPrompt(dataset, {
    campos,
    metricas,
    campoData,
    suboperacaoDetectada: opts.suboperacaoDetectada,
  });
  const userPrompt = _buildUserPrompt({
    mensagem,
    dataAtual: _dataAtual(),
    historico: intent._historicoResumido,
    estadoAnterior: {
      filtros: intent.filtros || {},
      agrupamentos: Array.isArray(intent.group_by) ? intent.group_by : (intent.agrupar_por ? [intent.agrupar_por] : []),
      periodo: intent.periodo || null,
    },
    entidadeSeguranca,
  });

  let plano;
  try {
    const raw = await aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
      json: true,
      maxTokens: 2800,
      timeoutMs: 45000,
      temperature: 0,
      geminiCombinedPrompt: true,
      logPrefix: 'SemanticDatasetAI',
      empresaId,
      numeroWa: intent._remetente || null,
      canalId: intent._channelId || intent._canalId || null,
      usageOrigem: 'ia-owner',
      usageOperacao: 'faturamento_dataset_semantico',
    });
    plano = _json(raw);
    if (!plano || typeof plano !== 'object') throw new Error('IA nao retornou JSON valido.');
  } catch (e) {
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: 'Nao consigo processar sua consulta no momento. Tente novamente em breve.', sql_gerado: `-- IA semantica falhou: ${e.message}`, duracao_ms: Date.now() - t0 };
  }

  const sqlSelect = _aplicarTop(String(plano.sql || '').trim().replace(/;+\s*$/g, ''), intent.limite || dataset.limite_max || 1000);
  const camposPermitidos = campos.map(c => c.coluna);
  const validacao = _validarSelectBase(sqlSelect, camposPermitidos);
  if (!validacao.ok) {
    return {
      tipo: 'erro',
      subtipo: 'contrato_dataset_semantico_invalido',
      resposta_direta: 'Tive uma inconsistencia ao interpretar esta consulta pelo dataset semantico. Reformule a pergunta ou ajuste a documentacao semantica do dataset.',
      sql_gerado: `${sqlSelect}\n\n-- ERRO: ${validacao.erros.join(' | ')}`,
      _ia_owner_plano: plano,
      duracao_ms: Date.now() - t0,
    };
  }

  const sqlBase = _sqlBaseSeguro(dataset, entidadeSeguranca, campos);
  const sqlFinal = [
    'WITH base AS (',
    sqlBase,
    ')',
    sqlSelect,
  ].join('\n');

  try {
    const conn = connectionFactory.carregarConexao(empresaId);
    conn._pergunta = mensagem;
    conn._sender = intent._remetente || '';
    conn._modulo = dataset.nome || 'dataset_semantico';
    conn._operacao = intent.intencao || 'faturamento_dataset_semantico';
    conn._empresa_id = empresaId || '';
    const rowsBrutas = await connectionFactory.executar(conn, sqlFinal, {});
    const rows = intent._escopoExecucao === 'whatsapp_all'
      ? _normalizarRowsMultiempresa(rowsBrutas)
      : rowsBrutas;
    const respostaFallback = _formatarRespostaSemantica(rows, mensagem);
    return {
      tipo: 'sucesso_ai_sql',
      resposta_direta: responseFormatter.normalizarAgrupamentosPais(respostaFallback),
      rows: rows || [],
      sql_gerado: sqlFinal,
      periodo_resolvido: plano.periodo || null,
      dataset_id: dataset.id,
      dataset_nome: dataset.nome,
      _sql_canonico: sqlFinal,
      _sql_canonico_origem: 'dataset_semantico',
      _ia_owner_plano: plano,
      trace: [{ etapa: 'dataset_semantico', acao: 'executado', modulo: 'faturamento', detalhe: `dataset=${dataset.nome}; linhas=${(rows || []).length}` }],
      duracao_ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      tipo: 'erro',
      subtipo: /conex|timeout|agente/i.test(e.message || '') ? 'sem_conexao' : 'erro_erp',
      resposta_direta: 'Nao consegui buscar essa informacao no sistema. Tente um periodo menor ou filtros mais especificos.',
      sql_gerado: `${sqlFinal}\n\n-- ERRO: ${e.message}`,
      _ia_owner_plano: plano,
      duracao_ms: Date.now() - t0,
    };
  }
}

module.exports = {
  executar,
  _test: {
    _validarSelectBase,
    _buildSystemPrompt,
    _campoVendedor,
  },
};
