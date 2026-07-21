'use strict';

const connectionFactory = require('../providers/connection-factory');
const aiProviderClient  = require('../core/ai-provider-client');
const { _periodoAtualPorTextoSemAno } = require('../core/temporal-contract');
const { identificarPeriodoTexto, resolverPeriodo } = require('../../ai/period-resolver');
const aiSqlGeneration   = require('../core/ai-sql-generation');
const sx3SqlValidator   = require('../totvs_protheus/SX/sx3-sql-validator');
const sx2SqlNormalizer  = require('../totvs_protheus/SX/sx2-sql-normalizer');
const entitySqlGuard    = require('../totvs_protheus/guards/entity-sql-guard');
const responseFormatter = require('../core/response-formatter');

function baseTabelaSX2(nome) {
  return sx2SqlNormalizer.baseTabelaSX2(nome);
}

function inferirSufixoSX2(sx2, fallback) {
  if (fallback) return fallback;
  const sufixos = [...new Set(Object.keys(sx2 || {}).map(sx2SqlNormalizer.sufixoTabelaSX2).filter(Boolean))];
  return sufixos.length === 1 ? sufixos[0] : null;
}

function sufixosPorTabelaSX2(sx2) {
  const out = {};
  for (const tabela of Object.keys(sx2 || {})) {
    const base = baseTabelaSX2(tabela);
    const sufixo = sx2SqlNormalizer.sufixoTabelaSX2(tabela);
    if (base && sufixo) out[base] = sufixo;
  }
  return out;
}

function tabelaFisicaSX2(sx2, base) {
  const alvo = String(base || '').trim().toUpperCase();
  return Object.keys(sx2 || {}).find(n => baseTabelaSX2(n) === alvo) || null;
}

function escapeSqlLiteral(valor) {
  return String(valor || '').replace(/'/g, "''");
}

function limitarTexto(valor, max = 6000) {
  const texto = String(valor || '');
  return texto.length > max ? texto.slice(0, max) + '...' : texto;
}

function flagAtiva(valor) {
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(valor || '').toLowerCase());
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dataAtualServidor() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const MESES_CRONOLOGICOS = 'janeiro|jan|fevereiro|fev|marco|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez';

function mensagemTemPeriodoCronologicoAutonomo(mensagem) {
  const texto = normalizarTexto(mensagem).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  return new RegExp(`\\b(hoje|ontem|do dia|no dia|dia atual|dia anterior|mes atual|deste mes|este mes|no mes|do mes|mes passado|ano atual|deste ano|este ano|do ano|no ano|ano corrente|ano passado|semana passada|ultima semana|ultimo mes|ultimo ano|${MESES_CRONOLOGICOS})\\b`).test(texto);
}

function mensagemErro(contract, tipo) {
  const msgs = contract.mensagensErro || {};
  const fallback = {
    ia_indisponivel: 'Nao consigo processar sua consulta no momento. Tente novamente em breve.',
    sql_invalido:    'Tivemos uma inconsistencia ao interpretar sua consulta. Por favor, reformule a pergunta e tente novamente.',
    sem_resultado:   'Nao encontrei registros para essa consulta no periodo informado.',
    erro_erp:        'Nao consegui buscar essa informacao no sistema. Tente um periodo menor ou filtros mais especificos.',
    sem_conexao:     'Esta empresa nao possui uma conexao com o ERP configurada. Solicite ao administrador.',
  };
  return msgs[tipo] || fallback[tipo] || 'Nao consegui responder sua consulta agora. Tente novamente.';
}

function sqlDiagnostico(contract, { mensagem, userSql, respostaSql, erro, subtipo } = {}) {
  return [
    `-- SQL NAO GERADO (${contract.logPrefix || contract.nome || 'SystemPrompt'})`,
    `-- subtipo: ${subtipo || 'indefinido'}`,
    mensagem    ? `-- mensagem: ${limitarTexto(mensagem, 500)}` : null,
    erro        ? `-- erro: ${limitarTexto(erro, 1000)}` : null,
    userSql     ? `\n-- PROMPT SQL\n${limitarTexto(userSql, 4000)}` : null,
    respostaSql ? `\n-- RESPOSTA IA\n${limitarTexto(respostaSql, 2000)}` : null,
  ].filter(Boolean).join('\n');
}

function buildRetryUserPrompt(contract, sqlFailed, erroMsg, mensagem) {
  if (contract.schema && typeof contract.schema.buildSqlRetryUserPrompt === 'function') {
    return contract.schema.buildSqlRetryUserPrompt(sqlFailed, erroMsg, mensagem);
  }
  return [
    `A pergunta "${mensagem}" gerou o SQL abaixo, que retornou um erro do banco de dados.`,
    'Analise o erro, corrija o SQL e retorne APENAS o JSON { "sql": "..." }.',
    'Corrija somente o erro estrutural/sintatico apontado; nao altere logica de negocio, agrupamentos ou filtros.',
    '',
    'SQL com erro:',
    String(sqlFailed || ''),
    '',
    'Erro retornado:',
    String(erroMsg || ''),
    '',
    'Retorne APENAS { "sql": "..." }. Sem explicacoes, sem markdown.',
  ].join('\n');
}

function formatarFallback(contract, rows) {
  if (!rows || !rows.length) return mensagemErro(contract, 'sem_resultado');
  if (typeof contract.formatarFallback === 'function') return contract.formatarFallback(rows);
  const brl = v => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const linhas = rows.slice(0, 20).map((row, i) => {
    const partes = Object.entries(row)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => /valor|total|fat|receita|preco|custo|vlr/i.test(k) ? `${k}: *${brl(v)}*` : `${k}: ${v}`);
    return `${i + 1}. ${partes.join(' | ')}`;
  });
  return `*${contract.tituloResposta || contract.nome || 'Consulta'}*\n\n${linhas.join('\n')}`;
}

