'use strict';

const investigativeDiscipline = require('./investigative-discipline-service');

function _temRespostaGenerica(texto) {
  const s = String(texto || '').toLowerCase();
  if (s.length < 450) return !_temRespostaCurtaObjetiva(texto);
  const genericos = [
    'verifique os logs',
    'envie mais informacoes',
    'envie mais informações',
    'pode ser um problema de configuracao',
    'pode ser um problema de configuração',
    'recomendo verificar',
  ];
  return genericos.filter(g => s.includes(g)).length >= 2 && !/\*\*evid[eê]ncias\*\*|fonte corrigido|linha|stack|exception|erro/i.test(texto || '');
}

function _temAcaoOuProximoPasso(texto) {
  return /\b(apli(?:que|car|cado|cada|ca[cç][aã]o)|execut(?:e|ar|ado|ada)|valid(?:e|ar|ado|ada|a[cç][aã]o)|envi(?:e|ar|ado|ada)|anex(?:e|ar|ado|ada)|corrij\w*|corrig\w*|corre[cç][aã]o|test(?:e|ar|ado|ada)|compar(?:e|ar|ado|ada)|verifi(?:que|car|cado|cada)|colet(?:e|ar|ado|ada))\b/i.test(texto || '');
}

function _temRespostaCurtaObjetiva(texto) {
  const s = _normalizar(texto);
  const temEvidenciaTecnica = /\b(evidencia|log|fonte|print|anexo|trecho|linha|stack|exception|erro|rotina|campo|tabela|parametro|advpl|prw|tlpp|array|indice)\b/i.test(s);
  const pedeEvidenciaEspecifica = /\b(evidencia insuficiente|faltam?|preciso|envie|enviar|anexe|anexar|colete|coletar)\b/i.test(s) && /\b(log|fonte|print|anexo|trecho|linha|stack|rotina|campo|passo|reproducao)\b/i.test(s);
  const temValidacao = /\b(valid\w*|homologa\w*|teste\w*|reteste\w*|reproduz\w*|compil\w*)\b/i.test(s);
  return (temEvidenciaTecnica && _temAcaoOuProximoPasso(texto) && temValidacao) || (pedeEvidenciaEspecifica && _temAcaoOuProximoPasso(texto));
}

