'use strict';

const aiProviderClient = require('./ai-provider-client');
const connectionFactory = require('../providers/connection-factory');
const responseFormatter = require('./response-formatter');
const canonicalWhatsappFormat = require('./canonical-whatsapp-format');
const { resolverVendedorFixoPorEmpresa } = require('../totvs_protheus/guards/vendedor-seguranca');

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
  const instrucaoFiltroMes = dataTextoProtheus
    ? `- Quando a pergunta mencionar "do mes", "este mes", "mes atual" ou nao informar outro periodo, filtre ${campoDataSql} entre YYYYMM01 e YYYYMMDD final do mes. Exemplo: ${campoDataSql} BETWEEN '20260701' AND '20260731'.`
    : `- Quando a pergunta mencionar "do mes", "este mes", "mes atual" ou nao informar outro periodo, filtre pelo mes/ano da Data atual usando YEAR(${campoDataSql}) e MONTH(${campoDataSql}).`;
  const instrucaoAgrupamentoMes = dataTextoProtheus
    ? `- Para agrupamento mensal use SUBSTRING(${campoDataSql}, 1, 6) AS competencia e o mesmo SUBSTRING no GROUP BY.`
    : `- Para agrupamento mensal use CONVERT(char(7), ${campoDataSql}, 120) AS competencia ou YEAR(${campoDataSql})/MONTH(${campoDataSql}).`;
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
    return `- ${c.coluna} (${c.tipo || 'campo'}): ${c.descricao || c.coluna}.${sinonimos}`;
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

function _prefixoSelectAtual(sql) {
  const texto = String(sql || '').trim();
  const m = texto.match(/^select\s+(top\s+\(?\d+\)?\s+)?/i);
  return m ? m[0].replace(/\s+$/g, ' ') : 'SELECT ';
}

function _aplicarEstruturaSqlModelo(sqlView, sqlModeloReferencia, camposPermitidos = []) {
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
  const m = texto.match(/\b(?:top|maiores?|menores?|primeir[oa]s?|ultim[oa]s?)\s+(\d{1,4})\b/i)
    || texto.match(/\b(\d{1,4})\s+(?:maiores?|menores?|primeir[oa]s?|ultim[oa]s?)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
}

function _aplicarTopPergunta(sql, mensagem, intent = {}) {
  const limite = _limiteTopPergunta(mensagem, intent);
  if (!limite) return sql;
  if (/\bOFFSET\b[\s\S]*\bFETCH\s+NEXT\b/i.test(sql)) return sql;
  const corrigido = String(sql || '').replace(/^select\s+top\s+(\(?\d+\)?)\s+distinct\b/i, 'SELECT DISTINCT TOP $1');
  if (corrigido !== String(sql || '')) return corrigido;
  if (/^select\s+(?:distinct\s+)?top\s+\(?\d+\)?\b/i.test(String(sql || '').trim())) return sql;
  if (/^select\s+distinct\b/i.test(String(sql || '').trim())) {
    return String(sql || '').replace(/^select\s+distinct\b/i, `SELECT DISTINCT TOP ${limite}`);
  }
  return String(sql || '').replace(/^select\b/i, `SELECT TOP ${limite}`);
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

function _formatarRespostaDataset(rows, intent, mensagem) {
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
    return _formatarRespostaSemantica(rows, mensagem);
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
  const campoData = _resolverCampoDataDataset(dataset, campos);
  const metricas = _metricas(campos);

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
    sqlModeloReferencia: intent._sqlCanonicoOriginal || intent._sql_canonico_original || null,
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

  const camposPermitidos = campos.map(c => c.coluna);
  const sqlSelectOriginal = _aplicarTop(String(plano.sql || '').trim().replace(/;+\s*$/g, ''), intent.limite || dataset.limite_max || 1000);
  const sqlSanitizado = _sanitizarSqlSelectDataset(sqlSelectOriginal, dataset, campoData, camposPermitidos, mensagem, campos);
  const estruturaModelo = _aplicarEstruturaSqlModelo(
    sqlSanitizado,
    intent._sqlCanonicoOriginal || intent._sql_canonico_original || null,
    camposPermitidos,
  );
  const sqlSelect = _aplicarTopPergunta(estruturaModelo.sql, mensagem, intent);
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
    const respostaFallback = _formatarRespostaDataset(rows, intent, mensagem);
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
  },
};
