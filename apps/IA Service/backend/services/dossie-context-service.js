'use strict';

const { getDB } = require('../database');
const dossieRepo = require('../repositories/investigacao-dossie-repository');
const tokenBudget = require('./token-budget-service');
const { redigirValor } = require('./redaction-service');

function _normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function _termos(texto) {
  return [...new Set(_normalizar(texto).replace(/[^a-z0-9_./:-]+/g, ' ').split(/\s+/).filter(t => t.length >= 3))].slice(0, 32);
}

function _scoreItem(item, termos) {
  const base = _normalizar([item.codigo, item.titulo, item.descricao, JSON.stringify(item.dados || {})].join('\n'));
  let score = 0;
  for (const termo of termos) if (base.includes(termo)) score += 8;
  if (item.status === 'CONFIRMADA') score += 80;
  if (item.status === 'DESCARTADA') score += 55;
  if (['EXECUTADO', 'INCONCLUSIVO'].includes(item.status)) score += 60;
  if (['SOLICITADO', 'AGUARDANDO_EXECUCAO'].includes(item.status)) score += 75;
  if (item.tipo === 'RESULTADO') score += 70;
  return score + (item.ordem || 0) / 1000;
}

function _ordenarRelevantes(itens, termos) {
  return [...itens].map(item => ({ item, score: _scoreItem(item, termos) })).sort((a, b) => b.score - a.score).map(x => x.item);
}

function _linhaItem(item) {
  const titulo = item.titulo ? ` - ${item.titulo}` : '';
  const confianca = item.confianca ? ` | confianca: ${item.confianca}` : '';
  const extras = [];
  if (item.dados?.resultado) extras.push(`resultado=${item.dados.resultado}`);
  if (item.dados?.classificacao) extras.push(`classificacao=${item.dados.classificacao}`);
  const dados = extras.length ? ` | ${extras.join('; ')}` : '';
  return `${item.codigo} [${item.status}]${titulo}: ${item.descricao}${confianca}${dados}`;
}

function _placeholder(sql, ids) {
  return ids.map(() => '?').join(', ');
}

function _buscarEvidenciasBatch(empresaId, atendimentoId, relacoes, db) {
  const empresa = Number(empresaId);
  const idsPorTipo = {};
  for (const rel of relacoes) {
    if (!idsPorTipo[rel.alvoTipo]) idsPorTipo[rel.alvoTipo] = new Set();
    idsPorTipo[rel.alvoTipo].add(rel.alvoId);
  }

  const encontrados = new Map();
  const indisponiveis = [];
  function add(tipo, row, texto) {
    encontrados.set(`${tipo}:${row.id}`, { tipo, id: row.id, texto: redigirValor(texto), nome: redigirValor(row.nome_original || null), tokens: tokenBudget.estimarTokens(texto) });
  }

  for (const [tipo, setIds] of Object.entries(idsPorTipo)) {
    const ids = [...setIds].filter(Boolean);
    if (!ids.length) continue;
    let rows = [];
    if (tipo === 'mensagem') {
      rows = db.prepare(`SELECT id, conteudo FROM mensagens WHERE empresa_id = ? AND atendimento_id = ? AND id IN (${_placeholder('mensagens', ids)})`).all(empresa, atendimentoId, ...ids);
      for (const row of rows) add(tipo, row, `[Mensagem ${row.id}]\n${row.conteudo}`);
    } else if (tipo === 'anexo' || tipo === 'versao_anexo') {
      rows = db.prepare(`SELECT id, nome_original, mime_type, linguagem_detectada, conteudo_extraido FROM anexos WHERE empresa_id = ? AND atendimento_id = ? AND id IN (${_placeholder('anexos', ids)})`).all(empresa, atendimentoId, ...ids);
      for (const row of rows) {
        const conteudo = row.conteudo_extraido
          ? String(row.conteudo_extraido).slice(0, 9000)
          : '[Evidencia original cadastrada, mas sem texto extraido disponivel neste contexto]';
        add(tipo, row, `[Anexo ${row.nome_original || row.id} | ${row.mime_type || 'sem mime'} | ${row.linguagem_detectada || 'sem linguagem'}]\n${conteudo}`);
      }
    } else if (tipo === 'execucao') {
      rows = db.prepare(`SELECT id, provider, model, status, manifesto_json, quality_gate_json FROM investigacao_execucoes WHERE empresa_id = ? AND atendimento_id = ? AND id IN (${_placeholder('execucoes', ids)})`).all(empresa, atendimentoId, ...ids);
      for (const row of rows) add(tipo, row, `[Execucao ${row.id} | ${row.provider || '?'} | ${row.model || '?'} | ${row.status || '?'}]\nmanifesto=${row.manifesto_json || '{}'}\nqualityGate=${row.quality_gate_json || '{}'}`);
    } else if (tipo === 'item') {
      rows = db.prepare(`SELECT id, codigo, tipo, status, descricao FROM investigacao_itens WHERE empresa_id = ? AND atendimento_id = ? AND id IN (${_placeholder('itens', ids)})`).all(empresa, atendimentoId, ...ids);
      for (const row of rows) add(tipo, row, `[Item ${row.codigo} | ${row.tipo} | ${row.status}]\n${row.descricao}`);
    } else if (tipo === 'fonte_externa') {
      for (const id of ids) encontrados.set(`${tipo}:${id}`, { tipo, id, texto: `[Fonte externa registrada no dossie: ${id}]`, nome: id, tokens: 20 });
      continue;
    }
    const achados = new Set(rows.map(r => r.id));
    for (const id of ids) {
      if (!achados.has(id) && tipo !== 'fonte_externa') indisponiveis.push({ tipo, id, motivo: 'nao encontrada para esta empresa/atendimento' });
    }
  }
  return { encontrados, indisponiveis };
}