function _usaTemplateFormalRobotico(texto) {
  if (/(^|\n)\s*#{1,4}\s+/i.test(String(texto || ''))) return true;
  const secoes = [
    'diagnostico',
    'causa provavel',
    'fatos e evidencias',
    'evidencias',
    'chamados semelhantes',
    'pesquisa tecnica',
    'correcao proposta',
    'lacunas investigativas',
    'validacao',
    'proximos passos',
  ];
  const normalizado = _normalizar(texto);
  const qtd = secoes.filter(secao => {
    const re = new RegExp(`(^|\\n)\\s*(#{1,4}\\s*)?(\\*\\*)?${secao}(\\*\\*)?\\s*[:\\-]?`, 'i');
    return re.test(normalizado);
  }).length;
  return qtd >= 4;
}

function _correcaoPoucoAcionavel(texto) {
  const s = _normalizar(texto);
  const recomendacoesFracas = [
    'analise mais detalhada',
    'analisar mais detalhadamente',
    'agendar uma videochamada',
    'realizar uma videochamada',
    'entender melhor o contexto',
    'consultar a documentacao',
    'verificar se ha patches',
    'verificar se ha atualizacoes',
  ];
  const temFraca = recomendacoesFracas.some(t => s.includes(t));
  if (!temFraca) return false;
  if (s.includes('agendar uma videochamada') || s.includes('realizar uma videochamada')) return true;
  if (s.includes('consultar a documentacao') && s.includes('se precisar de mais informacoes')) return true;
  const temAcaoTecnica = /\b(mv_[a-z0-9_]+|sx[235]|ponto de entrada|gatilho|valid|when|fwwhen|debug|log|fonte|rotina|parametro|reproduzir|comparar|desabilitar|homologacao|rpo|rdmake|advpl|tlpp|dbaccess)\b/i.test(s);
  return !temAcaoTecnica;
}

function _acaoIgnoraErroMaisEspecifico(texto) {
  const s = _normalizar(texto);
  const erroModoEdicao = /fwwhen|modo edicao nao respeitado|valor nao pode ser atribuido/.test(s);
  if (!erroModoEdicao) return false;
  const primeiraAcaoParametro = /primeir[oa][\s\S]{0,180}\bmv_[a-z0-9_]+/.test(s);
  if (!primeiraAcaoParametro) return false;
  const primeiraAcaoAtacaEdicao = /primeir[oa][\s\S]{0,260}\b(when|valid|gatilho|ponto de entrada|customizacao|modo de edicao|atribuicao|atribuir|campo)\b/.test(s);
  return !primeiraAcaoAtacaEdicao;
}

function _citaIdsInternosComoEvidencia(texto) {
  const s = String(texto || '');
  return /\b(log|logs|mensagens?)\b[\s\S]{0,120}\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(s);
}

// Verifica se a resposta reconheceu uma pendencia de retorno externo
// BLOQUEANTE (ex. fornecedor/TOTVS) como a dependencia efetiva do proximo
// passo. Generico — nao hardcoda nenhum ticket/numero especifico, so o
// conceito de "pendencia de terceiro externo" vindo do manifesto
// (context-engine.js:_interpretarPendenciaConsolidada). Achado real,
// homologacao 2026-10: o Caso C tinha a pendencia no prompt mas a resposta
// final nunca a tratava como bloqueio — so pedia mais evidencia tecnica
// interna (codigo/log), como se a pendencia nao existisse.
function _ignoraPendenciaExternaBloqueante(textoResposta, manifesto) {
  const pendencia = manifesto?.pendenciaConsolidada;
  if (!pendencia?.bloqueante) return false;
  const s = _normalizar(textoResposta);
  // reconhece a pendencia se a resposta menciona o responsavel (fornecedor/
  // terceiro) associado a vocabulario de espera/acompanhamento/dependencia —
  // nao basta citar a palavra "fornecedor" de passagem (ex. so repetindo o
  // historico), precisa estar perto de um verbo de pendencia/acompanhamento.
  const mencionaResponsavelComPendencia = /\b(fornecedor|totvs|terceiro|distribuidor)\b[\s\S]{0,80}\b(aguard|pendente|pendencia|retorno|depende|bloquei|acompanh)\w*/i.test(s)
    || /\b(aguard|pendente|pendencia|depende|bloquei|acompanh)\w*[\s\S]{0,80}\b(fornecedor|totvs|terceiro|distribuidor)\b/i.test(s);
  return !mencionaResponsavelComPendencia;
}

function _descartaCustomizacaoSemBase(textoResposta, manifesto) {
  const s = _normalizar(textoResposta);
  const descarta = /nao por customizacao|nao e customizacao|erro e gerado pelo proprio protheus|comportamento padrao do protheus/.test(s);
  if (!descarta) return false;
  const selecionados = manifesto?.selecionados || [];
  const temFonteOuLog = selecionados.some(e => {
    const nome = _normalizar(e.nome || '');
    return nome.endsWith('.log') || nome.endsWith('.prw') || nome.endsWith('.tlpp') || nome.endsWith('.advpl') || nome.endsWith('.ini') || nome.endsWith('.json') || nome.endsWith('.xml');
  });
  return !temFonteOuLog;
}

function _normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function _temJustificativa(texto) {
  const s = _normalizar(texto);
  // "porque/devido/pois/apos" soltos capturavam qualquer explicacao causal
  // comum (ex. "deve subtrair PORQUE o produto volta ao fornecedor") como se
  // fosse justificativa de evidencia NOVA — achado real na homologacao
  // 2026-10, mascarava a propria resposta que estava repetindo a mesma
  // conclusao sem novidade. Agora exigem proximidade de um termo que de fato
  // indique mudanca/evidencia (nao so qualquer explicacao).
  if (/\b(porque|devido|pois|apos)\b[\s\S]{0,60}\b(evidencia|teste|log|resultado|retorno|confirma[cç][aã]o|valida[cç][aã]o|anexo|print)\b/i.test(s)) return true;
  if (/\b(evidencia|teste|log|resultado|retorno|confirma[cç][aã]o|valida[cç][aã]o|anexo|print)\b[\s\S]{0,60}\b(porque|devido|pois|apos)\b/i.test(s)) return true;
  return /nova evidencia|mudou|alterou|repetir.*rev|novo log|periodo diferente|execucao diferente|ambiente mudou|versao nova|revalidar/i.test(s);
}

function _paginasLidasOuReutilizadas(pesquisa) {
  return (pesquisa?.paginasLidas || []).filter(p => p.status === 'lida' || p.status === 'reutilizada');
}

function _avaliarRegressaoInvestigativa(textoResposta, manifesto) {
  const falhas = [];
  const resposta = _normalizar(textoResposta);
  const guard = manifesto?.dossie?.regressaoGuard || {};
  const justificavel = _temJustificativa(textoResposta);

  for (const teste of guard.testesExecutados || []) {
    if (!teste.codigo || !resposta.includes(_normalizar(teste.codigo))) continue;
    if (/\b(faca|execute|reteste|repita|realize|rode)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_TESTE_REPETIDO',
        severidade: 'media',
        itemCodigo: teste.codigo,
        detalhe: 'teste ja executado/encerrado citado como proximo passo sem justificativa nova',
        acaoCorretiva: 'nao_repetir_teste_sem_justificativa',
      });
    }
  }

  for (const hipotese of guard.hipotesesDescartadas || []) {
    if (!hipotese.codigo || !resposta.includes(_normalizar(hipotese.codigo))) continue;
    if (/\b(causa|provavel|hipotese|deve ser)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_HIPOTESE_DESCARTADA',
        severidade: 'media',
        itemCodigo: hipotese.codigo,
        detalhe: 'hipotese descartada reapresentada sem nova evidencia',
        acaoCorretiva: 'reconhecer_descarte_ou_justificar_reconsideracao',
      });
    }
  }

  for (const ev of manifesto?.dossie?.evidenciasRecuperadas || []) {
    const nome = _normalizar(ev.nome || '');
    if (nome.length < 4 || !resposta.includes(nome)) continue;
    if (/\b(envie|mande|anexe|encaminhe|preciso do|solicite)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_EVIDENCIA_JA_RECEBIDA',
        severidade: 'media',
        evidencia: ev.nome || ev.id,
        detalhe: 'evidencia recuperada pelo dossie foi solicitada novamente sem motivo',
        acaoCorretiva: 'nao_pedir_evidencia_ja_recebida_sem_justificativa',
      });
    }
  }

  for (const solucao of guard.solucoesFalhas || []) {
    const termos = _normalizar(solucao.descricao || '').split(/\s+/).filter(t => t.length >= 4).slice(0, 8);
    if (termos.length && termos.some(t => resposta.includes(t)) && /\b(aplicar|aplique|solucao|corrig\w*|corrij\w*)\b/i.test(resposta) && !justificavel) {
      falhas.push({
        codigo: 'REGRESSAO_INVESTIGATIVA_SOLUCAO_FALHA',
        severidade: 'media',
        itemCodigo: solucao.codigo,
        detalhe: 'solucao/resultado ja negativo reaparece como novidade sem justificativa',
        acaoCorretiva: 'evitar_solucao_ja_falha_sem_nova_razao',
      });
      break;
    }
  }

  return falhas;
}

