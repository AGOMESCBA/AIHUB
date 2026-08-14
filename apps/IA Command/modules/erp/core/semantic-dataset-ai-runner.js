'use strict';

const aiProviderClient = require('./ai-provider-client');
const connectionFactory = require('../providers/connection-factory');
const responseFormatter = require('./response-formatter');
const canonicalWhatsappFormat = require('./canonical-whatsapp-format');
const { resolverVendedorFixoPorEmpresa } = require('../totvs_protheus/guards/vendedor-seguranca');
const { resolverClienteFixoPorEmpresa } = require('../totvs_protheus/guards/cliente-seguranca');
const entitySqlGuard = require('../totvs_protheus/guards/entity-sql-guard');
const { resolverIdentidadeDinamica } = require('./guards/identidade-dinamica-seguranca');

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

function _metricas(campos = []) {
  return (campos || [])
    .filter(c => String(c.tipo || '').toLowerCase() === 'metrica')
    .map(c => String(c.coluna || '').trim())
    .filter(Boolean);
}

function _campoPorPadrao(campos = [], regex) {
  return (campos || [])
    .map(c => String(c.coluna || '').trim())
    .find(nome => regex.test(nome)) || null;
}

function _campoPreferido(campos = [], preferidos = [], regexFallback = null, fallback = null) {
  const nomes = (campos || []).map(c => String(c.coluna || '').trim()).filter(Boolean);
  const porUpper = new Map(nomes.map(n => [n.toUpperCase(), n]));
  for (const preferido of preferidos || []) {
    const achado = porUpper.get(String(preferido || '').toUpperCase());
    if (achado) return achado;
  }
  if (regexFallback) {
    const achado = nomes.find(nome => regexFallback.test(nome));
    if (achado) return achado;
  }
  return fallback;
}

function _camposSx3Presentes(campos = []) {
  const nomes = (campos || []).map(c => _normalizarNomeColuna(c.coluna)).filter(Boolean);
  return nomes.filter(nome => /^[A-Z0-9]{2}_[A-Z0-9_]+$/.test(nome));
}

function _campoTemporalEhTextoProtheus(campoData) {
  return /^[A-Z0-9]{2}_(?:EMISSAO|DT|DT[A-Z0-9_]*|VENCTO|VENC|BAIXA)$/i.test(String(campoData || ''));
}

function _campoVendedor(campos = []) {
  const nomes = campos.map(c => String(c.coluna || '').trim()).filter(Boolean);
  return nomes.find(n => /^F2_VEND1$/i.test(n))
    || nomes.find(n => /^A3_COD$/i.test(n))
    || nomes.find(n => /^A3_NOME$/i.test(n))
    || nomes.find(n => /^vendedor$/i.test(n))
    || nomes.find(n => /cod.*vendedor|vendedor.*cod/i.test(n))
    || nomes.find(n => /^ear$/i.test(n))
    || null;
}

function _campoCliente(campos = []) {
  const nomes = campos.map(c => String(c.coluna || '').trim()).filter(Boolean);
  return nomes.find(n => /^F2_CLIENTE$/i.test(n))
    || nomes.find(n => /^D2_CLIENTE$/i.test(n))
    || nomes.find(n => /^A1_COD$/i.test(n))
    || null;
}

