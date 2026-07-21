'use strict';

const { identificarPeriodoTexto, resolverPeriodo } = require('../../ai/period-resolver');
const { _temChaveIA } = require('./ai-sql-generation');

const MIN_CONF_IA = 0.8;

function resolverPeriodoDeterministico({ modulo, mensagem, periodoInicial, hoje = new Date() } = {}) {
  const periodoAtualSemAno = _periodoAtualPorTextoSemAno({ mensagem, hoje });
  if (periodoAtualSemAno) return _normalizarPeriodo(periodoAtualSemAno);

  // Datas explícitas do orquestrador são autoritativas — não deixar texto do turno atual sobrescrever
  const iniExplicito = _normalizarData((periodoInicial || {}).dataInicio || (periodoInicial || {}).data_inicio);
  const fimExplicito = _normalizarData((periodoInicial || {}).dataFim || (periodoInicial || {}).data_fim);
  if (iniExplicito && fimExplicito) {
    return _normalizarPeriodo({ ...(periodoInicial || {}), dataInicio: iniExplicito, dataFim: fimExplicito });
  }

  let base = periodoInicial || identificarPeriodoTexto(mensagem || '', { hoje });
  if (!base || base.tipo === 'nenhum') {
    const tipoPadrao = _tipoPadraoModulo(modulo, mensagem);
    if (tipoPadrao) base = { tipo: tipoPadrao };
  }
  // Se base já tem datas concretas (ex.: período herdado do contexto), preserva-as diretamente.
  // Evita que resolverPeriodo sobrescreva com null (tipos 'ano'/'mes' não tratados) ou com
  // datas erradas (tipo 'personalizado' lê data_inicio em snake_case, não dataInicio).
  const baseInicio = _normalizarData((base || {}).dataInicio || (base || {}).data_inicio);
  const baseFim = _normalizarData((base || {}).dataFim || (base || {}).data_fim);
  if (baseInicio && baseFim) {
    return _normalizarPeriodo({ ...base, dataInicio: baseInicio, dataFim: baseFim });
  }
  const datas = resolverPeriodo(base, { hoje });
  return _normalizarPeriodo({ ...base, ...datas });
}

async function resolverContratoTemporalComIA({
  modulo,
  mensagem,
  periodoInicial,
  historicoResumido,
  orquestradorContrato,
  keys,
  cfg,
  chamarIA,
  hoje = new Date(),
} = {}) {
  const deterministico = resolverPeriodoDeterministico({ modulo, mensagem, periodoInicial, hoje });
  const baseContrato = {
    modulo: modulo || null,
    origem: 'deterministico',
    periodoDeterministico: deterministico,
    sugestaoIA: null,
    divergencia: null,
  };

  if (!_temChaveIA(keys) || typeof chamarIA !== 'function') {
    return { periodo: deterministico, contrato: baseContrato };
  }

  // Quando o orquestrador forneceu datas explícitas, elas já são a fonte de verdade.
  // Chamar a IA temporal aqui só introduz risco de sobrescrita incorreta.
  const _iniExp = _normalizarData((periodoInicial || {}).dataInicio || (periodoInicial || {}).data_inicio);
  const _fimExp = _normalizarData((periodoInicial || {}).dataFim || (periodoInicial || {}).data_fim);
  if (_iniExp && _fimExp) {
    return { periodo: deterministico, contrato: { ...baseContrato, origem: 'deterministico_datas_explicitas' } };
  }

  try {
    // Garante que o contrato do orquestrador reflita o período herdado quando ele próprio
    // ficou com tipo:'nenhum' (ex.: turno de agrupamento por mês sem período explícito).
    // Sem isso, a IA temporal vê periodo:'nenhum' e pode devolver mes_atual sobrescrevendo
    // o deterministico correto.
    const orquestradorContratoEfetivo = (() => {
      if (!orquestradorContrato) return null;
      const cTipo = orquestradorContrato.periodo?.tipo || 'nenhum';
      if (cTipo === 'nenhum' && periodoInicial?.tipo && periodoInicial.tipo !== 'nenhum') {
        return { ...orquestradorContrato, periodo: periodoInicial };
      }
      return orquestradorContrato;
    })();
    const respostaIA = await chamarIA(
      keys,
      cfg,
      buildTemporalSystemPrompt(),
      buildTemporalUserPrompt({ modulo, mensagem, periodoDeterministico: deterministico, historicoResumido, orquestradorContrato: orquestradorContratoEfetivo, hoje }),
      { json: true, maxTokens: 700 }
    );
    const sugestaoIA = normalizarSugestaoTemporal(respostaIA);
    const aplicado = aplicarSugestaoTemporal({ modulo, mensagem, deterministico, sugestaoIA, hoje });
    return {
      periodo: aplicado.periodo,
      contrato: {
        ...baseContrato,
        origem: aplicado.origem,
        sugestaoIA,
        divergencia: aplicado.divergencia,
        respostaIA,
      },
    };
  } catch (erro) {
    return {
      periodo: deterministico,
      contrato: {
        ...baseContrato,
        origem: 'deterministico_ia_temporal_indisponivel',
        erro: erro.message,
      },
    };
  }
}

