'use strict';

const UI_ACOES = new Set(['INCLUIR', 'ALTERAR', 'VISUALIZAR', 'CONSULTAR', 'EXCLUIR', 'CONFIRMAR', 'CANCELAR', 'SALVAR', 'FECHAR']);
const IGNORAR = new Set(['TOTVS', 'PROTHEUS', 'SOFTEXPERT', 'PDF', 'PNG', 'JPG', 'XML', 'JSON', 'HTTP', 'HTTPS', 'SLA', 'IA', 'API']);

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function compactar(texto, max = 280) {
  const s = String(texto || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function removerIdsInternos(texto) {
  return String(texto || '')
    .replace(/\baud[-\u2010-\u2015]?(?:msg|an|at|ch)[-\u2010-\u2015]?[a-z0-9_.:-]+\b/gi, '[ID_INTERNO]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[ID_INTERNO]');
}

function tipoIdentificador(termo) {
  const t = String(termo || '').toUpperCase();
  if (UI_ACOES.has(t)) return 'acao_tela';
  if (/^MV_[A-Z0-9_]+$/.test(t)) return 'parametro';
  if (/^U_[A-Z0-9_]+$/.test(t)) return 'funcao_custom';
  if (/^SIGA[A-Z0-9]+$/.test(t)) return 'modulo';
  if (/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_.]*$/.test(t)) return 'fonte';
  if (/^(?:MATA|FINA|PGCA|OMSA|GPEA|CTBA|CNTA|ATFA|COMA|FATA|OM)[A-Z0-9_]*\d[A-Z0-9_]*$/.test(t)) return 'rotina';
  if (/^(?:SX[235]|S[A-Z0-9]{2}|[A-Z]\d_[A-Z0-9_]+|B1_[A-Z0-9_]+|F1_[A-Z0-9_]+|D1_[A-Z0-9_]+)$/.test(t)) return 'tabela_campo';
  if (/^[A-Z][A-Z0-9_]{2,}_[A-Z0-9_]+$/.test(t)) return 'funcao_custom';
  if (/^[A-Z]\d[A-Z0-9_]{3,}$/.test(t)) return 'rotina_ou_codigo';
  if (/^[A-Z]{3,}\d{2,}[A-Z0-9_]*$/.test(t)) return 'rotina_ou_codigo';
  if (/APP$|EXECUTE|CALL|STACK|TRACE/.test(t)) return 'stack';
  return 'termo_comum';
}

function extrairTermosTecnicos(texto) {
  const s = String(texto || '');
  const encontrados = s.match(/\b(?:MV_[A-Z0-9_]+|U_[A-Z0-9_]+|SIGA[A-Z0-9]+|[A-Z]\d_[A-Z0-9_]+|[A-Z]\d[A-Z0-9_]{3,}|[A-Z]{3,}\d{2,}[A-Z0-9_]*|[A-Z][A-Z0-9_]{2,}_[A-Z0-9_]+|[A-Z]{2,}[A-Z0-9_]{3,}|[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_.]*)\b/g) || [];
  return [...new Set(encontrados.map(t => t.toUpperCase()).filter(t => {
    if (t.length < 5 || IGNORAR.has(t)) return false;
    const tipo = tipoIdentificador(t);
    return tipo !== 'acao_tela' && tipo !== 'termo_comum';
  }))].map(termo => ({ termo, tipo: tipoIdentificador(termo) }));
}

function adicionarTermo(map, termo, origem, usoPermitido, extra = {}) {
  if (!termo?.termo) return;
  const chave = termo.termo.toUpperCase();
  const atual = map.get(chave) || {
    termo: chave,
    tipo: termo.tipo,
    origens: [],
    usoPermitido,
    causalPermitido: false,
  };
  if (!atual.origens.some(o => o.origem === origem.origem && o.referencia === origem.referencia)) {
    atual.origens.push(origem);
  }
  if (usoPermitido === 'fato_do_chamado' || usoPermitido === 'hipotese_sustentada') atual.usoPermitido = usoPermitido;
  if (extra.causalPermitido) atual.causalPermitido = true;
  map.set(chave, atual);
}

function montarPlano({ manifesto = {}, pesquisaTexto = '', evidenciasSelecionadas = [] } = {}) {
  const quadro = manifesto.quadroInvestigativo || {};
  const termos = new Map();
  const fatosComprovados = [];
  const hipotesesFundamentadas = [];
  const referenciasExternas = [];
  const lacunas = [];

  if (quadro.problemaPrincipal) {
    fatosComprovados.push({
      id: 'fato-problema-principal',
      texto: compactar(quadro.problemaPrincipal),
      origem: 'quadro_investigativo',
      vinculoProblema: 'central',
      permissaoUso: 'fato_contextual',
    });
  }

  if (quadro.estadoOperacional) {
    fatosComprovados.push({
      id: 'fato-estado-operacional',
      texto: `Estado operacional: ${quadro.estadoOperacional}`,
      origem: 'quadro_investigativo',
      vinculoProblema: 'operacional',
      permissaoUso: 'fato_operacional',
    });
  }

  for (const acao of [...(quadro.acoesExecutadas || []), ...(quadro.acoesSolicitadasOuPlanejadas || [])].slice(0, 10)) {
    fatosComprovados.push({
      id: `fato-operacional-${fatosComprovados.length + 1}`,
      texto: compactar(acao.evidencia || `${acao.tipo} ${acao.status}`),
      origem: acao.origem || 'historico',
      vinculoProblema: 'operacional',
      permissaoUso: 'fato_operacional',
    });
  }

  for (const ev of quadro.evidencias || []) {
    const papel = (ev.papeis || [])[0] || 'TECNICA_RELACIONADA';
    const origem = {
      origem: ev.origem || 'manifesto',
      referencia: ev.referencia || ev.origem || null,
      papel,
      vinculoCausal: ev.vinculoCausal || null,
    };
    if ((ev.papeis || []).includes('CENTRAL') || (ev.papeis || []).includes('OPERACIONAL')) {
      fatosComprovados.push({
        id: `fato-evidencia-${fatosComprovados.length + 1}`,
        texto: compactar(ev.resumo || ev.referencia),
        origem: origem.origem,
        referencia: origem.referencia,
        vinculoProblema: (ev.papeis || []).includes('CENTRAL') ? 'central' : 'operacional',
        permissaoUso: 'fato_do_chamado',
      });
    } else if ((ev.papeis || []).includes('TECNICA_RELACIONADA')) {
      hipotesesFundamentadas.push({
        id: `hipotese-evidencia-${hipotesesFundamentadas.length + 1}`,
        texto: compactar(ev.resumo || ev.referencia),
        origem: origem.origem,
        referencia: origem.referencia,
        vinculoProblema: 'possivel',
        permissaoUso: 'hipotese_a_validar',
        testeNecessario: 'Confirmar vinculo causal com o sintoma principal antes de tratar como causa.',
      });
    } else if ((ev.papeis || []).includes('INCIDENTAL')) {
      lacunas.push({
        id: `lacuna-incidental-${lacunas.length + 1}`,
        texto: `Evidencia ${ev.referencia || ev.origem || 'sem referencia'} e incidental: ${ev.vinculoCausal || 'vinculo causal nao demonstrado'}`,
        origem: origem.origem,
        bloqueiaConclusao: true,
      });
    }
    for (const termo of extrairTermosTecnicos([ev.referencia, ev.resumo].filter(Boolean).join(' '))) {
      adicionarTermo(termos, termo, origem, (ev.papeis || []).includes('CENTRAL') ? 'fato_do_chamado' : 'contexto_ou_hipotese', {
        causalPermitido: (ev.papeis || []).includes('CENTRAL') && !/nao demonstrado/i.test(ev.vinculoCausal || ''),
      });
    }
  }

  // Varre o TEXTO COMPLETO das evidencias selecionadas (anexos e mensagens
  // de historico que de fato entraram no prompt), nao so o resumo compactado
  // do quadro investigativo — achado real, auditoria 2026-10: o PRR so
  // extraia termos tecnicos do quadro investigativo resumido (360 chars),
  // nunca do conteudo integral de anexos (PDF, log, codigo-fonte), bloqueando
  // citacao legitima de termo presente no proprio anexo selecionado.
  // Autorizado como 'contexto_ou_hipotese' (nao 'fato_do_chamado') e
  // causalPermitido=false deliberadamente: o anexo estar selecionado prova
  // que o termo e rastreavel (nao inventado), mas nao prova por si so que
  // o termo e a CAUSA do problema — essa inferencia ainda precisa de ponte
  // causal demonstrada na resposta, igual a qualquer evidencia TECNICA_
  // RELACIONADA do quadro investigativo (decisao explicita do usuario:
  // nao autorizar automaticamente como verdade tecnica tudo que estiver
  // em um anexo).
  for (const evidencia of evidenciasSelecionadas) {
    if (!evidencia?.texto) continue;
    const origem = {
      origem: evidencia.origem || 'evidencia_selecionada',
      referencia: evidencia.referencia || null,
      papel: 'evidencia_selecionada',
    };
    for (const termo of extrairTermosTecnicos(evidencia.texto)) {
      adicionarTermo(termos, termo, origem, 'contexto_ou_hipotese', { causalPermitido: false });
    }
  }

  for (const obs of manifesto.observacoesVisuais || []) {
    const texto = [
      obs.nome,
      ...(obs.textosVisiveis || []),
      ...(obs.campos || []),
      ...(obs.valores || []),
      obs.observacao,
    ].filter(Boolean).join(' ');
    for (const termo of extrairTermosTecnicos(texto)) {
      adicionarTermo(termos, termo, {
        origem: 'observacao_visual',
        referencia: obs.nome || obs.anexoId || null,
        papel: 'visual',
      }, 'contexto_visual');
    }
  }

  for (const termo of extrairTermosTecnicos(pesquisaTexto)) {
    const item = {
      termo: termo.termo,
      tipo: termo.tipo,
      origem: 'pesquisa_externa',
      usoPermitido: 'apoio_externo_apenas',
      causalPermitido: false,
      restricao: 'Nao apresentar como fato do chamado nem como causa sem ponte causal com evidencia interna.',
    };
    referenciasExternas.push(item);
    adicionarTermo(termos, termo, { origem: 'pesquisa_externa', referencia: null, papel: 'externa' }, 'apoio_externo_apenas');
  }

  for (const l of quadro.lacunasInformacao || []) {
    lacunas.push({
      id: `lacuna-quadro-${lacunas.length + 1}`,
      texto: l,
      origem: 'quadro_investigativo',
      bloqueiaConclusao: /nao ha|falta|sem vinculo|lacuna|indisponivel|omitid|nao afirmar conteudo/i.test(l),
    });
  }

  const proximoPasso = {
    tipo: lacunas.some(l => l.bloqueiaConclusao) ? 'reduzir_incerteza' : 'acao_tecnica',
    descricao: (quadro.acoesParaReduzirIncerteza || [])[0] || 'Indicar a evidencia tecnica decisiva que falta antes de concluir a causa.',
    origem: 'quadro_investigativo',
    exigeValidacao: true,
  };

  return {
    versao: 1,
    objetivo: 'Limitar a resposta a fatos, hipoteses, lacunas e proximos passos rastreaveis.',
    fatosComprovados: fatosComprovados.slice(0, 16),
    hipotesesFundamentadas: hipotesesFundamentadas.slice(0, 12),
    referenciasExternas: referenciasExternas.slice(0, 20),
    termosTecnicosPermitidos: [...termos.values()].slice(0, 40),
    lacunasObrigatorias: lacunas.slice(0, 12),
    proximoPassoRecomendado: proximoPasso,
    regrasUso: [
      'Nao cite termo tecnico especifico que nao esteja em termosTecnicosPermitidos, salvo como lacuna generica sem nomear rotina/parametro.',
      'Referencia externa so pode ser apoio; nao pode virar fato do chamado ou causa sem ponte causal interna.',
      'Hipotese deve vir com incerteza explicita e teste/evidencia para confirmar.',
      'Se houver lacuna bloqueante, nao apresentar causa confirmada.',
    ],
  };
}

function reconciliarObservacoesVisuais(plano, observacoesVisuais = []) {
  if (!plano || !Array.isArray(observacoesVisuais) || observacoesVisuais.length === 0) return plano;
  const termos = new Map((plano.termosTecnicosPermitidos || []).map(t => [String(t.termo || '').toUpperCase(), {
    ...t,
    origens: Array.isArray(t.origens) ? [...t.origens] : [],
  }]));

  for (const obs of observacoesVisuais) {
    const texto = [
      obs.nome,
      ...(obs.textosVisiveis || []),
      ...(obs.campos || []),
      ...(obs.valores || []),
      obs.observacao,
    ].filter(Boolean).join(' ');
    for (const termo of extrairTermosTecnicos(texto)) {
      adicionarTermo(termos, termo, {
        origem: 'observacao_visual',
        referencia: obs.nome || obs.anexoId || null,
        anexoId: obs.anexoId || null,
        confiancaVisual: obs.confiancaVisual || 'baixa',
        papel: 'visual',
      }, 'contexto_visual', { causalPermitido: false });
    }
  }

  return {
    ...plano,
    termosTecnicosPermitidos: [...termos.values()].slice(0, 60),
    reconciliadoComObservacoesVisuais: true,
  };
}

function formatarPlanoParaPrompt(plano) {
  if (!plano) return '';
  const linhas = ['## Plano de Resposta Rastreavel (PRR)'];
  linhas.push('Use o PRR como contrato obrigatorio de geracao: fatos como fatos, hipoteses como hipoteses, lacunas como limites obrigatorios.');
  linhas.push('Nao complete lacunas com nomes tecnicos especificos. Se o nome real de uma rotina, parametro, campo, tabela, fonte ou ponto de entrada nao estiver em "Termos tecnicos permitidos", descreva a verificacao de forma funcional, sem inventar identificadores.');
  if (plano.fatosComprovados?.length) {
    linhas.push('Fatos permitidos:');
    for (const f of plano.fatosComprovados.slice(0, 10)) linhas.push(`- ${f.id}: ${f.texto} [origem=${f.origem}; uso=${f.permissaoUso}]`);
  }
  if (plano.hipotesesFundamentadas?.length) {
    linhas.push('Hipoteses permitidas:');
    for (const h of plano.hipotesesFundamentadas.slice(0, 8)) linhas.push(`- ${h.id}: ${h.texto} [teste=${h.testeNecessario}]`);
  }
  if (plano.termosTecnicosPermitidos?.length) {
    linhas.push('Termos tecnicos permitidos e uso:');
    for (const t of plano.termosTecnicosPermitidos.slice(0, 20)) linhas.push(`- ${t.termo}: ${t.usoPermitido}; causal=${t.causalPermitido ? 'sim' : 'nao'}; origens=${t.origens.map(o => o.origem).join('+')}`);
  }
  if (plano.lacunasObrigatorias?.length) {
    linhas.push('Lacunas obrigatorias:');
    for (const l of plano.lacunasObrigatorias.slice(0, 8)) linhas.push(`- ${l.texto}`);
  }
  if (plano.proximoPassoRecomendado?.descricao) linhas.push(`Proximo passo recomendado pelo PRR: ${plano.proximoPassoRecomendado.descricao}`);
  linhas.push('Regra: se quiser citar uma rotina, parametro, fonte, tabela ou modulo que nao esteja no PRR, nao cite o nome; diga qual evidencia deve ser coletada para identificar essa referencia.');
  linhas.push('Regra de seguranca: uma resposta sem causa conclusiva continua valida se explicar fatos, hipoteses, lacunas e o proximo passo tecnico permitido.');
  return linhas.join('\n');
}

function _indicesTermo(texto, termo) {
  const original = String(texto || '');
  const n = normalizar(original);
  const t = normalizar(termo);
  const indices = [];
  if (!t) return indices;
  let idx = n.indexOf(t);
  while (idx >= 0) {
    indices.push(idx);
    idx = n.indexOf(t, idx + t.length);
  }
  return indices;
}

function _extrairTrechoAfirmacao(texto, termo, idxNormalizado) {
  const original = String(texto || '');
  const n = normalizar(original);
  const t = normalizar(termo);
  if (idxNormalizado < 0) return compactar(original);
  const anterior = n.slice(0, idxNormalizado);
  const posterior = n.slice(idxNormalizado + t.length);
  const inicioRelativo = Math.max(
    anterior.lastIndexOf('.'),
    anterior.lastIndexOf('!'),
    anterior.lastIndexOf('?'),
    anterior.lastIndexOf('\n'),
    anterior.lastIndexOf(';')
  );
  const candidatosFim = ['.', '!', '?', '\n', ';']
    .map(ch => posterior.indexOf(ch))
    .filter(i => i >= 0);
  const fimRelativo = candidatosFim.length ? Math.min(...candidatosFim) : -1;
  const inicio = Math.max(0, inicioRelativo + 1);
  const fim = fimRelativo >= 0 ? idxNormalizado + t.length + fimRelativo : original.length;
  const trecho = original.slice(inicio, fim).replace(/\s+/g, ' ').trim();
  if (trecho.length <= 360) return trecho;
  const recorteInicio = Math.max(0, idxNormalizado - 160);
  const recorteFim = Math.min(original.length, idxNormalizado + t.length + 190);
  return compactar(original.slice(recorteInicio, recorteFim), 360);
}

function _classificarTrechoReferencia(trecho, termo) {
  const s = normalizar(trecho);
  const t = normalizar(termo);
  const antesTermo = s.slice(0, Math.max(0, s.indexOf(t)));
  const proximoTermo = s.slice(Math.max(0, s.indexOf(t) - 80), Math.min(s.length, s.indexOf(t) + t.length + 120));

  const negacaoCausal = /\b(sem|nao ha|nao existe|nao tem|nao possui|nao foi demonstrad[oa]|nao esta demonstrad[oa]|ausencia de)\b.{0,80}\b(ponte|vinculo|relacao|evidencia|causa|causal|associacao)\b/i.test(s)
    || /\b(sem ponte causal|sem vinculo causal|sem relacao causal|sem evidencia causal|vinculo causal nao demonstrado|causa nao demonstrada|outro dominio|evidencia de outro dominio|e incidental|incidental)\b/i.test(s)
    || /\b(nao usaria|nao trataria|nao pode ser tratado|nao deve ser tratado)\b.{0,80}\b(causa|causal|diagnostico|acao principal)\b/i.test(s)
    || /\b(nao e|nao foi|nao seria)\b.{0,50}\b(causa|origem|responsavel)\b/i.test(s);

  const ausenciaEvidencia = /\b(nao comprova|nao confirma|sem comprovar|sem demonstrar|falta evidencia|faltam evidencias|nao ha evidencia|nao sustent[ao]|nao aparece no historico|nao consta no historico)\b/i.test(s);
  const observacaoIncidental = /\b(print|imagem|tela|anexo|observacao visual|texto visivel)\b.{0,90}\b(mostra|aparece|exibe|traz|cita|cont[eé]m|visivel)\b/i.test(s)
    || /\b(mostra|aparece|exibe|traz|cita|cont[eé]m|visivel)\b.{0,90}\b(print|imagem|tela|anexo|observacao visual|texto visivel)\b/i.test(s);
  const hipoteseCondicionada = /\b(hipotese|a validar|validar|validaria|confirmar|se confirmar|se houver|caso exista|possivel|pode ser|poderia|similar|exemplo|ou outro|pesquisa externa|fonte externa|apoio|trilha de apoio|trilha a conferir)\b/i.test(s);
  const afirmacaoCausal = /\b(causa|causou|causado|responsavel|origem|explica|impacta|impede|provoca|gera|gerou|bloqueia|bloqueou|esta ligado|esta relacionada|relacionado ao erro)\b/i.test(s);
  const recomendacaoTecnica = /\b(corrij\w*|corrig\w*|ajust\w*|alter\w*|apli(?:que|car)|abra a rotina|abrir a rotina|regulariz\w*|desativ\w*|ativ\w*|parametro deve|corrigir|resolvera|resolveria)\b/i.test(s);
  const referenciaExternaContextual = /\b(pesquisa externa|fonte externa|totvs|tdn|central de atendimento|documentacao|documenta[cÃ§][aÃ£]o)\b/i.test(s)
    && /\b(topico conhecido|tema conhecido|documentad[oa]|contexto do produto|contexto util|contexto geral|foi recuperad[ao]|pagina oficial|referencia oficial)\b/i.test(s)
    && !/\b(causa|causou|causado|corrij\w*|corrig\w*|ajust\w*|resolvera|resolveria|acao principal|a[cÃ§][aÃ£]o principal)\b/i.test(s);
  const qualificadorDominio = new RegExp(`\\b(modulo|m[oó]dulo|sistema|produto|linha|dominio|dom[ií]nio|ambiente|area|[aá]rea)\\b.{0,45}\\b${_escapeRegExp(t)}\\b`, 'i').test(s)
    || new RegExp(`\\b${_escapeRegExp(t)}\\b.{0,45}\\b(modulo|m[oó]dulo|sistema|produto|linha|dominio|dom[ií]nio|compras|financeiro|faturamento)\\b`, 'i').test(s);
  const acaoSobreReferencia = recomendacaoTecnica && (
    new RegExp(`\\b(corrij\\w*|corrig\\w*|ajust\\w*|alter\\w*|regulariz\\w*|desativ\\w*|ativ\\w*)\\b.{0,80}\\b${_escapeRegExp(t)}\\b`, 'i').test(s)
    || new RegExp(`\\b${_escapeRegExp(t)}\\b.{0,80}\\b(corrij\\w*|corrig\\w*|ajust\\w*|alter\\w*|regulariz\\w*|desativ\\w*|ativ\\w*|resolvera|resolveria)\\b`, 'i').test(s)
  );

  if (negacaoCausal) return 'negacao_causal';
  if (ausenciaEvidencia) return 'ausencia_evidencia_causal';
  if (observacaoIncidental && !afirmacaoCausal && !acaoSobreReferencia) return 'observacao_incidental';
  if (referenciaExternaContextual && !acaoSobreReferencia) return 'hipotese_condicionada';
  if (qualificadorDominio && !acaoSobreReferencia) return 'qualificador_dominio';
  if (acaoSobreReferencia) return 'recomendacao_operacional_baseada_na_referencia';
  if (afirmacaoCausal && !/\b(nao|sem|ausencia)\b.{0,60}\b(causa|causal|vinculo|ponte|relacao)\b/i.test(proximoTermo + ' ' + antesTermo.slice(-90))) return 'afirmacao_causal';
  if (hipoteseCondicionada) return 'hipotese_condicionada';
  if (observacaoIncidental) return 'observacao_incidental';
  return 'descritiva';
}

function _escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _classificarUsosReferencia(texto, termo) {
  return _indicesTermo(texto, termo).map(idx => {
    const trecho = _extrairTrechoAfirmacao(texto, termo, idx);
    return {
      termo: String(termo || '').toUpperCase(),
      trecho,
      classificacaoContextual: _classificarTrechoReferencia(trecho, termo),
    };
  });
}

function _usoBloqueadoPeloPRR(uso, permitido) {
  if (!uso) return false;
  if (permitido?.causalPermitido) return false;
  return uso.classificacaoContextual === 'afirmacao_causal'
    || uso.classificacaoContextual === 'recomendacao_operacional_baseada_na_referencia';
}

function _detalhesDecisaoPRR(uso, permitido) {
  return {
    trecho: uso?.trecho || null,
    referencia: uso?.termo || null,
    classificacaoContextual: uso?.classificacaoContextual || null,
    evidenciaUsada: permitido?.origens || [],
    permissaoPRR: permitido ? {
      usoPermitido: permitido.usoPermitido,
      causalPermitido: !!permitido.causalPermitido,
    } : null,
  };
}

function _afirmaConfirmacaoConclusiva(texto) {
  const s = String(texto || '');
  const padrao = /\b(causa confirmada|diagnostico confirmado|com certeza|definitivamente)\b/gi;
  let match;
  while ((match = padrao.exec(s)) !== null) {
    const janela = s.slice(Math.max(0, match.index - 90), Math.min(s.length, match.index + match[0].length + 90));
    if (/\b(nao|não|sem|nunca|tampouco)\b[\s\S]{0,45}\b(causa confirmada|diagnostico confirmado|com certeza|definitivamente)\b/i.test(janela)) continue;
    if (/\b(causa confirmada|diagnostico confirmado|com certeza|definitivamente)\b[\s\S]{0,55}\b(nao|não|ausente|nao demonstrad|não demonstrad|nao comprovad|não comprovad)\b/i.test(janela)) continue;
    return true;
  }
  return false;
}

function avaliarRespostaContraPlano({ textoResposta, plano } = {}) {
  if (!plano) return [];
  const falhas = [];
  const permitidos = new Map((plano.termosTecnicosPermitidos || []).map(t => [String(t.termo || '').toUpperCase(), t]));
  for (const termo of extrairTermosTecnicos(textoResposta)) {
    const permitido = permitidos.get(termo.termo);
    const usos = _classificarUsosReferencia(textoResposta, termo.termo);
    const usoBloqueavel = usos.find(uso => _usoBloqueadoPeloPRR(uso, permitido));
    if (!permitido) {
      if (usos.length && usos.every(uso => ['hipotese_condicionada', 'ausencia_evidencia_causal', 'negacao_causal'].includes(uso.classificacaoContextual))) continue;
      falhas.push({
        codigo: 'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED',
        severidade: 'media',
        detalhe: 'resposta citou referencia tecnica especifica fora do Plano de Resposta Rastreavel',
        termos: [termo.termo],
        ..._detalhesDecisaoPRR(usoBloqueavel || usos[0], null),
        decisionKind: 'bloqueio_objetivo',
        categoriaDecisao: 'bloqueio_objetivo',
        acaoCorretiva: 'remover_referencia_ou_incluir_origem_rastreavel_no_plano',
      });
      break;
    }
    if (permitido.usoPermitido === 'apoio_externo_apenas' && usoBloqueavel) {
      falhas.push({
        codigo: 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE',
        severidade: 'media',
        detalhe: 'resposta usou referencia externa como causa ou acao principal sem ponte causal interna permitida pelo PRR',
        termos: [termo.termo],
        ..._detalhesDecisaoPRR(usoBloqueavel, permitido),
        decisionKind: 'bloqueio_objetivo',
        categoriaDecisao: 'bloqueio_objetivo',
        acaoCorretiva: 'tratar_referencia_externa_como_apoio_ou_hipotese_a_validar',
      });
      break;
    }
    if (permitido.usoPermitido === 'contexto_visual' && usoBloqueavel) {
      falhas.push({
        codigo: 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE',
        severidade: 'media',
        detalhe: 'resposta usou termo observado em imagem como causa ou acao principal sem ponte causal permitida pelo PRR',
        termos: [termo.termo],
        ..._detalhesDecisaoPRR(usoBloqueavel, permitido),
        decisionKind: 'bloqueio_objetivo',
        categoriaDecisao: 'bloqueio_objetivo',
        acaoCorretiva: 'usar_termo_visual_como_contexto_ou_demonstrar_ponte_causal_interna',
      });
      break;
    }
  }
  const temLacunaBloqueante = (plano.lacunasObrigatorias || []).some(l => l.bloqueiaConclusao);
  if (temLacunaBloqueante && _afirmaConfirmacaoConclusiva(textoResposta)) {
    falhas.push({
      codigo: 'PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP',
      severidade: 'alta',
      detalhe: 'resposta apresentou causa confirmada apesar de lacuna bloqueante no PRR',
      decisionKind: 'bloqueio_objetivo',
      categoriaDecisao: 'bloqueio_objetivo',
      acaoCorretiva: 'rebaixar_para_hipotese_e_informar_evidencia_decisiva',
    });
  }
  return falhas;
}

function _textoLimpo(texto, max = 360) {
  return compactar(removerIdsInternos(texto).replace(/\[ID_INTERNO\]/g, '').replace(/\s+/g, ' ').trim(), max);
}

function _termosPermitidosTexto(plano) {
  return (plano?.termosTecnicosPermitidos || [])
    .filter(t => t?.termo && t.usoPermitido !== 'apoio_externo_apenas')
    .slice(0, 8)
    .map(t => `${t.termo} (${t.usoPermitido})`);
}

function _temFalhaCriticaNaoRecuperavel(falhas) {
  const recuperaveis = new Set([
    'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED',
    'UNTRACEABLE_TECHNICAL_REFERENCE',
    'INTERNAL_IDS_USED_AS_EVIDENCE',
    'REDUNDANT_OPERATIONAL_ESCALATION',
    'REDUNDANT_OPERATIONAL_MEETING',
    'ROBOTIC_TEMPLATE_RESPONSE',
    'VISUAL_EVIDENCE_TOO_GENERIC',
    'CORRECTION_WITHOUT_VALIDATION',
    'WEAK_ACTIONABLE_CORRECTION',
    'SPECIFIC_ERROR_NOT_PRIORITIZED',
    'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG',
  ]);
  return (falhas || []).some(f => {
    const kind = f.decisionKind || f.categoriaDecisao;
    if (kind === 'bloqueio_objetivo' && !recuperaveis.has(f.codigo)) return true;
    return f.codigo === 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE'
      || f.codigo === 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE'
      || f.codigo === 'PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP'
      || f.codigo === 'CERTAINTY_WITHOUT_EVIDENCE';
  });
}

function _temBloqueioRecuperavel(falhas) {
  const recuperaveis = new Set([
    'PRR_TECHNICAL_REFERENCE_NOT_ALLOWED',
    'UNTRACEABLE_TECHNICAL_REFERENCE',
    'INTERNAL_IDS_USED_AS_EVIDENCE',
    'REDUNDANT_OPERATIONAL_ESCALATION',
    'REDUNDANT_OPERATIONAL_MEETING',
  ]);
  return (falhas || []).some(f => {
    const kind = f.decisionKind || f.categoriaDecisao;
    return kind === 'bloqueio_objetivo' && recuperaveis.has(f.codigo);
  });
}

function gerarRespostaSeguraDeterministica({ plano, gate } = {}) {
  if (!plano) return null;
  const falhas = gate?.falhas || [];
  if (_temFalhaCriticaNaoRecuperavel(falhas)) return null;
  if (!_temBloqueioRecuperavel(falhas)) return null;

  const fatos = (plano.fatosComprovados || [])
    .filter(f => f?.texto)
    .slice(0, 5)
    .map(f => _textoLimpo(f.texto));
  const hipoteses = (plano.hipotesesFundamentadas || [])
    .filter(h => h?.texto)
    .slice(0, 3)
    .map(h => ({
      texto: _textoLimpo(h.texto),
      teste: _textoLimpo(h.testeNecessario || 'Validar com evidencia tecnica objetiva.', 220),
    }));
  const lacunas = (plano.lacunasObrigatorias || [])
    .filter(l => l?.texto)
    .slice(0, 5)
    .map(l => _textoLimpo(l.texto));
  const termosPermitidos = _termosPermitidosTexto(plano);
  const proximoPasso = _textoLimpo(plano.proximoPassoRecomendado?.descricao || 'Obter a evidencia tecnica decisiva antes de concluir a causa.', 420);

  if (!fatos.length && !hipoteses.length && !lacunas.length && !proximoPasso) return null;

  const partes = [];
  partes.push('Com as evidencias disponiveis, a orientacao segura e separar o que esta comprovado do que ainda precisa ser confirmado antes de concluir a causa.');

  if (fatos.length) {
    partes.push(`O que esta confirmado: ${fatos.join(' ')}.`);
  }

  if (termosPermitidos.length) {
    partes.push(`Referencias tecnicas que podem ser citadas com rastreabilidade: ${termosPermitidos.join('; ')}.`);
  }

  if (hipoteses.length) {
    const textoHipoteses = hipoteses.map(h => `${h.texto} Para usar isso como causa, e preciso validar: ${h.teste}`).join(' ');
    partes.push(`Hipotese util, ainda nao conclusiva: ${textoHipoteses}`);
  }

  if (lacunas.length) {
    partes.push(`O que ainda impede uma conclusao segura: ${lacunas.join(' ')}`);
  } else {
    partes.push('Mesmo com as evidencias atuais, nao ha base para acrescentar nomes de rotinas, parametros, tabelas ou pontos de entrada sem origem verificavel.');
  }

  partes.push(`Proximo passo permitido agora: ${proximoPasso}`);
  partes.push('Se esse proximo passo revelar o nome real da rotina, parametro, fonte ou ponto de entrada, essa referencia podera ser usada na analise com origem verificavel.');

  return {
    texto: partes.filter(Boolean).join('\n\n'),
    modo: lacunas.length ? 'resposta_investigativa_limitada' : 'correcao_segura',
    origem: 'prr_deterministico',
  };
}

module.exports = {
  montarPlano,
  reconciliarObservacoesVisuais,
  formatarPlanoParaPrompt,
  avaliarRespostaContraPlano,
  gerarRespostaSeguraDeterministica,
  extrairTermosTecnicos,
};