function _normalizarNomeColuna(valor) {
  return String(valor || '').replace(/^[\[`"]|[\]`"]$/g, '').trim().toUpperCase();
}

function _aliasesSqlBase(sqlBase) {
  const texto = String(sqlBase || '');
  return [...texto.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)]
    .map(m => ({ origem: _normalizarNomeColuna(m[1]), alias: String(m[2] || '').trim() }))
    .filter(a => a.origem && a.alias);
}

function _resolverCampoDataDataset(dataset, campos = []) {
  const configurado = String(dataset?.campo_data || '').trim();
  const configuradoNorm = _normalizarNomeColuna(configurado);
  const colunasCampos = new Set((campos || []).map(c => _normalizarNomeColuna(c.coluna)).filter(Boolean));

  const datasGrid = (campos || [])
    .filter(c => String(c.tipo || '').toLowerCase() === 'data')
    .map(c => String(c.coluna || '').trim())
    .filter(Boolean);
  const dataPreferida = datasGrid.find(c => _normalizarNomeColuna(c) === configuradoNorm)
    || datasGrid.find(c => /^F2_EMISSAO$/i.test(c))
    || datasGrid.find(c => /^emissao$/i.test(c))
    || datasGrid.find(c => /emissao/i.test(c))
    || datasGrid[0];
  if (dataPreferida) return dataPreferida;

  const dataSx3NaGrid = _campoPreferido(campos, [
    'F2_EMISSAO',
    'D2_EMISSAO',
    'F1_EMISSAO',
    'E1_EMISSAO',
    'E2_EMISSAO',
  ]);
  if (dataSx3NaGrid) return dataSx3NaGrid;

  if (configurado && colunasCampos.has(configuradoNorm)) return configurado;
  return 'EMISSAO';
}

function _sqlModeloReferencia(sql) {
  const texto = String(sql || '').trim();
  if (!texto) return '';
  return texto.length > 5000 ? `${texto.slice(0, 5000)}\n-- SQL modelo truncado para caber no prompt` : texto;
}

function _buildSystemPrompt(dataset, { campos, metricas, campoData, suboperacaoDetectada, sqlModeloReferencia } = {}) {
  const campoFaturamento = _campoPreferido(campos, ['D2_TOTAL', 'FATURAMENTO'], /^faturamento$/i, 'FATURAMENTO');
  const campoQuantidade = _campoPreferido(campos, ['D2_QUANT', 'QUANTIDADE'], /^quantidade$/i, 'QUANTIDADE');
  const campoValorDevolvido = _campoPreferido(campos, ['D2_VALDEV', 'D1_TOTAL', 'VALOR_DEVOLVIDO'], /valor.*devolv|devolv.*valor/i, 'VALOR_DEVOLVIDO');
  const campoQuantidadeDevolvida = _campoPreferido(campos, ['D2_QTDEDEV', 'D1_QUANT', 'QUANTIDADE_DEVOLVIDA'], /quantidade.*devolv|qtd.*devolv|devolv.*quantidade/i, 'QUANTIDADE_DEVOLVIDA');
  const campoCliente = _campoPreferido(campos, ['A1_NOME', 'A1_NREDUZ', 'F2_CLIENTE', 'CLIENTE'], /cliente/i, 'CLIENTE');
  const campoProduto = _campoPreferido(campos, ['B1_DESC', 'D2_COD', 'PRODUTO'], /produto/i, 'PRODUTO');
  const campoVendedor = _campoPreferido(campos, ['A3_NOME', 'F2_VEND1', 'VENDEDOR', 'EAR'], /vendedor|ear/i, 'VENDEDOR');
  const campoCfop = _campoPreferido(campos, ['D2_CF', 'CFOP'], /^cfop$/i, 'CFOP');
  const campoTesCodigo = _campoPreferido(campos, ['D2_TES', 'TES'], /^tes$/i, 'TES');
  const campoTesDescricao = _campoPreferido(campos, ['F4_TEXTO', 'TES_DESCRICAO', 'DESCRICAO_TES'], /tes.*(texto|descri)|descri.*tes/i, campoTesCodigo);
  const campoValorNota = _campoPreferido(campos, ['F2_VALBRUT', 'VALOR_NF'], /valor.*nf|nf.*valor/i, 'F2_VALBRUT');
  const campoGrupoProduto = _campoPreferido(campos, ['B1_GRUPO', 'NEGOCIO'], /negocio|grupo/i, 'B1_GRUPO');
  const campoEstoque = _campoPreferido(campos, ['F4_ESTOQUE', 'GERA_ESTOQUE'], /estoque/i, 'GERA_ESTOQUE');
  const campoFinanceiro = _campoPreferido(campos, ['F4_DUPLIC', 'GERA_FINANCEIRO'], /financeiro|duplic/i, 'GERA_FINANCEIRO');
  const camposSx3 = _camposSx3Presentes(campos);
  const campoDataSql = campoData || 'EMISSAO';
  const dataTextoProtheus = _campoTemporalEhTextoProtheus(campoDataSql);
  // "Sem periodo informado = mes atual" e um padrao de negocio do Protheus (faturamento,
  // compras etc. sao sempre um recorte temporal). Nao vale para outros sistemas: uma consulta
  // como "chamados em aberto e em atraso" e sobre estado atual, nao um periodo — aplicar essa
  // instrucao la faz a IA inventar um filtro de data que o usuario nunca pediu.
  const datasetEhProtheusPrompt = String(dataset.erp || 'protheus').trim().toLowerCase() === 'protheus';
  const instrucaoFiltroMes = !datasetEhProtheusPrompt
    ? `- Nao aplique filtro de periodo por padrao. So filtre ${campoDataSql} por data quando a pergunta mencionar explicitamente um periodo (ex: "em julho", "este mes", "ultimos 7 dias").`
    : dataTextoProtheus
    ? `- Quando a pergunta mencionar "do mes", "este mes", "mes atual" ou nao informar outro periodo, filtre ${campoDataSql} entre YYYYMM01 e YYYYMMDD final do mes. Exemplo: ${campoDataSql} BETWEEN '20260701' AND '20260731'.`
    : `- Quando a pergunta mencionar "do mes", "este mes", "mes atual" ou nao informar outro periodo, filtre ${campoDataSql} usando BETWEEN com datas no formato YYYY-MM-DD (ex: ${campoDataSql} BETWEEN '2026-07-01' AND '2026-07-31'), ou YEAR(${campoDataSql})/MONTH(${campoDataSql}) quando o agrupamento for mensal.`;
  const instrucaoAgrupamentoMes = dataTextoProtheus
    ? `- Para agrupamento mensal use SUBSTRING(${campoDataSql}, 1, 6) AS competencia e o mesmo SUBSTRING no GROUP BY. EXCECAO OBRIGATORIA: se a pergunta nomear explicitamente uma coluna de data no agrupamento (ex: "agrupado por data de emissao", "por data do documento"), NAO use competencia/SUBSTRING — agrupe por ${campoDataSql} completo (o dia exato), mesmo que a palavra "mes" apareca em outro trecho da pergunta. Exemplo CORRETO para "por mes agrupado por data de emissao, cliente": SELECT ${campoDataSql} AS data_emissao, cliente, ... GROUP BY ${campoDataSql}, cliente. Exemplo INCORRETO (nao faça): SELECT SUBSTRING(${campoDataSql},1,6) AS competencia, cliente, ... GROUP BY SUBSTRING(${campoDataSql},1,6), cliente.`
    : `- Para agrupamento mensal use CONVERT(char(7), ${campoDataSql}, 120) AS competencia ou YEAR(${campoDataSql})/MONTH(${campoDataSql}). EXCECAO OBRIGATORIA: se a pergunta nomear explicitamente uma coluna de data no agrupamento (ex: "agrupado por data de emissao"), NAO resuma para competencia — agrupe por ${campoDataSql} completo (o dia exato), mesmo que a palavra "mes" apareca em outro trecho da pergunta.`;
  const contratoSx3Texto = camposSx3.length ? [
    'Contrato SX3/Protheus da base:',
    '- A base pode expor campos com nome SX3, como F2_EMISSAO, F2_VALBRUT, D2_TOTAL, D2_QUANT, D2_TES, D2_CF, B1_GRUPO, B1_DESC, A1_NREDUZ, A3_COD, A3_NOME, F4_ESTOQUE e F4_DUPLIC.',
    '- Esses nomes SX3 sao colunas documentadas da tabela logica base, nao tabelas fisicas. Pode usa-los quando aparecerem em Campos disponiveis.',
    `- Data padrao: ${campoDataSql}.`,
    `- Faturamento bruto: SUM(${campoFaturamento}) AS faturamento_total.`,
    `- Quantidade: SUM(${campoQuantidade}) AS quantidade_total.`,
    `- Valor da nota/cabecalho: use ${campoValorNota} apenas quando a pergunta pedir valor da NF ou total por nota; para faturamento operacional prefira ${campoFaturamento}.`,
    `- Cliente: use ${campoCliente} quando a pergunta pedir por cliente.`,
    `- Produto: use ${campoProduto} quando a pergunta pedir por produto.`,
    `- Grupo/negocio do produto: use ${campoGrupoProduto} quando a pergunta pedir por negocio, grupo ou familia.`,
    `- Vendedor: use ${campoVendedor} quando a pergunta pedir por vendedor.`,
    `- CFOP: use ${campoCfop} para remessa, transferencia e regras fiscais.`,
    `- TES: use ${campoTesDescricao} como descricao principal quando a pergunta pedir por TES; use ${campoTesCodigo} apenas como codigo auxiliar/filtro quando necessario.`,
    `- Estoque: use ${campoEstoque} = 'S' para carregada/movimentou estoque quando a coluna existir.`,
    `- Financeiro/duplicata: use ${campoFinanceiro} = 'S' para gerou financeiro/duplicata quando a coluna existir.`,
    '- Para consolidacao multiempresa, prefira aliases de saida canonicos: competencia, faturamento_total, quantidade_total, cliente, produto, vendedor.',
  ].join('\n') : '';
  const camposTexto = campos.map(c => {
    const sinonimos = c.sinonimos ? ` Sinonimos: ${c.sinonimos}.` : '';
    const usos = [
      c.filtravel ? 'filtravel' : '',
      c.agrupavel ? 'agrupavel' : '',
      c.ordenavel ? 'ordenavel' : '',
    ].filter(Boolean).join(', ');
    const usoTexto = usos ? ` Uso: ${usos}.` : '';
    const regraTexto = c.regra ? ` Regra: ${c.regra}.` : '';
    return `- ${c.coluna} (${c.tipo || 'campo'}): ${c.descricao || c.coluna}.${sinonimos}${usoTexto}${regraTexto}`;
  }).join('\n');
  const sqlModeloTexto = _sqlModeloReferencia(sqlModeloReferencia);
  const referenciaSaidaTexto = sqlModeloTexto ? [
    'SQL modelo de referencia gerado por empresa sem Dataset View:',
    sqlModeloTexto,
    '',
    'Regra de compatibilidade com o SQL modelo:',
    '- Use o SQL modelo apenas para copiar a estrutura do SELECT final: aliases, dimensoes, metricas, ordem das colunas, GROUP BY, ORDER BY e TOP quando aplicavel.',
    '- Nao use as tabelas fisicas do SQL modelo. A consulta final deve continuar usando somente FROM base.',
    '- Adapte os campos fisicos do modelo para as colunas documentadas da base. Exemplo: SD2.D2_TOTAL vira D2_TOTAL, SF2.F2_EMISSAO vira F2_EMISSAO, SD2.D2_CF vira D2_CF.',
    '- Preserve os mesmos aliases finais do SQL modelo sempre que a coluna equivalente existir na base. Exemplo: se o modelo usa SD2.D2_CF AS cod_fiscal, use D2_CF AS cod_fiscal.',
    '- Se o SQL modelo trouxer colunas extras validas, preserve equivalentes na view quando existirem.',
  ].join('\n') : '';

  return [
    'Voce e o IA-OWNER semantico do IA Command para o modulo faturamento.',
    'Sua tarefa e gerar SQL Server usando SOMENTE a tabela logica chamada base.',
    'A tabela base ja e uma fonte canonica de negocio; nao use tabelas Protheus, SX2, SX3, SF2, SD2, SA1, SB1, SA3, SF4 ou aliases de tabelas fisicas.',
    'Se a base documentar colunas com nomes SX3/Protheus, use esses nomes como colunas da base.',
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
    '- Nao use nomes de colunas do SQL Base original se eles foram renomeados por alias. Use somente o nome documentado da tabela base.',
    '- Nao filtre EMPRESA por nomes mencionados na pergunta; a CTE base ja representa a empresa em execucao.',
    '- Para datas, use o campo temporal informado abaixo. Ele pode ser texto Protheus YYYYMMDD ou datetime.',
    instrucaoFiltroMes,
    '- Quando a pergunta pedir agrupamento por cliente/produto/vendedor, mantenha o filtro de periodo solicitado; agrupamento nunca substitui filtro de periodo.',
    instrucaoAgrupamentoMes,
    '- Em consultas com UNION ALL, cada SELECT deve estar sintaticamente completo antes do UNION. Feche funcoes no GROUP BY, por exemplo: GROUP BY SUBSTRING(F2_EMISSAO, 1, 6).',
    '- Para metricas somadas, use COALESCE(SUM(campo), 0) para retornar zero quando nao houver movimentos.',
    `- Para faturamento, use a metrica ${campoFaturamento} quando existir.`,
    `- Faturamento liquido = ${campoFaturamento} - ${campoValorDevolvido}, quando a pergunta mencionar devolucao, devolucoes, liquido ou abatendo devolucoes.`,
    `- Quantidade liquida = ${campoQuantidade} - ${campoQuantidadeDevolvida}, quando a pergunta mencionar devolucao, devolucoes, liquido ou abatendo devolucoes.`,
    `- Remessa: use ${campoCfop} iniciado por '59' ou '69', salvo regra semantica mais especifica no dataset.`,
    `- Transferencia: use ${campoCfop} IN ('5151','6151','5152','6152','5155','6155','5156','6156'), salvo regra semantica mais especifica no dataset.`,
    `- Entrega futura / nota mae: use ${campoCfop} IN ('5117','6117'), salvo regra semantica mais especifica no dataset.`,
    `- Quando a pergunta pedir "por TES", agrupe/exiba por ${campoTesDescricao} se existir; nao prefira ${campoTesCodigo} como saida principal quando houver descricao.`,
    `- Carregada / movimentou estoque: use ${campoEstoque} = 'S' quando a coluna existir.`,
    `- Gerou financeiro / duplicata: use ${campoFinanceiro} = 'S' quando a coluna existir.`,
    '- Para perguntas por cliente/produto/vendedor, agrupe pelo campo correspondente e some as metricas.',
    '- Para crescimento, calcule valor e percentual com LAG quando apropriado.',
    '- Para media mensal, retorne uma linha com AVG dos totais mensais: use uma subconsulta que soma por competencia e depois SELECT AVG(total_mensal). Nao retorne a lista de meses salvo se a pergunta pedir detalhe por mes.',
    '- Para "media mensal por mes", retorne uma linha por competencia com SUM da metrica; nao aplique AVG, porque o usuario pediu o detalhe por mes.',
    `- Para preco medio de venda, ticket medio por produto ou valor medio por unidade, use SUM(${campoFaturamento}) / NULLIF(SUM(${campoQuantidade}), 0) AS preco_medio_venda. Nunca use AVG(${campoFaturamento}) para preco medio.`,
    '',
    `Dataset: ${dataset.nome}`,
    `View: ${dataset.view_nome || dataset.nome}`,
    `Descricao: ${dataset.view_descricao || 'Nao informada'}`,
    `Suboperacao detectada: ${suboperacaoDetectada || 'vendas'}`,
    `Campo de data padrao: ${campoDataSql}`,
    `Metricas padrao: ${metricas.join(', ') || 'nao informadas'}`,
    '',
    contratoSx3Texto,
    referenciaSaidaTexto,
    '',
    'Campos disponiveis:',
    camposTexto || '- Nenhum campo documentado.',
    '',
    dataset.regras_semanticas ? `Regras semanticas do dataset:\n${dataset.regras_semanticas}` : '',
    dataset.exemplos_perguntas ? `Exemplos cadastrados:\n${dataset.exemplos_perguntas}` : '',
    dataset.limitacoes ? `Limitacoes:\n${dataset.limitacoes}` : '',
  ].filter(Boolean).join('\n');
}

function _buildContratoTemporalDataset(intent = {}, datasetEhProtheus = true) {
  // Fora do Protheus, so monta contrato obrigatorio quando o periodo veio de mencao
  // explicita (dataInicio/dataFim concretas) — nunca para um periodo implicito de sistema
  // que nao trabalha com recorte temporal por padrao (ver _intentAiSqlDireto).
  if (!datasetEhProtheus && !_periodoComDatas(intent?.periodo)) return '';
  const atual = _periodoComDatas(intent?.periodo);
  const periodos = _periodosComparativosDataset(intent, {});
  const linhas = [];
  if (atual) {
    linhas.push('CONTRATO OBRIGATORIO DE SQL DATASET:');
    linhas.push(`- periodo_autoritativo: ${atual.dataInicio} a ${atual.dataFim}`);
  }
  if (periodos.length > 1) {
    linhas.push(`- periodo_base: ${periodos[0].dataInicio} a ${periodos[0].dataFim}`);
    linhas.push(`- periodo_comparacao: ${periodos[1].dataInicio} a ${periodos[1].dataFim}`);
    linhas.push('- comparativo_continuidade: o SQL deve retornar os dois periodos, nao apenas o periodo_comparacao.');
    linhas.push("- Use UNION ALL com literal de competencia correto para cada bloco, ou agrupe por competencia com filtro IN ('AAAAMM','AAAAMM').");
  }
  return linhas.join('\n');
}

function _buildUserPrompt({ mensagem, dataAtual, historico, estadoAnterior, entidadeSeguranca, contratoTemporal = '', retryErro = '' }) {
  return [
    `Data atual: ${dataAtual}`,
    `Mensagem do usuario: ${mensagem || ''}`,
    contratoTemporal ? ['', contratoTemporal].join('\n') : '',
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
    retryErro ? [
      '',
      'A tentativa anterior foi rejeitada pelo contrato tecnico:',
      retryErro,
      'Gere novamente corrigindo o SQL. Nao reaproveite o trecho rejeitado.',
      'Se o erro for parenteses sem fechamento em GROUP BY SUBSTRING(..., 1, 6), feche a funcao antes de UNION ALL ou do fim do SELECT.',
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
  if (/\bSELECT\s+TOP\s+\(?\d+\)?\b[\s\S]*\bOFFSET\b[\s\S]*\bFETCH\s+NEXT\b/i.test(texto)) {
    erros.push('SQL nao pode usar SELECT TOP junto com OFFSET/FETCH. Para ranking/top N, use apenas OFFSET/FETCH; para limite geral, use apenas SELECT TOP.');
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

function _empresaFixaSqlBase(sqlBase) {
  const texto = String(sqlBase || '');
  const m = texto.match(/\bEMPRESA\s*=\s*'([^']+)'/i);
  return m ? String(m[1] || '').trim() : null;
}

function _removerFiltroEmpresaDivergente(sql, empresaBase) {
  if (!empresaBase) return sql;
  const base = String(empresaBase || '').trim().toUpperCase();
  return String(sql || '')
    .replace(/\s+AND\s+EMPRESA\s*=\s*'([^']+)'/gi, (trecho, empresa) => (
      String(empresa || '').trim().toUpperCase() === base ? trecho : ''
    ))
    .replace(/\s+WHERE\s+EMPRESA\s*=\s*'([^']+)'\s+AND\s+/i, (trecho, empresa) => (
      String(empresa || '').trim().toUpperCase() === base ? trecho : ' WHERE '
    ))
    .replace(/\s+WHERE\s+EMPRESA\s*=\s*'([^']+)'\s*/i, (trecho, empresa) => (
      String(empresa || '').trim().toUpperCase() === base ? trecho : ' '
    ));
}