function buildTemporalSystemPrompt() {
  return [
    'Voce interpreta apenas o periodo temporal de perguntas sobre ERP.',
    'Nao gere SQL. Nao escolha tabelas. Nao invente filtros de negocio.',
    'Responda somente JSON valido.',
    'Voce e a autoridade principal para interpretar o periodo. A sugestao do sistema e apenas um candidato auxiliar.',
    'Campos permitidos: tipo, dataInicio, dataFim, confianca, precisa_confirmacao, justificativa.',
    'Use datas no formato YYYYMMDD.',
    'Se a pergunta atual e o historico nao indicarem periodo, use tipo "nenhum" e datas null.',
    'Se a pergunta atual citar um mes sem ano explicito e o contexto herdado tiver um ano especifico, use o ano do contexto herdado.',
    'Se contrato_orquestrador.herdou_contexto=true, trate contrato_orquestrador.contexto_usado como memoria estruturada do turno anterior.',
    'Se houver ambiguidade real, mantenha o sentido mais provavel e reduza a confianca.',
  ].join('\n');
}

function _enriquecerContratoHistoricoTemporal(historico) {
  if (!Array.isArray(historico)) return [];
  return historico.map(item => {
    if (!item?.contrato_orquestrador) return item;
    const cTipo = item.contrato_orquestrador.periodo?.tipo || 'nenhum';
    if (cTipo === 'nenhum' && item.periodo?.tipo && item.periodo.tipo !== 'nenhum') {
      return { ...item, contrato_orquestrador: { ...item.contrato_orquestrador, periodo: item.periodo } };
    }
    return item;
  });
}

function buildTemporalUserPrompt({ modulo, mensagem, periodoDeterministico, historicoResumido, orquestradorContrato, hoje } = {}) {
  return JSON.stringify({
    hoje: _ymd(hoje || new Date()),
    modulo: modulo || null,
    mensagem: mensagem || '',
    periodo_sugerido_pelo_sistema: periodoDeterministico || { tipo: 'nenhum', dataInicio: null, dataFim: null },
    historico_resumido: _enriquecerContratoHistoricoTemporal(historicoResumido),
    contrato_orquestrador: orquestradorContrato || null,
    instrucao: 'Interprete expressoes como ano, este ano, ano passado, exercicio e intervalos explicitos. Retorne apenas o contrato temporal sugerido.',
  });
}