// Shingles de 8 palavras — repeticao de hipotese/recomendacao em linguagem
// natural, sem depender de ela ter virado item do dossie com codigo
// rastreavel (gap real: _avaliarRegressaoInvestigativa so compara contra
// guard.testesExecutados/hipotesesDescartadas, que vem de itens persistidos;
// quando a execucao anterior falhou ou o LLM nunca estruturou a hipotese como
// item, nao ha nenhuma memoria contra a qual comparar). Esta checagem compara
// direto contra o TEXTO de respostas anteriores reais da IA no historico.
function _shingles(texto, tamanho = 3) {
  const palavras = _normalizar(texto).replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + tamanho <= palavras.length; i++) out.add(palavras.slice(i, i + tamanho).join(' '));
  return out;
}

function _similaridadeShingles(a, b) {
  const sa = _shingles(a);
  const sb = _shingles(b);
  if (!sa.size || !sb.size) return 0;
  let comuns = 0;
  for (const s of sa) if (sb.has(s)) comuns += 1;
  return comuns / Math.min(sa.size, sb.size);
}

// Ancoras tecnicas restritas para repeticao SEMANTICA (nao lexical): shingles
// de palavras falham quando o LLM reformula livremente (achado real,
// homologacao 2026-10 — duas respostas reais do Caso A afirmando a MESMA
// operacao matematica como causa tiveram so 25% de similaridade por
// shingles-3, porque a segunda reescreveu a frase do zero). Em vez de medir
// sobreposicao de sequencias de palavras, extrai um vocabulario fechado e
// pequeno de sinais estruturais que carregam o significado central da
// afirmacao tecnica — operador matematico mencionado e identificadores em
// formato de codigo (maiusculas/underscore, ex. STATUSWF, ZZ_SALDO) — que
// sobrevivem a reformulacao porque nao dependem de ordem de palavras nem de
// conectores. Deliberadamente NAO usa a lista fixa de termos de
// investigative-discipline-service.js (x5_filial, thumbprint, ora-00060...)
// porque aquela e especifica a cenarios de teste conhecidos; esta precisa
// generalizar para qualquer par de respostas (ex. soma/subtrai, incrementa/
// decrementa, qualquer campo/rotina citado como codigo).
function _extrairAncorasTecnicas(texto) {
  const n = _normalizar(texto);
  const ancoras = new Set();
  if (/usando\s*\+|\+\s*(em vez|ao inves)|operac[aã]o de adi[cç][aã]o|\bsoma(r|ndo)?\b|\baumenta/.test(n)) ancoras.add('OP:SOMA');
  if (/subtrac[aã]o|\bsubtrair\b|usando\s*-|-\s*(em vez|ao inves)|\bdiminui/.test(n)) ancoras.add('OP:SUBTRAI');
  if (/incrementa/.test(n)) ancoras.add('OP:INCREMENTA');
  if (/decrementa/.test(n)) ancoras.add('OP:DECREMENTA');
  const codigos = String(texto || '').match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || [];
  for (const c of codigos) ancoras.add('CODE:' + c.toUpperCase());
  return ancoras;
}

