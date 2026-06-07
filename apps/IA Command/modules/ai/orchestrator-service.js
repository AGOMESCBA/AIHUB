'use strict';

const aiProviderClient = require('../erp/ai-provider-client');

const MODULOS_DINAMICOS = new Set(['financeiro', 'compras', 'faturamento', 'comissao']);

function _parseJsonLoose(raw) {
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

function _normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _moduloPorIntencao(nome = '') {
  const texto = _normalizarTexto(nome);
  if (texto.includes('financeiro')) return 'financeiro';
  if (texto.includes('compras') || texto.includes('compra')) return 'compras';
  if (texto.includes('faturamento')) return 'faturamento';
  if (texto.includes('comissao')) return 'comissao';
  return null;
}

function _intencaoPorModulo(modulo, intencoes = []) {
  const alvo = _normalizarTexto(modulo);
  const registro = (intencoes || []).find(i => {
    const nome = String(i.nome || '').toLowerCase();
    const acao = String(i.acao || '').toLowerCase();
    const mod = _moduloPorIntencao([i.modulo, i.nome, i.descricao].filter(Boolean).join(' '));
    return mod === alvo && (acao === 'ai_text_to_sql' || nome.endsWith('_dinamico'));
  });
  return registro?.nome || (MODULOS_DINAMICOS.has(alvo) ? `${alvo}_dinamico` : null);
}

function _normalizarPeriodo(periodo = {}) {
  const tipo = String(periodo?.tipo || 'nenhum').trim() || 'nenhum';
  const dataInicio = periodo?.dataInicio || periodo?.data_inicio || null;
  const dataFim = periodo?.dataFim || periodo?.data_fim || null;
  return {
    tipo,
    ...(dataInicio ? { dataInicio: String(dataInicio).replace(/\D/g, '') } : {}),
    ...(dataFim ? { dataFim: String(dataFim).replace(/\D/g, '') } : {}),
  };
}

function _temDataExplicita(mensagem = '') {
  const texto = _normalizarTexto(mensagem);
  return /\b(?:19|20)\d{2}\b/.test(texto)
    || /\b(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(texto)
    || /\b(hoje|ontem|semana|mes atual|m[eê]s atual|mes passado|m[eê]s passado|ano atual|ano passado|periodo|per[ií]odo)\b/.test(texto);
}

function _corrigirPeriodoAgrupamento({ periodo, agrupamentos, mensagem } = {}) {
  const p = _normalizarPeriodo(periodo);
  const grupos = new Set(agrupamentos || []);
  const texto = _normalizarTexto(mensagem);
  if (!_temDataExplicita(mensagem)) {
    if (/\bpor ano\b/.test(texto)) {
      grupos.add('ano');
      return { periodo: { tipo: 'nenhum' }, agrupamentos: [...grupos] };
    }
    if (/\bpor mes\b|\bpor meses\b|\bmes a mes\b|\bmensal\b/.test(texto)) {
      grupos.add('mes');
      return { periodo: { tipo: 'nenhum' }, agrupamentos: [...grupos] };
    }
  }
  return { periodo: p, agrupamentos: [...grupos] };
}

function _mesSemAnoExplicitoDoContexto({ periodo, contexto, mensagem } = {}) {
  const texto = _normalizarTexto(mensagem);
  if (/\b(?:19|20)\d{2}\b/.test(texto)) return null;
  const atual = _normalizarPeriodo(periodo);
  const ctx = _normalizarPeriodo(contexto?.periodo || {});
  if (!atual.dataInicio || !atual.dataFim || !ctx.dataInicio || !ctx.dataFim) return null;
  if (atual.dataInicio.slice(0, 6) !== atual.dataFim.slice(0, 6)) return null;
  const anoAtual = atual.dataInicio.slice(0, 4);
  const anoCtx = ctx.dataInicio.slice(0, 4);
  if (anoAtual === anoCtx || ctx.dataInicio.slice(0, 4) !== ctx.dataFim.slice(0, 4)) return null;
  const mesAtual = atual.dataInicio.slice(4, 6);
  if (!/^(0[1-9]|1[0-2])$/.test(mesAtual)) return null;
  return {
    ...atual,
    tipo: atual.tipo || 'personalizado',
    dataInicio: `${anoCtx}${atual.dataInicio.slice(4)}`,
    dataFim: `${anoCtx}${atual.dataFim.slice(4)}`,
  };
}

function _ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function _fimMes(ano, mes) {
  return String(new Date(ano, mes, 0).getDate()).padStart(2, '0');
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

function _periodoAtualPorTextoSemAno({ mensagem, hoje = new Date() } = {}) {
  const texto = _normalizarTexto(mensagem);
  if (!texto || /\b(?:19|20)\d{2}\b/.test(texto)) return null;
  if (/\b(passado|passada|anterior|ultimo|ultima|proximo|proxima|seguinte|ontem|amanha)\b/.test(texto)) return null;

  const dataHoje = hoje instanceof Date ? hoje : new Date(hoje);
  const ano = dataHoje.getFullYear();
  const mesAtual = dataHoje.getMonth() + 1;

  const mesNome = Object.keys(MESES_NOME)
    .sort((a, b) => b.length - a.length)
    .find(nome => new RegExp(`\\b${nome}\\b`, 'i').test(texto));
  if (mesNome) {
    const mes = MESES_NOME[mesNome];
    const mm = String(mes).padStart(2, '0');
    return { tipo: 'mes', dataInicio: `${ano}${mm}01`, dataFim: `${ano}${mm}${_fimMes(ano, mes)}` };
  }

  if (/(^|\s)(do ano|no ano|deste ano|desse ano|ano atual|este ano|esse ano|ano corrente|ano)(\s|$)/.test(texto)) {
    return { tipo: 'ano', dataInicio: `${ano}0101`, dataFim: `${ano}1231` };
  }

  if (/(^|\s)(do mes|no mes|deste mes|desse mes|mes atual|este mes|esse mes|mes corrente|mes)(\s|$)/.test(texto)) {
    const mm = String(mesAtual).padStart(2, '0');
    return { tipo: 'mes', dataInicio: `${ano}${mm}01`, dataFim: `${ano}${mm}${_fimMes(ano, mesAtual)}` };
  }

  if (/(^|\s)(do dia|no dia|dia atual|dia corrente|hoje|hj)(\s|$)/.test(texto)) {
    const dd = String(dataHoje.getDate()).padStart(2, '0');
    const mm = String(mesAtual).padStart(2, '0');
    return { tipo: 'dia', dataInicio: `${ano}${mm}${dd}`, dataFim: `${ano}${mm}${dd}` };
  }

  return null;
}

function _normalizarLista(valor) {
  if (!valor) return null;
  const arr = Array.isArray(valor) ? valor : [valor];
  const out = arr
    .map(v => _normalizarTexto(v).replace(/\s+/g, '_'))
    .map(v => v === 'por_ano' ? 'ano' : v === 'por_mes' || v === 'por_meses' ? 'mes' : v === 'grupo_de_produto' || v === 'grupo_de_produtos' ? 'grupo_produto' : v)
    .filter(Boolean);
  return out.length ? [...new Set(out)] : null;
}

// Campos de filtro que devem conter apenas nomes próprios de entidades cadastrais
const _CAMPOS_ENTIDADE = new Set(['cliente', 'fornecedor', 'vendedor', 'produto', 'grupo_produto', 'grupo']);

// Padrões inequivocamente operacionais — compostos ou muito específicos para não conflitar com nomes de empresa
const _RE_OPERACIONAL = /\b(agrupando\s+por|em\s+ordem(?:\s+decrescente|\s+crescente)?|todos\s+os\s+anos|todos\s+os\s+meses|por\s+m[eê]s(?:\s|$)|por\s+dia(?:\s|$)|por\s+ano(?:\s|$)|ordenado\s+por|ordenando\s+por|ordenar\s+por)\b/i;

// Remove ruído operacional de valores de filtros de entidade (ex: "Softexpert de todos os anos agrupando por mes...")
function _sanitizarFiltrosEntidade(filtros = {}) {
  if (!filtros || typeof filtros !== 'object') return filtros;
  const resultado = { ...filtros };
  for (const campo of Object.keys(resultado)) {
    if (!_CAMPOS_ENTIDADE.has(campo)) continue;
    const valor = resultado[campo];
    if (typeof valor !== 'string') continue;
    const m = _RE_OPERACIONAL.exec(valor);
    if (!m) continue;
    // Tenta extrair o nome próprio antes do ruído operacional (remove preposições finais)
    const antes = valor.slice(0, m.index).replace(/\s+(de|da|do|dos|das|e|em|para|por|com)\s*$/i, '').trim();
    if (antes.length >= 3) { resultado[campo] = antes; continue; }
    // Nome pode estar após o ruído (ex: "...decrescente da Softexpert")
    const depois = valor.slice(m.index + m[0].length).trim();
    const matchFinal = /(?:da?\s+|de\s+|do\s+)([A-Za-zÀ-ÿ0-9][\w\sÀ-ÿ.-]{1,40})$/i.exec(depois);
    if (matchFinal) { resultado[campo] = matchFinal[1].trim(); continue; }
    if (depois.length >= 3) resultado[campo] = depois;
  }
  return resultado;
}

function _temTermoDominioExplicito(texto = '', dominio = '') {
  const t = _normalizarTexto(texto);
  if (dominio === 'compras') return /\b(compras?|pedido de compra|ordem de compra|nota fiscal de entrada|nf entrada)\b/.test(t);
  if (dominio === 'faturamento') return /\b(faturamento|vendas?|nota fiscal de saida|nf saida|receita)\b/.test(t);
  if (dominio === 'comissao') return /\b(comiss[aã]o|comissoes|vendedor(?:es)?)\b/.test(t);
  return false;
}

function _aplicarGuardrailsContrato(obj = {}, mensagem = '') {
  const contrato = { ...obj };
  const texto = _normalizarTexto(mensagem);
  const ctx = contrato.contexto_usado && typeof contrato.contexto_usado === 'object' ? contrato.contexto_usado : null;
  const ajustes = [];
  const marcarAjuste = (motivo) => {
    if (motivo && !ajustes.includes(motivo)) ajustes.push(motivo);
  };

  if (/\b(contas? a pagar|titulo(?:s)? a pagar|duplicata(?:s)? a pagar|fornecedor(?:es)? a pagar)\b/.test(texto)) {
    if (_normalizarTexto(contrato.modulo) !== 'financeiro') marcarAjuste('contas_a_pagar_financeiro');
    contrato.modulo = 'financeiro';
    contrato.operacao = contrato.operacao || 'contas_a_pagar';
    contrato.carteira = 'pagar';
  }

  if (/\b(contas? a receber|titulo(?:s)? a receber|duplicata(?:s)? a receber|cliente(?:s)? a receber)\b/.test(texto)) {
    if (_normalizarTexto(contrato.modulo) !== 'financeiro') marcarAjuste('contas_a_receber_financeiro');
    contrato.modulo = 'financeiro';
    contrato.operacao = contrato.operacao || 'contas_a_receber';
    contrato.carteira = 'receber';
  }

  if (/\b(saldo bancario|saldo dos bancos|bancos?|fluxo de caixa|caixa)\b/.test(texto)) {
    if (_normalizarTexto(contrato.modulo) !== 'financeiro') marcarAjuste('caixa_bancos_financeiro');
    contrato.modulo = 'financeiro';
    contrato.operacao = texto.includes('fluxo de caixa') ? 'fluxo_de_caixa' : (contrato.operacao || 'saldo_bancario');
    if (/\brealizado\b/.test(texto)) contrato.fluxoTipo = 'realizado';
    if (/\b(projetado|previsto|futuro)\b/.test(texto)) contrato.fluxoTipo = 'projetado';
  }

  if (/\bem aberto\b|\baberto(?:s)?\b/.test(texto) && contrato.modulo === 'financeiro') {
    contrato.estado = 'em_aberto';
  }

  const herdouFinanceiroPagar = contrato.herdou_contexto
    && ctx
    && _normalizarTexto(ctx.modulo) === 'financeiro'
    && _normalizarTexto(ctx.carteira) === 'pagar';
  if (
    herdouFinanceiroPagar
    && /\bfornecedor(?:es)?\b/.test(texto)
    && !_temTermoDominioExplicito(mensagem, 'compras')
  ) {
    if (_normalizarTexto(contrato.modulo) !== 'financeiro') marcarAjuste('contexto_pagar_fornecedor_financeiro');
    contrato.modulo = 'financeiro';
    contrato.operacao = contrato.operacao || ctx.operacao || 'contas_a_pagar';
    contrato.carteira = 'pagar';
    contrato.estado = contrato.estado || ctx.estado || null;
  }

  const herdouFinanceiroReceber = contrato.herdou_contexto
    && ctx
    && _normalizarTexto(ctx.modulo) === 'financeiro'
    && _normalizarTexto(ctx.carteira) === 'receber';
  if (
    herdouFinanceiroReceber
    && /\bcliente(?:s)?\b/.test(texto)
    && !_temTermoDominioExplicito(mensagem, 'faturamento')
  ) {
    if (_normalizarTexto(contrato.modulo) !== 'financeiro') marcarAjuste('contexto_receber_cliente_financeiro');
    contrato.modulo = 'financeiro';
    contrato.operacao = contrato.operacao || ctx.operacao || 'contas_a_receber';
    contrato.carteira = 'receber';
    contrato.estado = contrato.estado || ctx.estado || null;
  }

  if (ajustes.length) {
    contrato.justificativa = `Contrato validado por guardrail: ${ajustes.join(', ')}.`;
  }

  return contrato;
}

function _periodoEfetivo(contrato, periodoMesclado) {
  if (!contrato) return null;
  const cTipo = contrato.periodo?.tipo || 'nenhum';
  if (cTipo === 'nenhum' && periodoMesclado?.tipo && periodoMesclado.tipo !== 'nenhum') {
    return { ...contrato, periodo: periodoMesclado };
  }
  return contrato;
}

function _contratoHistoricoRecente(historico = [], contextoAnterior = null) {
  // Quando o contrato_orquestrador salvou periodo:'nenhum' (ex.: turno de agrupamento por mês),
  // usa o período mesclado real (intent.periodo) para não perder o contexto temporal.
  if (contextoAnterior?._orquestradorContrato) {
    return _periodoEfetivo(contextoAnterior._orquestradorContrato, contextoAnterior.periodo);
  }
  const lista = Array.isArray(historico) ? historico : [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const item = lista[i];
    if (item?.contrato_orquestrador) {
      return _periodoEfetivo(item.contrato_orquestrador, item.periodo);
    }
  }
  return null;
}

function _aplicarContextoDeterministico(obj = {}, { mensagem = '', historicoResumido = [], contextoAnterior = null } = {}) {
  const contrato = { ...(obj || {}) };
  const texto = _normalizarTexto(mensagem);
  const ctx = _contratoHistoricoRecente(historicoResumido, contextoAnterior);
  if (!ctx) return contrato;

  const ehRefinamento = /^(detalhe|detalha|detalhar|detalhes|agora|mostra|mostre|liste|listar|por)\b/.test(texto);
  const contextoFinanceiroPagar = _normalizarTexto(ctx.modulo) === 'financeiro' && _normalizarTexto(ctx.carteira) === 'pagar';
  const falaFornecedor = /\bfornecedor(?:es)?\b/.test(texto);
  const trocaParaCompras = _temTermoDominioExplicito(mensagem, 'compras');

  if (ehRefinamento && contextoFinanceiroPagar && falaFornecedor && !trocaParaCompras) {
    contrato.modulo = 'financeiro';
    contrato.operacao = contrato.operacao || ctx.operacao || 'contas_a_pagar';
    contrato.carteira = 'pagar';
    contrato.estado = contrato.estado || ctx.estado || null;
    // Preserva período do contexto para refinamentos sem período explícito na mensagem
    const ctxPer = _normalizarPeriodo(ctx.periodo || {});
    const temTermoTemporalExplicito = /\b(jan(?:eiro)?|fev(?:ereiro)?|mar(?:c[oo])?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?|\d{4}|mes passado|semana passada|hoje|ontem|esta semana|este mes|ano passado|proximo mes)\b/i.test(texto);
    if (ctxPer.tipo === 'nenhum') {
      contrato.periodo = { tipo: 'nenhum' };
    } else if (!temTermoTemporalExplicito) {
      // Sem período novo explícito → herda sempre do contexto anterior
      contrato.periodo = ctx.periodo || contrato.periodo;
    } else {
      contrato.periodo = contrato.periodo && _normalizarPeriodo(contrato.periodo).tipo !== 'nenhum'
        ? contrato.periodo
        : (ctx.periodo || contrato.periodo);
    }
    // Acumula agrupamentos para drill-down hierárquico (ex: por mês → por fornecedor = ['mes','fornecedor'])
    const novosGrupos = _normalizarLista(contrato.agrupamentos || contrato.group_by) || [];
    // Garante 'fornecedor' como dimensão de agrupamento — a IA pode classificá-lo erroneamente em filtros
    if (!novosGrupos.includes('fornecedor')) novosGrupos.push('fornecedor');
    // Remove filtro genérico "fornecedor: true" — não é entidade específica, é dimensão de agrupamento
    if (contrato.filtros && contrato.filtros.fornecedor === true) {
      const f = { ...contrato.filtros };
      delete f.fornecedor;
      contrato.filtros = f;
    }
    const gruposCtx = Array.isArray(ctx.agrupamentos) ? ctx.agrupamentos : [];
    const acumulados = [...new Set([...gruposCtx, ...novosGrupos])];
    contrato.agrupamentos = acumulados.length > 0 ? acumulados : null;
    contrato.herdou_contexto = true;
    contrato.contexto_usado = ctx;
    contrato.justificativa = 'Contexto financeiro de contas a pagar preservado para refinamento hierárquico por fornecedor.';
  }

  return contrato;
}

function buildSystemPrompt() {
  return [
    'Voce e a IA Orquestradora principal do IA Command.',
    'Sua funcao e interpretar a pergunta do usuario antes de qualquer modulo executar SQL.',
    'Nao gere SQL. Retorne somente JSON valido.',
    '',
    'Voce e a autoridade semantica principal: escolha modulo, periodo, filtros, agrupamentos e operacao a partir da pergunta atual e do historico.',
    'O sistema apenas validara o contrato e executara o modulo correto.',
    '',
    'Modulos dinamicos disponiveis:',
    '- financeiro: contas a pagar/receber, pagamentos, recebimentos, titulos, duplicatas, saldo bancario, bancos, fluxo de caixa, fluxo de caixa realizado/projetado.',
    '- compras: compras, notas fiscais de entrada, pedidos/ordens de compra, fornecedores/produtos comprados.',
    '- faturamento: vendas, faturamento, notas fiscais de saida, receita, clientes/produtos vendidos.',
    '- comissao: comissoes, vendedores, comissao paga/a receber, base/percentual de comissao.',
    '',
    'Regras criticas:',
    '- saldo bancario, fluxo de caixa, fluxo de caixa realizado e fluxo de caixa projetado sempre sao financeiro.',
    '- contas a pagar e fornecedor sao financeiro/carteira pagar.',
    '- contas a receber e cliente sao financeiro/carteira receber.',
    '- Se a pergunta atual for continuidade, use historico_resumido dentro do limite recebido.',
    '- Quando historico_resumido trouxer contrato_orquestrador, trate esse contrato como a memoria validada do turno anterior.',
    '- Em perguntas de continuidade, herde do contrato_orquestrador os campos modulo, periodo, filtros, carteira, operacao, fluxoTipo e agrupamentos que ainda forem aplicaveis.',
    '- Nao reinterprete historico antigo por texto livre quando existir contrato_orquestrador: prefira o contrato estruturado.',
    '- Se a pergunta atual trouxer novo periodo/filtro/modulo, ela prevalece sobre o historico.',
    '- Nao herde contexto quando a pergunta atual trocar explicitamente de assunto ou dominio.',
    '- "por ano" e "por mes" normalmente sao agrupamentos, nao periodos, salvo quando houver ano/mes/data explicitos.',
    '- Se houver duvida real, marque precisa_confirmacao=true.',
    '- REGRA CRITICA DE DATA: use SEMPRE o campo "data_atual" do user prompt como ancora para calculos de ano. NUNCA use anos de treinamento. "ultimos 3 anos" com data_atual=2026 = anos 2024, 2025, 2026. Quando gerar filtros.anos ou qualquer lista de anos, calcule a partir de data_atual.',
    '- REGRA filtros.empresa — QUANDO USAR: gere filtros.empresa SOMENTE quando o usuario escrever explicitamente a palavra "empresa(s)" seguida de um nome na mensagem atual (ex: "empresa C3I", "empresa J2A"). Esse campo identifica uma empresa-canal IAHub (tenant/escopo de execucao), nao e um cliente cadastral.',
    '- REGRA filtros.empresa — QUANDO NAO USAR: se o usuario mencionar um nome sem a palavra "empresa" (ex: "da Softexpert", "do cliente Acme", "para a XPTO"), use filtros.cliente, filtros.fornecedor ou o campo cadastral correspondente — NUNCA filtros.empresa. filtros.empresa nao e sinonimo de cliente ou fornecedor.',
    '- REGRA filtros.empresa — CONTINUIDADE: quando o contrato anterior ja tiver filtros.empresa="X", preserve exatamente como filtros.empresa em turnos seguintes. NUNCA renomeie para filtros.cliente ou outro tipo cadastral. Exemplo: historico tem filtros.empresa="C3I" + usuario diz "e de 2025?" → novo contrato: filtros.empresa="C3I" (mantido) + periodo 2025.',
    '- REGRA filtros.empresa — MULTIPLOS FILTROS: e possivel ter filtros.empresa (tenant) E filtros.cliente (entidade cadastral) simultaneamente. Exemplo: "faturamento do ano da empresa J2A da Softexpert" → filtros.empresa="J2A" (tenant) + filtros.cliente="Softexpert" (entidade a resolver no ERP da J2A).',
    '',
    'Formato obrigatorio:',
    '{',
    '  "modulo": "financeiro"|"compras"|"faturamento"|"comissao"|"desconhecido",',
    '  "periodo": {"tipo":"nenhum"|string, "dataInicio": string|null, "dataFim": string|null},',
    '  "filtros": object,',
    '  "agrupamentos": string[]|null,',
    '  "operacao": string|null,',
    '  "carteira": "pagar"|"receber"|"ambas"|null,',
    '  "estado": string|null,',
    '  "fluxoTipo": "projetado"|"realizado"|null,',
    '  "herdou_contexto": boolean,',
    '  "contexto_usado": object|null,',
    '  "confianca": number,',
    '  "precisa_confirmacao": boolean,',
    '  "justificativa": string',
    '}',
  ].join('\n');
}

function _dataAtualServidor() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildUserPrompt({ mensagem, historicoResumido, contextoAnterior, intencoes } = {}) {
  const historico = Array.isArray(historicoResumido) ? historicoResumido : [];
  const modulos = (intencoes || [])
    .filter(i => String(i.acao || '').toLowerCase() === 'ai_text_to_sql' || String(i.nome || '').toLowerCase().endsWith('_dinamico'))
    .map(i => ({ nome: i.nome, modulo: i.modulo || _moduloPorIntencao(i.nome), descricao: i.descricao || null }));
  return JSON.stringify({
    mensagem: mensagem || '',
    data_atual: _dataAtualServidor(),
    historico_meta: {
      turnos_recebidos: historico.length,
      limite_aplicado_pelo_sistema: historico.length,
      regra: 'Use somente estes turnos. Se vierem vazios, nao invente contexto anterior.',
    },
    historico_resumido: historico,
    contexto_anterior: contextoAnterior || null,
    modulos_dinamicos_cadastrados: modulos,
    instrucao: 'Interprete a pergunta e retorne o contrato JSON. Nao gere SQL.',
  });
}

function normalizarContrato(raw, { intencoes = [], mensagem = '', hoje = new Date(), historicoResumido = [], contextoAnterior = null } = {}) {
  const parsed = _parseJsonLoose(raw);
  if (!parsed || typeof parsed !== 'object') return { ok: false, erro: 'Resposta da orquestracao nao e JSON objeto.' };
  const obj = _aplicarGuardrailsContrato(_aplicarContextoDeterministico(parsed, { mensagem, historicoResumido, contextoAnterior }), mensagem);

  const modulo = _normalizarTexto(obj.modulo || obj.dominio || obj.intent || obj.intencao).replace(/\s+/g, '_');
  const moduloFinal = MODULOS_DINAMICOS.has(modulo) ? modulo : 'desconhecido';
  if (moduloFinal === 'desconhecido') {
    return {
      ok: true,
      contrato: {
        modulo: 'desconhecido',
        intencao: 'desconhecido',
        periodo: _corrigirPeriodoAgrupamento({ periodo: obj.periodo, agrupamentos: _normalizarLista(obj.agrupamentos || obj.group_by || obj.agrupar_por), mensagem }).periodo,
        filtros: obj.filtros && typeof obj.filtros === 'object' ? obj.filtros : {},
        agrupamentos: _normalizarLista(obj.agrupamentos || obj.group_by || obj.agrupar_por),
        confianca: Number(obj.confianca ?? 0.3) || 0.3,
        precisa_confirmacao: Boolean(obj.precisa_confirmacao ?? true),
        justificativa: String(obj.justificativa || 'Modulo desconhecido.'),
      },
    };
  }

  const intencao = _intencaoPorModulo(moduloFinal, intencoes);
  if (!intencao) return { ok: false, erro: `Modulo ${moduloFinal} sem intencao dinamica cadastrada.` };

  const confianca = Math.max(0, Math.min(1, Number(obj.confianca ?? 0.85) || 0.85));
  const agrupamentosRaw = _normalizarLista(obj.agrupamentos || obj.group_by || obj.agrupar_por);
  const periodoAgrupamento = _corrigirPeriodoAgrupamento({ periodo: obj.periodo, agrupamentos: agrupamentosRaw, mensagem });
  const periodoContextual = obj.herdou_contexto
    ? _mesSemAnoExplicitoDoContexto({ periodo: periodoAgrupamento.periodo, contexto: obj.contexto_usado, mensagem })
    : null;
  // Não inferir período atual quando o agrupamento é temporal (mes/ano) — período 'nenhum' é intencional
  const temAgrupamentoTemporal = (periodoAgrupamento.agrupamentos || []).some(g => g === 'mes' || g === 'ano');
  const periodoAtualSemAno = (periodoContextual || temAgrupamentoTemporal) ? null : _periodoAtualPorTextoSemAno({ mensagem, hoje });
  const periodoFinal = periodoContextual || periodoAtualSemAno || periodoAgrupamento.periodo;
  const agrupamentos = periodoAgrupamento.agrupamentos.length ? periodoAgrupamento.agrupamentos : null;
  const filtros = _sanitizarFiltrosEntidade(
    obj.filtros && typeof obj.filtros === 'object' && !Array.isArray(obj.filtros) ? obj.filtros : {}
  );

  return {
    ok: true,
    contrato: {
      modulo: moduloFinal,
      intencao,
      periodo: periodoFinal,
      filtros,
      agrupamentos,
      operacao: obj.operacao ? _normalizarTexto(obj.operacao).replace(/\s+/g, '_') : null,
      carteira: obj.carteira ? _normalizarTexto(obj.carteira).replace(/\s+/g, '_') : null,
      estado: obj.estado ? _normalizarTexto(obj.estado).replace(/\s+/g, '_') : null,
      fluxoTipo: obj.fluxoTipo || obj.fluxo_tipo ? _normalizarTexto(obj.fluxoTipo || obj.fluxo_tipo).replace(/\s+/g, '_') : null,
      herdou_contexto: Boolean(obj.herdou_contexto),
      contexto_usado: obj.contexto_usado && typeof obj.contexto_usado === 'object' ? obj.contexto_usado : null,
      confianca,
      precisa_confirmacao: Boolean(obj.precisa_confirmacao),
      justificativa: periodoContextual
        ? 'Periodo ajustado para o ano do contexto herdado porque a pergunta citou mes sem ano explicito.'
        : periodoAtualSemAno
          ? 'Periodo ajustado para data atual porque a pergunta nao informou ano explicito.'
          : String(obj.justificativa || ''),
    },
  };
}

function contratoParaIntent(contrato, mensagem) {
  const agrupamentos = contrato.agrupamentos || null;
  return {
    intencao: contrato.intencao,
    periodo: contrato.periodo || { tipo: 'nenhum' },
    filtros: contrato.filtros || {},
    group_by: agrupamentos,
    agrupar_por: agrupamentos?.[0] || null,
    agrupar_por_composto: agrupamentos && agrupamentos.length >= 2 ? agrupamentos : null,
    ordenar_por: null,
    limite: null,
    confianca: contrato.confianca ?? 0.85,
    precisa_confirmacao: !!contrato.precisa_confirmacao,
    origem: 'ia_orquestradora',
    _provedor: 'orquestrador',
    _motor: 'ia_orquestradora',
    _dynamicAiScope: true,
    _moduloDinamico: contrato.modulo,
    _mensagemOriginal: mensagem,
    _orquestradorContrato: contrato,
    _herdouContextoOrquestrador: !!contrato.herdou_contexto,
    _contextoUsadoOrquestrador: contrato.contexto_usado || null,
  };
}

async function orquestrar({ mensagem, empresaId, keys, cfg, ordem = [], intencoes = [], historicoResumido = [], contextoAnterior = null } = {}) {
  const erros = [];
  for (const provedor of ordem) {
    if (!keys?.[provedor]) continue;
    try {
      const raw = await aiProviderClient.chamarProvedor(
        provedor,
        keys[provedor],
        buildSystemPrompt(),
        buildUserPrompt({ mensagem, historicoResumido, contextoAnterior, intencoes }),
        { json: true, maxTokens: 900, timeoutMs: 25000, logPrefix: 'IAOrquestradora' }
      );
      const normalizado = normalizarContrato(raw, { intencoes, mensagem, historicoResumido, contextoAnterior });
      if (!normalizado.ok) throw new Error(normalizado.erro);
      return {
        ok: true,
        provedor,
        raw,
        contrato: normalizado.contrato,
        intent: contratoParaIntent(normalizado.contrato, mensagem),
      };
    } catch (e) {
      erros.push({ provedor, erro: e.message });
    }
  }
  return { ok: false, erros, erro: erros.map(e => `${e.provedor}: ${e.erro}`).join(' | ') || 'Nenhum provider disponivel para orquestracao.' };
}

module.exports = {
  orquestrar,
  buildSystemPrompt,
  buildUserPrompt,
  normalizarContrato,
  contratoParaIntent,
  _periodoEfetivo,
  _contratoHistoricoRecente,
};