function normalizarSugestaoTemporal(raw) {
  if (!raw) return null;
  const obj = typeof raw === 'string' ? _parseJsonLoose(raw) : raw;
  if (!obj || typeof obj !== 'object') return null;

  const tipo = typeof obj.tipo === 'string' && obj.tipo.trim()
    ? obj.tipo.trim()
    : null;
  const dataInicio = _normalizarData(obj.dataInicio || obj.data_inicio || obj.inicio);
  const dataFim = _normalizarData(obj.dataFim || obj.data_fim || obj.fim);
  const confianca = Number.isFinite(Number(obj.confianca)) ? Number(obj.confianca) : 0;

  if ((dataInicio && !dataFim) || (!dataInicio && dataFim)) return null;
  if (dataInicio && dataFim && dataInicio > dataFim) return null;

  return {
    tipo: tipo || (dataInicio ? 'personalizado' : 'nenhum'),
    dataInicio: dataInicio || null,
    dataFim: dataFim || null,
    confianca,
    precisa_confirmacao: Boolean(obj.precisa_confirmacao),
    justificativa: typeof obj.justificativa === 'string' ? obj.justificativa : null,
  };
}

function aplicarSugestaoTemporal({ modulo, mensagem, deterministico, sugestaoIA, hoje = new Date() } = {}) {
  const periodoBase = _normalizarPeriodo(deterministico || { tipo: 'nenhum' });
  if (!sugestaoIA || sugestaoIA.precisa_confirmacao || sugestaoIA.confianca < MIN_CONF_IA) {
    return { periodo: periodoBase, origem: 'deterministico', divergencia: null };
  }

  if (_devePreservarSemPeriodo({ modulo, mensagem, deterministico: periodoBase })) {
    return {
      periodo: periodoBase,
      origem: 'guardrail_periodo_aberto_preservado',
      divergencia: _divergencia(periodoBase, sugestaoIA),
    };
  }

  if ((periodoBase.dataInicio && periodoBase.dataFim) && sugestaoIA.tipo === 'nenhum') {
    return {
      periodo: periodoBase,
      origem: 'deterministico_ia_temporal_rejeitada',
      divergencia: _divergencia(periodoBase, sugestaoIA),
    };
  }

  const periodoIA = _resolverPeriodoDaSugestao(sugestaoIA, hoje);
  if (!periodoIA) {
    return { periodo: periodoBase, origem: 'deterministico_ia_temporal_rejeitada', divergencia: _divergencia(periodoBase, sugestaoIA) };
  }

  const divergencia = _divergencia(periodoBase, periodoIA);
  const guardrailPeriodoAtual = _guardrailPeriodoAtual({ mensagem, deterministico: periodoBase });
  if (divergencia && guardrailPeriodoAtual) {
    return {
      periodo: periodoBase,
      origem: guardrailPeriodoAtual,
      divergencia,
    };
  }
  return {
    periodo: _normalizarPeriodo(periodoIA),
    origem: divergencia ? 'ia_temporal_validada' : 'ia_temporal_confirmada',
    divergencia,
  };
}

function _resolverPeriodoDaSugestao(sugestaoIA, hoje) {
  if (!sugestaoIA || sugestaoIA.tipo === 'nenhum') {
    return { tipo: 'nenhum', dataInicio: null, dataFim: null };
  }
  if (sugestaoIA.dataInicio && sugestaoIA.dataFim) {
    return {
      tipo: sugestaoIA.tipo || 'personalizado',
      dataInicio: sugestaoIA.dataInicio,
      dataFim: sugestaoIA.dataFim,
    };
  }
  const datas = resolverPeriodo(sugestaoIA, { hoje });
  if (!datas?.dataInicio || !datas?.dataFim) return null;
  return { ...sugestaoIA, ...datas };
}

function _normalizarPeriodo(periodo = {}) {
  const dataInicio = _normalizarData(periodo.dataInicio || periodo.data_inicio);
  const dataFim = _normalizarData(periodo.dataFim || periodo.data_fim);
  return {
    ...periodo,
    tipo: periodo.tipo || 'nenhum',
    dataInicio: dataInicio || null,
    dataFim: dataFim || null,
  };
}