function _similaridadeAncoras(a, b) {
  const sa = _extrairAncorasTecnicas(a);
  const sb = _extrairAncorasTecnicas(b);
  if (!sa.size || !sb.size) return null; // sem ancora identificavel, nao opina
  let comuns = 0;
  for (const x of sa) if (sb.has(x)) comuns += 1;
  return comuns / Math.min(sa.size, sb.size);
}

// Rotulos oficiais do vocabulario de confianca pedido pelo system prompt
// (prompt-builder.js: "causa confirmada", "forte evidencia", "hipotese
// provavel", "evidencia insuficiente") — a mesma lista que
// investigacao-service.js:_extrairNivelConfianca ja usa para persistir
// mensagens.nivel_confianca, sem custo de chamada adicional.
const ROTULOS_CONFIANCA = ['causa confirmada', 'forte evidência', 'hipótese provável', 'evidência insuficiente'];
const PESO_CONFIANCA = { 'evidência insuficiente': 0, 'hipótese provável': 1, 'forte evidência': 2, 'causa confirmada': 3 };

function _extrairNivelConfiancaTexto(texto) {
  const t = String(texto || '').toLowerCase();
  return ROTULOS_CONFIANCA.find(r => t.includes(r)) || null;
}

function _avaliarRepeticaoDeRespostaAnterior(textoResposta, historicoMensagens) {
  const respostasAnteriores = (historicoMensagens || [])
    .filter(m => m.papel === 'assistant' && !m.diagnostico?.erroInfraestrutura && String(m.conteudo || '').trim().length > 150);
  if (!respostasAnteriores.length) return [];
  if (String(textoResposta || '').trim().length < 150) return [];
  const justificavel = _temJustificativa(textoResposta);
  if (justificavel) return [];

  const nivelAtual = _extrairNivelConfiancaTexto(textoResposta);
  const pesoAtual = nivelAtual ? PESO_CONFIANCA[nivelAtual] : null;

  for (const anterior of respostasAnteriores) {
    const simAncoras = _similaridadeAncoras(textoResposta, anterior.conteudo);
    const simTexto = _similaridadeShingles(textoResposta, anterior.conteudo);
    const similaridade = simAncoras !== null ? Math.max(simAncoras, simTexto) : simTexto;
    if (similaridade < 0.5) continue;

    // Mesma afirmacao tecnica central repetida — severidade sobe se, alem de
    // repetir, a resposta ESCALOU a confianca sem justificativa (hipotese ->
    // certeza) ou abandonou o vocabulario de hedging que a anterior usava
    // (achado real: resposta 1 dizia "hipotese provavel", resposta 2 afirmou
    // a mesma coisa sem nenhum rotulo de confianca).
    const nivelAnterior = _extrairNivelConfiancaTexto(anterior.conteudo);
    const pesoAnterior = nivelAnterior ? PESO_CONFIANCA[nivelAnterior] : null;
    const escalouSemHedging = nivelAnterior && pesoAnterior < 3 && (nivelAtual === null || pesoAtual > pesoAnterior);

    return [{
      codigo: 'REGRESSAO_INVESTIGATIVA_RESPOSTA_REPETIDA',
      severidade: escalouSemHedging ? 'alta' : 'media',
      detalhe: simAncoras !== null
        ? `resposta repete a mesma afirmacao tecnica central (operador/identificador) de uma resposta anterior (similaridade de ancoras ${Math.round(simAncoras * 100)}%), sem evidencia nova${escalouSemHedging ? ' — e escalou de hipotese para afirmacao mais categorica sem justificativa' : ''}`
        : `resposta atual tem ${Math.round(simTexto * 100)}% de sobreposicao textual com uma resposta anterior da IA neste atendimento, sem justificativa de evidencia nova`,
      acaoCorretiva: 'reconhecer_resposta_anterior_e_avancar_ou_declarar_falta_de_novidade',
    }];
  }
  return [];
}

