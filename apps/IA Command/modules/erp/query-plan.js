'use strict';

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bdocumetnos\b/g, 'documentos')
    .replace(/\bdocumetno\b/g, 'documento')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _containsTerm(texto, termo) {
  if (!termo) return false;
  const escaped = normalizarTexto(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(texto);
}

function _containsAny(texto, termos) {
  return termos.some(termo => _containsTerm(texto, termo));
}

function _periodoTemDatas(periodo = {}) {
  return !!(periodo.dataInicio || periodo.data_inicio || periodo.dataFim || periodo.data_fim);
}

function _temPeriodo(periodo = {}) {
  return !!(periodo && periodo.tipo && periodo.tipo !== 'nenhum') || _periodoTemDatas(periodo);
}

const _GRUPOS_ENTIDADE_ANTECIPACAO = new Set(['fornecedor', 'cliente', 'documento']);

function _inferirAjusteAntecipacao(agrupamentos, texto, ajusteExistente) {
  if (_containsAny(texto, [
    // PA explícito
    'incluindo pa', 'com pa', 'com pa no periodo', 'considerando pa',
    'descontando pa', 'com desconto de pa', 'levando em conta pa',
    'deduzindo pa', 'com pa deduzido',
    // RA explícito
    'incluindo ra', 'com ra', 'com ra no periodo', 'considerando ra',
    'descontando ra', 'com desconto de ra', 'levando em conta ra',
    'deduzindo ra', 'com ra deduzido',
    // Genérico antecipação / adiantamento
    'com antecipacao', 'incluindo antecipacao', 'considerando antecipacao',
    'deduzindo antecipacao', 'descontando antecipacao', 'desconto temporal',
    'com adiantamento', 'com adiantamentos', 'incluindo adiantamento',
    'incluindo adiantamentos', 'considerando adiantamento',
  ])) return 'temporal';
  // Preserva temporal vindo da IA quando o texto não o contradiz
  if (ajusteExistente === 'temporal') return 'temporal';
  // 'vinculo' nunca é ativado automaticamente por agrupamento — apenas quando o usuário pede explicitamente PA/RA
  return 'nenhum';
}

function _sincronizarRegraPeriodo(plano = {}) {
  const ajustado = { ...(plano || {}) };
  ajustado.periodoExplicito = !!ajustado.periodoExplicito || _temPeriodo(ajustado.periodo);
  if (!ajustado.periodoExplicito) return ajustado;
  ajustado.proibirFiltroData = false;
  ajustado.regras = (ajustado.regras || []).filter(r => r !== 'nao_filtrar_data_sem_periodo_explicito');
  return ajustado;
}

function _inferirAgrupamentos(texto) {
  const grupos = [];
  const defs = [
    ['fornecedor', ['fornecedor', 'fornecedores']],
    ['cliente', ['cliente', 'clientes']],
    ['produto', ['produto', 'produtos', 'item', 'itens']],
    ['grupo_produto', ['grupo produto', 'grupo de produto', 'familia produto']],
    ['vendedor', ['vendedor', 'vendedores']],
    ['filial', ['filial', 'filiais']],
    // "banco"/"bancos" isolados removidos: aparecem em "desconsiderando os bancos X e Y" (filtro, não agrupamento)
    ['banco', ['por banco', 'por bancos']],
    ['conta', ['por conta', 'por contas', 'conta bancaria', 'contas bancarias']],
    ['natureza', ['natureza']],
    // "titulo"/"titulos" isolados mantidos pois indicam granularidade de listagem
    ['documento', ['por documento', 'por documentos', 'por titulo', 'por titulos', 'por duplicata', 'por duplicatas', 'documento', 'documentos', 'titulo', 'titulos', 'duplicata', 'duplicatas']],
    ['mes', ['por mes', 'por meses', 'mes a mes', 'todos os meses', 'todo mes', 'mensal']],
    ['ano', ['por ano', 'ano a ano', 'anual']],
    ['dia', ['por dia', 'diario', 'por data', 'por data de vencimento', 'por vencimento', 'data de vencimento']],
  ];
  for (const [grupo, termos] of defs) {
    if (_containsAny(texto, termos)) grupos.push(grupo);
  }
  return [...new Set(grupos)];
}

function _inferirPlanoFinanceiro(texto, periodo) {
  // "bancos" isolado foi removido desta lista: a palavra aparece em contextos como "desconsiderando os bancos CX1 e CX2"
  // dentro de uma pergunta de fluxo de caixa, o que causava classificação errada como saldo_bancario.
  // Resultado: query_plan enviava operacao=saldo_bancario para a IA, que gerava SQL errado nas 3 tentativas de retry.
  const saldoBancario = _containsAny(texto, ['saldo bancario', 'saldos bancarios', 'saldo dos bancos', 'saldo por banco']);
  const mencionaReceber = _containsAny(texto, [
    'contas a receber', 'a receber', 'receber', 'recebimento', 'recebimentos',
    'recebimento realizado', 'recebimentos realizados', 'contas recebidas',
    'recebido', 'recebidos', 'recebidas',
    'cobranca', 'cobrancas',
  ]);
  const mencionaPagar = _containsAny(texto, [
    'contas a pagar', 'a pagar', 'pagar', 'pagamento', 'pagamentos',
    'pagamento realizado', 'pagamentos realizados', 'contas pagas',
    'pago', 'pagos', 'pagas',
  ]);
  const comparativo = _containsAny(texto, ['comparativo', 'comparar', 'comparacao', 'versus', 'vs', 'crescimento', 'variacao']);
  const calcularPercentualCrescimento = _containsAny(texto, ['percentual de crescimento', 'crescimento percentual', 'percentual', 'variacao percentual']);
  // fluxoRealizado só dispara com termos explícitos de movimento passado — palavras genéricas como
  // "pagamentos" e "recebimentos" foram removidas pois aparecem em qualquer contexto financeiro
  // e causavam classificação errada de "fluxo de caixa 30 dias" como realizado.
  const fluxoRealizado = _containsAny(texto, [
    'fluxo de caixa realizado', 'realizado', 'passado',
    'contas recebidas', 'contas pagas',
    'baixado', 'baixados', 'baixadas', 'liquidado', 'liquidados', 'liquidadas',
  ]);
  const fluxoProjetado = _containsAny(texto, [
    'fluxo de caixa projetado', 'projetado', 'previsto', 'previsao',
    'futuro', 'a vencer', 'vencendo', 'proximos', 'proximo',
  ]);
  const carteira = mencionaReceber && mencionaPagar
    ? 'ambas'
    : mencionaReceber
      ? 'receber'
      : mencionaPagar
        ? 'pagar'
        : _containsAny(texto, ['fluxo de caixa', 'caixa'])
          ? 'ambas'
          : null;

  const estado = _containsAny(texto, ['em aberto', 'aberto', 'abertos', 'saldo', 'carteira', 'posicao', 'vencendo'])
    ? 'em_aberto'
    : _containsAny(texto, ['vencido', 'vencidos', 'atrasado', 'atrasados'])
      ? 'vencido'
      : _containsAny(texto, [
          'pago', 'pagos', 'pagas', 'pagamento', 'pagamentos',
          'pagamento realizado', 'pagamentos realizados', 'contas pagas',
          'baixado', 'baixados', 'liquidado', 'liquidados',
        ])
        ? 'pago'
        : _containsAny(texto, [
            'recebido', 'recebidos', 'recebidas', 'recebimento', 'recebimentos',
            'recebimento realizado', 'recebimentos realizados', 'contas recebidas',
            'baixado', 'baixados', 'liquidado', 'liquidados',
          ])
          ? 'recebido'
          : null;

  const operacao = saldoBancario
    ? 'saldo_bancario'
    : comparativo
    ? 'comparativo'
    : _containsAny(texto, ['fluxo de caixa', 'pagas versus recebidas', 'pago versus recebido', 'pagamentos versus recebimentos', 'pagamentos vs recebimentos'])
    ? 'fluxo_caixa'
    : estado === 'em_aberto' || _containsAny(texto, ['saldo', 'posicao', 'carteira'])
      ? 'posicao'
    : _containsAny(texto, ['listar', 'lista', 'relacao', 'documento', 'documentos', 'titulos', 'duplicatas'])
        ? 'listagem'
        : 'consulta';
  const fluxoTipo = operacao === 'fluxo_caixa'
    ? (fluxoRealizado && !fluxoProjetado ? 'realizado' : 'projetado')
    : null;
  const estadoFinal = operacao === 'fluxo_caixa' && fluxoTipo === 'projetado'
    ? 'em_aberto'
    : operacao === 'fluxo_caixa' && fluxoTipo === 'realizado'
      ? 'realizado'
      : estado;
  const dataPadrao = operacao === 'fluxo_caixa' && fluxoTipo === 'realizado'
    ? 'baixa_movimento'
    : estadoFinal === 'pago' || estadoFinal === 'recebido'
      ? 'baixa_movimento'
      : 'vencimento_real';

  const semPeriodo = !_temPeriodo(periodo);
  return {
    carteira: saldoBancario ? null : carteira,
    estado: saldoBancario ? null : estadoFinal,
    operacao,
    fluxoTipo,
    comparativo,
    calcularPercentualCrescimento,
    dataPadrao: saldoBancario ? 'saldo_atual' : dataPadrao,
    exigirSaldoAberto: !saldoBancario && semPeriodo && estadoFinal === 'em_aberto' && ['receber', 'pagar', 'ambas'].includes(carteira),
    proibirFiltroData: !saldoBancario && semPeriodo && estadoFinal === 'em_aberto' && ['receber', 'pagar', 'ambas'].includes(carteira),
  };
}

function _inferirPlanoCompras(texto) {
  return {
    carteira: null,
    estado: _containsAny(texto, ['pedido aberto', 'pedidos abertos', 'saldo pedido', 'a receber']) ? 'em_aberto' : null,
    operacao: _containsAny(texto, ['pedido', 'ordem de compra', 'oc']) ? 'pedido_compra' : 'consulta',
    dataPadrao: 'entrada',
    exigirSaldoAberto: false,
    proibirFiltroData: false,
  };
}

function _inferirPlanoFaturamento(texto) {
  return {
    carteira: null,
    estado: _containsAny(texto, ['cancelado', 'canceladas']) ? 'cancelado' : null,
    operacao: _containsAny(texto, ['nota', 'nf', 'nfe', 'documento']) ? 'notas' : 'consulta',
    dataPadrao: 'emissao',
    exigirSaldoAberto: false,
    proibirFiltroData: false,
  };
}

function _inferirPlanoComissao(texto, periodo) {
  const emAberto = _containsAny(texto, [
    'em aberto', 'aberto', 'abertos', 'pendente', 'pendentes',
    'a receber', 'nao pago', 'nao paga', 'nao liquidado', 'nao liquidada',
  ]);
  const pago = _containsAny(texto, [
    'paga', 'pagas', 'pago', 'pagos', 'processada', 'processadas',
    'realizada', 'realizadas', 'realizado', 'realizados',
  ]);
  const semPeriodo = !_temPeriodo(periodo);
  const estado = pago ? 'pago' : (emAberto || semPeriodo ? 'em_aberto' : null);
  return {
    carteira: null,
    estado,
    operacao: estado === 'em_aberto' ? 'posicao' : 'consulta',
    dataPadrao: estado === 'pago' ? 'pagamento_comissao' : 'vencimento',
    exigirSaldoAberto: false,
    proibirFiltroData: semPeriodo && estado === 'em_aberto',
  };
}

function buildQueryPlan({ modulo, mensagem, periodo = {}, filtros = {}, entidades = [] } = {}) {
  const texto = normalizarTexto(mensagem);
  const agrupamentosIniciais = _inferirAgrupamentos(texto);
  const base = {
    versao: 1,
    modulo: modulo || 'dinamico',
    periodo: periodo || { tipo: 'nenhum' },
    periodoExplicito: _temPeriodo(periodo),
    agrupamentos: agrupamentosIniciais,
    filtros: filtros || {},
    entidades: (entidades || []).map(e => ({ tipo: e.tipo, codigo: e.codigo || null, loja: e.loja || null, nome: e.nome || null })),
    regras: [],
  };

  const especifico = modulo === 'financeiro'
    ? _inferirPlanoFinanceiro(texto, periodo)
    : modulo === 'compras'
      ? _inferirPlanoCompras(texto)
      : modulo === 'faturamento'
        ? _inferirPlanoFaturamento(texto)
        : modulo === 'comissao'
          ? _inferirPlanoComissao(texto, periodo)
          : {};

  const plano = { ...base, ...especifico };
  if (plano.modulo === 'financeiro' && plano.carteira === 'receber' && plano.agrupamentos.includes('fornecedor')) {
    plano.agrupamentos = plano.agrupamentos.map(g => g === 'fornecedor' ? 'cliente' : g);
    plano.agrupamentoOriginal = 'fornecedor';
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'pagar' && plano.agrupamentos.includes('cliente')) {
    plano.agrupamentos = plano.agrupamentos.map(g => g === 'cliente' ? 'fornecedor' : g);
    plano.agrupamentoOriginal = 'cliente';
  }
  if (plano.modulo === 'financeiro' && plano.comparativo && _containsTerm(texto, 'ano') && !plano.agrupamentos.includes('ano')) {
    plano.agrupamentos.push('ano');
  }
  if (plano.proibirFiltroData) plano.regras.push('nao_filtrar_data_sem_periodo_explicito');
  if (plano.exigirSaldoAberto) plano.regras.push('exigir_saldo_em_aberto');
  if (plano.calcularPercentualCrescimento) plano.regras.push('calcular_percentual_crescimento');
  if (plano.modulo === 'financeiro' && plano.operacao === 'fluxo_caixa') {
    if (plano.fluxoTipo === 'realizado') plano.regras.push('fluxo_caixa_realizado');
    else plano.regras.push('fluxo_caixa_projetado');
  }
  if (plano.modulo === 'financeiro') {
    plano.ajusteAntecipacao = _inferirAjusteAntecipacao(plano.agrupamentos, texto, null);
  }
  return plano;
}

function buildBaseQueryPlan({ modulo, periodo = {}, filtros = {}, entidades = [] } = {}) {
  return {
    versao: 1,
    modulo: modulo || 'dinamico',
    periodo: periodo || { tipo: 'nenhum' },
    periodoExplicito: _temPeriodo(periodo),
    agrupamentos: [],
    filtros: filtros || {},
    entidades: (entidades || []).map(e => ({ tipo: e.tipo, codigo: e.codigo || null, loja: e.loja || null, nome: e.nome || null })),
    regras: [],
  };
}

function reconciliarPlanoComMensagem(plano = {}, mensagem = '') {
  const texto = normalizarTexto(mensagem);
  const ajustado = { ...(plano || {}) };
  ajustado.periodoExplicito = !!ajustado.periodoExplicito || _temPeriodo(ajustado.periodo);
  if (ajustado.operacao === 'fluxo_de_caixa') ajustado.operacao = 'fluxo_caixa';
  if (ajustado.fluxoTipo === 'projetada') ajustado.fluxoTipo = 'projetado';
  if (ajustado.fluxoTipo === 'realizada') ajustado.fluxoTipo = 'realizado';

  if (ajustado.modulo === 'financeiro' && _containsAny(texto, ['saldo bancario', 'saldos bancarios', 'saldo dos bancos', 'saldo por banco'])) {
    ajustado.operacao = 'saldo_bancario';
    ajustado.carteira = null;
    ajustado.estado = null;
    ajustado.dataPadrao = 'saldo_atual';
    ajustado.exigirSaldoAberto = false;
    ajustado.proibirFiltroData = false;
    ajustado.regras = (ajustado.regras || []).filter(r => !['exigir_saldo_em_aberto', 'nao_filtrar_data_sem_periodo_explicito'].includes(r));
  }

  if (ajustado.modulo === 'financeiro' && !['fluxo_caixa', 'saldo_bancario'].includes(ajustado.operacao)) {
    const falaPagar = _containsAny(texto, ['contas a pagar', 'a pagar', 'pagar', 'pagamento', 'pagamentos', 'fornecedor', 'fornecedores']);
    const falaReceber = _containsAny(texto, ['contas a receber', 'a receber', 'receber', 'recebimento', 'recebimentos', 'cliente', 'clientes']);
    const falaRealizado = _containsAny(texto, [
      'pago', 'pagos', 'pagas', 'pagamento realizado', 'pagamentos realizados',
      'recebido', 'recebidos', 'recebidas', 'recebimento realizado', 'recebimentos realizados',
      'baixado', 'baixados', 'baixadas', 'liquidado', 'liquidados', 'liquidadas',
    ]);
    if (falaPagar && !falaReceber) {
      ajustado.carteira = 'pagar';
      if (ajustado.agrupamentos?.includes('cliente')) {
        ajustado.agrupamentos = ajustado.agrupamentos.map(g => g === 'cliente' ? 'fornecedor' : g);
        ajustado.agrupamentoOriginal = 'cliente';
      }
    } else if (falaReceber && !falaPagar) {
      ajustado.carteira = 'receber';
      if (ajustado.agrupamentos?.includes('fornecedor')) {
        ajustado.agrupamentos = ajustado.agrupamentos.map(g => g === 'fornecedor' ? 'cliente' : g);
        ajustado.agrupamentoOriginal = 'fornecedor';
      }
    }

    if (!falaRealizado && ['pagar', 'receber'].includes(ajustado.carteira) && _containsAny(texto, ['contas a pagar', 'a pagar', 'contas a receber', 'a receber'])) {
      ajustado.estado = 'em_aberto';
      ajustado.operacao = 'posicao';
      ajustado.dataPadrao = 'vencimento_real';
      ajustado.exigirSaldoAberto = !ajustado.periodoExplicito;
      ajustado.proibirFiltroData = !ajustado.periodoExplicito;
      const regras = new Set(ajustado.regras || []);
      if (ajustado.exigirSaldoAberto) regras.add('exigir_saldo_em_aberto');
      if (ajustado.proibirFiltroData) regras.add('nao_filtrar_data_sem_periodo_explicito');
      ajustado.regras = [...regras];
    } else if (_containsAny(texto, ['em aberto', 'aberto', 'abertos', 'saldo', 'carteira', 'posicao'])) {
      ajustado.estado = 'em_aberto';
      ajustado.operacao = ajustado.operacao && ajustado.operacao !== 'consulta' ? ajustado.operacao : 'posicao';
      ajustado.dataPadrao = 'vencimento_real';
    }
  }

  const grupos = new Set(ajustado.agrupamentos || []);
  if (_containsAny(texto, ['por ano', 'ano a ano', 'anual'])) grupos.add('ano');
  if (_containsAny(texto, ['por mes', 'por meses', 'mes a mes', 'mensal'])) grupos.add('mes');
  if (_containsAny(texto, ['por banco', 'por bancos'])) grupos.add('banco');
  if (_containsAny(texto, ['por conta', 'por contas', 'conta bancaria', 'contas bancarias'])) grupos.add('conta');
  ajustado.agrupamentos = [...grupos];

  if (ajustado.modulo === 'financeiro') {
    // Passa ajusteAntecipacao existente (pode vir do plano da IA) para preservar temporal
    ajustado.ajusteAntecipacao = _inferirAjusteAntecipacao(ajustado.agrupamentos, texto, ajustado.ajusteAntecipacao);
  }

  return _sincronizarRegraPeriodo(ajustado);
}

function buildPlanSystemPrompt() {
  return [
    'Voce interpreta perguntas de ERP e retorna somente JSON valido.',
    'Nao gere SQL nesta etapa.',
    'Sua saida deve descrever a intencao em um contrato estruturado para o sistema validar depois.',
    'Voce e a autoridade principal para interpretar modulo, operacao, carteira, estado, periodo semantico, agrupamentos e regras.',
    'O sistema pode enviar periodo/filtros/historico como contexto auxiliar, mas nao como decisao final quando a pergunta indicar algo diferente.',
    'Campos permitidos: modulo, operacao, carteira, estado, dataPadrao, fluxoTipo, agrupamentos, regras.',
    'Use periodoExplicito=false quando o usuario nao mencionar data/periodo.',
    'Para financeiro em aberto sem periodo, use estado="em_aberto", operacao="posicao", regras=["nao_filtrar_data_sem_periodo_explicito","exigir_saldo_em_aberto"].',
    'Para saldo bancario atual, use operacao="saldo_bancario", carteira=null, estado=null, dataPadrao="saldo_atual"; "por banco" e agrupamento banco, nao fornecedor.',
    'Para fluxo de caixa projetado, use operacao="fluxo_caixa", carteira="ambas", fluxoTipo="projetado", estado="em_aberto", dataPadrao="vencimento_real".',
    'Para fluxo de caixa realizado, use operacao="fluxo_caixa", carteira="ambas", fluxoTipo="realizado", estado="realizado", dataPadrao="baixa_movimento".',
    'Para comissao em aberto sem periodo, use estado="em_aberto", operacao="posicao", regras=["nao_filtrar_data_sem_periodo_explicito"]. Nao use BETWEEN em E3_VENCTO quando nao houver periodo. No SQL use E3_DATA em branco se existir no SX3; nao use E3_STATUS como pagamento.',
    'Para comissao paga/realizada, use estado="pago". No SQL prefira SE3 -> SE2 -> SE5 e filtre periodo por SE5.E5_DATA quando SE2/SE5 existirem no SX2/SX3; se nao existirem, use E3_DATA preenchido como fallback. Nao use E3_STATUS="P" como pagamento, pois E3_STATUS indica geracao/processamento do titulo para o financeiro.',
    'No financeiro, contas a receber e carteira receber usam cliente/SA1; se o usuario disser fornecedor nesse contexto, normalize agrupamento/entidade para cliente.',
    'No financeiro, contas a pagar e carteira pagar usam fornecedor/SA2; se o usuario disser cliente nesse contexto, normalize agrupamento/entidade para fornecedor.',
    'No financeiro, quando o usuario pedir explicitamente para incluir, considerar, descontar, deduzir PA ou RA — ou usar sinonimos como adiantamento, antecipacao, desconto de antecipacao — adicione ajusteAntecipacao="temporal" ao JSON. Nao inclua este campo nos demais casos; o sistema derivara automaticamente.',
  ].join('\n');
}

function buildPlanUserPrompt({ modulo, mensagem, periodo, filtros, historicoResumido, orquestradorContrato } = {}) {
  const partes = [
    `Modulo esperado: ${modulo || 'dinamico'}`,
    `Pergunta: ${mensagem || ''}`,
    `Periodo candidato detectado pelo sistema: ${JSON.stringify(periodo || { tipo: 'nenhum' })}`,
    `Filtros candidatos detectados pelo sistema: ${JSON.stringify(filtros || {})}`,
  ];

  if (orquestradorContrato && typeof orquestradorContrato === 'object') {
    partes.push(`Contrato da IA Orquestradora global: ${JSON.stringify(orquestradorContrato)}`);
    partes.push('Use este contrato como decisao semantica principal, corrigindo apenas se ele contradizer explicitamente a pergunta atual.');
  }

  if (Array.isArray(historicoResumido) && historicoResumido.length) {
    const linhas = historicoResumido.map((t, idx) => {
      const p = t.periodo?.tipo && t.periodo.tipo !== 'nenhum'
        ? ` periodo=${t.periodo.tipo}${t.periodo.dataInicio ? ` (${t.periodo.dataInicio} ate ${t.periodo.dataFim})` : ''};`
        : '';
      const f = t.filtros && Object.keys(t.filtros).length
        ? ` filtros=${JSON.stringify(t.filtros)};`
        : '';
      const a = Array.isArray(t.agrupamento) && t.agrupamento.length
        ? ` agrupamento=${t.agrupamento.join('>')};`
        : '';
      return `${idx + 1}. "${t.pergunta || ''}";${p}${f}${a}`;
    }).join('\n');
    partes.push(`Historico resumido da conversa:\n${linhas}`);
    partes.push('Use o historico para resolver referencias como "mesmo periodo", "agora por fornecedor" ou "realizado", sem perder a pergunta atual.');
  }

  partes.push(
    'Importante: nao copie cegamente periodo/filtros candidatos se a pergunta atual ou o historico indicar outro contexto.',
    'Retorne apenas JSON com os campos permitidos. Nao inclua markdown.',
  );
  return partes.join('\n');
}

function normalizarPlanoIA(raw, fallbackPlan = {}) {
  let obj = raw;
  if (typeof raw === 'string') {
    const limpo = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    try { obj = JSON.parse(limpo); } catch (_) { obj = {}; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};

  const plano = {
    ...fallbackPlan,
    operacao: typeof obj.operacao === 'string' && obj.operacao ? obj.operacao : fallbackPlan.operacao,
    carteira: typeof obj.carteira === 'string' && obj.carteira ? obj.carteira : fallbackPlan.carteira,
    estado: typeof obj.estado === 'string' && obj.estado ? obj.estado : fallbackPlan.estado,
    dataPadrao: typeof obj.dataPadrao === 'string' && obj.dataPadrao ? obj.dataPadrao : fallbackPlan.dataPadrao,
    fluxoTipo: typeof obj.fluxoTipo === 'string' && obj.fluxoTipo ? normalizarTexto(obj.fluxoTipo).replace(/\s+/g, '_') : fallbackPlan.fluxoTipo,
    comparativo: typeof obj.comparativo === 'boolean' ? obj.comparativo : fallbackPlan.comparativo,
    calcularPercentualCrescimento: typeof obj.calcularPercentualCrescimento === 'boolean' ? obj.calcularPercentualCrescimento : fallbackPlan.calcularPercentualCrescimento,
  };

  if (!plano.operacao) plano.operacao = 'consulta';
  if (!Array.isArray(plano.agrupamentos)) plano.agrupamentos = fallbackPlan.agrupamentos || [];
  if (!Array.isArray(plano.regras)) plano.regras = fallbackPlan.regras || [];

  if (Array.isArray(obj.agrupamentos)) {
    plano.agrupamentos = [...new Set(obj.agrupamentos.map(g => normalizarTexto(g).replace(/\s+/g, '_')).filter(Boolean))];
  }
  if (Array.isArray(obj.regras)) {
    plano.regras = [...new Set([...(fallbackPlan.regras || []), ...obj.regras.map(r => normalizarTexto(r).replace(/\s+/g, '_')).filter(Boolean)])];
  }

  if ((plano.regras || []).includes('nao_filtrar_data_sem_periodo_explicito')) plano.proibirFiltroData = true;
  if ((plano.regras || []).includes('exigir_saldo_em_aberto')) plano.exigirSaldoAberto = true;
  if (plano.modulo === 'financeiro' && plano.operacao === 'fluxo_caixa') {
    if (!['projetado', 'realizado'].includes(plano.fluxoTipo)) plano.fluxoTipo = fallbackPlan.fluxoTipo || 'projetado';
    if (plano.fluxoTipo === 'projetado') {
      plano.estado = 'em_aberto';
      plano.dataPadrao = 'vencimento_real';
      plano.regras = [...new Set([...(plano.regras || []), 'fluxo_caixa_projetado'])];
    } else {
      plano.estado = 'realizado';
      plano.dataPadrao = 'baixa_movimento';
      plano.regras = [...new Set([...(plano.regras || []), 'fluxo_caixa_realizado'])];
    }
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'receber' && plano.agrupamentos?.includes('fornecedor')) {
    plano.agrupamentos = plano.agrupamentos.map(g => g === 'fornecedor' ? 'cliente' : g);
    plano.agrupamentoOriginal = 'fornecedor';
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'pagar' && plano.agrupamentos?.includes('cliente')) {
    plano.agrupamentos = plano.agrupamentos.map(g => g === 'cliente' ? 'fornecedor' : g);
    plano.agrupamentoOriginal = 'cliente';
  }
  if (plano.modulo === 'financeiro') {
    // ajusteIA: lido do JSON da IA; fallbackPlan.ajusteAntecipacao: do plano base
    const ajusteIA = ['nenhum', 'vinculo', 'temporal'].includes(obj.ajusteAntecipacao)
      ? obj.ajusteAntecipacao
      : (fallbackPlan.ajusteAntecipacao || null);
    plano.ajusteAntecipacao = _inferirAjusteAntecipacao(plano.agrupamentos, '', ajusteIA);
  }
  return _sincronizarRegraPeriodo(plano);
}

function formatQueryPlanForPrompt(plano = {}) {
  if (!plano || !plano.versao) return '';
  const linhas = [
    'Plano estruturado da consulta (contrato obrigatorio entre interpretacao e SQL):',
    `  modulo: ${plano.modulo || 'dinamico'}`,
    `  operacao: ${plano.operacao || 'consulta'}`,
    `  carteira: ${plano.carteira || 'nao_aplicavel'}`,
    `  estado: ${plano.estado || 'nao_informado'}`,
    `  periodo: ${plano.periodoExplicito ? 'explicito' : 'nenhum'}`,
  ];
  if (plano.fluxoTipo) linhas.push(`  fluxo_tipo: ${plano.fluxoTipo}`);
  if (plano.dataPadrao) linhas.push(`  campo_data_semantico: ${plano.dataPadrao}`);
  // agrupamentos não são enviados para a IA — ela infere da pergunta original.
  // O campo é usado apenas internamente (correções de domínio e validações).
  if (Array.isArray(plano.regras) && plano.regras.length) linhas.push(`  regras: ${plano.regras.join(', ')}`);
  if (plano.comparativo) linhas.push('  comparativo: gere linhas comparaveis para os periodos solicitados.');
  if (plano.calcularPercentualCrescimento) linhas.push('  calculo_obrigatorio: incluir percentual de crescimento/variacao entre ano_base e ano_comparacao.');
  if (plano.proibirFiltroData) linhas.push('  proibido: adicionar filtro de data quando periodo=nenhum.');
  if (plano.exigirSaldoAberto) linhas.push('  obrigatorio: filtrar saldo em aberto na carteira correspondente.');
  if (plano.modulo === 'financeiro' && plano.ajusteAntecipacao) {
    if (plano.ajusteAntecipacao === 'nenhum') {
      if (plano.carteira === 'pagar') {
        linhas.push("  financeiro_antecipacao: excluir PA; use WHERE SE2.E2_TIPO <> 'PA'. Nao use E1_TIPO nem SE1 em contas a pagar. Nao use CASE WHEN para PA.");
      } else if (plano.carteira === 'receber') {
        linhas.push("  financeiro_antecipacao: excluir RA; use WHERE SE1.E1_TIPO <> 'RA'. Nao use E2_TIPO nem SE2 em contas a receber. Nao use CASE WHEN para RA.");
      } else {
        linhas.push("  financeiro_antecipacao: excluir PA e RA; use WHERE SE2.E2_TIPO <> 'PA' para pagar e WHERE SE1.E1_TIPO <> 'RA' para receber. Nao use CASE WHEN para PA/RA.");
      }
    } else if (plano.ajusteAntecipacao === 'vinculo') {
      linhas.push("  financeiro_antecipacao: deduzir PA/RA vinculado a entidade; use CASE WHEN E2_TIPO = 'PA' THEN -E2_SALDO ELSE E2_SALDO END.");
    } else if (plano.ajusteAntecipacao === 'temporal') {
      linhas.push("  financeiro_antecipacao: deduzir PA/RA por periodo (usuario solicitou); use CASE WHEN E2_TIPO = 'PA' THEN -E2_SALDO ELSE E2_SALDO END.");
    }
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'receber') {
    linhas.push('  financeiro_receber: use SE1 + SA1; nao use SA2/fornecedor em contas a receber.');
    if (plano.estado === 'recebido') {
      linhas.push(`  financeiro_receber_recebido: modelo_baixas_receber=${plano.modelo_baixas_receber || 'SE5'}. SE modelo=FK1: JOIN FK1 por FK1.FK1_FILIAL=SE1.E1_FILIAL AND FK1.FK1_PREFIXO=SE1.E1_PREFIXO AND FK1.FK1_NUM=SE1.E1_NUM AND FK1.FK1_PARCELA=SE1.E1_PARCELA AND FK1.FK1_TIPO=SE1.E1_TIPO AND FK1.D_E_L_E_T_=' ', filtro FK1.FK1_DATA, some FK1.FK1_VALOR. SE modelo=SE5: JOIN SE5 por E5_PREFIXO=E1_PREFIXO AND E5_NUMERO=E1_NUM AND E5_PARCELA=E1_PARCELA AND E5_TIPO=E1_TIPO AND E5_CLIFOR=E1_CLIENTE AND E5_LOJA=E1_LOJA AND E5_RECPAG='R' AND E5_SITUACAO<>'C' AND E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_=' ', filtro SE5.E5_DATA, some SE5.E5_VALOR. Use SOMENTE o modelo indicado.`);
      linhas.push('  financeiro_receber_recebido: PROIBIDO usar SE1.E1_BAIXA, E1_EMISSAO, E1_VENCREA, E1_VENCTO. NAO filtre SE1.E1_SITUACAO (titulo pode ter baixa parcial).');
    }
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'pagar') {
    linhas.push('  financeiro_pagar: use SE2 + SA2; nao use SA1/cliente em contas a pagar.');
    if (plano.estado === 'pago') {
      linhas.push('  financeiro_pagar_pago: use somente SE2 + SA2; nao use SE1/SA1, recebimentos nem UNION ALL.');
      linhas.push(`  financeiro_pagar_pago: modelo_baixas_pagar=${plano.modelo_baixas_pagar || 'SE5'}. SE modelo=FK2: JOIN FK2 por FK2.FK2_FILIAL=SE2.E2_FILIAL AND FK2.FK2_PREFIXO=SE2.E2_PREFIXO AND FK2.FK2_NUM=SE2.E2_NUM AND FK2.FK2_PARCELA=SE2.E2_PARCELA AND FK2.FK2_TIPO=SE2.E2_TIPO AND FK2.D_E_L_E_T_=' ', filtro FK2.FK2_DATA, some FK2.FK2_VALOR. SE modelo=SE5: JOIN SE5 por E5_PREFIXO=E2_PREFIXO AND E5_NUMERO=E2_NUM AND E5_PARCELA=E2_PARCELA AND E5_TIPO=E2_TIPO AND E5_CLIFOR=E2_FORNECE AND E5_LOJA=E2_LOJA AND E5_RECPAG='P' AND E5_SITUACAO<>'C' AND E5_TIPO NOT IN ('EST','ED') AND SE5.D_E_L_E_T_=' ', filtro SE5.E5_DATA, some SE5.E5_VALOR. Use SOMENTE o modelo indicado.`);
      linhas.push('  financeiro_pagar_pago: PROIBIDO usar SE2.E2_BAIXA, E2_EMISSAO, E2_VENCREA, E2_VENCTO, SE2.E2_SITUACAO, SE2.E2_VALOR ou SE2.E2_SALDO como base de pagamento realizado.');
    }
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'ambas') {
    const estadoAmbas = plano.estado;
    if (estadoAmbas === 'recebido' || estadoAmbas === 'pago' || estadoAmbas === 'realizado') {
      linhas.push('  financeiro_ambas_realizado: gere UM UNICO SELECT com duas colunas: valor_recebido e valor_pago. Use duas subqueries escalares no SELECT — uma para SE1+SE5/FK1 e outra para SE2+SE5/FK2. PROIBIDO gerar dois SELECTs separados ou UNION ALL.');
      linhas.push(`  financeiro_ambas_realizado: modelo_baixas_receber=${plano.modelo_baixas_receber || 'SE5'}, modelo_baixas_pagar=${plano.modelo_baixas_pagar || 'SE5'}. Use os modelos indicados para cada subquery.`);
      linhas.push("  financeiro_ambas_realizado: estrutura obrigatoria: SELECT (SELECT COALESCE(SUM(...),0) FROM SE1 JOIN SE5/FK1 ON ... AND SE5.D_E_L_E_T_ = ' ' WHERE SE1.D_E_L_E_T_ = ' ' AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.E5_DATA BETWEEN ...) AS valor_recebido, (SELECT COALESCE(SUM(...),0) FROM SE2 JOIN SE5/FK2 ON ... AND SE5.D_E_L_E_T_ = ' ' WHERE SE2.D_E_L_E_T_ = ' ' AND SE5.E5_TIPO NOT IN ('EST','ED') AND SE5.E5_DATA BETWEEN ...) AS valor_pago. OBRIGATORIO: SE1.D_E_L_E_T_ = ' ' no WHERE da subquery de receber; SE2.D_E_L_E_T_ = ' ' no WHERE da subquery de pagar.");
    } else {
      linhas.push('  financeiro_ambas: receber usa SE1 + SA1, pagar usa SE2 + SA2; nao faca JOIN direto entre SE1 e SE2.');
    }
  }
  if (plano.modulo === 'financeiro' && plano.operacao === 'fluxo_caixa') {
    if (plano.fluxoTipo === 'projetado' || !plano.fluxoTipo) {
      linhas.push('  fluxo_caixa_projetado: SE8 fornece o saldo bancario inicial via CTE com ROW_NUMBER (rn=1), filtrado por E8_BANCO NOT IN (...). Esse saldo deve ser referenciado como subquery escalar no SELECT: (SELECT COALESCE(SUM(saldo_recente.E8_SALATUA),0) FROM saldo_recente WHERE saldo_recente.rn = 1). PROIBIDO JOIN de SE1 ou SE2 com SE8/saldo_recente — sao independentes.');
      linhas.push('  fluxo_caixa_projetado: SE1 e SE2 sao consultadas separadamente por data de vencimento (E1_VENCREA / E2_VENCREA). Some E1_SALDO (nao E1_VALOR) para entradas e E2_SALDO (nao E2_VALOR) para saidas. PROIBIDO JOIN direto entre SE1 e SE2.');
    } else {
      linhas.push('  fluxo_caixa_realizado: formula obrigatoria = movimentos ja realizados filtrados por E5_DATA no periodo.');
      linhas.push('  fluxo_caixa_realizado: use SE5 filtrado por E5_DATA. SE5.E5_RECPAG = \'R\' para entradas, \'P\' para saidas. PROIBIDO usar SE1/SE2 como tabela principal.');
    }
  }
  return linhas.join('\n');
}

function _camposDataPorPlano(plano = {}) {
  if (plano.modulo === 'financeiro') {
    if (plano.operacao === 'saldo_bancario') return ['E8_DTSALAT'];
    if (plano.carteira === 'receber') return ['E1_VENCREA', 'E1_VENCTO', 'E1_EMISSAO', 'E1_BAIXA'];
    if (plano.carteira === 'pagar') return ['E2_VENCREA', 'E2_VENCTO', 'E2_EMISSAO', 'E2_BAIXA'];
    return ['E1_VENCREA', 'E1_VENCTO', 'E1_EMISSAO', 'E1_BAIXA', 'E2_VENCREA', 'E2_VENCTO', 'E2_EMISSAO', 'E2_BAIXA'];
  }
  if (plano.modulo === 'compras') return ['F1_DTDIGIT', 'F1_EMISSAO', 'D1_EMISSAO', 'C7_EMISSAO', 'C7_DATPRF'];
  if (plano.modulo === 'faturamento') return ['F2_EMISSAO', 'D2_EMISSAO'];
  if (plano.modulo === 'comissao') return ['E3_VENCTO', 'E3_DATA'];
  return [];
}

function validarSqlContraPlano(sql, plano = {}) {
  const texto = String(sql || '');
  if (!plano || !plano.versao) return { ok: true, erros: [] };

  const erros = [];
  const campoTemFiltro = campo => {
    const c = String(campo || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const campoRe = `(?:[A-Z][A-Z0-9_]*\\.)?${c}`;
    return [
      new RegExp(`\\b${campoRe}\\s*(?:BETWEEN|>=|<=|=|>|<)`, 'i'),
      new RegExp(`\\b${campoRe}\\s+IN\\s*\\(`, 'i'),
      new RegExp(`\\b(?:SUBSTRING|LEFT|RIGHT)\\s*\\(\\s*${campoRe}[\\s\\S]{0,120}\\)\\s*(?:BETWEEN|>=|<=|=|>|<|IN\\s*\\()`, 'i'),
    ].some(re => re.test(texto));
  };

  if (plano.proibirFiltroData) {
    const campos = _camposDataPorPlano(plano);
    if (campos.length) {
      if (campos.some(campoTemFiltro)) {
        erros.push('SQL aplicou filtro de data apesar de o plano indicar periodo=nenhum.');
      }
    }
  }

  if (plano.exigirSaldoAberto) {
    if ((plano.carteira === 'receber' || plano.carteira === 'ambas') && !/\bE1_SALDO\b\s*>\s*0\b/i.test(texto)) {
      erros.push('SQL nao filtrou E1_SALDO > 0 para contas a receber em aberto.');
    }
    if ((plano.carteira === 'pagar' || plano.carteira === 'ambas') && !/\bE2_SALDO\b\s*>\s*0\b/i.test(texto)) {
      erros.push('SQL nao filtrou E2_SALDO > 0 para contas a pagar em aberto.');
    }
  }

  if (plano.modulo === 'financeiro' && plano.dataPadrao === 'baixa_movimento') {
    // Reconhece SE5990, SE5010, SE5 e o placeholder SE5xxx gerado pelo LLM
    const temSe5 = /\b(?:FROM|JOIN)\s+SE5(?:\d{3,4}|[Xx]{3})?\b/i.test(texto);
    const temFiltroEstorno = /E5_TIPO\s+NOT\s+IN\s*\(\s*'EST'\s*,\s*'ED'\s*\)/i.test(texto)
      || /E5_TIPO\s+NOT\s+IN\s*\(\s*'ED'\s*,\s*'EST'\s*\)/i.test(texto);
    if (temSe5 && !temFiltroEstorno) {
      erros.push("SQL usa SE5 mas nao filtrou estornos: adicione AND SE5.E5_TIPO NOT IN ('EST','ED') no JOIN de SE5. Estornos devem ser excluidos do valor realizado.");
    }

    if (plano.carteira === 'ambas') {
      const temSe5OuFk = /\b(?:FROM|JOIN)\s+(?:SE5|FK1|FK2)(?:\d{3,4}|[Xx]{3})?\b/i.test(texto);
      if (!temSe5OuFk) {
        erros.push('SQL de contas recebidas e pagas (realizadas) nao usou SE5, FK1 nem FK2; use subqueries escalares com SE1+SE5/FK1 para valor_recebido e SE2+SE5/FK2 para valor_pago. PROIBIDO FULL OUTER JOIN entre SE1 e SE2 com E1_VALOR/E2_VALOR.');
      }
      if (/\bFULL\s+(?:OUTER\s+)?JOIN\b/i.test(texto)) {
        erros.push('SQL usou FULL OUTER JOIN para contas realizadas (ambas); use UM UNICO SELECT com duas subqueries escalares: (SELECT COALESCE(SUM(SE5.E5_VALOR),0) FROM SE1 JOIN SE5 ...) AS valor_recebido, (SELECT COALESCE(SUM(SE5.E5_VALOR),0) FROM SE2 JOIN SE5 ...) AS valor_pago.');
      }
      if (/\bUNION\s+ALL\b/i.test(texto)) {
        erros.push("SQL usou UNION ALL para contas realizadas (carteira=ambas); PROIBIDO. Gere UM UNICO SELECT com duas subqueries escalares: SELECT (SELECT COALESCE(SUM(SE5.E5_VALOR),0) FROM SE1 JOIN SE5 WHERE ... AND SE5.E5_TIPO NOT IN ('EST','ED')) AS valor_recebido, (SELECT COALESCE(SUM(SE5.E5_VALOR),0) FROM SE2 JOIN SE5 WHERE ... AND SE5.E5_TIPO NOT IN ('EST','ED')) AS valor_pago.");
      }
    }
    if (plano.carteira === 'pagar') {
      const usaDataErrada = ['E2_VENCREA', 'E2_VENCTO', 'E2_EMISSAO', 'E2_BAIXA'].some(campoTemFiltro);
      if (usaDataErrada) {
        erros.push('SQL filtrou pagamento realizado por vencimento/emissao/E2_BAIXA; use modelo_baixas_pagar do contextoTecnico: FK2 (JOIN por FILIAL+PREFIXO+NUM+PARCELA+TIPO, filtro FK2.FK2_DATA) ou SE5 (JOIN por E5_PREFIXO=E2_PREFIXO AND E5_NUMERO=E2_NUM AND E5_PARCELA=E2_PARCELA AND E5_TIPO=E2_TIPO AND E5_CLIFOR=E2_FORNECE AND E5_LOJA=E2_LOJA AND E5_RECPAG=\'P\' AND E5_SITUACAO<>\'C\', filtro SE5.E5_DATA).');
      }
      const temFk2OuSe5 = /\b(?:FROM|JOIN)\s+FK2\d{0,3}\b/i.test(texto) || /\b(?:FROM|JOIN)\s+SE5\d{0,3}\b/i.test(texto);
      if (!temFk2OuSe5) {
        erros.push('SQL de pagamento realizado nao usou FK2 nem SE5; verifique modelo_baixas_pagar no contextoTecnico e gere JOIN com FK2 (se disponivel) ou SE5 para obter a data e o valor real de pagamento.');
      }
    }
    if (plano.carteira === 'receber') {
      const usaDataErrada = ['E1_VENCREA', 'E1_VENCTO', 'E1_EMISSAO', 'E1_BAIXA'].some(campoTemFiltro);
      if (usaDataErrada) {
        erros.push('SQL filtrou recebimento realizado por vencimento/emissao/E1_BAIXA; use modelo_baixas_receber do contextoTecnico: FK1 (JOIN por FILIAL+PREFIXO+NUM+PARCELA+TIPO, filtro FK1.FK1_DATA) ou SE5 (JOIN por E5_PREFIXO=E1_PREFIXO AND E5_NUMERO=E1_NUM AND E5_PARCELA=E1_PARCELA AND E5_TIPO=E1_TIPO AND E5_CLIFOR=E1_CLIENTE AND E5_LOJA=E1_LOJA AND E5_RECPAG=\'R\' AND E5_SITUACAO<>\'C\', filtro SE5.E5_DATA). NAO filtre SE1.E1_SITUACAO.');
      }
      const temFk1OuSe5 = /\b(?:FROM|JOIN)\s+FK1\d{0,3}\b/i.test(texto) || /\b(?:FROM|JOIN)\s+SE5\d{0,3}\b/i.test(texto);
      if (!temFk1OuSe5) {
        erros.push('SQL de recebimento realizado nao usou FK1 nem SE5; verifique modelo_baixas_receber no contextoTecnico e gere JOIN com FK1 (se disponivel) ou SE5 para obter a data e o valor real de recebimento.');
      }
    }
  }

  if (plano.modulo === 'financeiro' && plano.operacao === 'fluxo_caixa' && plano.fluxoTipo === 'projetado') {
    // SE5 no FROM/JOIN principal de fluxo projetado é erro: fluxo projetado usa SE1+SE2 (carteiras abertas), não baixas realizadas.
    // Permite SE5 apenas dentro de subquery escalar de baixas (JOIN SE5 ON ...) — padrão legítimo em continuidade multi-turno.
    // Detecção: SE5 no FROM principal = SE5 aparece como primeira tabela ou após FROM sem estar dentro de subquery de baixas
    const temSe5Principal = /\bFROM\s+SE5(?:\d{3,4}|[Xx]{3})?\s+SE5\b/i.test(texto);
    if (temSe5Principal) {
      erros.push(
        'Fluxo de caixa PROJETADO nao pode usar SE5 como tabela principal (FROM SE5). ' +
        'SE5 sao baixas ja realizadas — nao projecao. ' +
        'Use: SE8 (saldo bancario atual) + SE1.E1_SALDO > 0 filtrado por E1_VENCREA (entradas futuras) + SE2.E2_SALDO > 0 filtrado por E2_VENCREA (saidas futuras). ' +
        'Gere o SQL novamente com SE8 + SE1 + SE2.'
      );
    }
  }

  if (plano.modulo === 'financeiro' && plano.operacao === 'saldo_bancario') {
    if (!/\b(?:FROM|JOIN)\s+SE8\d{0,3}\b/i.test(texto) && !/\bSE8\s*\./i.test(texto)) {
      erros.push('SQL de saldo bancario deve usar SE8.');
    }
    if (plano.agrupamentos?.includes('banco') && (/\b(?:FROM|JOIN)\s+SA2\d{0,3}\b/i.test(texto) || /\bSA2\s*\./i.test(texto))) {
      erros.push('SQL de saldo bancario por banco usou SA2/fornecedor; use SA6.');
    }
  }

  if (plano.modulo === 'financeiro' && plano.carteira === 'receber') {
    if (/\b(?:FROM|JOIN)\s+SE2\d{0,3}\b/i.test(texto) || /\bSE2\s*\./i.test(texto)) {
      erros.push('SQL usou SE2/contas a pagar em consulta de contas a receber; use somente SE1 + SA1.');
    }
    if (/\b(?:FROM|JOIN)\s+SA2\d{0,3}\b/i.test(texto) || /\bSA2\s*\./i.test(texto)) {
      erros.push('SQL usou SA2/fornecedor em consulta de contas a receber; use SE1 + SA1.');
    }
  }
  if (plano.modulo === 'financeiro' && plano.carteira === 'pagar') {
    if (/\b(?:FROM|JOIN)\s+SE1\d{0,3}\b/i.test(texto) || /\bSE1\s*\./i.test(texto)) {
      erros.push('SQL usou SE1/contas a receber em consulta de contas a pagar; use somente SE2 + SA2.');
    }
    if (/\b(?:FROM|JOIN)\s+SA1\d{0,3}\b/i.test(texto) || /\bSA1\s*\./i.test(texto)) {
      erros.push('SQL usou SA1/cliente em consulta de contas a pagar; use SE2 + SA2.');
    }
  }

  return { ok: erros.length === 0, erros };
}

function extrairAliasesSelectAgregado(sql) {
  const texto = String(sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  if (!/\b(?:SUM|COUNT|AVG|MIN|MAX)\s*\(/i.test(texto)) return [];

  const selectMatch = texto.match(/\bSELECT\b/i);
  if (!selectMatch) return [];
  const fromMatch = texto.slice(selectMatch.index + selectMatch[0].length).match(/\bFROM\b/i);
  if (!fromMatch) return [];

  const selectList = texto.slice(
    selectMatch.index + selectMatch[0].length,
    selectMatch.index + selectMatch[0].length + fromMatch.index
  );
  const aliases = [];
  const reAliasAgregado = /\b(?:SUM|COUNT|AVG|MIN|MAX)\s*\([\s\S]*?\)\s+AS\s+\[?([A-Z_][A-Z0-9_]*)\]?/gi;
  let m;
  while ((m = reAliasAgregado.exec(selectList)) !== null) aliases.push(m[1]);
  return [...new Set(aliases)];
}

function rowsZeroParaAgregadoSemLinhas(sql) {
  const aliases = extrairAliasesSelectAgregado(sql);
  if (!aliases.length) return null;
  return [Object.fromEntries(aliases.map(alias => [alias, 0]))];
}

/**
 * Enriquece o contrato do orquestrador com o group_by acumulado pelo merger.
 * O orquestrador vê apenas o turno atual (ex: "por dia" → agrupamentos:['dia']),
 * enquanto o merger acumula todos os níveis (ex: ['mes','fornecedor','dia']).
 * Usado exclusivamente no _interpretarPlanoConsulta — NÃO usar no temporal-contract.
 */
function enriquecerContratoComGroupBy(contrato, intent) {
  if (!contrato) return null;
  const groupByMerged =
    (Array.isArray(intent?.group_by) && intent.group_by.length ? intent.group_by : null)
    || (Array.isArray(intent?.agrupar_por_composto) && intent.agrupar_por_composto.length ? intent.agrupar_por_composto : null)
    || (intent?.agrupar_por ? [String(intent.agrupar_por).toLowerCase()] : null);
  if (!groupByMerged) return contrato;
  const contratoAgrup = Array.isArray(contrato.agrupamentos) ? contrato.agrupamentos : [];
  if (groupByMerged.length <= contratoAgrup.length) return contrato;
  return { ...contrato, agrupamentos: groupByMerged };
}

module.exports = {
  normalizarTexto,
  buildQueryPlan,
  buildBaseQueryPlan,
  reconciliarPlanoComMensagem,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  normalizarPlanoIA,
  formatQueryPlanForPrompt,
  validarSqlContraPlano,
  extrairAliasesSelectAgregado,
  rowsZeroParaAgregadoSemLinhas,
  enriquecerContratoComGroupBy,
};