function _devePreservarSemPeriodo({ modulo, mensagem, deterministico } = {}) {
  if ((deterministico?.tipo || 'nenhum') !== 'nenhum') return false;
  const mod = String(modulo || '').toLowerCase();
  const texto = String(mensagem || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (mod === 'financeiro') {
    return /em aberto/.test(texto) || /a receber/.test(texto) || /a pagar/.test(texto);
  }
  if (mod === 'comissao') {
    return /em aberto/.test(texto) || /pendente/.test(texto) || /a receber/.test(texto);
  }
  return false;
}

function _guardrailPeriodoAtual({ mensagem, deterministico } = {}) {
  const periodo = _normalizarPeriodo(deterministico || {});
  if (!periodo.dataInicio || !periodo.dataFim) return null;
  const texto = String(mensagem || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(passado|passada|anterior|ultimo|ultima|ontem|amanha|pr[oó]ximo|proxima)\b/.test(texto)) return null;
  if (/\b(19|20)\d{2}\b/.test(texto)) return null;

  if (periodo.tipo === 'ano_atual') {
    if (/(^|\s)(do ano|no ano|ano atual|este ano|esse ano|ano)(\s|$)/.test(texto)) return 'guardrail_ano_atual_preservado';
  }
  if (periodo.tipo === 'mes_atual') {
    if (/(^|\s)(do mes|no mes|mes atual|este mes|esse mes|mes)(\s|$)/.test(texto)) return 'guardrail_mes_atual_preservado';
  }
  if (periodo.tipo === 'hoje') {
    if (/(^|\s)(do dia|no dia|dia atual|hoje|dia)(\s|$)/.test(texto)) return 'guardrail_dia_atual_preservado';
  }
  return null;
}

function _tipoPadraoModulo(modulo, mensagem = '') {
  const nome = String(modulo || '').toLowerCase();
  if (nome === 'compras') return 'mes_atual';
  if (nome === 'faturamento') return 'mes_atual';
  if (nome === 'comissao') {
    const texto = String(mensagem || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Consultas de "em aberto" / "pendentes" não têm período implícito — a IA decide
    if (/em aberto|pendente|a receber/.test(texto)) return null;
    return 'mes_atual';
  }
  return null;
}

function _divergencia(a, b) {
  const left = _normalizarPeriodo(a || {});
  const right = _normalizarPeriodo(b || {});
  if (left.tipo === right.tipo && left.dataInicio === right.dataInicio && left.dataFim === right.dataFim) return null;
  return {
    sistema: { tipo: left.tipo, dataInicio: left.dataInicio, dataFim: left.dataFim },
    ia: { tipo: right.tipo, dataInicio: right.dataInicio, dataFim: right.dataFim },
  };
}

function _normalizarData(valor) {
  if (valor == null || valor === '') return null;
  const s = String(valor).replace(/\D/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  const ano = Number(s.slice(0, 4));
  const mes = Number(s.slice(4, 6));
  const dia = Number(s.slice(6, 8));
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return s;
}

const MESES_NOME = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

function _normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _fimMes(ano, mes) {
  return String(new Date(ano, mes, 0).getDate()).padStart(2, '0');
}

function _periodoAtualPorTextoSemAno({ mensagem, hoje = new Date() } = {}) {
  const texto = _normalizarTexto(mensagem);
  if (!texto || /\b(?:19|20)\d{2}\b/.test(texto)) return null;
  if (/\b(passado|passada|anterior|ultimo|ultima|proximo|proxima|seguinte|ontem|amanha)\b/.test(texto)) return null;

  const dataHoje = hoje instanceof Date ? hoje : new Date(hoje);
  const ano = dataHoje.getFullYear();
  const mesAtual = dataHoje.getMonth() + 1;

  const mesNomeAtual = Object.keys(MESES_NOME)
    .sort((a, b) => b.length - a.length)
    .find(nome => new RegExp(`\\b${nome}\\b`, 'i').test(texto));
  if (mesNomeAtual) {
    const mes = MESES_NOME[mesNomeAtual];
    const mm = String(mes).padStart(2, '0');
    return { tipo: 'mes', dataInicio: `${ano}${mm}01`, dataFim: `${ano}${mm}${_fimMes(ano, mes)}` };
  }

  // Detecta expressões de ano ANTES de remover agrupamento — "por ano" carrega sentido temporal
  // ("comissão do Jean por ano" = ano inteiro) além de granularidade de exibição.
  if (/(^|\s)(do ano|no ano|deste ano|desse ano|nesse ano|neste ano|ano atual|este ano|esse ano|ano corrente|todo o? ano|todos os meses do ano)(\s|$)/.test(texto)) {
    return { tipo: 'ano', dataInicio: `${ano}0101`, dataFim: `${ano}1231` };
  }

  // Remove expressões de agrupamento ("por mês", "mês a mês", etc.) — descrevem granularidade
  // de exibição, não o período temporal. Sem isso, "detalhar por mes" ativaria o detector de
  // "mes" e destruiria o período herdado do contexto.
  // "por ano" já foi tratado acima — manter aqui só para limpar o restante da análise.
  const textoSemAgrupamento = texto
    .replace(/\bpor\s+mes(?:es)?\b/g, ' ')
    .replace(/\bmes\s+a\s+mes\b/g, ' ')
    .replace(/\bpor\s+ano\b/g, ' ')
    .replace(/\bano\s+a\s+ano\b/g, ' ')
    .replace(/\bpor\s+dia(?:s)?\b/g, ' ')
    .replace(/\bdia\s+a\s+dia\b/g, ' ')
    .replace(/\bpor\s+semana(?:s)?\b/g, ' ')
    .replace(/\bsemana\s+a\s+semana\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

  if (/(^|\s)(do ano|no ano|deste ano|desse ano|nesse ano|neste ano|ano atual|este ano|esse ano|ano corrente|ano)(\s|$)/.test(textoSemAgrupamento)) {
    return { tipo: 'ano', dataInicio: `${ano}0101`, dataFim: `${ano}1231` };
  }

  if (/(^|\s)(do mes|no mes|deste mes|desse mes|nesse mes|neste mes|mes atual|este mes|esse mes|mes corrente|mes)(\s|$)/.test(textoSemAgrupamento)) {
    const mm = String(mesAtual).padStart(2, '0');
    return { tipo: 'mes', dataInicio: `${ano}${mm}01`, dataFim: `${ano}${mm}${_fimMes(ano, mesAtual)}` };
  }

  // "nesse dia", "neste dia", "no dia", "hoje" sem número específico = hoje
  if (/(^|\s)(do dia|nesse dia|neste dia|no dia|dia atual|dia corrente|hoje|hj)(\s|$)/.test(textoSemAgrupamento)) {
    const dd = String(dataHoje.getDate()).padStart(2, '0');
    const mm = String(mesAtual).padStart(2, '0');
    return { tipo: 'dia', dataInicio: `${ano}${mm}${dd}`, dataFim: `${ano}${mm}${dd}` };
  }

  return null;
}

function validarPeriodoNoSQL(sql, periodo) {
  const inicio = _normalizarData(periodo?.dataInicio || periodo?.data_inicio);
  const fim = _normalizarData(periodo?.dataFim || periodo?.data_fim);
  if (!inicio || !fim) return true;

  const datas = String(sql || '')
    .match(/\b(?:19|20)\d{6}\b/g)
    ?.map(_normalizarData)
    .filter(Boolean) || [];

  if (!datas.length) return false;
  return datas.every(data => data >= inicio && data <= fim);
}

function _parseJsonLoose(raw) {
  const texto = String(raw || '').trim();
  try { return JSON.parse(texto); } catch (_) {}
  const semFence = texto.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(semFence); } catch (_) {}
  const match = semFence.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

function _ymd(data) {
  const d = data instanceof Date ? data : new Date(data);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

module.exports = {
  resolverPeriodoDeterministico,
  resolverContratoTemporalComIA,
  buildTemporalSystemPrompt,
  buildTemporalUserPrompt,
  normalizarSugestaoTemporal,
  aplicarSugestaoTemporal,
  validarPeriodoNoSQL,
  _periodoAtualPorTextoSemAno,
  _enriquecerContratoHistoricoTemporal,
};