function avaliarResposta({ textoResposta, manifesto, pesquisa, pergunta, houveRetry = false, historicoMensagens = [] } = {}) {
  const falhas = [];
  const resposta = String(textoResposta || '');
  const perguntaTexto = String(pergunta || '');
  const selecionados = manifesto?.selecionados || [];
  const omitidos = manifesto?.omitidos || [];
  const analisados = selecionados.filter(e => e.status === 'ANALISADA' || e.status === 'PARCIALMENTE_ANALISADA');
  const anexosAnalisados = analisados.filter(e => e.tipo === 'anexo' || e.tipo === 'imagem');
  const imagensAnalisadas = analisados.filter(e => e.tipo === 'imagem');
  const pedeAnexo = /\b(anexo|arquivo|fonte|log|print|imagem|screenshot|pdf|compare|ver novamente)\b/i.test(perguntaTexto);
  const evidenciaCriticaOmitida = omitidos.find(e => (e.score || 0) >= 80 && e.status !== 'NAO_SUPORTADA');
  const paginasComConteudo = _paginasLidasOuReutilizadas(pesquisa);

  if (pedeAnexo && anexosAnalisados.length === 0) {
    falhas.push({ codigo: 'ATTACHMENT_NOT_ANALYZED', legado: 'PERGUNTA_PEDE_ANEXO_SEM_ANEXO_ANALISADO', severidade: 'alta', acaoCorretiva: 'reconstruir_contexto_com_anexo_ou_visual' });
  }
  if (evidenciaCriticaOmitida) {
    falhas.push({ codigo: 'CRITICAL_EVIDENCE_OMITTED', legado: 'EVIDENCIA_CRITICA_OMITIDA', severidade: 'alta', evidencia: evidenciaCriticaOmitida.nome || evidenciaCriticaOmitida.id, evidenciaId: evidenciaCriticaOmitida.id, acaoCorretiva: 'forcar_evidencia_no_retry' });
  }
  if (_temRespostaGenerica(resposta) && analisados.length > 0) {
    falhas.push({ codigo: 'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE', legado: 'RESPOSTA_GENERICA_COM_EVIDENCIA_DISPONIVEL', severidade: 'media', acaoCorretiva: 'reforcar_evidencias_especificas' });
  }
  if (_usaTemplateFormalRobotico(resposta) && (analisados.length > 0 || paginasComConteudo.length > 0)) {
    falhas.push({
      codigo: 'ROBOTIC_TEMPLATE_RESPONSE',
      severidade: 'media',
      detalhe: 'resposta usou estrutura de laudo formal apesar de haver contexto para uma conversa tecnica direta',
      acaoCorretiva: 'reescrever_com_tom_conversacional',
    });
  }
  if (_correcaoPoucoAcionavel(resposta) && (analisados.length > 0 || paginasComConteudo.length > 0)) {
    falhas.push({
      codigo: 'WEAK_ACTIONABLE_CORRECTION',
      severidade: 'media',
      detalhe: 'resposta terminou em recomendacao generica mesmo com evidencias especificas disponiveis',
      acaoCorretiva: 'propor_primeiro_ajuste_ou_teste_tecnico',
    });
  }
  if (_acaoIgnoraErroMaisEspecifico(resposta) && (analisados.length > 0 || paginasComConteudo.length > 0)) {
    falhas.push({
      codigo: 'SPECIFIC_ERROR_NOT_PRIORITIZED',
      severidade: 'media',
      detalhe: 'resposta escolheu parametro/documentacao como primeira acao mesmo havendo erro especifico de modo de edicao/atribuicao',
      acaoCorretiva: 'priorizar_erro_especifico_na_correcao',
    });
  }
  if (_citaIdsInternosComoEvidencia(resposta)) {
    falhas.push({
      codigo: 'INTERNAL_IDS_USED_AS_EVIDENCE',
      severidade: 'media',
      detalhe: 'resposta citou ids internos do manifesto como se fossem logs/evidencias do chamado',
      acaoCorretiva: 'remover_ids_internos_e_citar_conteudo_visivel',
    });
  }
  if (_descartaCustomizacaoSemBase(resposta, manifesto)) {
    falhas.push({
      codigo: 'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG',
      severidade: 'media',
      detalhe: 'resposta descartou customizacao sem fonte/log/configuracao suficiente para sustentar a conclusao',
      acaoCorretiva: 'rebaixar_para_hipotese_e_pedir_fonte_ou_log_especifico',
    });
  }
  if (_ignoraPendenciaExternaBloqueante(resposta, manifesto)) {
    falhas.push({
      codigo: 'EXTERNAL_PENDING_DEPENDENCY_IGNORED',
      severidade: 'alta',
      detalhe: `chamado tem pendencia de retorno externo (${manifesto.pendenciaConsolidada.responsavel}) nao reconhecida como dependencia efetiva do proximo passo`,
      acaoCorretiva: 'reconhecer_pendencia_externa_e_priorizar_acompanhamento',
    });
  }
  if (/\b(causa confirmada|diagn[oó]stico confirmado|com certeza|definitivamente)\b/i.test(resposta) && !/\b(evid[eê]ncia|log|fonte|print|anexo|trecho|linha|stack)\b/i.test(resposta)) {
    falhas.push({
      codigo: 'CERTAINTY_WITHOUT_EVIDENCE',
      severidade: 'media',
      detalhe: 'resposta afirmou certeza sem explicitar evidencia tecnica',
      acaoCorretiva: 'explicitar_evidencia_ou_rebaixar_para_hipotese',
    });
  }
  if (/\b(corrig|corre[cç][aã]o|aplicar|ajuste|alterar)\b/i.test(resposta) && !/\b(valid\w*|homologa\w*|teste\w*|reteste\w*|reproduz\w*|compil\w*)\b/i.test(resposta)) {
    falhas.push({
      codigo: 'CORRECTION_WITHOUT_VALIDATION',
      severidade: 'media',
      detalhe: 'resposta propos correcao sem orientar validacao',
      acaoCorretiva: 'incluir_validacao_objetiva_da_correcao',
    });
  }
  if ((analisados.length > 0 || paginasComConteudo.length > 0) && /\b(evid[eê]ncia|log|fonte|print|anexo)\b/i.test(resposta) && !_temAcaoOuProximoPasso(resposta)) {
    falhas.push({
      codigo: 'EVIDENCE_WITHOUT_NEXT_ACTION',
      severidade: 'media',
      detalhe: 'resposta citou evidencia mas nao deixou uma acao/proximo passo claro',
      acaoCorretiva: 'informar_acao_recomendada_ou_evidencia_faltante',
    });
  }
  if (imagensAnalisadas.length > 0 && /imagem|imagens|print|screenshot|tela/i.test(resposta)) {
    const respostaNormalizada = _normalizar(resposta);
    const temSinalVisualConcreto = /fwwhen|%\s*rateio|perc\s+rateio|valor do rat|nf rateio|modo edicao|valor nao pode ser atribuido|incluir|alterar|100[, ]?00|105[, ]?6/.test(respostaNormalizada);
    if (!temSinalVisualConcreto) {
      falhas.push({
        codigo: 'VISUAL_EVIDENCE_TOO_GENERIC',
        severidade: 'media',
        detalhe: 'resposta cita imagens/prints sem mencionar texto, campo, percentual ou mensagem visivel nos anexos',
        acaoCorretiva: 'citar_evidencia_visual_concreta',
      });
    }
  }
  falhas.push(...investigativeDiscipline.avaliarAfirmacoes({
    textoResposta: resposta,
    evidenciasTexto: [
      perguntaTexto,
      ...(analisados || []).map(e => `${e.nome || e.id || ''} ${e.trecho || e.resumo || e.conteudo || ''}`),
      pesquisa?.plano ? JSON.stringify(pesquisa.plano) : '',
    ].filter(Boolean).join('\n'),
    manifesto: { ...manifesto, pesquisa },
  }));
  falhas.push(..._avaliarRegressaoInvestigativa(resposta, manifesto));
  falhas.push(..._avaliarRepeticaoDeRespostaAnterior(resposta, historicoMensagens));
  if (/pesquis|tdn|totvs|softexpert|documenta[cç][aã]o|fonte oficial/i.test(perguntaTexto)) {
    if (!pesquisa?.configurado) falhas.push({ codigo: 'RESEARCH_REQUIRED_NOT_EXECUTED', legado: 'PESQUISA_NAO_CONFIGURADA', severidade: 'media', acaoCorretiva: 'informar_pesquisa_indisponivel' });
    else if (pesquisa?.modo !== 'web') falhas.push({ codigo: 'RESEARCH_CONFIGURED_WITHOUT_RESULTS', legado: 'PESQUISA_CONFIGURADA_SEM_RESULTADO', severidade: 'media', acaoCorretiva: 'executar_pesquisa_solicitada_ou_declarar_limite' });
    else if (!paginasComConteudo.length) falhas.push({ codigo: 'RESEARCH_FOUND_BUT_NOT_READ', legado: 'PESQUISA_SEM_PAGINA_LIDA', severidade: 'media', acaoCorretiva: 'tentar_fetch_seguro' });
  }

  const deveRetry = !houveRetry && falhas.some(f => ['alta', 'media'].includes(f.severidade));
  return {
    aprovado: falhas.length === 0,
    deveRetry,
    falhas,
    criterios: {
      anexosAnalisados: anexosAnalisados.length,
      evidenciasSelecionadas: selecionados.length,
      evidenciasOmitidas: omitidos.length,
      dossieStatus: manifesto?.dossie?.status || null,
      dossieStale: manifesto?.dossie?.stale ?? null,
      dossieItensSelecionados: manifesto?.dossie?.itensSelecionados?.length || 0,
      pesquisaModo: pesquisa?.modo || null,
      paginasLidas: paginasComConteudo.length,
    },
  };
}