function _normalizarCampoDataLegado(sql, campoData, camposPermitidos) {
  const permitidos = new Set((camposPermitidos || []).map(c => String(c || '').toUpperCase()));
  const campo = String(campoData || '').trim();
  if (!campo || !permitidos.has(campo.toUpperCase()) || /^DATA$/i.test(campo)) return sql;
  return String(sql || '').replace(/\bDATA\b/gi, campo);
}

function _sanitizarSqlSelectDataset(sql, dataset, campoData, camposPermitidos, mensagem, campos = []) {
  let out = String(sql || '');
  out = _normalizarCampoDataLegado(out, campoData, camposPermitidos);
  out = _removerFiltroEmpresaDivergente(out, _empresaFixaSqlBase(dataset?.sql_base));
  out = _corrigirGroupBySubstringIncompleto(out);
  return out;
}

function _corrigirGroupBySubstringIncompleto(sql) {
  return String(sql || '')
    .replace(
      /(\bGROUP\s+BY\s+SUBSTRING\s*\(\s*(?:base\s*\.\s*)?\[?[A-Za-z_][A-Za-z0-9_]*\]?\s*,\s*1\s*,\s*6)(\s+(?:UNION\b|HAVING\b|ORDER\b|$))/gi,
      '$1)$2',
    )
    .replace(
      /(\bGROUP\s+BY\s+CONVERT\s*\(\s*char\s*\(\s*6\s*\)\s*,\s*(?:base\s*\.\s*)?\[?[A-Za-z_][A-Za-z0-9_]*\]?\s*,\s*112)(\s+(?:UNION\b|HAVING\b|ORDER\b|$))/gi,
      '$1)$2',
    );
}

// A instrucao de prompt "sem periodo = mes atual" as vezes faz a IA resumir para competencia
// (SUBSTRING/CONVERT) mesmo quando o usuario nomeou explicitamente a coluna de data no
// agrupamento (ex: "agrupado por data de emissao"). Prompt e orientacao, nao garantia — esta
// correcao deterministica troca a expressao de competencia pela coluna de data completa
// quando a mensagem original nomeia explicitamente essa coluna, sem depender da IA obedecer.
const _PALAVRAS_DATA_COMPLETA = /\bdata\s+(de\s+)?(emiss[aã]o|documento|abertura|cadastro|movimento|lan[cç]amento)\b/i;

function _mencionaColunaDataExplicita(mensagem) {
  return _PALAVRAS_DATA_COMPLETA.test(String(mensagem || ''));
}

function _forcarDataCompletaNoAgrupamento(sql, campoDataSql, mensagem) {
  if (!campoDataSql || !_mencionaColunaDataExplicita(mensagem)) return sql;
  const campo = String(campoDataSql).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = String(sql || '');
  // SELECT ... SUBSTRING(campo, 1, 6) AS alias  -> SELECT ... campo AS alias
  out = out.replace(
    new RegExp(`SUBSTRING\\s*\\(\\s*(?:base\\s*\\.\\s*)?\\[?${campo}\\]?\\s*,\\s*1\\s*,\\s*6\\s*\\)(\\s+AS\\s+\\[?\\w+\\]?)?`, 'gi'),
    (match, asAlias) => `${campoDataSql}${asAlias || ''}`,
  );
  // SELECT ... CONVERT(char(7), campo, 120) AS alias -> SELECT ... campo AS alias
  out = out.replace(
    new RegExp(`CONVERT\\s*\\(\\s*char\\s*\\(\\s*7\\s*\\)\\s*,\\s*(?:base\\s*\\.\\s*)?\\[?${campo}\\]?\\s*,\\s*120\\s*\\)(\\s+AS\\s+\\[?\\w+\\]?)?`, 'gi'),
    (match, asAlias) => `${campoDataSql}${asAlias || ''}`,
  );
  // GROUP BY SUBSTRING(campo, 1, 6) -> GROUP BY campo
  out = out.replace(
    new RegExp(`SUBSTRING\\s*\\(\\s*(?:base\\s*\\.\\s*)?\\[?${campo}\\]?\\s*,\\s*1\\s*,\\s*6\\s*\\)`, 'gi'),
    campoDataSql,
  );
  // GROUP BY CONVERT(char(7), campo, 120) -> GROUP BY campo
  out = out.replace(
    new RegExp(`CONVERT\\s*\\(\\s*char\\s*\\(\\s*7\\s*\\)\\s*,\\s*(?:base\\s*\\.\\s*)?\\[?${campo}\\]?\\s*,\\s*120\\s*\\)`, 'gi'),
    campoDataSql,
  );
  return out;
}

function _posicaoFromPrincipal(sql, inicioBusca = 0) {
  const texto = String(sql || '');
  let aspas = null;
  let nivel = 0;
  for (let i = inicioBusca; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas) {
        if (aspas === "'" && texto[i + 1] === "'") {
          i++;
        } else {
          aspas = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      continue;
    }
    if (ch === '[') {
      aspas = ']';
      continue;
    }
    if (ch === '(') nivel++;
    else if (ch === ')' && nivel > 0) nivel--;
    else if (nivel === 0 && /\s/i.test(texto[i - 1] || ' ') && /^from\b/i.test(texto.slice(i))) {
      return i;
    }
  }
  return -1;
}

function _splitSelectItensComPosicao(selectList, offset = 0) {
  const texto = String(selectList || '');
  const itens = [];
  let aspas = null;
  let nivel = 0;
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas) {
        if (aspas === "'" && texto[i + 1] === "'") {
          i++;
        } else {
          aspas = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      continue;
    }
    if (ch === '[') {
      aspas = ']';
      continue;
    }
    if (ch === '(') nivel++;
    else if (ch === ')' && nivel > 0) nivel--;
    else if (ch === ',' && nivel === 0) {
      itens.push({ texto: texto.slice(inicio, i), inicio: offset + inicio, fim: offset + i });
      inicio = i + 1;
    }
  }
  itens.push({ texto: texto.slice(inicio), inicio: offset + inicio, fim: offset + texto.length });
  return itens;
}

function _selectPrincipal(sql) {
  const texto = String(sql || '');
  const semSet = texto.replace(/^\s*SET\s+ROWCOUNT\s+\d+\s*;\s*/i, '');
  const deslocamento = texto.length - semSet.length;
  const m = semSet.match(/\bSELECT\b/i);
  if (!m) return null;
  const selectInicio = deslocamento + m.index;
  const listaInicio = selectInicio + m[0].length;
  const fromInicio = _posicaoFromPrincipal(texto, listaInicio);
  if (fromInicio < 0) return null;
  return {
    listaInicio,
    fromInicio,
    lista: texto.slice(listaInicio, fromInicio),
    itens: _splitSelectItensComPosicao(texto.slice(listaInicio, fromInicio), listaInicio),
  };
}

function _aliasItemSelect(item) {
  const texto = String(item?.texto || '').trim();
  const as = texto.match(/\bAS\s+([\[\]`"A-Za-z_][\]\[`"A-Za-z0-9_]*)\s*$/i);
  if (as) return String(as[1] || '').replace(/^[\[`"]|[\]`"]$/g, '').trim();
  return null;
}

function _aplicarAliasNoItem(itemTexto, alias) {
  const alvo = String(alias || '').trim();
  if (!alvo) return itemTexto;
  const texto = String(itemTexto || '');
  if (/\bAS\s+[\[\]`"A-Za-z_][\]\[`"A-Za-z0-9_]*\s*$/i.test(texto)) {
    return texto.replace(/\bAS\s+[\[\]`"A-Za-z_][\]\[`"A-Za-z0-9_]*\s*$/i, `AS ${alvo}`);
  }
  return `${texto.replace(/\s+$/g, '')} AS ${alvo}`;
}

function _harmonizarAliasesComSqlModelo(sql, sqlModeloReferencia) {
  const modelo = _selectPrincipal(sqlModeloReferencia);
  const atual = _selectPrincipal(sql);
  if (!modelo || !atual || !/\bFROM\s+base\b/i.test(sql)) return sql;

  const aliasesModelo = modelo.itens.map(_aliasItemSelect);
  const aliasesAtuais = atual.itens.map(_aliasItemSelect);
  if (!aliasesModelo.length || aliasesModelo.length !== aliasesAtuais.length) return sql;
  if (aliasesModelo.some(alias => !alias) || aliasesAtuais.some(alias => !alias)) return sql;

  const alteracoes = [];
  for (let i = 0; i < atual.itens.length; i++) {
    if (aliasesModelo[i].toLowerCase() === aliasesAtuais[i].toLowerCase()) continue;
    const itemComAlias = _aplicarAliasNoItem(atual.itens[i].texto, aliasesModelo[i]);
    alteracoes.push({
      inicio: atual.itens[i].inicio,
      fim: atual.itens[i].fim,
      texto: atual.itens[i].fim === atual.fromInicio && !/\s$/.test(itemComAlias) ? `${itemComAlias} ` : itemComAlias,
    });
  }
  if (!alteracoes.length) return sql;

  let out = String(sql || '');
  for (const alt of alteracoes.reverse()) {
    out = `${out.slice(0, alt.inicio)}${alt.texto}${out.slice(alt.fim)}`;
  }
  return out;
}

function _acharClausulasTopLevel(sql, inicioBusca = 0) {
  const texto = String(sql || '');
  const achados = [];
  let aspas = null;
  let nivel = 0;
  for (let i = inicioBusca; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas) {
        if (aspas === "'" && texto[i + 1] === "'") {
          i++;
        } else {
          aspas = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      continue;
    }
    if (ch === '[') {
      aspas = ']';
      continue;
    }
    if (ch === '(') {
      nivel++;
      continue;
    }
    if (ch === ')' && nivel > 0) {
      nivel--;
      continue;
    }
    if (nivel !== 0 || !/\s/i.test(texto[i - 1] || ' ')) continue;
    const resto = texto.slice(i);
    const tipo = /^group\s+by\b/i.test(resto)
      ? 'group'
      : /^having\b/i.test(resto)
        ? 'having'
        : /^order\s+by\b/i.test(resto)
          ? 'order'
          : null;
    if (tipo) achados.push({ tipo, inicio: i });
  }
  return achados;
}

function _extrairClausulasExternas(sql) {
  const texto = String(sql || '').trim().replace(/;+\s*$/g, '');
  const select = _selectPrincipal(texto);
  if (!select) return null;
  const clausulas = _acharClausulasTopLevel(texto, select.fromInicio);
  const primeiraAposFrom = clausulas[0]?.inicio ?? texto.length;
  const partes = {
    select: texto.slice(select.listaInicio, select.fromInicio).trim(),
    fromWhere: texto.slice(select.fromInicio, primeiraAposFrom).trim(),
    group: '',
    having: '',
    order: '',
  };
  for (let i = 0; i < clausulas.length; i++) {
    const atual = clausulas[i];
    const fim = clausulas[i + 1]?.inicio ?? texto.length;
    partes[atual.tipo] = texto.slice(atual.inicio, fim).trim();
  }
  return partes;
}

function _traduzirTrechoSqlModeloParaBase(trecho, camposPermitidos = []) {
  const permitidos = new Set((camposPermitidos || []).map(c => _normalizarNomeColuna(c)).filter(Boolean));
  const camposUsados = new Set();
  let ok = true;
  let traduzido = String(trecho || '')
    .replace(/\[([A-Za-z0-9_]+)\]\s*\.\s*\[([A-Za-z0-9_]+)\]/g, (_m, _alias, campo) => {
      const normal = _normalizarNomeColuna(campo);
      if (!permitidos.has(normal)) ok = false;
      camposUsados.add(normal);
      return campo;
    })
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b/g, (_m, _alias, campo) => {
      const normal = _normalizarNomeColuna(campo);
      if (!permitidos.has(normal)) ok = false;
      camposUsados.add(normal);
      return campo;
    });
  traduzido = _normalizarSubstringTemporalTraduzido(traduzido, permitidos);

  if (/\b(SF2|SD2|SF1|SD1|SA1|SA3|SB1|SBM|SF4|CTT|ACY)\s*\./i.test(traduzido)) ok = false;
  return { ok, sql: traduzido, camposUsados: [...camposUsados] };
}

function _traduzirGroupBySqlModeloParaBase(trecho, camposPermitidos = []) {
  const texto = String(trecho || '').trim();
  if (!texto) return { ok: true, sql: '', camposUsados: [] };
  const m = texto.match(/^GROUP\s+BY\s+([\s\S]+)$/i);
  if (!m) return _traduzirTrechoSqlModeloParaBase(texto, camposPermitidos);

  const itens = _splitSelectItensComPosicao(m[1]);
  const traduzidos = [];
  const camposUsados = [];
  for (const item of itens) {
    const parte = String(item.texto || '').trim();
    if (!parte) continue;
    const traduzido = _traduzirTrechoSqlModeloParaBase(parte, camposPermitidos);
    if (!traduzido.ok) continue;
    traduzidos.push(traduzido.sql.trim());
    camposUsados.push(...traduzido.camposUsados);
  }

  if (!traduzidos.length) return { ok: false, sql: texto, camposUsados };
  return { ok: true, sql: `GROUP BY ${traduzidos.join(', ')}`, camposUsados };
}

function _campoPareceTemporal(nome) {
  return /(?:^|_)(?:EMISSAO|DTDIGIT|DATA|DT|VENCTO|VENC|BAIXA)$/i.test(String(nome || ''));
}

function _normalizarSubstringTemporalTraduzido(sql, permitidos) {
  return String(sql || '').replace(
    /\bSUBSTRING\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*1\s*,\s*([468])\s*\)/gi,
    (match, campo, tamanho) => {
      const normal = _normalizarNomeColuna(campo);
      if (!permitidos.has(normal) || !_campoPareceTemporal(normal)) return match;
      return `CONVERT(char(${tamanho}), ${campo}, 112)`;
    },
  );
}

function _temUnionTopLevel(sql = '') {
  const texto = String(sql || '');
  let aspas = null;
  let nivel = 0;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas) {
        if (aspas === "'" && texto[i + 1] === "'") i++;
        else aspas = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      continue;
    }
    if (ch === '[') {
      aspas = ']';
      continue;
    }
    if (ch === '(') {
      nivel++;
      continue;
    }
    if (ch === ')' && nivel > 0) {
      nivel--;
      continue;
    }
    if (nivel === 0 && /\bUNION\b/i.test(texto.slice(i, i + 12))) {
      const antes = i > 0 ? texto[i - 1] : ' ';
      const depois = texto[i + 5] || ' ';
      if (!/[A-Z0-9_]/i.test(antes) && !/[A-Z0-9_]/i.test(depois)) return true;
    }
  }
  return false;
}

function _prefixoSelectAtual(sql) {
  const texto = String(sql || '').trim();
  const m = texto.match(/^select\s+(top\s+\(?\d+\)?\s+)?/i);
  return m ? m[0].replace(/\s+$/g, ' ') : 'SELECT ';
}

function _aplicarEstruturaSqlModelo(sqlView, sqlModeloReferencia, camposPermitidos = []) {
  if (_temUnionTopLevel(sqlModeloReferencia)) {
    return { sql: sqlView, aplicado: false, motivo: 'modelo_union_nao_aplicado_dataset' };
  }
  const modelo = _extrairClausulasExternas(sqlModeloReferencia);
  const view = _extrairClausulasExternas(sqlView);
  if (!modelo || !view || !/\bfrom\s+base\b/i.test(view.fromWhere)) {
    return { sql: sqlView, aplicado: false, motivo: 'sem_modelo_ou_view_base' };
  }

  const selectTrad = _traduzirTrechoSqlModeloParaBase(modelo.select, camposPermitidos);
  const groupTrad = _traduzirGroupBySqlModeloParaBase(modelo.group, camposPermitidos);
  const havingTrad = _traduzirTrechoSqlModeloParaBase(modelo.having, camposPermitidos);
  const orderTrad = _traduzirTrechoSqlModeloParaBase(modelo.order, camposPermitidos);
  if (![selectTrad, groupTrad, havingTrad, orderTrad].every(p => p.ok)) {
    return { sql: sqlView, aplicado: false, motivo: 'campo_modelo_nao_existe_na_view' };
  }

  const prefixo = _prefixoSelectAtual(sqlView);
  const partes = [
    `${prefixo}${selectTrad.sql}`,
    view.fromWhere,
    groupTrad.sql,
    havingTrad.sql,
    orderTrad.sql,
  ].filter(Boolean);
  return { sql: partes.join('\n'), aplicado: true, motivo: null };
}

function _aplicarTop(sql, limite) {
  const n = Math.max(1, Math.min(Number(limite) || 1000, 10000));
  if (/\bOFFSET\b[\s\S]*\bFETCH\s+NEXT\b/i.test(sql)) return sql;
  const corrigido = String(sql || '').replace(/^select\s+top\s+(\(?\d+\)?)\s+distinct\b/i, 'SELECT DISTINCT TOP $1');
  if (corrigido !== String(sql || '')) return corrigido;
  if (/^select\s+(?:distinct\s+)?top\s+\(?\d+\)?\b/i.test(sql)) return sql;
  if (/^select\s+distinct\b/i.test(String(sql || '').trim())) {
    return String(sql || '').replace(/^select\s+distinct\b/i, `SELECT DISTINCT TOP ${n}`);
  }
  return String(sql || '').replace(/^select\b/i, `SELECT TOP ${n}`);
}

function _limiteTopPergunta(mensagem, intent = {}) {
  const limiteIntent = Number(intent?.limite);
  if (Number.isFinite(limiteIntent) && limiteIntent > 0 && limiteIntent <= 10000) return limiteIntent;

  const texto = String(mensagem || '');
  const quantidade = '(\\d{1,4}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte)';
  const m = texto.match(new RegExp(`\\b(?:top|maior(?:es)?|menor(?:es)?|primeir[oa]s?|ultim[oa]s?)\\s+${quantidade}\\b`, 'i'))
    || texto.match(new RegExp(`\\b${quantidade}\\s+(?:maior(?:es)?|menor(?:es)?|primeir[oa]s?|ultim[oa]s?|clientes?|produtos?|fornecedores?|vendedores?)\\b`, 'i'));
  if (!m) return null;
  const n = _numeroNatural(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
}

function _numeroNatural(valor) {
  if (/^\d+$/.test(String(valor))) return Number(valor);
  const mapa = {
    um: 1, uma: 1,
    dois: 2, duas: 2,
    tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
  };
  const key = String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');
  return mapa[key] || null;
}

function _aplicarTopPergunta(sql, mensagem, intent = {}) {
  const limite = _limiteTopPergunta(mensagem, intent);
  if (!limite) return sql;
  if (/\bOFFSET\b[\s\S]*\bFETCH\s+NEXT\b/i.test(sql)) return sql;
  const corrigido = String(sql || '').replace(/^select\s+top\s+(\(?\d+\)?)\s+distinct\b/i, 'SELECT DISTINCT TOP $1');
  const texto = corrigido;
  const trim = texto.trim();
  if (/^select\s+distinct\s+top\s+\(?\d+\)?\b/i.test(trim)) {
    return texto.replace(/^select\s+distinct\s+top\s+\(?\d+\)?\b/i, `SELECT DISTINCT TOP ${limite}`);
  }
  if (/^select\s+top\s+\(?\d+\)?\b/i.test(trim)) {
    return texto.replace(/^select\s+top\s+\(?\d+\)?\b/i, `SELECT TOP ${limite}`);
  }
  if (/^select\s+distinct\b/i.test(trim)) {
    return texto.replace(/^select\s+distinct\b/i, `SELECT DISTINCT TOP ${limite}`);
  }
  return texto.replace(/^select\b/i, `SELECT TOP ${limite}`);
}

function _periodoComDatas(periodo = {}) {
  const p = periodo && typeof periodo === 'object' ? periodo : {};
  const dataInicio = String(p.dataInicio || p.data_inicio || p.start || p.inicio || '').trim();
  const dataFim = String(p.dataFim || p.data_fim || p.end || p.fim || '').trim();
  if (!/^\d{8}$/.test(dataInicio) || !/^\d{8}$/.test(dataFim)) return null;
  return { ...p, dataInicio, dataFim };
}

function _textoComparativoContinuidade(texto = '') {
  return /\b(compare|comparar|comparativo|comparacao|versus|vs\.?|contra|crescimento|variacao|evolucao)\b/i
    .test(String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

function _periodosComparativosDataset(intent = {}, plano = {}) {
  const atual = _periodoComDatas(intent?.periodo) || _periodoComDatas(plano?.periodo);
  const declarados = Array.isArray(intent?.periodo?.periodos_comparativos)
    ? intent.periodo.periodos_comparativos.map(_periodoComDatas).filter(Boolean)
    : Array.isArray(plano?.periodo?.periodos_comparativos)
      ? plano.periodo.periodos_comparativos.map(_periodoComDatas).filter(Boolean)
      : [];
  if (declarados.length > 1) return declarados;
  const base = _periodoComDatas(intent?._contextoUsadoOrquestrador?.periodo)
    || _periodoComDatas(intent?._contextoUsadoOrquestrador?.contexto_usado?.periodo)
    || _periodoComDatas(intent?._historicoResumido?.[intent._historicoResumido.length - 1]?.periodo);
  if (!atual || !base || !_textoComparativoContinuidade(intent?._mensagemOriginal || intent?.intencao || '')) return [];
  if (base.dataInicio === atual.dataInicio && base.dataFim === atual.dataFim) return [atual];
  return [base, atual];
}

function _campoRe(campoData) {
  const campo = String(campoData || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `(?:base\\s*\\.\\s*)?\\[?${campo}\\]?`;
}

function _isoDeYyyymmdd(yyyymmdd) {
  const s = String(yyyymmdd || '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

function _sqlTemFiltroPeriodoDataset(sql, campoData, periodo) {
  const texto = String(sql || '');
  const p = _periodoComDatas(periodo);
  if (!p) return true;
  const campo = _campoRe(campoData);
  const ini = p.dataInicio;
  const fim = p.dataFim;
  const competencia = ini.slice(0, 6);
  const iniIso = _isoDeYyyymmdd(ini);
  const fimIso = _isoDeYyyymmdd(fim);
  const ano = ini.slice(0, 4);
  const mes = ini.slice(4, 6);
  const reBetween = new RegExp(`\\b${campo}\\s+BETWEEN\\s*'${ini}'\\s+AND\\s*'${fim}'`, 'i');
  // Colunas datetime reais (não-texto Protheus) — filtro pode vir em formato ISO YYYY-MM-DD,
  // com hora opcional (ex: '2026-08-01' ou '2026-08-01 00:00:00' / 'T00:00:00').
  const reBetweenIso = new RegExp(`\\b${campo}\\s+BETWEEN\\s*'${iniIso}[T ]?[^']*'\\s+AND\\s*'${fimIso}[T ]?[^']*'`, 'i');
  const reSubstr = new RegExp(`SUBSTRING\\s*\\(\\s*${campo}\\s*,\\s*1\\s*,\\s*6\\s*\\)\\s*=\\s*'${competencia}'`, 'i');
  const reConvert = new RegExp(`CONVERT\\s*\\(\\s*char\\s*\\(\\s*6\\s*\\)\\s*,\\s*${campo}\\s*,\\s*112\\s*\\)\\s*=\\s*'${competencia}'`, 'i');
  const reIn = new RegExp(`(?:SUBSTRING\\s*\\(\\s*${campo}\\s*,\\s*1\\s*,\\s*6\\s*\\)|CONVERT\\s*\\(\\s*char\\s*\\(\\s*6\\s*\\)\\s*,\\s*${campo}\\s*,\\s*112\\s*\\))\\s+IN\\s*\\([^)]*'${competencia}'`, 'i');
  // YEAR(campo) = AAAA AND MONTH(campo) = MM — alternativa sugerida pelo prompt para colunas datetime.
  const reYearMonth = new RegExp(`YEAR\\s*\\(\\s*${campo}\\s*\\)\\s*=\\s*${ano}\\b[\\s\\S]{0,60}?MONTH\\s*\\(\\s*${campo}\\s*\\)\\s*=\\s*${Number(mes)}\\b`, 'i');
  return reBetween.test(texto) || reBetweenIso.test(texto) || reSubstr.test(texto)
    || reConvert.test(texto) || reIn.test(texto) || reYearMonth.test(texto);
}

function _dividirUnionTopLevel(sql = '') {
  const texto = String(sql || '');
  const partes = [];
  let aspas = null;
  let nivel = 0;
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas) {
        if (aspas === "'" && texto[i + 1] === "'") i++;
        else aspas = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      continue;
    }
    if (ch === '[') {
      aspas = ']';
      continue;
    }
    if (ch === '(') {
      nivel++;
      continue;
    }
    if (ch === ')' && nivel > 0) {
      nivel--;
      continue;
    }
    if (nivel !== 0 || !/\bUNION\b/i.test(texto.slice(i, i + 12))) continue;
    const antes = i > 0 ? texto[i - 1] : ' ';
    const depois = texto[i + 5] || ' ';
    if (/[A-Z0-9_]/i.test(antes) || /[A-Z0-9_]/i.test(depois)) continue;
    partes.push(texto.slice(inicio, i));
    const m = texto.slice(i).match(/^UNION\s+ALL\b/i);
    i += (m ? m[0].length : 'UNION'.length) - 1;
    inicio = i + 1;
  }
  partes.push(texto.slice(inicio));
  return partes.map(p => p.trim()).filter(Boolean);
}

function _competenciasFiltradasNoTrecho(trecho = '', campoData) {
  const texto = String(trecho || '');
  const campo = _campoRe(campoData);
  const valores = new Set();
  const regexes = [
    new RegExp(`\\b${campo}\\s+BETWEEN\\s*'(\\d{8})'\\s+AND\\s*'(\\d{8})'`, 'gi'),
    new RegExp(`SUBSTRING\\s*\\(\\s*${campo}\\s*,\\s*1\\s*,\\s*6\\s*\\)\\s*=\\s*'(\\d{6})'`, 'gi'),
    new RegExp(`CONVERT\\s*\\(\\s*char\\s*\\(\\s*6\\s*\\)\\s*,\\s*${campo}\\s*,\\s*112\\s*\\)\\s*=\\s*'(\\d{6})'`, 'gi'),
  ];
  for (const re of regexes) {
    let m;
    while ((m = re.exec(texto)) !== null) {
      if (m[2]) {
        if (m[1].slice(0, 6) === m[2].slice(0, 6)) valores.add(m[1].slice(0, 6));
      } else {
        valores.add(m[1]);
      }
    }
  }
  const reIn = new RegExp(`(?:SUBSTRING\\s*\\(\\s*${campo}\\s*,\\s*1\\s*,\\s*6\\s*\\)|CONVERT\\s*\\(\\s*char\\s*\\(\\s*6\\s*\\)\\s*,\\s*${campo}\\s*,\\s*112\\s*\\))\\s+IN\\s*\\(([^)]*)\\)`, 'gi');
  let m;
  while ((m = reIn.exec(texto)) !== null) {
    for (const valor of String(m[1] || '').match(/'\d{6}'/g) || []) valores.add(valor.replace(/'/g, ''));
  }
  return valores;
}

function _validarCompetenciaLiteralDataset(sql, campoData) {
  const erros = [];
  for (const parte of _dividirUnionTopLevel(sql)) {
    const select = _selectPrincipal(parte);
    const selectTexto = select ? parte.slice(select.listaInicio, select.fromInicio) : '';
    const literais = [...selectTexto.matchAll(/'(\d{6})'\s+AS\s+(?:\[?competencia\]?|\[?periodo\]?)/gi)]
      .map(m => m[1]);
    if (!literais.length) continue;
    const filtradas = _competenciasFiltradasNoTrecho(parte, campoData);
    for (const comp of literais) {
      if (filtradas.size && !filtradas.has(comp)) {
        erros.push(`Competencia literal ${comp} nao corresponde ao filtro temporal em ${campoData} (${[...filtradas].join(', ')}).`);
      }
    }
  }
  return erros;
}

function _validarSintaxeBasicaSqlDataset(sql) {
  const texto = String(sql || '');
  const erros = [];
  let aspas = null;
  let nivel = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    if (aspas) {
      if (ch === aspas) {
        if (aspas === "'" && texto[i + 1] === "'") i += 1;
        else aspas = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      aspas = ch;
      continue;
    }
    if (ch === '[') {
      aspas = ']';
      continue;
    }
    if (ch === '(') {
      nivel += 1;
      continue;
    }
    if (ch === ')') {
      nivel -= 1;
      if (nivel < 0) {
        erros.push('SQL do dataset contem fechamento de parenteses sem abertura correspondente.');
        nivel = 0;
      }
    }
  }
  if (aspas) erros.push('SQL do dataset contem aspas ou delimitador sem fechamento.');
  if (nivel !== 0) erros.push('SQL do dataset contem parenteses sem fechamento.');

  const partes = _dividirUnionTopLevel(texto);
  if (!partes.length) erros.push('SQL do dataset nao contem SELECT valido.');
  for (const parte of partes) {
    if (!/^\s*SELECT\b/i.test(parte)) {
      erros.push('Cada bloco do UNION no dataset deve iniciar com SELECT.');
      break;
    }
    if (!/\bFROM\b/i.test(parte)) {
      erros.push('Cada bloco SELECT do dataset deve conter FROM.');
      break;
    }
  }

  return { ok: erros.length === 0, erros };
}

function _validarPeriodoDataset(sql, campoData, intent = {}, plano = {}, datasetEhProtheus = true) {
  const erros = [];
  // Fora do Protheus, so exige filtro de periodo no SQL quando o periodo veio de mencao
  // explicita do usuario (dataInicio/dataFim concretas) — nao forca filtro para um periodo
  // implicito que o proprio sistema nao deveria ter aplicado (ver _intentAiSqlDireto).
  if (!datasetEhProtheus && !_periodoComDatas(intent?.periodo) && !_periodoComDatas(plano?.periodo)) {
    return { ok: true, erros: [] };
  }
  const periodosComparativos = _periodosComparativosDataset(intent, plano);
  const periodos = periodosComparativos.length > 1
    ? periodosComparativos
    : [_periodoComDatas(intent?.periodo) || _periodoComDatas(plano?.periodo)].filter(Boolean);
  for (const periodo of periodos) {
    if (!_sqlTemFiltroPeriodoDataset(sql, campoData, periodo)) {
      erros.push(`O SQL do dataset deve filtrar ${campoData} no periodo ${periodo.dataInicio} a ${periodo.dataFim}.`);
    }
  }
  erros.push(..._validarCompetenciaLiteralDataset(sql, campoData));
  return { ok: erros.length === 0, erros };
}

function _intentFormatacaoDataset(intent = {}) {
  const invalidos = new Set(['valor', 'valores', 'quantidade', 'quantidades', 'qtd', 'total']);
  const clone = { ...(intent || {}) };
  const groupBy = Array.isArray(clone.group_by)
    ? clone.group_by
    : (clone.agrupar_por ? [clone.agrupar_por] : []);
  const limpo = groupBy
    .map(v => String(v || '').trim())
    .filter(v => v && !invalidos.has(v.toLowerCase()));
  clone.group_by = limpo;
  clone.agrupar_por = limpo[0] || null;
  return clone;
}

function _formatarRespostaDataset(rows, intent, mensagem, dataset = {}) {
  const camposDataset = _campos(dataset);
  const ehProtheus = String(dataset.erp || 'protheus').trim().toLowerCase() === 'protheus';

  // Sistemas fora do Protheus (ex: SoftExpert) não passam pelo formatador canonico: ele
  // desconhece os tipos documentados no dataset (aba Semantica > Campos) e assume por
  // padrao rotulo/formatacao de faturamento Protheus, o que produz respostas erradas
  // (ex: contagem de chamados formatada como "R$"). Usa direto o formatador generico
  // deste arquivo, que respeita o tipo cadastrado em cada campo do dataset.
  if (!ehProtheus) {
    try {
      return _formatarRespostaSemantica(rows, mensagem, camposDataset);
    } catch (_) {
      return responseFormatter.formatarAiSqlLocal(rows, _intentFormatacaoDataset(intent));
    }
  }

  try {
    const canonico = canonicalWhatsappFormat.renderSingle(rows, {
      contextoConsulta: mensagem,
      mensagem,
      nomeModulo: 'Faturamento',
    });
    if (canonico) return canonico;
  } catch (_) {
    // Mantem fallback abaixo.
  }
  try {
    return responseFormatter.formatarAiSqlLocal(rows, _intentFormatacaoDataset(intent));
  } catch (_) {
    return _formatarRespostaSemantica(rows, mensagem, camposDataset);
  }
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

// Busca o tipo documentado na grade de Campos Semanticos do dataset (aba Semantica > Campos).
// Prioriza sempre essa fonte sobre qualquer heuristica por nome de coluna, ja que e informacao
// que o proprio cadastrante do dataset validou (ex: sla_horas_chamado = metrica, nao moeda).
function _tipoCampoSemantico(col, camposDataset = []) {
  const alvo = String(col || '').trim().toLowerCase();
  if (!alvo) return null;
  const achado = (camposDataset || []).find(c => String(c.coluna || '').trim().toLowerCase() === alvo);
  return achado?.tipo || null;
}

function _ehMetrica(col, valor, camposDataset = []) {
  const tipoDoc = _tipoCampoSemantico(col, camposDataset);
  if (tipoDoc) return tipoDoc === 'metrica';
  const c = String(col || '').toLowerCase();
  if (/competencia|ano_mes|periodo|data|emissao|ano$|mes$|dia$|codigo|cod_|^id$|_id$/.test(c)) return false;
  if (/fatur|valor|receita|total|quant|qtd|dev|devolv|crescimento|variacao|media|preco/.test(c)) return true;
  return typeof valor === 'number';
}

function _label(col) {
  return String(col || '').replace(/_/g, ' ').toLowerCase();
}

function _formatarValor(col, valor, camposDataset = []) {
  if (/percent|perc|pct|%/i.test(col)) return `${_fmtNumero(valor)}%`;
  const tipoDoc = _tipoCampoSemantico(col, camposDataset);
  // Campo documentado como metrica no dataset: numero, nunca moeda, salvo indicacao explicita
  // de valor monetario no nome (heuristica so entra quando NAO ha documentacao do campo).
  if (tipoDoc === 'metrica') {
    return /valor|fatur|receita|preco/i.test(col) ? _fmtMoeda(valor) : _fmtNumero(valor);
  }
  return /quant|qtd/i.test(col) && !/valor/i.test(col) ? _fmtNumero(valor) : _fmtMoeda(valor);
}

function _formatarRespostaSemantica(rows, mensagem, camposDataset = []) {
  if (!rows || !rows.length) return 'Nenhum dado encontrado para sua consulta.';
  const first = rows[0] || {};
  const cols = Object.keys(first);
  const metricas = cols.filter(c => _ehMetrica(c, first[c], camposDataset));
  const dimensoes = cols.filter(c => !metricas.includes(c));

  if (rows.length === 1) {
    const r = rows[0];
    const linhasMetricas = metricas.map(c => `*${_label(c)}*: ${_formatarValor(c, r[c], camposDataset)}`);
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
      .map(c => `${_label(c)}: *${_formatarValor(c, r[c], camposDataset)}*`)
      .join('; ');
    return `${idx + 1}. *${titulo}*${mets ? ` — ${mets}` : ''}`;
  });

  const totalizadores = metricas.slice(0, 3).map(c => {
    const total = rows.reduce((s, r) => s + _num(r[c]), 0);
    return `*Total ${_label(c)}*: ${_formatarValor(c, total, camposDataset)}`;
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
        out.faturamento_total = valor;
        continue;
      }
      if (/^(quantidade|quantidade_total|total_quantidade)$/i.test(c)) {
        out.quantidade_total = valor;
        continue;
      }
      out[col] = valor;
    }
    return out;
  });
}

function _sqlBaseSeguro(dataset, entidadeSeguranca, campos) {
  if (!entidadeSeguranca) return dataset.sql_base;
  // Seguranca dinamica (papel generico, ex: SoftExpert) ja traz o nome da coluna resolvido
  // via seguranca_papeis_json do dataset — nao precisa da heuristica por regex Protheus.
  let campo = entidadeSeguranca.campo || null;
  if (!campo) {
    const ehCliente = entidadeSeguranca.tipo === 'cliente_fixo_seguranca';
    campo = ehCliente ? _campoCliente(campos) : _campoVendedor(campos);
  }
  if (!campo) return dataset.sql_base;
  const codigo = String(entidadeSeguranca.codigo || '').replace(/'/g, "''");
  return [
    'SELECT *',
    'FROM (',
    dataset.sql_base,
    ') AS _dataset_base',
    `WHERE ${_q(campo)} = '${codigo}'`,
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
  const campoData = _resolverCampoDataDataset(dataset, campos);
  const metricas = _metricas(campos);

  let entidadeSeguranca = null;
  const remetente = intent._remetente || null;
  // Seguranca por vendedor/cliente fixo e um conceito especifico do Protheus (RLS por
  // codigo de vendedor/cliente do ERP). Datasets de outros sistemas (ex: SoftExpert) nao tem
  // esse tipo de restricao — aplicar essa checagem la bloquearia qualquer usuario cadastrado
  // como vendedor Protheus mesmo perguntando sobre um sistema sem esse conceito.
  const datasetEhProtheus = String(dataset.erp || 'protheus').trim().toLowerCase() === 'protheus';
  if (remetente && datasetEhProtheus) {
    const resolucao = resolverVendedorFixoPorEmpresa(remetente, empresaId);
    if (resolucao.estado === 'nao_cadastrado') {
      return {
        tipo: 'erro',
        subtipo: 'nao_cadastrado',
        resposta_direta: 'Seu numero nao esta cadastrado como usuario ou gestor no IA Command. Para acessar dados de faturamento, solicite ao gestor do IA Command que configure seu perfil ERP.',
        sql_gerado: `-- erro: numero ${remetente} nao encontrado em whatsapp_allowed_numbers para empresa_id=${empresaId}`,
        duracao_ms: Date.now() - t0,
      };
    }
    // Nota: 'sem_codigo_vendedor' (erp_tipo='usuario' sem erp_id) NAO bloqueia aqui —
    // o numero pode ser um usuario que so tem codigo de cliente. Cai no else abaixo.
    if (resolucao.estado === 'vendedor') {
      entidadeSeguranca = { tipo: 'vendedor_fixo_seguranca', codigo: resolucao.codigo, nome: resolucao.nome };
      if (!_campoVendedor(campos)) {
        return {
          tipo: 'erro',
          subtipo: 'dataset_sem_campo_seguranca',
          resposta_direta: 'O dataset semantico de faturamento nao possui campo de vendedor para aplicar a seguranca do seu perfil.',
          sql_gerado: '-- erro: dataset sem campo VENDEDOR para seguranca',
          duracao_ms: Date.now() - t0,
        };
      }
    } else if (resolucao.estado === 'gestor') {
      // gestor: acesso total, sem checar cliente
    } else {
      // sem_restricao: pode ainda assim ser cliente com cod_cliente_erp cadastrado —
      // campo independente de erp_tipo, mesmo padrao do faturamento-ia-owner-spec.js.
      const resolucaoCliente = resolverClienteFixoPorEmpresa(remetente, empresaId);
      if (resolucaoCliente.estado === 'cliente') {
        entidadeSeguranca = { tipo: 'cliente_fixo_seguranca', codigo: resolucaoCliente.codigo, nome: resolucaoCliente.nome };
        if (!_campoCliente(campos)) {
          return {
            tipo: 'erro',
            subtipo: 'dataset_sem_campo_seguranca',
            resposta_direta: 'O dataset semantico de faturamento nao possui campo de cliente para aplicar a seguranca do seu perfil.',
            sql_gerado: '-- erro: dataset sem campo CLIENTE para seguranca',
            duracao_ms: Date.now() - t0,
          };
        }
      }
    }
  } else if (remetente && !datasetEhProtheus) {
    // Seguranca por papel dinamico (ex: SoftExpert): le papel + codigo_identidade de
    // whatsapp_numero_modulos e o mapa papel->coluna cadastrado no dataset
    // (seguranca_papeis_json, aba Seguranca em admin-datasets.html). Papel "gestor" libera
    // acesso total. Sem mapa cadastrado para o dataset, nao ha seguranca para aplicar —
    // apenas segue sem filtro (dataset ainda nao configurado, nao e motivo pra bloquear).
    let mapaPapeis = {};
    try { mapaPapeis = dataset.seguranca_papeis_json ? JSON.parse(dataset.seguranca_papeis_json) : {}; } catch (_) { mapaPapeis = {}; }

    if (Object.keys(mapaPapeis).length) {
      const erpDataset = String(dataset.erp || '').trim().toLowerCase();
      const resolucao = resolverIdentidadeDinamica(remetente, empresaId, erpDataset);
      if (resolucao.estado === 'nao_cadastrado') {
        return {
          tipo: 'erro',
          subtipo: 'nao_cadastrado',
          resposta_direta: 'Seu numero nao esta cadastrado com acesso a este modulo no IA Command. Solicite ao gestor do IA Command que libere seu perfil.',
          sql_gerado: `-- erro: numero ${remetente} sem modulo liberado para erp=${erpDataset} empresa_id=${empresaId}`,
          duracao_ms: Date.now() - t0,
        };
      }
      if (resolucao.estado === 'sem_papel' || resolucao.estado === 'sem_codigo') {
        return {
          tipo: 'erro',
          subtipo: 'papel_sem_codigo_seguranca',
          resposta_direta: 'Seu cadastro de acesso a este modulo esta incompleto (falta o papel ou o codigo de identidade). Solicite ao gestor do IA Command que complete seu cadastro nos Numeros WhatsApp.',
          sql_gerado: `-- erro: numero ${remetente} com papel/codigo incompleto para erp=${erpDataset}`,
          duracao_ms: Date.now() - t0,
        };
      }
      if (resolucao.estado === 'filtrado') {
        const coluna = mapaPapeis[resolucao.papel] || null;
        if (!coluna) {
          return {
            tipo: 'erro',
            subtipo: 'dataset_sem_campo_seguranca',
            resposta_direta: `O dataset nao tem uma coluna de seguranca cadastrada para o papel "${resolucao.papel}". Peca ao gestor do IA Command para configurar isso na aba Seguranca do dataset.`,
            sql_gerado: `-- erro: dataset sem coluna de seguranca para papel=${resolucao.papel}`,
            duracao_ms: Date.now() - t0,
          };
        }
        entidadeSeguranca = { tipo: 'papel_dinamico_seguranca', campo: coluna, codigo: resolucao.codigo, nome: resolucao.nome };
      }
      // estado 'gestor': acesso total, entidadeSeguranca permanece null (sem filtro)
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
    sqlModeloReferencia: intent._sqlCanonicoOriginal || intent._sql_canonico_original || null,
  });
  const camposPermitidos = campos.map(c => c.coluna);
  let plano = null;
  let sqlSelect = null;
  let estruturaModelo = { aplicado: false, motivo: 'nao_processado' };
  let validacao = { ok: false, erros: ['nao_processado'] };
  let retryErro = '';

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const userPrompt = _buildUserPrompt({
      mensagem,
      dataAtual: _dataAtual(),
      historico: intent._historicoResumido,
      estadoAnterior: {
        filtros: intent.filtros || {},
        agrupamentos: Array.isArray(intent.group_by) ? intent.group_by : (intent.agrupar_por ? [intent.agrupar_por] : []),
        // Fora do Protheus, um periodo sem datas concretas (ex: {tipo:'mes_atual'} implicito)
        // nao deve ser exposto no prompt: contradiz a instrucao de "nao filtrar por padrao"
        // (instrucaoFiltroMes) e leva a IA a inventar um BETWEEN que o usuario nao pediu.
        // Periodo com dataInicio/dataFim concretas (mencao explicita, inclusive de turno
        // anterior) e sempre preservado.
        periodo: (datasetEhProtheus || _periodoComDatas(intent.periodo)) ? (intent.periodo || null) : null,
      },
      entidadeSeguranca,
      contratoTemporal: _buildContratoTemporalDataset(intent, datasetEhProtheus),
      retryErro,
    });

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

    const sqlSelectOriginal = _aplicarTop(String(plano.sql || '').trim().replace(/;+\s*$/g, ''), intent.limite || dataset.limite_max || 1000);
    const sqlSanitizado = _sanitizarSqlSelectDataset(sqlSelectOriginal, dataset, campoData, camposPermitidos, mensagem, campos);
    estruturaModelo = _aplicarEstruturaSqlModelo(
      sqlSanitizado,
      intent._sqlCanonicoOriginal || intent._sql_canonico_original || null,
      camposPermitidos,
    );
    sqlSelect = _aplicarTopPergunta(estruturaModelo.sql, mensagem, intent);
    sqlSelect = _forcarDataCompletaNoAgrupamento(sqlSelect, campoData, mensagem);
    const validacaoSintaxe = _validarSintaxeBasicaSqlDataset(sqlSelect);
    const validacaoBase = _validarSelectBase(sqlSelect, camposPermitidos);
    const validacaoPeriodo = _validarPeriodoDataset(sqlSelect, campoData, intent, plano, datasetEhProtheus);
    // Defesa em profundidade: rejeita SQL que filtre vendedor/cliente por codigo diferente
    // do autenticado, mesmo dentro da query externa da IA (nao so o CTE base injetado pelo
    // sistema) — mesmo padrao estrutural usado no runner.js do IA-OWNER classico.
    let validacaoSeguranca = { ok: true, erros: [] };
    if (entidadeSeguranca) {
      const campoSeguranca = entidadeSeguranca.campo
        || (entidadeSeguranca.tipo === 'cliente_fixo_seguranca' ? _campoCliente(campos) : _campoVendedor(campos));
      if (campoSeguranca) {
        validacaoSeguranca = entitySqlGuard.validarExclusividadeVendedorSeguranca(sqlSelect, entidadeSeguranca, [campoSeguranca]);
      }
    }
    validacao = {
      ok: validacaoSintaxe.ok && validacaoBase.ok && validacaoPeriodo.ok && validacaoSeguranca.ok,
      erros: [...validacaoSintaxe.erros, ...validacaoBase.erros, ...validacaoPeriodo.erros, ...validacaoSeguranca.erros],
    };
    if (validacao.ok) break;
    retryErro = validacao.erros.join(' | ');
  }

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
    const conn = connectionFactory.carregarConexao(empresaId, { connectionId: dataset.connection_id || null });
    conn._pergunta = mensagem;
    conn._sender = intent._remetente || '';
    conn._modulo = dataset.nome || 'dataset_semantico';
    conn._operacao = intent.intencao || 'faturamento_dataset_semantico';
    conn._empresa_id = empresaId || '';
    conn._dataset_id = dataset.id || '';
    const rowsBrutas = await connectionFactory.executar(conn, sqlFinal, {});
    const rows = intent._escopoExecucao === 'whatsapp_all'
      ? _normalizarRowsMultiempresa(rowsBrutas)
      : rowsBrutas;
    const respostaFallback = _formatarRespostaDataset(rows, intent, mensagem, dataset);
    const periodoCanonico = _periodoComDatas(intent?._periodoCanonicoResolvido)
      || _periodoComDatas(intent?.periodo)
      || _periodoComDatas(plano?.periodo)
      || plano.periodo
      || null;
    return {
      tipo: 'sucesso_ai_sql',
      resposta_direta: responseFormatter.normalizarAgrupamentosPais(respostaFallback),
      rows: rows || [],
      sql_gerado: sqlFinal,
      periodo_resolvido: periodoCanonico,
      dataset_id: dataset.id,
      dataset_nome: dataset.nome,
      _sql_canonico: sqlFinal,
      _sql_canonico_origem: 'dataset_semantico',
      _periodoCanonicoResolvido: periodoCanonico,
      _ia_owner_plano: {
        ...plano,
        dataset_modelo_sql_aplicado: estruturaModelo.aplicado,
        dataset_modelo_sql_motivo: estruturaModelo.motivo,
      },
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
  formatarRespostaSemantica: _formatarRespostaSemantica,
  _test: {
    _validarSelectBase,
    _buildSystemPrompt,
    _campoVendedor,
    _sanitizarSqlSelectDataset,
    _resolverCampoDataDataset,
    _normalizarRowsMultiempresa,
    _harmonizarAliasesComSqlModelo,
    _aplicarEstruturaSqlModelo,
    _extrairClausulasExternas,
    _traduzirTrechoSqlModeloParaBase,
    _temUnionTopLevel,
    _corrigirGroupBySubstringIncompleto,
    _validarPeriodoDataset,
    _validarCompetenciaLiteralDataset,
    _validarSintaxeBasicaSqlDataset,
    _periodosComparativosDataset,
    _limiteTopPergunta,
    _aplicarTopPergunta,
  },
};