function extrairFilialDaMensagem(mensagem) {
  const m = String(mensagem || '').match(/\bfilial\s+([A-Z0-9]{1,10})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function filtroPorTipoEntidade(contract) {
  const mapa = {};
  for (const [campo, tipo] of Object.entries(contract.filtrosParaEntidades || {})) {
    if (tipo) mapa[String(tipo).toLowerCase()] = campo;
  }
  return mapa;
}

function entidadesNomeadasDosFiltros(contract, filtros = {}) {
  const out = [];
  const mapa = contract.filtrosParaEntidades || {};
  for (const [campo, tipo] of Object.entries(mapa)) {
    const valor = filtros?.[campo];
    const texto = typeof valor === 'string' && !/^\d+$/.test(valor.trim()) ? valor.trim() : '';
    if (texto) out.push({ texto, tipo_sugerido: tipo });
  }
  return out;
}

function filtrarEntidadesCitadasNaMensagemAtual(entidades = [], mensagem = '') {
  const textoMensagem = normalizarTexto(mensagem);
  if (!textoMensagem) return [];
  return (Array.isArray(entidades) ? entidades : []).filter(entidade => {
    const textoEntidade = normalizarTexto(entidade?.texto);
    return textoEntidade && textoMensagem.includes(textoEntidade);
  });
}

function entidadeCompativelComFiltros(contract, entidade, filtros = {}) {
  const chave = filtroPorTipoEntidade(contract)[String(entidade?.tipo || '').toLowerCase()];
  const filtro = chave ? filtros?.[chave] : null;
  if (!filtro) return true;
  const nomeEntidade = normalizarTexto(entidade?.nome || entidade?.texto || entidade?.descricao || '');
  if (!nomeEntidade) return false;
  const nomeFiltro = normalizarTexto(filtro);
  return nomeEntidade.includes(nomeFiltro) || nomeFiltro.includes(nomeEntidade);
}

function filtrarEntidadesCompativeisComFiltros(contract, entidades = [], filtros = {}) {
  return (Array.isArray(entidades) ? entidades : [])
    .filter(entidade => entidadeCompativelComFiltros(contract, entidade, filtros));
}

function dividirTermosEmpresa(valor) {
  if (Array.isArray(valor)) return valor.flatMap(dividirTermosEmpresa);
  return String(valor || '')
    .split(/[|,;]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function termosEmpresaMencionadaIntent(intent = {}) {
  const termos = [
    ...dividirTermosEmpresa(intent._empresasMencionadasTextos),
    ...dividirTermosEmpresa(intent._empresaMencionadaTexto),
    ...dividirTermosEmpresa(intent.filtros?.empresa),
    ...dividirTermosEmpresa(intent._filtroEntidadeExplicitaMensagem?.empresa),
  ];
  const vistos = new Set();
  return termos.filter(termo => {
    const chave = normalizarTexto(termo);
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function textoPareceEmpresaMencionada(valor, intent = {}) {
  const alvos = termosEmpresaMencionadaIntent(intent);
  const texto = normalizarTexto(valor || '');
  if (!texto) return false;
  return alvos.some(alvoBruto => {
    const alvo = normalizarTexto(alvoBruto || '');
    if (!alvo) return false;
    return texto === alvo || texto.includes(alvo) || alvo.includes(texto);
  });
}

function removerEntidadeEmpresaMencionada(contract, intent = {}, fase1 = {}) {
  const termosEmpresa = termosEmpresaMencionadaIntent(intent);
  if (!termosEmpresa.length) return { intent, fase1, removidas: [] };
  const removidas = [];
  const entidades = (Array.isArray(fase1.entidades_nomeadas) ? fase1.entidades_nomeadas : []).filter(entidade => {
    const texto = entidade?.texto || entidade?.nome || '';
    const remover = textoPareceEmpresaMencionada(texto, intent);
    if (remover) removidas.push(texto);
    return !remover;
  });

  const filtros = { ...(intent.filtros || {}) };
  const explicitas = { ...(intent._filtroEntidadeExplicitaMensagem || {}) };
  const entidadesResolvidas = (Array.isArray(intent._entidadesResolvidas) ? intent._entidadesResolvidas : []).filter(entidade => {
    const texto = entidade?.nome || entidade?.texto || entidade?.descricao || '';
    const remover = textoPareceEmpresaMencionada(texto, intent);
    if (remover) removidas.push(texto);
    return !remover;
  });
  const entidadesResolvidasPorEmpresa = intent._entidadesResolvidasPorEmpresa && typeof intent._entidadesResolvidasPorEmpresa === 'object'
    ? Object.fromEntries(Object.entries(intent._entidadesResolvidasPorEmpresa).map(([empresaId, lista]) => [
        empresaId,
        (Array.isArray(lista) ? lista : []).filter(entidade => {
          const texto = entidade?.nome || entidade?.texto || entidade?.descricao || '';
          const remover = textoPareceEmpresaMencionada(texto, intent);
          if (remover) removidas.push(texto);
          return !remover;
        }),
      ]))
    : intent._entidadesResolvidasPorEmpresa;
  for (const campo of Object.keys(contract.filtrosParaEntidades || {})) {
    if (typeof filtros[campo] === 'string' && textoPareceEmpresaMencionada(filtros[campo], intent)) {
      removidas.push(filtros[campo]);
      delete filtros[campo];
      delete explicitas[campo];
    }
  }
  if (typeof filtros.empresa === 'string' && textoPareceEmpresaMencionada(filtros.empresa, intent)) {
    removidas.push(filtros.empresa);
    delete filtros.empresa;
    delete explicitas.empresa;
  }

  return {
    intent: {
      ...intent,
      filtros,
      _entidadesResolvidas: entidadesResolvidas,
      _entidadesResolvidasPorEmpresa: entidadesResolvidasPorEmpresa,
      _empresaMencionadaTexto: intent._empresaMencionadaTexto || termosEmpresa.join(' | '),
      _empresasMencionadasTextos: Array.isArray(intent._empresasMencionadasTextos) && intent._empresasMencionadasTextos.length
        ? intent._empresasMencionadasTextos
        : termosEmpresa,
      _filtroEntidadeExplicitaMensagem: Object.keys(explicitas).length ? explicitas : undefined,
    },
    fase1: { ...fase1, entidades_nomeadas: entidades },
    removidas: [...new Set(removidas.filter(Boolean))],
  };
}

function sincronizarFiltrosComEntidadesFase1(contract, intent = {}, fase1 = {}) {
  const filtros = { ...(intent.filtros || {}) };
  const explicitas = { ...(intent._filtroEntidadeExplicitaMensagem || {}) };
  const mapa = filtroPorTipoEntidade(contract);
  let alterou = false;

  for (const entidade of Array.isArray(fase1.entidades_nomeadas) ? fase1.entidades_nomeadas : []) {
    const chave = mapa[String(entidade?.tipo_sugerido || '').toLowerCase()];
    const texto = typeof entidade?.texto === 'string' ? entidade.texto.trim() : '';
    if (!chave || !texto) continue;
    const atual = typeof filtros[chave] === 'string' ? filtros[chave].trim() : '';
    if (!atual || normalizarTexto(atual) !== normalizarTexto(texto)) {
      filtros[chave] = texto;
      explicitas[chave] = texto;
      alterou = true;
    }
  }

  if (!alterou) return { intent, alterou: false };
  return {
    intent: {
      ...intent,
      filtros,
      _filtroEntidadeExplicitaMensagem: explicitas,
    },
    alterou: true,
  };
}

function decidirEntidadesParaFase2(contract, intent = {}, fase1 = {}, entidadesDosFiltros = []) {
  const entidadesNomeadasFase1 = Array.isArray(fase1.entidades_nomeadas) ? fase1.entidades_nomeadas : [];
  const entidadeEscolhidaManualmente = Boolean(intent._entidadeEscolhidaManualmente
    && Array.isArray(intent._entidadesResolvidas)
    && intent._entidadesResolvidas.length);
  const entidadesPreResolvidasCompativeis = filtrarEntidadesCompativeisComFiltros(
    contract,
    intent._entidadesResolvidas,
    intent.filtros || {},
  );
  const filtroEntidadeExplicitoAtual = Boolean(intent._filtroEntidadeExplicitaMensagem);
  const podeReusarEntidadeCompativel = Boolean(!entidadeEscolhidaManualmente
    && entidadesPreResolvidasCompativeis.length
    && !filtroEntidadeExplicitoAtual);
  const lookupObrigatorioEntidadeAtual = Boolean(!entidadeEscolhidaManualmente
    && !podeReusarEntidadeCompativel
    && (entidadesDosFiltros.length || entidadesNomeadasFase1.length));
  const entidadesResolvidas = entidadeEscolhidaManualmente
    ? intent._entidadesResolvidas
    : podeReusarEntidadeCompativel
      ? entidadesPreResolvidasCompativeis
      : lookupObrigatorioEntidadeAtual
        ? []
        : entidadesPreResolvidasCompativeis;

  return {
    entidadeEscolhidaManualmente,
    entidadesPreResolvidasCompativeis,
    filtroEntidadeExplicitoAtual,
    podeReusarEntidadeCompativel,
    lookupObrigatorioEntidadeAtual,
    entidadesResolvidas,
  };
}

function normalizarFiliaisDescobertas(rows = [], campos = []) {
  return [...new Set((rows || [])
    .map(row => {
      for (const campo of campos) {
        const valor = row[campo];
        if (valor != null && String(valor).trim()) return String(valor).trim();
      }
      return '';
    })
    .filter(Boolean))].slice(0, 3);
}

function resolverDatasLocais(periodo) {
  if (periodo?.dataInicio && periodo?.dataFim) return periodo;
  if (!periodo || periodo.tipo === 'nenhum') return periodo;
  const hoje = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const ymd  = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const ano  = hoje.getFullYear();
  const mes  = hoje.getMonth();
  const trimIni = Math.floor(mes / 3) * 3;
  switch (String(periodo?.tipo || 'mes_atual')) {
    case 'mes_atual':       return { ...periodo, dataInicio: ymd(new Date(ano, mes, 1)), dataFim: ymd(new Date(ano, mes + 1, 0)) };
    case 'mes_anterior':    return { ...periodo, dataInicio: ymd(new Date(ano, mes - 1, 1)), dataFim: ymd(new Date(ano, mes, 0)) };
    case 'ano_atual':
    case 'ano':             return { ...periodo, dataInicio: `${ano}0101`, dataFim: `${ano}1231` };
    case 'ano_anterior':    return { ...periodo, dataInicio: `${ano - 1}0101`, dataFim: `${ano - 1}1231` };
    case 'trimestre_atual': return { ...periodo, dataInicio: ymd(new Date(ano, trimIni, 1)), dataFim: ymd(new Date(ano, trimIni + 3, 0)) };
    case 'hoje':            { const d = ymd(hoje); return { ...periodo, dataInicio: d, dataFim: d }; }
    default:                return periodo;
  }
}

function configProtheus(empresaId) {
  try {
    const { getDB } = require('../../database');
    const db = getDB();
    let row = db.prepare('SELECT id, configuracoes FROM connections WHERE empresa_id = ? AND ativo = 1 LIMIT 1').get(empresaId);
    if (!row) {
      const sx2Row = db.prepare('SELECT connection_id FROM protheus_sx2 WHERE empresa_id = ? LIMIT 1').get(empresaId);
      if (sx2Row?.connection_id) {
        row = db.prepare('SELECT id, configuracoes FROM connections WHERE id = ? AND ativo = 1').get(sx2Row.connection_id);
      }
    }
    const cfg = row?.configuracoes ? JSON.parse(row.configuracoes) : {};
    return { conexaoId: row?.id || null, sufixoTabela: cfg.sufixo_tabela || '010', filialPadrao: cfg.filial_padrao || null };
  } catch (_) {
    return { conexaoId: null, sufixoTabela: '010', filialPadrao: null };
  }
}

function modosSX2(contract, conexaoId, empresaId) {
  if (!conexaoId) return null;
  try {
    const { getDB } = require('../../database');
    const rows = getDB().prepare('SELECT chave, arquivo, modo FROM protheus_sx2 WHERE connection_id = ? AND empresa_id = ?').all(conexaoId, empresaId);
    const tabelas = new Set(contract.tabelasSX2 || []);
    const mapa = {};
    for (const row of rows) {
      const arquivo = String(row.arquivo || row.chave || '').trim();
      if (arquivo && tabelas.has(baseTabelaSX2(arquivo))) mapa[arquivo] = row.modo;
    }
    return Object.keys(mapa).length ? mapa : null;
  } catch (_) {
    return null;
  }
}

function camposSX3(contract, conexaoId, empresaId) {
  if (!conexaoId) return null;
  try {
    const { getDB } = require('../../database');
    const rows = getDB().prepare(`
      SELECT tabela, campo, tipo, tamanho, decimal, titulo, descricao
      FROM protheus_sx3
      WHERE connection_id = ? AND empresa_id = ?
      ORDER BY tabela, ordem, campo
    `).all(conexaoId, empresaId);
    const tabelas = new Set(contract.tabelasSX3 || contract.tabelasSX2 || []);
    const mapa = {};
    for (const row of rows) {
      const tabela = String(row.tabela || '').toUpperCase().trim();
      if (!tabelas.has(baseTabelaSX2(tabela))) continue;
      if (!mapa[tabela]) mapa[tabela] = [];
      mapa[tabela].push({
        campo: row.campo,
        tipo: row.tipo,
        tamanho: row.tamanho,
        decimal: row.decimal,
        descricao: row.titulo || row.descricao || '',
      });
    }
    return Object.keys(mapa).length ? mapa : null;
  } catch (_) {
    return null;
  }
}

function temTabelasExclusivas(contract, conexaoId, empresaId) {
  if (!conexaoId) return false;
  try {
    const { getDB } = require('../../database');
    const rows = getDB().prepare("SELECT chave, arquivo, modo FROM protheus_sx2 WHERE connection_id = ? AND empresa_id = ? AND modo = 'E'").all(conexaoId, empresaId);
    const tabelas = new Set(contract.tabelasSX2 || []);
    return rows.some(row => tabelas.has(baseTabelaSX2(row.arquivo || row.chave)));
  } catch (_) {
    return false;
  }
}

async function descobrirFiliais(contract, empresaId, sx2, periodo) {
  if (typeof contract.descobrirFiliais === 'function') {
    return contract.descobrirFiliais({ empresaId, sx2, periodo, helpers: runnerHelpers });
  }

  const cfg = contract.descobertaFilial || {};
  const tabela = tabelaFisicaSX2(sx2, cfg.tabelaBase);
  if (!tabela || !cfg.campoFilial) return { status: 'indisponivel', filiais: [] };
  const ini = periodo?.dataInicio || periodo?.data_inicio;
  const fim = periodo?.dataFim || periodo?.data_fim;
  const where = ["D_E_L_E_T_ = ' '", `${cfg.campoFilial} IS NOT NULL`, `LTRIM(RTRIM(${cfg.campoFilial})) <> ''`];
  if (cfg.campoData && ini && fim) where.push(`${cfg.campoData} BETWEEN '${escapeSqlLiteral(ini)}' AND '${escapeSqlLiteral(fim)}'`);
  const sql = `SET ROWCOUNT 3;\nSELECT DISTINCT ${cfg.campoFilial} AS filial\nFROM ${tabela}\nWHERE ${where.join('\n  AND ')}\nORDER BY ${cfg.campoFilial};`;
  try {
    const conn = connectionFactory.carregarConexao(empresaId);
    conn._empresa_id = empresaId      || '';
    conn._modulo     = contract?.nome || '';
    conn._operacao   = 'descoberta_filial';
    conn._pergunta   = '';
    conn._sender     = '';
    const rows = await connectionFactory.executar(conn, sql, {});
    return { status: 'ok', filiais: normalizarFiliaisDescobertas(rows, ['filial', 'FILIAL', cfg.campoFilial]), sql };
  } catch (e) {
    return { status: 'erro', filiais: [], erro: e.message, sql };
  }
}

function extrairSQL(resposta) {
  if (!resposta) return null;
  if (typeof resposta === 'object' && resposta.sql) return resposta.sql;
  const texto = String(resposta).trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(texto);
    return obj.sql || null;
  } catch (_) {}
  const m = texto.match(/SET\s+ROWCOUNT[\s\S]+/i);
  return m ? m[0].trim() : null;
}

function _extrairDecisaoContexto(respostaSql) {
  if (!respostaSql) return null;
  try {
    const obj = typeof respostaSql === 'object' ? respostaSql : JSON.parse(String(respostaSql));
    return obj?.decisao_contexto || null;
  } catch (_) {
    return null;
  }
}

function _zerarContextoIAAnterior(fase1) {
  return {
    ...fase1,
    periodo: null,
    periodo_mantido: false,
    agrupamentos_mantidos: false,
    agrupamentos: [],
    entidades_nomeadas: [],
  };
}

async function chamarIA(contract, keys, cfg, systemPrompt, userPrompt, opts = {}) {
  return aiProviderClient.chamarIA(keys, cfg, systemPrompt, userPrompt, {
    logPrefix: contract.logPrefix || contract.nome || 'SystemPrompt',
    temperature: 0.1,
    geminiCombinedPrompt: true,
    ...opts,
  });
}

async function fase1ClassificarPergunta(contract, keys, cfg, mensagem, historicoResumido, contextoIAAnterior, usageContext = {}) {
  const fallback = contract.phase1Fallback || {
    periodo: { tipo: 'mes_atual' },
    periodo_mantido: false,
    agrupamentos_mantidos: false,
    agrupamentos: [],
    entidades_nomeadas: [],
    tipo_consulta: contract.defaultTipoConsulta || 'geral',
  };

  const partes = [];
  if (contextoIAAnterior) {
    const p = contextoIAAnterior.periodo;
    const ini = p?.dataInicio || p?.data_inicio || '';
    const fim = p?.dataFim || p?.data_fim || '';
    const periodoStr = ini && fim ? `${ini} a ${fim}` : (p?.tipo || '');
    const agrupStr = (contextoIAAnterior.agrupamentos || []).join(', ') || 'nenhum';
    partes.push(
      'Estado anterior da consulta:\n' +
      `  - Periodo: ${periodoStr}\n` +
      `  - Agrupamentos ativos: [${agrupStr}]\n` +
      `  - Tipo de consulta: ${contextoIAAnterior.tipo_consulta || contract.defaultTipoConsulta || 'geral'}`
    );
  }
  partes.push(`Pergunta: ${mensagem}`);
  if (Array.isArray(historicoResumido) && historicoResumido.length) {
    partes.push(`Historico: ${historicoResumido.slice(-2).map(t => t.pergunta).join(' -> ')}`);
  }

  try {
    const rawText = await chamarIA(contract, keys, cfg, contract.phase1SystemPrompt, partes.join('\n\n'), {
      json: true,
      maxTokens: 400,
      empresaId: usageContext.empresaId || null,
      numeroWa: usageContext.numeroWa || null,
      canalId: usageContext.canalId || null,
      usageOrigem: 'systemprompt',
      usageOperacao: `${contract.nome || 'erp'}_fase1`,
    });
    let raw = null;
    if (rawText && typeof rawText === 'object') raw = rawText;
    else if (typeof rawText === 'string') {
      try {
        raw = JSON.parse(rawText);
      } catch (_) {
        const m = rawText.match(/\{[\s\S]*\}/);
        try { raw = m ? JSON.parse(m[0]) : null; } catch (_2) { raw = null; }
      }
    }
    if (!raw || typeof raw !== 'object') return { ...fallback };

    const tiposValidos = new Set(contract.tiposConsultaValidos || ['geral']);
    const periodoMantido = raw.periodo_mantido === true;
    const fase1 = {
      periodo: raw.periodo || fallback.periodo,
      periodo_mantido: periodoMantido,
      agrupamentos_mantidos: periodoMantido ? raw.agrupamentos_mantidos !== false : false,
      agrupamentos: Array.isArray(raw.agrupamentos) ? raw.agrupamentos : [],
      entidades_nomeadas: Array.isArray(raw.entidades_nomeadas)
        ? raw.entidades_nomeadas.filter(e => e && typeof e.texto === 'string' && e.texto.trim())
        : [],
      tipo_consulta: tiposValidos.has(raw.tipo_consulta) ? raw.tipo_consulta : (contract.defaultTipoConsulta || 'geral'),
    };
    if (raw.carteira && ['em_aberto', 'paga', 'todas'].includes(raw.carteira)) fase1.carteira = raw.carteira;
    if (typeof contract.normalizarFase1 === 'function') return contract.normalizarFase1(fase1, raw, fallback);
    return fase1;
  } catch (e) {
    console.warn(`[${contract.logPrefix}] Fase 1 falhou, usando fallback: ${e.message}`);
    return { ...fallback };
  }
}

function injetarEntidadesDosFiltros(contract, fase1, intent) {
  if (fase1.entidades_nomeadas.length) return;
  fase1.entidades_nomeadas.push(...entidadesNomeadasDosFiltros(contract, intent.filtros || {}));
  if (fase1.entidades_nomeadas.length) {
    console.log(`[${contract.logPrefix}] Entidades de intent.filtros injetadas na Fase 1: ${fase1.entidades_nomeadas.map(e => e.texto).join(', ')}`);
  }
}

function agrupamentosEfetivos(fase1, intent) {
  const agrupOrq = Array.isArray(intent._orquestradorContrato?.agrupamentos) && intent._orquestradorContrato.agrupamentos.length
    ? intent._orquestradorContrato.agrupamentos
    : Array.isArray(intent.group_by) && intent.group_by.length
      ? intent.group_by
      : intent.agrupar_por ? [String(intent.agrupar_por)] : [];
  return Array.isArray(fase1.agrupamentos) && fase1.agrupamentos.length ? fase1.agrupamentos : agrupOrq;
}

const _RE_SUPERLATIVO = /\b(o\s+maior|o\s+menor|o\s+melhor|o\s+pior|o\s+mais|o\s+menos|a\s+maior|a\s+menor|com\s+(?:maior|menor)|qual\s+o\s+(?:cliente|fornecedor|vendedor|produto|grupo|representante)\s+(?:com\s+)?(?:maior|menor)|qual\s+a\s+(?:cliente|fornecedor|vendedor|produto|grupo|representante)\s+(?:com\s+)?(?:maior|menor)|quem\s+(?:tem|teve|fez|possui)\s+o\s+(?:maior|menor)|qual\s+o\s+(?:maior|menor)|qual\s+a\s+(?:maior|menor))\b/i;

async function gerarSQL(contract, keys, cfg, mensagemIA, contexto) {
  const userSql = contract.schema.buildSqlUserPromptV2(mensagemIA, contexto);

  const msgOriginal = String(mensagemIA || '');
  const ehSuperlativo = _RE_SUPERLATIVO.test(msgOriginal);
  const avisoSuperlativo = ehSuperlativo
    ? '⚠️ SUPERLATIVO DETECTADO — REGRA ABSOLUTA: Use SELECT TOP 3 imediatamente após SELECT (ex: "SELECT TOP 3 ..."). NUNCA retorne todos os registros ordenados. SET ROWCOUNT continua como limite global; TOP N é o limite real.\n\n'
    : '';

  const geracaoSql = await aiSqlGeneration.gerarSqlComIaPrimaria({
    keys,
    cfg,
    chamarIA: (k, c, systemPrompt, userPrompt, opts) => chamarIA(contract, k, c, systemPrompt, userPrompt, {
      ...opts,
      empresaId: contexto.empresaId,
      numeroWa: contexto.numeroWa || null,
      canalId: contexto.canalId || null,
      usageOrigem: 'systemprompt',
      usageOperacao: `${contract.nome || 'erp'}_sql`,
    }),
    systemPrompt: contract.schema.buildSqlSystemPrompt(),
    userPrompt: avisoSuperlativo + userSql,
    extrairSQL,
    maxTokens: contract.sqlMaxTokens || 2500,
  });
  return { ...geracaoSql, userSql };
}

async function tentarCorrigirSqlComIA(contract, keys, cfg, sqlFailed, erroMsg, mensagem, middlewareCfg, processarFn) {
  try {
    const retryPrompt = buildRetryUserPrompt(contract, sqlFailed, erroMsg, mensagem);
    const resultado = await aiSqlGeneration.gerarSqlComIaPrimaria({
      keys,
      cfg,
      chamarIA: (k, c, systemPrompt, userPrompt, opts) => chamarIA(contract, k, c, systemPrompt, userPrompt, opts),
      systemPrompt: contract.schema.buildSqlSystemPrompt(),
      userPrompt: retryPrompt,
      extrairSQL,
      maxTokens: contract.sqlMaxTokens || 2500,
    });
    if (!resultado.ok || !resultado.sql) return null;
    const sqlCorrigido = entitySqlGuard.removerHintsNoLock(resultado.sql);
    const mw = processarFn(sqlCorrigido, middlewareCfg);
    if (mw.bloqueado) return null;
    return mw.sql_processado;
  } catch (e) {
    console.warn(`[${contract.logPrefix}] Auto-correcao IA falhou:`, e.message);
    return null;
  }
}

async function executar(contract, intent, empresaId) {
  const t0 = Date.now();
  if (typeof contract.garantirIntencao === 'function') contract.garantirIntencao(empresaId);

  const mensagem = intent._mensagemOriginal || intent.intencao || contract.defaultMessage || 'consulta';
  const mensagemAnterior = intent._mensagemOriginalAnterior || '';
  const ehRefinamento = mensagemAnterior && mensagem.trim().split(/\s+/).length <= 10 && mensagem !== mensagemAnterior;
  const mensagemIA = ehRefinamento ? `${mensagemAnterior}. Refinamento: ${mensagem}` : mensagem;

  const preflight = typeof contract.prepararExecucao === 'function'
    ? contract.prepararExecucao({ intent, empresaId, mensagem, mensagemIA, startedAt: t0, helpers: { ...runnerHelpers, sqlDiagnostico: args => sqlDiagnostico(contract, args), mensagemErro: tipo => mensagemErro(contract, tipo) } })
    : null;
  if (preflight?.retorno) return preflight.retorno;
  if (preflight?.intent) intent = preflight.intent;
  const extraExecucao = preflight?.extra || {};

  let keys, cfg;
  try {
    ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId));
  } catch (e) {
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(contract, 'ia_indisponivel'), sql_gerado: sqlDiagnostico(contract, { mensagem, erro: e.message, subtipo: 'falha_resolver_chaves' }), duracao_ms: Date.now() - t0 };
  }
  if (!Object.values(keys).some(Boolean)) {
    return { tipo: 'erro', subtipo: 'sem_chave', resposta_direta: mensagemErro(contract, 'ia_indisponivel'), sql_gerado: sqlDiagnostico(contract, { mensagem, erro: 'Nenhuma chave de IA configurada.', subtipo: 'sem_chave' }), duracao_ms: Date.now() - t0 };
  }

  const protheus = configProtheus(empresaId);
  const sqlMW = contract.sqlMiddleware;
  const middlewareCfg = sqlMW.carregarConfig(empresaId);
  const modeloDados = middlewareCfg.modelo_dados || 'TRADICIONAL';
  const campoFilial = middlewareCfg.campo_filial || null;
  const sx2 = modosSX2(contract, protheus.conexaoId, empresaId);
  const sx3 = camposSX3(contract, protheus.conexaoId, empresaId);
  const sx3ParaPrompt = typeof contract.filtrarSx3Prompt === 'function' ? contract.filtrarSx3Prompt(sx3) : sx3;
  const sx3Prompt = sx3SqlValidator.limitarCamposSX3ParaPrompt(sx3ParaPrompt, contract.sx3PromptLimit || 80);
  const sufixoTabela = inferirSufixoSX2(sx2, protheus.sufixoTabela);

  const filialDaMensagem = extrairFilialDaMensagem(mensagem);
  let filialUsada = filialDaMensagem || intent.filtros?.filial || protheus.filialPadrao || null;
  const historicoResumido = Array.isArray(intent._historicoResumido) && intent._historicoResumido.length ? intent._historicoResumido : null;
  const contextoIAAnterior = intent._contextoIAAnterior || null;

  const usageContext = {
    empresaId,
    numeroWa: intent._remetente || null,
    canalId: intent._channelId || intent._canalId || null,
  };
  // Se a empresa já foi resolvida como tenant antes da IA, informa explicitamente na mensagem
  // para que a Fase 1 não classifique o nome do tenant como entidade cadastral (cliente/fornecedor).
  const mensagemIAComTenant = intent._empresaMencionadaTexto
    ? `[Contexto: "${intent._empresaMencionadaTexto}" e o nome de uma empresa-tenant do sistema IAHub, nao e um cliente ou fornecedor cadastral — nao inclua como filtro de entidade]\n${mensagemIA}`
    : mensagemIA;
  let fase1 = await fase1ClassificarPergunta(contract, keys, cfg, mensagemIAComTenant, historicoResumido, contextoIAAnterior, usageContext);
  console.log(`[${contract.logPrefix}] Fase1: periodo=${fase1.periodo?.tipo} agrupamentos_mantidos=${fase1.agrupamentos_mantidos} agrupamentos=${JSON.stringify(fase1.agrupamentos)}`);
  if (contextoIAAnterior?.periodo && fase1.periodo_mantido) {
    console.log(`[${contract.logPrefix}] IA declarou periodo_mantido=true; usando periodo anterior: ${JSON.stringify(contextoIAAnterior.periodo)}`);
    fase1.periodo = contextoIAAnterior.periodo;
  }

  // PRIORIDADE 1: Detecção determinística sobre a mensagem atual (sempre vence quando detecta período).
  // Usa mensagem (atual) e não mensagemIA para evitar que contexto anterior de um refinamento
  // (ex: "ultimos 12 meses") contamine a detecção de período da pergunta atual ("nesse mês").
  let periodoResolvido;
  const _ptAtual = _periodoAtualPorTextoSemAno({ mensagem: mensagem, hoje: new Date() });
  if (_ptAtual?.dataInicio && _ptAtual?.dataFim) {
    periodoResolvido = _ptAtual;
    console.log(`[${contract.logPrefix}] Periodo detectado no texto (${_ptAtual.tipo}): ${_ptAtual.dataInicio}-${_ptAtual.dataFim}`);
  } else {
    // identificarPeriodoTexto captura relativos ("mes passado", "ultimos 12 meses", etc.)
    const _pdAtual = identificarPeriodoTexto(mensagem, { hoje: new Date() });
    if (_pdAtual && _pdAtual.tipo !== 'nenhum') {
      const _ddAtual = resolverPeriodo(_pdAtual, { hoje: new Date() });
      if (_ddAtual?.dataInicio && _ddAtual?.dataFim) {
        periodoResolvido = { ..._pdAtual, ..._ddAtual };
        console.log(`[${contract.logPrefix}] Periodo resolvido deterministicamente (${_pdAtual.tipo}): ${_ddAtual.dataInicio}-${_ddAtual.dataFim}`);
      }
    }
  }

  // PRIORIDADE 2: Período do orquestrador — só usado quando a mensagem atual não tem período explícito.
  const orcIni = intent.periodo?.dataInicio || intent.periodo?.data_inicio;
  const orcFim = intent.periodo?.dataFim || intent.periodo?.data_fim;
  const usarPeriodoOrquestrador = typeof contract.usarPeriodoOrquestrador === 'function'
    ? contract.usarPeriodoOrquestrador(intent.periodo || {})
    : (orcIni && orcFim && contract.periodoOrquestradorSempre !== false);
  if (!periodoResolvido?.dataInicio && orcIni && orcFim && usarPeriodoOrquestrador) {
    periodoResolvido = { ...(intent.periodo || {}), dataInicio: orcIni, dataFim: orcFim };
    console.log(`[${contract.logPrefix}] Periodo do orquestrador: ${orcIni}-${orcFim}`);
  }

  // PRIORIDADE 3: Fase 1 / herança multi-turn (fallback final).
  if (!periodoResolvido?.dataInicio) {
    periodoResolvido = resolverDatasLocais(fase1.periodo);
  }
  const periodoAutonomoMensagemAtual = mensagemTemPeriodoCronologicoAutonomo(mensagem);

  // Filial: usa o que veio da mensagem, filtros ou config. Sem filial explícita → TODAS.
  // O sistema nunca pergunta filial por iniciativa própria.
  if (!filialUsada) filialUsada = 'TODAS';

  const limpezaEmpresa = removerEntidadeEmpresaMencionada(contract, intent, fase1);
  let intentBaseEntidades = limpezaEmpresa.intent;
  fase1 = limpezaEmpresa.fase1;
  if (limpezaEmpresa.removidas.length) {
    console.log(`[${contract.logPrefix}] Termo de empresa removido da resolucao de entidades: ${limpezaEmpresa.removidas.join(', ')}`);
  }

  injetarEntidadesDosFiltros(contract, fase1, intentBaseEntidades);

  let intentEntidades = intentBaseEntidades;
  if (contract.sincronizarEntidadesFase1 !== false) {
    const entidadesCitadasNaMensagemAtual = filtrarEntidadesCitadasNaMensagemAtual(fase1.entidades_nomeadas, mensagem);
    const fase1ParaSincronizar = entidadesCitadasNaMensagemAtual.length
      ? { ...fase1, entidades_nomeadas: entidadesCitadasNaMensagemAtual }
      : { ...fase1, entidades_nomeadas: [] };
    const sincronizacao = sincronizarFiltrosComEntidadesFase1(contract, intentEntidades, fase1ParaSincronizar);
    intentEntidades = sincronizacao.intent;
    if (sincronizacao.alterou) {
      console.log(`[${contract.logPrefix}] Entidade da pergunta atual sobrescreveu filtro herdado: ${JSON.stringify(intentEntidades._filtroEntidadeExplicitaMensagem)}`);
    }
  }

  const entidadesDosFiltros = entidadesNomeadasDosFiltros(contract, intentEntidades.filtros || {});
  if (entidadesDosFiltros.length) {
    const tiposFiltro = new Set(entidadesDosFiltros.map(e => e.tipo_sugerido));
    fase1.entidades_nomeadas = [
      ...(fase1.entidades_nomeadas || []).filter(e => !tiposFiltro.has(e.tipo_sugerido)),
      ...entidadesDosFiltros,
    ];
    console.log(`[${contract.logPrefix}] Entidades de intent.filtros forcando lookup: ${entidadesDosFiltros.map(e => `${e.texto}(${e.tipo_sugerido})`).join(', ')}`);
  }

  const decisaoEntidades = decidirEntidadesParaFase2(contract, intentEntidades, fase1, entidadesDosFiltros);
  let entidadesResolvidas = decisaoEntidades.entidadesResolvidas;
  if (decisaoEntidades.entidadeEscolhidaManualmente) {
    console.log(`[${contract.logPrefix}] Entidade escolhida manualmente na desambiguacao; usando selecao sem novo lookup.`);
  } else if (decisaoEntidades.podeReusarEntidadeCompativel) {
    console.log(`[${contract.logPrefix}] Reusando entidade pre-resolvida compativel com filtro herdado.`);
  }
  if (decisaoEntidades.lookupObrigatorioEntidadeAtual && entidadesDosFiltros.length && Array.isArray(intent._entidadesResolvidas) && intent._entidadesResolvidas.length) {
    console.warn(`[${contract.logPrefix}] Entidade(s) pre-resolvida(s) ignorada(s): filtro textual atual exige novo lookup.`);
  } else if (decisaoEntidades.lookupObrigatorioEntidadeAtual && Array.isArray(intent._entidadesResolvidas) && intent._entidadesResolvidas.length) {
    console.warn(`[${contract.logPrefix}] Entidade(s) pre-resolvida(s) ignorada(s): entidade nomeada na pergunta atual exige novo lookup.`);
  } else if (Array.isArray(intent._entidadesResolvidas) && intent._entidadesResolvidas.length && entidadesResolvidas.length !== intent._entidadesResolvidas.length) {
    console.warn(`[${contract.logPrefix}] Entidade(s) pre-resolvida(s) descartada(s): filtro atual mudou; lookup sera refeito.`);
  }

  if (!entidadesResolvidas.length && fase1.entidades_nomeadas.length && typeof contract.resolverEntidades === 'function') {
    const fase2 = await contract.resolverEntidades({
      empresaId,
      sx2,
      fase1,
      periodo: periodoResolvido,
      filial: filialUsada,
      extra: extraExecucao,
      helpers: runnerHelpers,
    });
    if (fase2.status === 'ambigua') {
      return {
        tipo: 'pergunta_entidade',
        _intentPendente: intent,
        _opcoesEntidade: fase2.candidatos,
        resposta_direta: contract.formatarPerguntaAmbiguidade(fase2.texto, fase2.candidatos),
        sql_gerado: sqlDiagnostico(contract, { mensagem, erro: 'Aguardando desambiguacao.', subtipo: 'pergunta_entidade' }),
        duracao_ms: Date.now() - t0,
        _contextoIAAnterior: fase1,
      };
    }
    if (fase2.status === 'nao_encontrado') {
      const resposta = typeof contract.formatarEntidadeNaoEncontrada === 'function'
        ? contract.formatarEntidadeNaoEncontrada(fase2)
        : `Nao encontrei *${fase2.texto}* no cadastro do ERP. Verifique o nome e tente novamente.`;
      return {
        tipo: 'erro',
        subtipo: 'entidade_nao_encontrada',
        resposta_direta: resposta,
        sql_gerado: sqlDiagnostico(contract, { mensagem, erro: `Entidade nao encontrada: ${fase2.texto}`, subtipo: 'entidade_nao_encontrada' }),
        duracao_ms: Date.now() - t0,
        _contextoIAAnterior: fase1,
      };
    }
    entidadesResolvidas = fase2.entidades || [];
    if (contract.bloquearEntidadeNaoEncontrada && fase1.entidades_nomeadas.length && !entidadesResolvidas.length) {
      const nomes = fase1.entidades_nomeadas.map(e => `*${e.texto}*`).join(', ');
      return {
        tipo: 'entidade_nao_encontrada',
        resposta_direta: `Nao encontrei ${nomes} no cadastro do ERP. Verifique o nome e tente novamente, ou faca a consulta sem esse filtro.`,
        sql_gerado: sqlDiagnostico(contract, { mensagem, erro: `Fase2: entidade(s) ${nomes} nao encontrada(s).`, subtipo: 'entidade_nao_encontrada' }),
        duracao_ms: Date.now() - t0,
        _contextoIAAnterior: fase1,
      };
    }
  }

  const filtrosContexto = { ...(intentEntidades.filtros || {}) };
  if (typeof filtrosContexto.empresa === 'string' && textoPareceEmpresaMencionada(filtrosContexto.empresa, intent)) {
    delete filtrosContexto.empresa;
  }

  const contexto = {
    sufixoTabela,
    data_atual: dataAtualServidor(),
    periodo: periodoAutonomoMensagemAtual ? null : periodoResolvido,
    aviso_periodo_autonomo: periodoAutonomoMensagemAtual
      ? 'Mensagem atual contem termo cronologico relativo, isolado ou omisso de ano. Calcule o periodo somente pela mensagem atual e por data_atual; ignore periodos/contratos antigos.'
      : null,
    agrupamentos: agrupamentosEfetivos(fase1, intent),
    tipo_consulta: fase1.tipo_consulta,
    filtros: filtrosContexto,
    filial: filialUsada,
    filialPadrao: filialUsada,
    modeloDados,
    campoFilial,
    sx2,
    sufixosPorTabela: sufixosPorTabelaSX2(sx2),
    sx3: sx3Prompt,
    sx3Validacao: sx3,
    entidades: entidadesResolvidas,
    empresaMencionadaTexto: intent._empresaMencionadaTexto || null,
    empresasMencionadasTextos: Array.isArray(intent._empresasMencionadasTextos) ? intent._empresasMencionadasTextos : [],
    empresaMencionadaId: intent._empresaMencionadaId || null,
    empresasMencionadasIds: Array.isArray(intent._empresasMencionadasIds) ? intent._empresasMencionadasIds : [],
    numeroWa: intent._remetente || null,
    canalId: intent._channelId || intent._canalId || null,
    historicoResumido,
    contextoIA: {
      periodo: periodoAutonomoMensagemAtual ? null : periodoResolvido,
      agrupamentos: fase1.agrupamentos,
      tipo_consulta: fase1.tipo_consulta,
      carteira: fase1.carteira,
    },
    ...extraExecucao.contexto,
  };
  if (typeof contract.enriquecerContexto === 'function') contract.enriquecerContexto(contexto, { intent, fase1, extra: extraExecucao, helpers: runnerHelpers });

  let sqlCanonicoWhatsappAll = intent._escopoExecucao === 'whatsapp_all' && intent._usarSqlCanonicoWhatsappAll && intent._sqlCanonicoOriginal ? String(intent._sqlCanonicoOriginal || '').trim() : null;
  if (sqlCanonicoWhatsappAll) {
    if (fase1.entidades_nomeadas.length) {
      console.warn(`[${contract.logPrefix}] whatsapp_all_reuso invalidado: Fase 1 detectou entidade(s) [${fase1.entidades_nomeadas.map(e => e.texto).join(', ')}]. Forcando Fase 3.`);
      sqlCanonicoWhatsappAll = null;
    } else if (entidadesResolvidas.length) {
      const ausentesCanonical = entidadesResolvidas.filter(e => !entitySqlGuard.sqlTemFiltroEntidade(sqlCanonicoWhatsappAll, e));
      if (ausentesCanonical.length) {
        console.warn(`[${contract.logPrefix}] whatsapp_all_reuso invalidado: SQL canonico nao filtra ${ausentesCanonical.map(e => `${e.tipo}(${e.codigo})`).join(', ')}. Forcando Fase 3.`);
        sqlCanonicoWhatsappAll = null;
      }
    }
  }

  const sqlAuditoria = {
    handler: contract.handlerName || contract.nome,
    origem: sqlCanonicoWhatsappAll ? 'whatsapp_all_reuso' : 'ia',
    empresa_id: empresaId,
    empresa_origem: intentEntidades._sqlCanonicoEmpresaOrigem || empresaId,
    sql_canonico_recebido: sqlCanonicoWhatsappAll || null,
    sql_ia_bruto: null,
    sql_apos_sx3: null,
    sql_apos_sx2: null,
    sql_apos_parametros: null,
    sql_apos_contrato: null,
    sql_final_executado: null,
    parametros_entidade_aplicados: [],
    parametros_entidade_pendentes: [],
    fase1: {
      periodo: fase1.periodo,
      agrupamentos: fase1.agrupamentos,
      entidades_nomeadas: fase1.entidades_nomeadas,
      tipo_consulta: fase1.tipo_consulta,
      carteira: fase1.carteira,
    },
    contexto_ia_anterior_usado: !!contextoIAAnterior,
    prompt_system: contract.schema.buildSqlSystemPrompt(),
    prompt_user: null,
  };

  let sql = null, userSql = null, respostaSql = null;
  let contextoIAProximo = fase1;
  if (sqlCanonicoWhatsappAll) {
    sql = sqlCanonicoWhatsappAll;
    respostaSql = JSON.stringify({ sql: sqlCanonicoWhatsappAll, origem: 'sql_canonico_whatsapp_all' });
    userSql = contract.schema.buildSqlUserPromptV2(mensagemIA, contexto);
  } else {
    const geracaoSql = await gerarSQL(contract, keys, cfg, mensagemIA, contexto);
    ({ sql, respostaSql, userSql } = { sql: geracaoSql.sql, respostaSql: geracaoSql.respostaSql, userSql: geracaoSql.userSql });
    sqlAuditoria.prompt_user = userSql || null;
    sqlAuditoria.sql_ia_bruto = sql || null;
    if (!geracaoSql.ok) {
      const tipo = geracaoSql.subtipo === 'sql_nao_extraido' ? 'sql_invalido' : geracaoSql.subtipo === 'sem_chave' ? 'ia_indisponivel' : geracaoSql.subtipo;
      return { tipo: 'erro', subtipo: geracaoSql.subtipo, resposta_direta: mensagemErro(contract, tipo), sql_gerado: sqlDiagnostico(contract, { mensagem, userSql, respostaSql, erro: geracaoSql.erro?.message, subtipo: geracaoSql.subtipo }), duracao_ms: Date.now() - t0, _contextoIAAnterior: fase1 };
    }
    const decisao = _extrairDecisaoContexto(respostaSql);
    if (decisao === 'nova_consulta' || decisao === 'troca_assunto') {
      console.log(`[${contract.logPrefix}] decisao_contexto='${decisao}' — contexto anterior zerado para proximo turno.`);
      contextoIAProximo = _zerarContextoIAAnterior(fase1);
    }
  }

  if (sql && typeof contract.validarCorrigirSqlGerado === 'function') {
    const guard = await contract.validarCorrigirSqlGerado({
      sql,
      keys,
      cfg,
      mensagem: mensagemIA,
      entidadesResolvidas,
      fase1,
      contexto,
      userSql,
      respostaSql,
      helpers: {
        ...runnerHelpers,
        extrairSQL,
        chamarIA: (systemPrompt, userPrompt, opts) => chamarIA(contract, keys, cfg, systemPrompt, userPrompt, {
          ...opts,
          empresaId,
          numeroWa: intent._remetente || null,
          canalId: intent._channelId || intent._canalId || null,
          usageOrigem: 'systemprompt',
          usageOperacao: `${contract.nome || 'erp'}_validacao`,
        }),
        gerarSqlComIaPrimaria: aiSqlGeneration.gerarSqlComIaPrimaria,
        sqlDiagnostico: args => sqlDiagnostico(contract, args),
        mensagemErro: tipo => mensagemErro(contract, tipo),
      },
    });
    if (guard?.erro) {
      return { ...guard.erro, duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };
    }
    if (guard?.sql) sql = guard.sql;
    if (guard?.respostaSql) respostaSql = guard.respostaSql;
    if (guard?.sqlIaBruto) sqlAuditoria.sql_ia_bruto = guard.sqlIaBruto;
  }

  if (sql) { sql = sx3SqlValidator.normalizarReferenciasAliasSql(sql); sqlAuditoria.sql_apos_sx3 = sql; }
  if (sql) {
    sql = sx2SqlNormalizer.adaptarSqlCanonicoPorSX2(sql, sx2, { logPrefix: contract.logPrefix, sufixoFallback: sufixoTabela });
    sqlAuditoria.sql_apos_sx2 = sql;
  }
  if (sql && typeof contract.ajustarSqlAposSx2 === 'function') {
    const ajustado = contract.ajustarSqlAposSx2({ sql, fase1, entidadesResolvidas, contexto });
    if (typeof ajustado === 'string') sql = ajustado;
    else if (ajustado?.sql) sql = ajustado.sql;
  }
  if (sql && entidadesResolvidas.some(e => e._todos)) {
    const sqlSemLoja = entitySqlGuard.removerFiltrosLojaEntidadesTodas(sql, entidadesResolvidas);
    if (sqlSemLoja !== sql) {
      console.log(`[${contract.logPrefix}] Guardrail _todos: filtro(s) de loja removido(s) do SQL.`);
      sql = sqlSemLoja;
    }
  }
  if (sql) {
    const parametros = entitySqlGuard.aplicarParametrosEntidadesSql(sql, entidadesResolvidas);
    sqlAuditoria.parametros_entidade_aplicados = parametros.aplicados || [];
    sqlAuditoria.parametros_entidade_pendentes = parametros.pendentes || [];
    if (!parametros.ok) {
      return { tipo: 'erro', subtipo: 'sql_parametro_entidade_pendente', resposta_direta: mensagemErro(contract, 'sql_invalido'), sql_gerado: sqlDiagnostico(contract, { mensagem, userSql, respostaSql, erro: `Parametros de entidade pendentes: ${parametros.pendentes.map(p => p.placeholder).join(', ')}`, subtipo: 'sql_parametro_entidade_pendente' }), duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };
    }
    sql = parametros.sql;
    sqlAuditoria.sql_apos_parametros = sql;
  }
  if (sql && contract.sanitizarFiltrosFilialSX2 !== false) {
    sql = sx2SqlNormalizer.sanitizarFiltrosFilialSX2(sql, sx2, { filialSolicitada: Boolean(filialDaMensagem || intentEntidades.filtros?.filial), logPrefix: contract.logPrefix });
  }
  if (sql) sqlAuditoria.sql_apos_contrato = sql;

  const validacaoSX3 = sx3SqlValidator.validarCamposSqlContraSX3(sql, contexto.sx3Validacao || contexto.sx3);
  if (!validacaoSX3.ok) {
    console.warn(`[${contract.logPrefix}] SQL rejeitado por SX3:`, validacaoSX3.erros.join(' | '));
    return { tipo: 'erro', subtipo: 'contrato_sx3_invalido', resposta_direta: mensagemErro(contract, 'sql_invalido'), sql_gerado: sqlDiagnostico(contract, { mensagem, userSql, respostaSql, erro: `SQL rejeitado por SX3: ${validacaoSX3.erros.join(' | ')}`, subtipo: 'contrato_sx3_invalido' }), duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };
  }

  sql = entitySqlGuard.removerHintsNoLock(sql);
  if (Array.isArray(contract.dimensionLeftJoinBases) && contract.dimensionLeftJoinBases.length) {
    sql = entitySqlGuard.converterInnerParaLeftJoinDimensionais(sql, contract.dimensionLeftJoinBases);
  }
  const mw = sqlMW.processar(sql, middlewareCfg);
  if (mw.alertas?.length) console.warn(`[${contract.logPrefix}] Middleware alertas (empresa #${empresaId}):`, mw.alertas.join(' | '));
  if (mw.bloqueado) return { tipo: 'erro', subtipo: 'sql_bloqueado', resposta_direta: mensagemErro(contract, 'sql_invalido'), sql_gerado: sql, duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };

  const sqlFinal = mw.sql_processado;
  sqlAuditoria.sql_final_executado = sqlFinal;

  let rows;
  let sqlExecutado = sqlFinal;
  let escopoExecucao = null;
  const mockAtivo = typeof contract.mockAtivo === 'function' ? contract.mockAtivo(process.env) : false;
  if (mockAtivo) {
    rows = typeof contract.dadosMock === 'function' ? contract.dadosMock(contexto) : [];
    escopoExecucao = 'mock';
    console.warn(`[${contract.logPrefix}] Modo mock ativo (${rows.length} linha(s)).`);
  } else {
    try {
      const conn = connectionFactory.carregarConexao(empresaId);
      conn._pergunta    = mensagem;
      conn._sender      = intent._remetente || '';
      conn._modulo      = contract.nome     || '';
      conn._operacao    = intent.intencao   || '';
      conn._empresa_id  = empresaId         || '';
      escopoExecucao = conn.tipo === 'api_proxy' ? 'agente_local' : 'conexao_direta';
      rows = await connectionFactory.executar(conn, sqlFinal, {});
    } catch (e) {
      const semConexao = /nenhuma conex|no connection|connect/i.test(e.message);
      if (semConexao) {
        return { tipo: 'erro', subtipo: 'sem_conexao', resposta_direta: mensagemErro(contract, 'sem_conexao'), sql_gerado: `${sqlFinal}\n\n-- ERRO: ${limitarTexto(e.message, 1000)}`, duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };
      }
      console.warn(`[${contract.logPrefix}] Erro SQL no ERP; tentando auto-correcao pela IA: ${e.message.slice(0, 300)}`);
      const sqlCorrigido = await tentarCorrigirSqlComIA(contract, keys, cfg, sqlFinal, e.message, mensagem, middlewareCfg, sqlMW.processar);
      if (!sqlCorrigido) {
        return { tipo: 'erro', subtipo: 'erro_erp', resposta_direta: mensagemErro(contract, 'erro_erp'), sql_gerado: `${sqlFinal}\n\n-- ERRO: ${limitarTexto(e.message, 1000)}`, duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };
      }
      sqlExecutado = sqlCorrigido;
      sqlAuditoria.sql_final_executado = sqlCorrigido;
      try {
        const conn2 = connectionFactory.carregarConexao(empresaId);
        conn2._pergunta   = mensagem;
        conn2._sender     = intent._remetente || '';
        conn2._modulo     = contract.nome     || '';
        conn2._operacao   = intent.intencao   || '';
        conn2._empresa_id = empresaId         || '';
        escopoExecucao = conn2.tipo === 'api_proxy' ? 'agente_local' : 'conexao_direta';
        rows = await connectionFactory.executar(conn2, sqlCorrigido, {});
      } catch (e2) {
        return { tipo: 'erro', subtipo: 'erro_erp', resposta_direta: mensagemErro(contract, 'erro_erp'), sql_gerado: `${sqlCorrigido}\n\n-- ERRO (apos correcao IA): ${limitarTexto(e2.message, 1000)}`, duracao_ms: Date.now() - t0, _contextoIAAnterior: contextoIAProximo };
      }
    }
  }

  const retornoBase = {
    _escopoExecucao: escopoExecucao,
    _sql_canonico: sql,
    _sql_canonico_origem: sqlCanonicoWhatsappAll ? 'whatsapp_all_reuso' : 'ia',
    _sql_canonico_original: sqlCanonicoWhatsappAll || sql,
    _sql_canonico_empresa_origem: intentEntidades._sqlCanonicoEmpresaOrigem || empresaId,
    _sql_auditoria: sqlAuditoria,
    _entidadesResolvidas: entidadesResolvidas,
    _contextoIAAnterior: contextoIAProximo,
  };

  if (!rows || !rows.length) {
    return { tipo: 'sucesso_ai_sql', resposta_direta: mensagemErro(contract, 'sem_resultado'), rows: [], sql_gerado: sqlExecutado, ...retornoBase, duracao_ms: Date.now() - t0 };
  }

  let resposta;
  try {
    const textoDireto = typeof contract.schema.buildFormatDirect === 'function'
      ? contract.schema.buildFormatDirect(mensagem, rows, [])
      : null;
    if (textoDireto) {
      resposta = textoDireto;
    } else {
      resposta = await chamarIA(contract, keys, cfg, contract.schema.buildFormatSystemPrompt(), contract.schema.buildFormatUserPrompt(mensagem, rows, []), {
        json: false,
        maxTokens: 3000,
        empresaId,
        numeroWa: intent._remetente || null,
        canalId: intent._channelId || intent._canalId || null,
        usageOrigem: 'systemprompt',
        usageOperacao: `${contract.nome || 'erp'}_formatacao`,
      });
    }
  } catch (e) {
    console.warn(`[${contract.logPrefix}] IA de formatacao falhou, usando fallback:`, e.message);
    resposta = formatarFallback(contract, rows);
  }

  resposta = responseFormatter.normalizarAgrupamentosPais(resposta);
  return { tipo: 'sucesso_ai_sql', resposta_direta: resposta, rows, sql_gerado: sqlExecutado, ...retornoBase, mock_dados: mockAtivo, duracao_ms: Date.now() - t0 };
}

async function executarSqlDireto(contract, sqlCanonico, intent, empresaId) {
  const t0 = Date.now();
  const mensagem = intent._mensagemOriginal || intent.intencao || '';

  let keys, cfg;
  try {
    ({ keys, cfg } = await aiProviderClient.resolverKeysEOrdem(empresaId));
  } catch (_) {
    return { tipo: 'erro', subtipo: 'ia_indisponivel', resposta_direta: mensagemErro(contract, 'ia_indisponivel'), sql_gerado: sqlCanonico, duracao_ms: Date.now() - t0 };
  }

  const protheus = configProtheus(empresaId);
  const sx2 = modosSX2(contract, protheus.conexaoId, empresaId);
  const sufixoTabela = inferirSufixoSX2(sx2, protheus.sufixoTabela);
  let sql = sx2SqlNormalizer.adaptarSqlCanonicoPorSX2(sqlCanonico, sx2, { logPrefix: contract.chatLogPrefix || `${contract.logPrefix}-chat`, sufixoFallback: sufixoTabela });

  const entidadesResolvidasEmpresa = intent._entidadesResolvidasPorEmpresa?.[String(empresaId)];
  const entidadesResolvidas = Array.isArray(entidadesResolvidasEmpresa) && entidadesResolvidasEmpresa.length
    ? entidadesResolvidasEmpresa
    : Array.isArray(intent._entidadesResolvidas) ? intent._entidadesResolvidas : [];
  const parametros = entitySqlGuard.aplicarParametrosEntidadesSql(sql, entidadesResolvidas);
  if (!parametros.ok) {
    console.warn(`[${contract.chatLogPrefix || `${contract.logPrefix}-chat`}] SQL canonico com placeholder de entidade pendente: ${parametros.pendentes.map(p => p.placeholder).join(', ')}`);
    return {
      tipo: 'erro',
      subtipo: 'sql_parametro_entidade_pendente',
      resposta_direta: mensagemErro(contract, 'sql_invalido'),
      sql_gerado: sqlDiagnostico(contract, {
        mensagem,
        erro: `Parametros de entidade pendentes: ${parametros.pendentes.map(p => p.placeholder).join(', ')}`,
        subtipo: 'sql_parametro_entidade_pendente',
      }),
      duracao_ms: Date.now() - t0,
    };
  }
  if (parametros.aplicados.length) {
    console.log(`[${contract.chatLogPrefix || `${contract.logPrefix}-chat`}] Parametros de entidade aplicados no SQL canonico: ${parametros.aplicados.map(p => `${p.tipo}:${p.campo}`).join(', ')}`);
  }
  sql = parametros.sql;

  const middlewareCfg = contract.sqlMiddleware.carregarConfig(empresaId);
  const mw = contract.sqlMiddleware.processar(sql, middlewareCfg);
  if (mw.bloqueado) {
    return { tipo: 'erro', subtipo: 'sql_bloqueado', resposta_direta: mensagemErro(contract, 'sql_invalido'), sql_gerado: sql, duracao_ms: Date.now() - t0 };
  }
  const sqlFinal = mw.sql_processado;

  // Apenas erros de socket transitórios justificam retry. Timeout e falha de conexão ao agente
  // são problemas de rede/infra — não adianta tentar de novo e travar por mais 240s.
  const _erroAgenteTemporal = (msg) => /socket hang up|ECONNRESET/i.test(msg || '');
  let rows;
  for (let _tentativa = 1; _tentativa <= 2; _tentativa++) {
    try {
      if (_tentativa > 1) await new Promise(r => setTimeout(r, 2000));
      const conn = connectionFactory.carregarConexao(empresaId);
      conn._pergunta   = mensagem;
      conn._sender     = intent._remetente || '';
      conn._modulo     = contract.nome     || '';
      conn._operacao   = intent.intencao   || '';
      conn._empresa_id = empresaId         || '';
      rows = await connectionFactory.executar(conn, sqlFinal, {});
      break;
    } catch (e) {
      if (_tentativa < 2 && _erroAgenteTemporal(e.message)) continue;
      const semConexao = /nenhuma conex|no connection|connect/i.test(e.message);
      return {
        tipo: 'erro',
        subtipo: semConexao ? 'sem_conexao' : 'erro_erp',
        resposta_direta: mensagemErro(contract, semConexao ? 'sem_conexao' : 'erro_erp'),
        sql_gerado: `${sqlFinal}\n\n-- ERRO: ${limitarTexto(e.message, 500)}`,
        duracao_ms: Date.now() - t0,
      };
    }
  }

  if (!rows || !rows.length) {
    return { tipo: 'sucesso_ai_sql', resposta_direta: mensagemErro(contract, 'sem_resultado'), rows: [], sql_gerado: sqlFinal, _sql_canonico: sqlCanonico, _sql_canonico_origem: 'chat', _sql_canonico_original: sqlCanonico, _sql_canonico_empresa_origem: empresaId, duracao_ms: Date.now() - t0 };
  }

  const whatsappFormatter = require('../../ai/chat/whatsapp-formatter');
  let resposta;
  try {
    resposta = await whatsappFormatter.formatar(rows, mensagem, keys, cfg);
  } catch (e) {
    console.warn(`[${contract.chatLogPrefix || `${contract.logPrefix}-chat`}] Formatacao WhatsApp falhou:`, e.message);
    resposta = whatsappFormatter._formatarFallback(rows, mensagem);
  }

  return {
    tipo: 'sucesso_ai_sql',
    resposta_direta: resposta,
    rows,
    sql_gerado: sqlFinal,
    _sql_canonico: sqlCanonico,
    _sql_canonico_origem: 'chat',
    _sql_canonico_original: sqlCanonico,
    _sql_canonico_empresa_origem: empresaId,
    duracao_ms: Date.now() - t0,
  };
}

const runnerHelpers = {
  baseTabelaSX2,
  inferirSufixoSX2,
  tabelaFisicaSX2,
  escapeSqlLiteral,
  limitarTexto,
  flagAtiva,
  normalizarFiliaisDescobertas,
  connectionFactory,
};

module.exports = {
  executar,
  executarSqlDireto,
  helpers: runnerHelpers,
  _test: {
    entidadesNomeadasDosFiltros,
    decidirEntidadesParaFase2,
    sincronizarFiltrosComEntidadesFase1,
    removerEntidadeEmpresaMencionada,
    textoPareceEmpresaMencionada,
    mensagemTemPeriodoCronologicoAutonomo,
    sufixosPorTabelaSX2,
  },
};