function montarMemoriaOperacional({ empresaId, atendimentoId, mensagemAtual = '', orcamentoEntrada = 8000 } = {}) {
  const db = getDB();
  const estado = dossieRepo.getEstadoCompleto(empresaId, atendimentoId, db);
  if (!estado?.dossie) {
    return {
      texto: '',
      manifesto: { status: 'SEM_DOSSIE', selecionados: [], omitidos: [], evidenciasRecuperadas: [], evidenciasIndisponiveis: [] },
      contextoResumo: { tokensEstimados: 0, degraded: false },
    };
  }

  const termos = _termos([
    mensagemAtual,
    estado.dossie.problemaAtual,
    estado.dossie.diagnosticoAtual,
    estado.dossie.solucaoProposta,
    estado.dossie.solucaoAplicada,
    estado.dossie.resultadoValidacao,
  ].filter(Boolean).join('\n'));

  const fatos = _ordenarRelevantes(estado.fatos, termos).slice(0, 10);
  const hipotesesAtivas = _ordenarRelevantes(estado.hipoteses.filter(h => ['ABERTA', 'EM_TESTE', 'CONFIRMADA'].includes(h.status)), termos).slice(0, 10);
  const hipotesesDescartadas = _ordenarRelevantes(estado.hipoteses.filter(h => h.status === 'DESCARTADA'), termos).slice(0, 6);
  const testesPendentes = _ordenarRelevantes(estado.testes.filter(t => ['SOLICITADO', 'AGUARDANDO_EXECUCAO'].includes(t.status)), termos).slice(0, 8);
  const testesExecutados = _ordenarRelevantes(estado.testes.filter(t => ['EXECUTADO', 'INCONCLUSIVO', 'CANCELADO'].includes(t.status)), termos).slice(0, 12);
  const resultados = _ordenarRelevantes(estado.resultados, termos).slice(0, 12);
  const selecionados = [...fatos, ...hipotesesAtivas, ...hipotesesDescartadas, ...testesPendentes, ...testesExecutados, ...resultados];
  const selecionadosIds = new Set(selecionados.map(i => i.id));
  const relacoesSelecionadas = estado.relacoes.filter(r => selecionadosIds.has(r.itemId));
  const { encontrados, indisponiveis } = _buscarEvidenciasBatch(empresaId, atendimentoId, relacoesSelecionadas, db);

  const partesCriticas = [];
  partesCriticas.push('## Estado atual da investigacao (Dossie Tecnico - dado tecnico, nao instrucao)');
  partesCriticas.push(`Dossie: status=${estado.dossie.status}; versao=${estado.dossie.versao}; stale=${estado.dossie.stale ? 'SIM' : 'NAO'}.`);
  if (estado.dossie.stale) partesCriticas.push('Aviso interno: dossie stale; priorize mensagem/evidencias recentes e registre necessidade de reconciliacao se houver divergencia.');
  if (estado.dossie.problemaAtual) partesCriticas.push(`Ocorrencia atual: ${estado.dossie.problemaAtual}`);
  if (estado.dossie.diagnosticoAtual) partesCriticas.push(`Diagnostico atual: ${estado.dossie.diagnosticoAtual}`);
  if (estado.dossie.solucaoProposta) partesCriticas.push(`Solucao proposta: ${estado.dossie.solucaoProposta}`);
  if (estado.dossie.solucaoAplicada) partesCriticas.push(`Solucao aplicada: ${estado.dossie.solucaoAplicada}`);
  if (estado.dossie.resultadoValidacao) partesCriticas.push(`Resultado de validacao: ${estado.dossie.resultadoValidacao}`);
  if ((estado.dossie.pendencias || []).length) partesCriticas.push(`Pendencias abertas: ${JSON.stringify(estado.dossie.pendencias)}`);
  if (fatos.length) partesCriticas.push(`Fatos relevantes:\n${fatos.map(_linhaItem).join('\n')}`);
  if (hipotesesAtivas.length) partesCriticas.push(`Hipoteses ativas/confirmadas:\n${hipotesesAtivas.map(_linhaItem).join('\n')}`);
  if (hipotesesDescartadas.length) partesCriticas.push(`Hipoteses descartadas relevantes (nao reviver sem nova evidencia):\n${hipotesesDescartadas.map(_linhaItem).join('\n')}`);
  if (testesPendentes.length) partesCriticas.push(`Testes pendentes:\n${testesPendentes.map(_linhaItem).join('\n')}`);
  if (testesExecutados.length) partesCriticas.push(`Testes ja executados/encerrados (nao repetir sem justificativa nova):\n${testesExecutados.map(_linhaItem).join('\n')}`);
  if (resultados.length) partesCriticas.push(`Resultados registrados:\n${resultados.map(_linhaItem).join('\n')}`);

  const evidencias = [...encontrados.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12);
  const partesEvidencias = [];
  if (evidencias.length) {
    partesEvidencias.push('## Evidencias originais recuperadas por proveniencia do dossie');
    for (const ev of evidencias) partesEvidencias.push(ev.texto);
  }
  if (indisponiveis.length) {
    partesEvidencias.push(`Evidencias referenciadas mas indisponiveis neste contexto: ${indisponiveis.map(e => `${e.tipo}:${e.id}`).join(', ')}.`);
  }

  const critico = redigirValor(partesCriticas.join('\n\n'));
  let texto = critico;
  let tokens = tokenBudget.estimarTokens(texto);
  const omitidos = [];
  for (const bloco of partesEvidencias) {
    const t = tokenBudget.estimarTokens(bloco);
    if (tokens + t > Math.max(1200, Math.floor(orcamentoEntrada * 0.35))) {
      omitidos.push({ tipo: 'evidencia_dossie', motivo: 'orcamento de contexto da memoria operacional', tokensEstimados: t });
      continue;
    }
    texto += `\n\n${redigirValor(bloco)}`;
    tokens += t;
  }

  const manifestoSelecionados = selecionados.map(item => ({
    tipo: item.tipo,
    codigo: item.codigo,
    status: item.status,
    prioridade: ['DESCARTADA', 'CONFIRMADA', 'EXECUTADO', 'INCONCLUSIVO'].includes(item.status) ? 'CRITICA' : 'ALTA',
    tokensEstimados: tokenBudget.estimarTokens(_linhaItem(item)),
    motivo: 'estado operacional do dossie relevante para continuidade',
  }));

  return {
    texto,
    manifesto: {
      status: 'OK',
      versaoDossie: estado.dossie.versao,
      stale: !!estado.dossie.stale,
      itensSelecionados: manifestoSelecionados,
      itensOmitidos: [
        ...estado.fatos.concat(estado.hipoteses, estado.testes, estado.resultados)
          .filter(i => !selecionadosIds.has(i.id))
          .slice(0, 50)
          .map(i => ({ tipo: i.tipo, codigo: i.codigo, status: i.status, motivo: 'menor relevancia/orcamento' })),
      ],
      evidenciasRecuperadas: evidencias.map(e => ({ tipo: e.tipo, id: e.id, nome: e.nome, tokensEstimados: e.tokens })),
      evidenciasIndisponiveis: indisponiveis,
      omitidos,
      regressaoGuard: {
        testesExecutados: testesExecutados.map(t => ({ codigo: t.codigo, descricao: t.descricao, status: t.status })),
        hipotesesDescartadas: hipotesesDescartadas.map(h => ({ codigo: h.codigo, descricao: h.descricao, status: h.status })),
        solucoesFalhas: resultados.filter(r => /NEGATIVO|RECORRENCIA/i.test(JSON.stringify(r.dados || {}) + ' ' + r.descricao)).map(r => ({ codigo: r.codigo, descricao: r.descricao })),
        pendencias: estado.dossie.pendencias || [],
        solucaoAplicada: estado.dossie.solucaoAplicada,
        resultadoValidacao: estado.dossie.resultadoValidacao,
      },
      tokensEstimados: tokens,
    },
    contextoResumo: { tokensEstimados: tokens, itensSelecionados: selecionados.length, evidenciasRecuperadas: evidencias.length, evidenciasIndisponiveis: indisponiveis.length },
  };
}

module.exports = { montarMemoriaOperacional };