function montarInstrucaoRetry(gate) {
  const falhas = (gate?.falhas || []).map(f => f.codigo).join(', ');
  const regressao = (gate?.falhas || []).filter(f => String(f.codigo || '').startsWith('REGRESSAO_INVESTIGATIVA'));
  // Achado real, Caso #001 (2026-10): quando pesquisa era necessária mas não
  // pôde ser executada (sem chave configurada) OU foi mal interpretada pelo
  // plano, a resposta seguia como se a investigação externa tivesse sido
  // considerada normalmente, sem declarar a limitação — o usuário via uma
  // "causa provável" repetida sem saber que nenhuma fonte externa real foi
  // consultada. Esta instrução não inventa resultado nem força retry
  // infinito (deveRetry já é limitado a 1 tentativa em investigacao-service.js);
  // apenas garante que, quando a 2ª tentativa ainda carregar essa falha, o
  // texto final seja obrigado a declarar a limitação explicitamente.
  const pesquisaIndisponivel = (gate?.falhas || []).some(f => f.codigo === 'RESEARCH_REQUIRED_NOT_EXECUTED');
  return [
    'A resposta anterior falhou no Quality Gate interno.',
    `Falhas detectadas: ${falhas || 'nao especificadas'}.`,
    regressao.length ? `Regressao investigativa detectada: ${regressao.map(f => `${f.codigo}${f.itemCodigo ? ` em ${f.itemCodigo}` : ''}${f.evidencia ? ` em ${f.evidencia}` : ''}`).join('; ')}.` : '',
    regressao.length ? 'Use o estado atual do dossie: nao repita teste/evidencia/hipotese/solucao ja encerrados sem justificar explicitamente qual evidencia ou mudanca nova torna a repeticao necessaria.' : '',
    'Refaca a analise usando explicitamente as evidencias selecionadas no manifesto. Cite as evidencias tecnicas que sustentam o diagnostico.',
    'Reescreva como conversa tecnica humana, nao como laudo com template fixo. Evite cabecalhos formais em Markdown como "### Fatos", "### Causa provavel" e "### Proximos passos". Comece pelo ponto que mais muda a analise e va direto ao proximo ajuste/teste de maior valor.',
    'Se houver evidencias suficientes, proponha uma acao tecnica concreta. Nao use "agendar videochamada", "analisar melhor" ou "consultar documentacao" como recomendacao principal quando ja existem prints, logs, parametros, rotinas ou fontes oficiais apontando uma trilha.',
    'A primeira acao tecnica deve atacar a evidencia mais especifica do caso. Se houver uma mensagem de erro concreta (por exemplo modo de edicao, campo nao atribuivel, stack trace ou excecao), priorize essa trilha antes de parametros/documentacao genericos.',
    'Nao cite IDs internos do manifesto como se fossem logs, mensagens ou evidencias do chamado. Cite apenas conteudo visivel, nome de arquivo, campo, mensagem de erro, trecho de log real ou fonte tecnica.',
    'Nao descarte customizacao nem atribua o erro ao produto padrao sem fonte, log ou codigo sustentando essa conclusao. Se nao houver esse material, diga que precisa conferir fonte/gatilho/ponto de entrada.',
    'Quando houver imagens/prints enviados, cite textos, campos, percentuais, mensagens ou estados visiveis nas telas. Nao escreva apenas "as imagens mostram" sem dizer o que foi visto.',
    'Quando houver fontes oficiais lidas ou reutilizadas, use-as como evidencia externa rastreavel e diferencie parametro/documentacao de causa confirmada no ambiente.',
    'Se a evidencia necessaria nao estiver disponivel ou nao for suportada, diga isso objetivamente e peca a evidencia especifica que falta.',
    'Se uma causa ou fato tecnico nao estiver sustentado, rebaixe para hipotese explicita e informe a lacuna/proximo passo de maior valor.',
    pesquisaIndisponivel ? 'Pesquisa tecnica externa era necessaria para esta pergunta mas nao pode ser executada (mecanismo de busca indisponivel nesta instalacao). Declare isso explicitamente na resposta ao usuario — nao apresente a causa como se tivesse sido corroborada por fonte externa, e nao finja ter pesquisado.' : '',
  ].filter(Boolean).join('\n');
}

module.exports = { avaliarResposta, montarInstrucaoRetry, _avaliarRegressaoInvestigativa, _similaridadeShingles, _extrairAncorasTecnicas };
