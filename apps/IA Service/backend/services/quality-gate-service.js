'use strict';

const investigativeDiscipline = require('./investigative-discipline-service');
const planoRespostaRastreavel = require('./plano-resposta-rastreavel-service');
const { avaliarEvidencias } = require('./evidencia-comportamento-fonte-service');
const { extrairAlteracoes } = require('./alteracao-ancorada-service');

const DECISAO_QG = {
  BLOQUEIO_OBJETIVO: 'bloqueio_objetivo',
  SUSPEITA_SEMANTICA: 'suspeita_semantica',
  EVIDENCIA_INSUFICIENTE: 'evidencia_insuficiente',
  CORRECAO_ESTILO: 'correcao_estilo',
};

function _comDecisao(falha, decisao) {
  if (!falha) return falha;
  return {
    ...falha,
    decisionKind: falha.decisionKind || decisao,
    categoriaDecisao: falha.categoriaDecisao || decisao,
  };
}

function _classificarFalha(falha) {
  if (!falha || falha.decisionKind) return falha;
  const codigo = falha.codigo;
  const estilo = new Set([
    'ROBOTIC_TEMPLATE_RESPONSE',
    'WEAK_ACTIONABLE_CORRECTION',
    'SPECIFIC_ERROR_NOT_PRIORITIZED',
    'GENERIC_RESPONSE_WITH_SPECIFIC_EVIDENCE',
    'VISUAL_EVIDENCE_TOO_GENERIC',
    'CORRECTION_WITHOUT_VALIDATION',
    'EVIDENCE_WITHOUT_NEXT_ACTION',
    'RETRY_CONTEXT_LEAKED',
  ]);
  const objetivo = new Set([
    'SOURCE_BEHAVIOR_CONTRADICTION',
    'INTERNAL_IDS_USED_AS_EVIDENCE',
    'UNSUPPORTED_OPERATIONAL_COUNT',
    'REDUNDANT_OPERATIONAL_ESCALATION',
    'REDUNDANT_OPERATIONAL_MEETING',
    'OPERATIONAL_ESCALATION_TREATED_AS_RESOLUTION',
    'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE',
    'INVESTIGATIVE_FRAME_OPERATIONAL_STAGE_IGNORED',
    'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG',
    'ATTACHMENT_NOT_ANALYZED',
    'CRITICAL_EVIDENCE_OMITTED',
    'FACTUAL_CONTRADICTION_WITH_MISSING_EVIDENCE',
    'TRUNCATED_RESPONSE_INCOMPLETE',
    'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE',
    'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE',
  ]);
  if (estilo.has(codigo)) return _comDecisao(falha, DECISAO_QG.CORRECAO_ESTILO);
  if (objetivo.has(codigo)) return _comDecisao(falha, DECISAO_QG.BLOQUEIO_OBJETIVO);
  if (codigo === 'UNTRACEABLE_TECHNICAL_REFERENCE' && falha.motivoRastreabilidade === 'visual_sem_observacao_estruturada') {
    return _comDecisao(falha, DECISAO_QG.EVIDENCIA_INSUFICIENTE);
  }
  if (codigo === 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE') {
    return _comDecisao(falha, DECISAO_QG.SUSPEITA_SEMANTICA);
  }
  if (codigo === 'UNTRACEABLE_TECHNICAL_REFERENCE') return _comDecisao(falha, DECISAO_QG.BLOQUEIO_OBJETIVO);
  return _comDecisao(falha, DECISAO_QG.SUSPEITA_SEMANTICA);
}

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

function _propostaDeCorrecao(texto) {
  // Uma ação já feita no histórico não é uma nova prescrição. Exigir teste
  // só pela palavra "ajuste" gerava reprovação sem correção proposta.
  // Alterações ancoradas sempre são uma correção proposta.
  if (/```iahub-alteracao/.test(String(texto || ''))) return '```iahub-alteracao';
  const IMPERATIVO = '(?:aplique|ajuste|altere|corrija|configure|atualize|substitua|remova|adicione|inclua|troque|instale|habilite|desabilite|recompile|compile)';
  const INFINITIVO = '(?:aplicar|ajustar|alterar|corrigir|configurar|atualizar|substituir|remover|adicionar|incluir|trocar|instalar|habilitar|desabilitar|compilar|recompilar)';
  return String(texto || '').split(/\n|(?<=[.!?])\s+/).find(frase =>
    // Necessidade relatada no passado ("foi necessário ajustar") é histórico.
    !/\b(?:foi|foram|era|eram|tinha|tinham|houve)\s+(?:necess[aá]ri\w*|precis\w*)\b/i.test(frase) && (
      new RegExp(`(?:^|[:,;]|\\b(?:e|ou|depois|ent[aã]o|em seguida)\\s)\\s*(?:\\d+[.)]\\s*)?(?:[-*]\\s*)?(?:\\*\\*)?${IMPERATIVO}\\b`, 'i').test(frase)
      // Limites com acentos: \b não reconhece "é" como letra.
      || new RegExp(`(?<![\\wÀ-ú])(?:proponho|propomos|recomendo|recomendamos|sugiro|sugerimos|deve|devem|deveria|precisa|precisam|(?:é|e) preciso|necess[aá]rio|vale|conv[eé]m|basta|pode|podem|corre[cç][aã]o proposta|a corre[cç][aã]o (?:é|e|seria)|a solu[cç][aã]o (?:é|e|seria))(?![\\wÀ-ú])[^.!?\\n]{0,100}\\b${INFINITIVO}\\b`, 'i').test(frase)));
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
  const s = String(texto || '').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  return /\b(log|logs|mensagens?|anexos?|evidencias?)\b[\s\S]{0,160}\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|aud-(?:msg|an|at|ch)-[a-z0-9-]+)\b/i.test(s)
    || /\baud-(?:msg|an|at|ch)-[a-z0-9-]+\b/i.test(s);
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
  const reconheceLimite = /\b(sem|nao ha|nao temos|nao veio|nao mostra|nao mostram|falt[ao]?)\b[\s\S]{0,120}\b(fonte|codigo|log|gatilho|ponto de entrada|pe|configuracao)\b/i.test(s)
    || /\b(nao da para afirmar|nao e possivel afirmar|nao consigo afirmar|precisa conferir|preciso conferir|hipotese|possivel|a validar|falta confirmar)\b/i.test(s);
  const discuteCondicional = /\b(pode ser|poderia ser|pode existir|hipotese|possivel|a validar|gatilho|ponto de entrada|pe|fonte)\b[\s\S]{0,140}\b(customizacao|comportamento padrao|produto padrao|protheus)\b/i.test(s)
    || /\b(customizacao|comportamento padrao|produto padrao|protheus)\b[\s\S]{0,140}\b(pode ser|poderia ser|hipotese|possivel|a validar|gatilho|ponto de entrada|pe|fonte)\b/i.test(s);
  if (reconheceLimite || discuteCondicional) return false;
  const descarta = /nao por customizacao|nao e customizacao|nao se trata de customizacao|descarto customizacao|customizacao descartada|erro e gerado pelo proprio protheus|comportamento padrao do protheus|produto padrao do protheus/.test(s);
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

// A resposta informa ao analista que a pesquisa externa nao trouxe resultado.
function _declaraPesquisaSemResultado(texto) {
  const s = _normalizar(texto);
  const ausencia = '(nao (retornou|retornaram|trouxe|trouxeram|encontrou|encontrei|encontramos|localizou|localizei|achei|identifiquei|identificou)|nao foi (encontrad|localizad|identificad)|nao foram (encontrad|localizad|identificad)|nenhum (resultado|registro|chamado|artigo|conteudo|material)|sem (resultado|retorno))';
  const pesquisa = '(pesquis|busca|consulta|fonte|totvs|tdn|forum|internet|documentac)';
  return new RegExp(`${pesquisa}[^.!?\\n]{0,160}${ausencia}`).test(s) || new RegExp(`${ausencia}[^.!?\\n]{0,160}${pesquisa}`).test(s);
}

function _corpusInterno(manifesto, pergunta, historicoMensagens) {
  return [
    pergunta,
    ...(historicoMensagens || []).map(m => m.conteudo || ''),
    ...(manifesto?.observacoesVisuais || []).map(o => [
      o.nome,
      o.anexoId,
      ...(o.textosVisiveis || []),
      ...(o.campos || []),
      ...(o.valores || []),
      o.observacao,
    ].filter(Boolean).join(' ')),
    ...(manifesto?.selecionados || []).map(e => [
      e.nome,
      e.trecho,
      e.resumo,
      e.conteudo,
      e.conteudoExtraido,
      e.textoObservado,
      e.observacaoVisual,
      e.evidenciaVisual,
      e.visual?.texto,
      e.visual?.observacao,
    ].filter(Boolean).join(' ')),
    JSON.stringify(manifesto?.dossie || {}),
    JSON.stringify(manifesto?.quadroInvestigativo || {}),
  ].filter(Boolean).join('\n');
}

function _avaliarContradicaoComEvidenciaAusente(textoResposta, manifesto, pergunta, historicoMensagens) {
  const corpus = _normalizar(_corpusInterno(manifesto, pergunta, historicoMensagens));
  const resposta = _normalizar(textoResposta);
  const falhas = [];

  const ausencias = [
    {
      item: 'XML original/completo',
      ausente: /\b(xml|arquivo xml)\b[\s\S]{0,80}\b(nao|sem|ausente|falt|pendente|indisponivel)\b[\s\S]{0,80}\b(anexad|enviad|disponibiliz|consta|recebid|incluid|fornecid)|\b(nao|sem|ausente|falt|pendente|indisponivel)\b[\s\S]{0,80}\b(xml|arquivo xml)\b[\s\S]{0,80}\b(anexad|enviad|disponibiliz|consta|recebid|incluid|fornecid)/i,
      contradiz: /\b(pdf|anexo|retorno|evidencia|arquivo)\b[\s\S]{0,80}\b(contem|traz|inclui|mostra|apresenta|possui)\b[\s\S]{0,80}\b(xml completo|xml original|arquivo xml completo)\b|\b(xml completo|xml original|arquivo xml completo)\b[\s\S]{0,80}\b(foi anexad|foi enviad|esta anexad|consta no|veio no|aparece no|esta no pdf|esta no anexo)\b/i,
    },
    {
      item: 'log TSS/completo',
      ausente: /\b(log tss|log completo|log)\b[\s\S]{0,80}\b(nao|sem|ausente|falt|pendente|indisponivel)\b[\s\S]{0,80}\b(anexad|enviad|disponibiliz|consta|recebid|incluid|fornecid)|\b(nao|sem|ausente|falt|pendente|indisponivel)\b[\s\S]{0,80}\b(log tss|log completo|log)\b[\s\S]{0,80}\b(anexad|enviad|disponibiliz|consta|recebid|incluid|fornecid)/i,
      contradiz: /\b(pdf|anexo|retorno|evidencia|arquivo)\b[\s\S]{0,80}\b(contem|traz|inclui|mostra|apresenta|possui)\b[\s\S]{0,80}\b(log tss|log completo)\b|\b(log tss|log completo)\b[\s\S]{0,80}\b(foi anexad|foi enviad|esta anexad|consta no|veio no|aparece no|esta no pdf|esta no anexo)\b/i,
    },
    {
      item: 'fonte/codigo',
      ausente: /\b(fonte|codigo|prw|tlpp)\b[\s\S]{0,80}\b(nao|sem|ausente|falt|pendente|indisponivel)\b[\s\S]{0,80}\b(anexad|enviad|disponibiliz|consta|recebid|incluid|fornecid)|\b(nao|sem|ausente|falt|pendente|indisponivel)\b[\s\S]{0,80}\b(fonte|codigo|prw|tlpp)\b[\s\S]{0,80}\b(anexad|enviad|disponibiliz|consta|recebid|incluid|fornecid)/i,
      contradiz: /\b(fonte completo|codigo completo|prw completo|tlpp completo)\b[\s\S]{0,80}\b(foi anexad|foi enviad|esta anexad|consta no|veio no|aparece no|esta no anexo)\b|\b(anexo|arquivo)\b[\s\S]{0,80}\b(contem|traz|inclui|mostra|apresenta|possui)\b[\s\S]{0,80}\b(fonte completo|codigo completo|prw completo|tlpp completo)\b/i,
    },
  ];

  for (const regra of ausencias) {
    if (!regra.ausente.test(corpus)) continue;
    if (!regra.contradiz.test(resposta)) continue;
    falhas.push({
      codigo: 'FACTUAL_CONTRADICTION_WITH_MISSING_EVIDENCE',
      severidade: 'alta',
      evidencia: regra.item,
      detalhe: `resposta afirmou disponibilidade/conteudo de evidencia explicitamente ausente: ${regra.item}`,
      acaoCorretiva: 'corrigir_fato_e_tratar_item_como_lacuna_investigativa',
    });
  }
  return falhas;
}

function _avaliarCertezaIndevidaComEvidenciaParcial(textoResposta, manifesto, pergunta, historicoMensagens) {
  const corpus = _normalizar(_corpusInterno(manifesto, pergunta, historicoMensagens));
  const resposta = _normalizar(textoResposta);
  const falhas = [];

  const fonteParcial = /\b(trecho do fonte|trecho de fonte|fonte parcial|linhas?\s+\d+\s+a\s+\d+|arquivo completo nao|fonte completo nao|faltam? linhas?|preciso ver o fonte completo|precisa ver o fonte completo)\b/i.test(corpus);
  if (fonteParcial) {
    const padroesConclusivos = [
      /\b(a causa tecnica e|a causa e|causa direta|ponte causal e direta|isso e o erro|esse e o erro|resolve o erro especifico|corrige o erro especifico)\b[\s\S]{0,180}\b(local|declaracao|declarar|escopo|variavel|cseriedanfe)\b/gi,
      /\b(a causa esta clara|causa esta clara|causa clara)\b[\s\S]{0,220}\b(local|declaracao|declarar|escopo|variavel|cseriedanfe|fonte|log)\b/gi,
      /\b(local|declaracao|declarar|escopo|variavel|cseriedanfe)\b[\s\S]{0,180}\b(e a causa|causa tecnica|resolve o erro|corrige o erro|nao existe no escopo)\b/gi,
    ];
    let conclusaoIndevida = false;
    for (const padrao of padroesConclusivos) {
      let match;
      while ((match = padrao.exec(resposta)) !== null) {
        const janela = resposta.slice(Math.max(0, match.index - 80), Math.min(resposta.length, match.index + match[0].length + 120));
        const conclusaoForte = /\b(a causa tecnica e|a causa e|a causa esta clara|causa esta clara|causa clara|ponte causal e direta|isso e o erro|esse e o erro|resolve o erro especifico|corrige o erro especifico)\b/i.test(janela);
        const limitadorLocal = /\b(hipotese|a validar|se confirmado|se nao houver|precisa confirmar|preciso confirmar|confirmar no fonte completo|verificar no fonte completo|teste controlado)\b/i.test(janela);
        if (conclusaoForte || !limitadorLocal) {
          conclusaoIndevida = true;
          break;
        }
      }
      if (conclusaoIndevida) break;
    }
    if (conclusaoIndevida) {
      falhas.push({
        codigo: 'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE',
        severidade: 'media',
        detalhe: 'resposta promoveu conclusao de escopo/variavel a causa confirmada apesar de haver apenas trecho de fonte ou fonte incompleto',
        acaoCorretiva: 'rebaixar_para_hipotese_e_exigir_fonte_completo_compilacao_e_teste_controlado',
      });
    }
  }

  const softExpertWorkflow = /\bsoftexpert|workflow|callback|activity|act-validacao|pending responsible role resolution|responsible role\b/i.test(corpus);
  if (softExpertWorkflow) {
    const padraoAutorizacao = /\b(autorizacao|autoriza[cç][aã]o|permissao|permiss[aã]o|papel|role|responsavel|responsabilidade)\b[\s\S]{0,140}\b(bloqueia|bloqueando|impede|impedindo|falha|falhando|explica por que|causa)\b|\b(bloqueia|bloqueando|impede|impedindo|explica por que|causa)\b[\s\S]{0,140}\b(autorizacao|autoriza[cç][aã]o|permissao|permiss[aã]o|papel|role|responsavel|responsabilidade)\b/gi;
    let match;
    while ((match = padraoAutorizacao.exec(resposta)) !== null) {
      const janela = resposta.slice(Math.max(0, match.index - 90), Math.min(resposta.length, match.index + match[0].length + 90));
      const contemLimitador = /\b(pode|poderia|hipotese|hipótese|provavel|provável|sinal|sugere|a confirmar|validar|verificar|se|preciso|falta|sem evid[eê]ncia conclusiva|nao da para afirmar|não dá para afirmar)\b/i.test(janela);
      if (contemLimitador) continue;
      falhas.push({
        codigo: 'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE',
        severidade: 'media',
        detalhe: 'resposta tratou permissao/papel/responsavel como causa confirmada sem log interno ou configuracao do workflow',
        acaoCorretiva: 'apresentar_como_hipotese_e_pedir_log_interno_configuracao_da_atividade_e_permissoes',
      });
      break;
    }
  }
  return falhas;
}

// Detecta afirmacao numerica que nao fecha aritmeticamente — achado real,
// auditoria 2026-10 (caso 035635): resposta afirmou que a diferenca de saldo
// de R$ 61.487,96 "corresponde a" duas aplicacoes CDB citadas (R$
// 11.117.500,00 + R$ 145.500,00 = R$ 11.263.000,00), uma discrepancia de
// ~184x. O Quality Gate so reprovou por estilo (ROBOTIC_TEMPLATE_RESPONSE),
// nunca verificou se a conta de fato fecha. Diferente dos detectores de
// "certeza indevida" existentes (_avaliarCertezaIndevidaComEvidenciaParcial),
// que dependem de vocabulario fixo de dois cenarios especificos, esta
// checagem e puramente aritmetica: extrai valores monetarios de ambos os
// lados de uma frase de correspondencia/soma e confere o calculo com
// tolerancia de 1% (ou R$1, o que for maior) para arredondamento legitimo —
// nao bloqueia por palavra isolada, soh quando o numero realmente nao bate.
function _extrairValoresMonetarios(trecho) {
  // Aceita "R$ 1.234,56" ou numero solto no padrao BR "1.234,56" (ex. dentro
  // de parenteses listando valores somados) — achado real, auditoria
  // 2026-10: a resposta real citava os valores somados SEM o prefixo "R$"
  // repetido ("11.117.500,00 + 145.500,00"), so a diferenca tinha "R$".
  const matches = String(trecho || '').match(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
  return matches.map(m => {
    const limpo = m.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.');
    return Number(limpo);
  }).filter(n => Number.isFinite(n));
}

function _avaliarConsistenciaAritmetica(textoResposta) {
  const falhas = [];
  const s = String(textoResposta || '');
  const padraoCorrespondencia = /\bdiferen[cç]a[\s\S]{0,60}(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}[\s\S]{0,40}\b(?:que\s+)?corresponde(?:m)?\s+a\b[\s\S]{0,220}/gi;
  let match;
  while ((match = padraoCorrespondencia.exec(s)) !== null) {
    const trecho = match[0];
    const valores = _extrairValoresMonetarios(trecho);
    if (valores.length < 2) continue;
    const diferencaAfirmada = Math.abs(valores[0]);
    const somaDemaisValores = valores.slice(1).reduce((acc, v) => acc + Math.abs(v), 0);
    const tolerancia = Math.max(1, diferencaAfirmada * 0.01);
    if (Math.abs(somaDemaisValores - diferencaAfirmada) > tolerancia) {
      falhas.push({
        codigo: 'ARITHMETIC_CLAIM_DOES_NOT_RECONCILE',
        severidade: 'alta',
        detalhe: `resposta afirmou que valores somam/correspondem a uma diferenca de R$ ${diferencaAfirmada.toFixed(2)}, mas a soma dos valores citados e R$ ${somaDemaisValores.toFixed(2)} — a conta nao fecha`,
        trecho: compactarTrechoAritmetico(trecho),
        decisionKind: DECISAO_QG.BLOQUEIO_OBJETIVO,
        categoriaDecisao: DECISAO_QG.BLOQUEIO_OBJETIVO,
        acaoCorretiva: 'corrigir_o_calculo_ou_remover_a_afirmacao_de_correspondencia_numerica',
      });
    }
  }
  return falhas;
}

function compactarTrechoAritmetico(trecho, max = 240) {
  const s = String(trecho || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

function _corpusPesquisa(pesquisa) {
  return [
    ...(pesquisa?.paginasLidas || []).map(p => [p.titulo, p.url, p.trecho].filter(Boolean).join(' ')),
    ...(pesquisa?.resultados || []).map(p => [p.titulo, p.url, p.trecho].filter(Boolean).join(' ')),
    JSON.stringify(pesquisa?.plano || {}),
  ].filter(Boolean).join('\n');
}

const UI_ACOES = new Set(['INCLUIR', 'ALTERAR', 'VISUALIZAR', 'CONSULTAR', 'EXCLUIR', 'CONFIRMAR', 'CANCELAR', 'SALVAR', 'FECHAR']);

function _tipoIdentificadorTecnico(termo) {
  const t = String(termo || '').toUpperCase();
  if (UI_ACOES.has(t)) return 'UI_ACAO';
  if (/^MV_[A-Z0-9_]+$/.test(t)) return 'PARAMETRO';
  if (/^U_[A-Z0-9_]+$/.test(t)) return 'FUNCAO_CUSTOM';
  if (/^SIGA[A-Z0-9]+$/.test(t)) return 'MODULO';
  if (/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_.]*$/.test(t)) return 'ARQUIVO_FONTE';
  if (/^(?:MATA|FINA|PGCA|OMSA|GPEA|CTBA|CNTA|ATFA|COMA|FATA|OM)[A-Z0-9_]*\d[A-Z0-9_]*$/.test(t)) return 'ROTINA_PROTHEUS';
  if (/^(?:SX[235]|S[A-Z0-9]{2}|B1_[A-Z0-9_]+|F1_[A-Z0-9_]+|D1_[A-Z0-9_]+)$/.test(t)) return 'TABELA_CAMPO';
  if (/^[A-Z][A-Z0-9_]{2,}_[A-Z0-9_]+$/.test(t)) return 'FUNCAO_CUSTOM';
  if (/^[A-Z]{3,}\d{2,}[A-Z0-9_]*$/.test(t)) return 'ROTINA_OU_CODIGO';
  if (/APP$|EXECUTE|CALL|STACK|TRACE/.test(t)) return 'FUNCAO_STACK';
  return 'TERMO_COMUM_MAIUSCULO';
}

function _extrairIdentificadoresTecnicosDetalhados(texto) {
  const s = String(texto || '');
  const encontrados = s.match(/\b(?:MV_[A-Z0-9_]+|U_[A-Z0-9_]+|SIGA[A-Z0-9]+|[A-Z]{3,}\d{2,}[A-Z0-9_]*|[A-Z][A-Z0-9_]{2,}_[A-Z0-9_]+|[A-Z]{2,}[A-Z0-9_]{3,}|[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_.]*)\b/g) || [];
  const ignorar = new Set(['TOTVS', 'PROTHEUS', 'SOFTEXPERT', 'PDF', 'PNG', 'JPG', 'XML', 'JSON', 'HTTP', 'HTTPS', 'SLA', 'IA', 'API', 'OBSERVACOES_VISUAIS_AUDITORIA', 'FIM_OBSERVACOES_VISUAIS_AUDITORIA']);
  const termos = [...new Set(encontrados.map(t => t.toUpperCase()).filter(t => !ignorar.has(t) && t.length >= 5))];
  return termos.map(termo => ({ termo, tipo: _tipoIdentificadorTecnico(termo) }));
}

function _extrairIdentificadoresTecnicos(texto) {
  return _extrairIdentificadoresTecnicosDetalhados(texto)
    .filter(x => x.tipo !== 'UI_ACAO' && x.tipo !== 'TERMO_COMUM_MAIUSCULO')
    .map(x => x.termo);
}

function _temRotuloHipoteseOuOrigem(texto, termo) {
  const n = _normalizar(texto);
  const t = _normalizar(termo);
  const idx = n.indexOf(t);
  if (idx < 0) return false;
  const janela = n.slice(Math.max(0, idx - 140), Math.min(n.length, idx + t.length + 160));
  return /\b(pesquisa|fonte externa|documentacao|tdn|totvs cita|artigo|hipotese|hipotetico|a validar|validar|pode ser|possivel|exemplo|como apoio|contexto geral|nao confirma|sem comprovar|similar|semelhante|familia|trilha|verificar se existe|procure por|procurar por)\b/i.test(janela);
}

function _temReferenciaVisualRastreavel(manifesto, termo) {
  const t = _normalizar(termo);
  const observacao = (manifesto?.observacoesVisuais || []).some(o => {
    const texto = _normalizar([
      o.nome,
      o.anexoId,
      ...(o.textosVisiveis || []),
      ...(o.campos || []),
      ...(o.valores || []),
      o.observacao,
    ].filter(Boolean).join(' '));
    return texto && texto.includes(t);
  });
  if (observacao) return true;
  return (manifesto?.selecionados || []).some(e => {
    if (e.tipo !== 'imagem' && !e.enviadoComoImagem && !e.imagemEnviada) return false;
    const texto = _normalizar([
      e.trecho,
      e.resumo,
      e.conteudo,
      e.conteudoExtraido,
      e.textoObservado,
      e.observacaoVisual,
      e.evidenciaVisual,
      e.visual?.texto,
      e.visual?.observacao,
    ].filter(Boolean).join(' '));
    return texto && texto.includes(t);
  });
}

function _temImagemSemTextoEstruturado(manifesto) {
  if ((manifesto?.observacoesVisuais || []).length > 0) return false;
  return (manifesto?.selecionados || []).some(e => {
    if (e.tipo !== 'imagem' && !e.enviadoComoImagem && !e.imagemEnviada) return false;
    const texto = [
      e.trecho,
      e.resumo,
      e.conteudo,
      e.conteudoExtraido,
      e.textoObservado,
      e.observacaoVisual,
      e.evidenciaVisual,
      e.visual?.texto,
      e.visual?.observacao,
    ].filter(Boolean).join(' ').trim();
    return !texto;
  });
}

function _respostaAlegaVisual(texto, termo) {
  const n = _normalizar(texto);
  const t = _normalizar(termo);
  const idx = n.indexOf(t);
  if (idx < 0) return false;
  const janela = n.slice(Math.max(0, idx - 180), Math.min(n.length, idx + t.length + 180));
  return /\b(print|prints|imagem|imagens|tela|screenshot|anexo visual)\b/.test(janela)
    && /\b(mostra|mostram|aparece|aparecem|traz|trazem|vejo|visivel|visiveis|comprova|comprovam|confirma|confirmam|prova|provam)\b/.test(janela);
}

function _janelaNegaAtribuicaoInterna(janela) {
  return /\b(nao|sem|nenhum|nenhuma)\b[\s\S]{0,80}\b(historico|mensagens?|cliente|prints?|anexos?|log|evidencias? internas?)\b[\s\S]{0,120}\b(mencao|mostra|mostram|traz|trazem|aparece|aparecem|informa|registra|cita|referencia)\b/i.test(janela)
    || /\b(nao aparece|nao ha|nao consta|nao foi encontrado|nao esta no|nao veio do|apenas pesquisa externa|so pesquisa externa|fonte externa|contexto do modulo|nao e evidencia|nao comprova|nao confirma)\b/i.test(janela);
}

function _pareceRotinaPadraoProtheus(termo) {
  return /^(?:FINA|MATA|PGCA|OMSA|GPEA|CTBA|SIGA)[A-Z0-9_]*\d[A-Z0-9_]*$/i.test(String(termo || ''));
}

function _usoVisualComoObservacaoSemCausa(texto, termo) {
  const n = _normalizar(texto);
  const t = _normalizar(termo);
  const idx = n.indexOf(t);
  if (idx < 0) return false;
  const janela = n.slice(Math.max(0, idx - 220), Math.min(n.length, idx + t.length + 260));
  const visual = /\b(print|prints|imagem|imagens|tela|screenshot|anexo visual)\b/.test(janela);
  if (!visual) return false;
  const limitaCausa = /\b(sem ponte causal|sem vinculo causal|nao tem relacao causal demonstrada|nao usaria isso como causa|outro dominio|problema diferente|incidental|separad[ao]|nao relacionado)\b/.test(janela);
  const afirmaCausa = /\b(causa|causado|impactando|impede|por isso|deve estar|regularizar.*antes|corrigir.*antes)\b/.test(janela) && !limitaCausa;
  return !afirmaCausa && (limitaCausa || /\b(mostra|mostram|aparece|aparecem|traz|trazem|erro|mensagem)\b/.test(janela));
}

function _usoTecnicoComoHipoteseCondicional(texto, termo) {
  const n = _normalizar(texto);
  const t = _normalizar(termo);
  const idx = n.indexOf(t);
  if (idx < 0) return false;
  const janela = n.slice(Math.max(0, idx - 240), Math.min(n.length, idx + t.length + 260));
  const hipotese = /\b(hipotese|a validar|validar|verificar|conferir|procure por|procurar por|pode existir|pode ser|possivel|similar|semelhante|ou similar|familia|exemplo|ex\.|por exemplo|ou outro|ou outra|trilha)\b/.test(janela);
  if (!hipotese) return false;
  const conclusaoForte = /\b(causa confirmada|causa provavel e|diagnostico confirmado|com certeza|definitivamente|e o ponto de entrada concreto|corrija a rotina|ajuste a rotina|a causa e|o problema e causado)\b/.test(janela);
  return !conclusaoForte;
}

const TOKENS_PROTOCOLO_INTERNO = new Set(['OBSERVACOES_VISUAIS_AUDITORIA', 'FIM_OBSERVACOES_VISUAIS_AUDITORIA']);
const FONTES_DO_CASO = 'cliente|historico|mensagens?|prints?|anexos?|log|evidencias? internas?';
const VERBOS_ATRIBUICAO = 'mostra|mostram|traz|trazem|aparece|aparecem|informa|informou|registra|registram|cita|citam|referencia|referenciam';

// A resposta apresenta a referencia como algo que o cliente/historico/print/log
// do CASO mostra? (afirmacao sobre o caso, nao conhecimento tecnico)
function _atribuiReferenciaAoCaso(janela) {
  return new RegExp(`\\b(${FONTES_DO_CASO})\\b[\\s\\S]{0,120}\\b(${VERBOS_ATRIBUICAO})\\b`, 'i').test(janela)
    || new RegExp(`\\b(${VERBOS_ATRIBUICAO})\\b[\\s\\S]{0,120}\\b(${FONTES_DO_CASO})\\b`, 'i').test(janela);
}

// A propria resposta ja identifica a origem como externa/conhecimento/hipotese?
function _reconheceOrigemNaoCaso(janela) {
  return /\b(pesquisa|fonte externa|documentacao|tdn|totvs|artigo|como apoio|contexto geral|conhecimento|em geral|geralmente|normalmente|costuma|tipicamente|padrao do produto|hipotese|a validar|possivel|pode ser)\b/i.test(janela);
}

// Referencia nao evidenciada AFIRMADA como causa confirmada do caso (sem
// hedge): afirmacao sobre o caso, nao conhecimento tecnico.
function _afirmaComoCausaConfirmada(janela) {
  return /\b(causa confirmada|causa comprovada|causa concreta|causa raiz e|diagnostico confirmado|com certeza|definitivamente|a causa e|e a causa|o problema e causado|esta causando|foi a causa|ponto de entrada concreto)\b/i.test(janela)
    && !/\b(provavel|provavelmente|possivel|possivelmente|talvez|hipotese|suspeit\w*|indica que pode|pode estar|nao confirm\w*)\b/i.test(janela);
}

function _contemTermoNormalizado(textoNorm, termoNorm) {
  if (!termoNorm) return false;
  if (termoNorm.length >= 5) return textoNorm.includes(termoNorm);
  const esc = termoNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${esc}([^a-z0-9_]|$)`).test(textoNorm);
}

function _termosTecnicosDaResposta(texto) {
  const mapa = new Map();
  for (const x of _extrairIdentificadoresTecnicosDetalhados(texto)) {
    if (x.tipo === 'UI_ACAO' || x.tipo === 'TERMO_COMUM_MAIUSCULO') continue;
    mapa.set(x.termo, x.tipo);
  }
  for (const x of planoRespostaRastreavel.extrairTermosTecnicos(texto, { codigosCurtos: true })) {
    if (!mapa.has(x.termo)) mapa.set(x.termo, x.tipo);
  }
  for (const t of TOKENS_PROTOCOLO_INTERNO) mapa.delete(t);
  return [...mapa.entries()].map(([termo, tipo]) => ({ termo, tipo }));
}

// Proveniencia das referencias tecnicas citadas na resposta (M1). NAO ha lista
// de termos permitidos: a origem e calculada por correspondencia com o que o
// modelo recebeu (texto enviado das evidencias, historico, observacoes visuais,
// dossie, quadro) e com a pesquisa lida.
//   chamado             -> consta nas evidencias do caso
//   pesquisa            -> consta so na pesquisa externa
//   conhecimento_modelo -> nao consta em nenhuma (hipotese/orientacao tecnica)
// Referencia nova NAO e erro. So vira falha quando apresentada como observada
// no caso (atribuicao falsa) — ver _avaliarRastreabilidadeTecnica.
function classificarProvenienciaReferencias(textoResposta, { manifesto, pesquisa, pergunta, historicoMensagens, indiceReferencias } = {}) {
  const resposta = String(textoResposta || '');
  const respostaNorm = _normalizar(resposta);
  const internoNorm = _normalizar(_corpusInterno(manifesto, pergunta, historicoMensagens));
  const pesquisaNorm = _normalizar(_corpusPesquisa(pesquisa));
  const indice = indiceReferencias instanceof Set ? indiceReferencias : new Set(indiceReferencias || []);
  const referencias = [];
  for (const item of _termosTecnicosDaResposta(resposta)) {
    const id = item.termo;
    const idNorm = _normalizar(id);
    const doCaso = indice.has(id.toUpperCase())
      || _contemTermoNormalizado(internoNorm, idNorm)
      || _temReferenciaVisualRastreavel(manifesto, id);
    const naPesquisa = _contemTermoNormalizado(pesquisaNorm, idNorm);
    const origem = doCaso ? 'chamado' : naPesquisa ? 'pesquisa' : 'conhecimento_modelo';
    const idx = respostaNorm.indexOf(idNorm);
    const janela = idx >= 0
      ? respostaNorm.slice(Math.max(0, idx - 170), Math.min(respostaNorm.length, idx + idNorm.length + 170))
      : '';
    const rotulada = _temRotuloHipoteseOuOrigem(resposta, id) || _usoTecnicoComoHipoteseCondicional(resposta, id);
    const reconheceOrigem = rotulada || _reconheceOrigemNaoCaso(janela);
    const atribuidaAoCaso = origem !== 'chamado'
      && _atribuiReferenciaAoCaso(janela)
      && !_janelaNegaAtribuicaoInterna(janela)
      && !reconheceOrigem;
    const afirmadaComoCausa = origem !== 'chamado' && _afirmaComoCausaConfirmada(janela);
    referencias.push({ termo: id, tipo: item.tipo, origem, rotulada, atribuidaAoCaso, afirmadaComoCausa });
  }
  return referencias;
}

function _resumoProveniencia(referencias) {
  const contagem = { chamado: 0, pesquisa: 0, conhecimento_modelo: 0 };
  for (const r of referencias) contagem[r.origem] = (contagem[r.origem] || 0) + 1;
  return {
    contagem,
    atribuicoesFalsas: referencias.filter(r => r.atribuidaAoCaso || r.afirmadaComoCausa).length,
    referencias: referencias.slice(0, 60).map(r => ({ termo: r.termo, origem: r.origem, rotulada: !!r.rotulada, atribuidaAoCaso: !!r.atribuidaAoCaso, afirmadaComoCausa: !!r.afirmadaComoCausa })),
  };
}

// O Quality Gate protege a INTEGRIDADE do que se afirma sobre o caso. Uma
// referencia tecnica nova (conhecimento do modelo/hipotese) nao e falha: so e
// quando apresentada como observada no chamado, print, log ou pesquisa.
function _avaliarRastreabilidadeTecnica(textoResposta, { manifesto, referencias } = {}) {
  const falhas = [];
  const resposta = String(textoResposta || '');
  for (const ref of referencias || []) {
    if (ref.origem === 'chamado') continue;
    const id = ref.termo;
    const visualSemTextoMasObservado = _temImagemSemTextoEstruturado(manifesto)
      && _pareceRotinaPadraoProtheus(id)
      && _usoVisualComoObservacaoSemCausa(resposta, id);
    if (visualSemTextoMasObservado) continue;
    const visualNaoVerificavel = _temImagemSemTextoEstruturado(manifesto) && _respostaAlegaVisual(resposta, id);
    if (visualNaoVerificavel && !ref.rotulada) {
      if (!falhas.some(f => f.codigo === 'UNTRACEABLE_TECHNICAL_REFERENCE')) {
        falhas.push({
          codigo: 'UNTRACEABLE_TECHNICAL_REFERENCE',
          severidade: 'media',
          detalhe: 'resposta citou identificador tecnico como observado em imagem, mas nao ha observacao visual estruturada independente no manifesto',
          termos: [id],
          tipoIdentificador: ref.tipo,
          motivoRastreabilidade: 'visual_sem_observacao_estruturada',
          decisionKind: DECISAO_QG.EVIDENCIA_INSUFICIENTE,
          categoriaDecisao: DECISAO_QG.EVIDENCIA_INSUFICIENTE,
          acaoCorretiva: 'corrigir_atribuicao_visual_mantendo_conteudo_tecnico',
        });
      }
      continue;
    }
    if (ref.atribuidaAoCaso || ref.afirmadaComoCausa) {
      const codigo = ref.origem === 'pesquisa' ? 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE' : 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE';
      if (!falhas.some(f => f.codigo === codigo)) {
        falhas.push({
          codigo,
          severidade: 'media',
          detalhe: ref.afirmadaComoCausa && !ref.atribuidaAoCaso
            ? 'referencia tecnica que nao consta nas evidencias foi afirmada como causa confirmada do chamado (sem rotulo de hipotese)'
            : ref.origem === 'pesquisa'
              ? 'referencia tecnica encontrada em pesquisa externa foi apresentada como se estivesse no historico/anexo/log do chamado'
              : 'referencia tecnica do conhecimento do modelo foi apresentada como se estivesse no historico/anexo/log do chamado',
          termos: [id],
          tipoIdentificador: ref.tipo,
          decisionKind: DECISAO_QG.BLOQUEIO_OBJETIVO,
          categoriaDecisao: DECISAO_QG.BLOQUEIO_OBJETIVO,
          acaoCorretiva: 'corrigir_atribuicao_de_origem_mantendo_conteudo_tecnico',
        });
      }
    }
  }
  return falhas;
}

// Falhas que podem VETAR a entrega apos o retry: integridade do que e afirmado
// sobre o caso, grau de certeza e vazamento de dados internos. Demais falhas
// (estilo, qualidade, aviso operacional) geram alerta, nunca substituem a
// resposta (M4).
const FALHAS_DE_INTEGRIDADE = new Set([
  'SOURCE_BEHAVIOR_CONTRADICTION',
  'INTERNAL_IDS_USED_AS_EVIDENCE',
  'RETRY_CONTEXT_LEAKED',
  'UNSUPPORTED_OPERATIONAL_COUNT',
  'FACTUAL_CONTRADICTION_WITH_MISSING_EVIDENCE',
  'ARITHMETIC_CLAIM_DOES_NOT_RECONCILE',
  'TRUNCATED_RESPONSE_INCOMPLETE',
  'OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE',
  'HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE',
  'PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP',
  'CERTAINTY_WITHOUT_EVIDENCE',
  'CUSTOMIZATION_DISCARDED_WITHOUT_CODE_OR_LOG',
  'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE',
  'OPERATIONAL_ESCALATION_TREATED_AS_RESOLUTION',
  'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE',
  'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE',
  'UNTRACEABLE_TECHNICAL_REFERENCE',
  'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE',
  'PRR_VISUAL_REFERENCE_USED_AS_CAUSE',
]);

function ehFalhaDeIntegridade(falha) {
  return FALHAS_DE_INTEGRIDADE.has(falha?.codigo);
}

function temFalhaDeIntegridade(gate) {
  return (gate?.falhas || []).some(ehFalhaDeIntegridade);
}

function _avaliarContagemOperacionalFalsa(textoResposta, historicoMensagens, manifesto) {
  const resposta = _normalizar(textoResposta);
  const numeroExtenso = '(?:duas|dois|tres|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez)';
  const m = resposta.match(new RegExp(`\\b(\\d+|${numeroExtenso})\\s+vezes\\b`, 'i'));
  if (!m) return [];
  const janelaAntes = resposta.slice(Math.max(0, m.index - 140), m.index);
  if (!/\b(foi|foram|feito|feita|realizad[ao]s?|abert[ao]s?|encaminhad[ao]s?|acionad[ao]s?|retornad[ao]s?|analisad[ao]s?|visto|vista|fabrica|desenvolvimento|meet|reuniao|video)\b/i.test(janelaAntes)) return [];
  const normalizarNumero = valor => {
    const v = _normalizar(valor);
    const mapa = { duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
    return /^\d+$/.test(v) ? Number(v) : mapa[v];
  };
  const n = normalizarNumero(m[1]);
  if (!Number.isFinite(n) || n <= 1) return [];
  const historico = _normalizar((historicoMensagens || []).map(x => x.conteudo || '').join('\n'));
  const numeroLiteral = String(m[1] || '').toLowerCase();
  const numeroTexto = Object.entries({ duas: 2, dois: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 })
    .filter(([, valor]) => valor === n)
    .map(([texto]) => texto.replace('ê', '[eê]'));
  const mencaoExplicita = new RegExp(`\\b(?:${[String(n), numeroLiteral, ...numeroTexto].filter(Boolean).join('|')})\\s+vezes\\b`, 'i').test(historico);
  if (!mencaoExplicita) {
    return [{
      codigo: 'UNSUPPORTED_OPERATIONAL_COUNT',
      severidade: 'media',
      detalhe: 'resposta afirmou contagem operacional sem essa quantidade aparecer explicitamente no historico',
      quantidadeAfirmada: n,
      decisionKind: DECISAO_QG.BLOQUEIO_OBJETIVO,
      categoriaDecisao: DECISAO_QG.BLOQUEIO_OBJETIVO,
      acaoCorretiva: 'remover_contagem_ou_ancorar_na_evidencia_real',
    }];
  }
  const mencionaFabrica = /\b(fabrica|desenvolvimento|escalar|escalado|encaminh|acionad|retornad)\b/.test(resposta);
  const mencionaReuniao = /\b(meet|video|reuniao|chamada|demonstr)\b/.test(resposta);
  let count = 0;
  if (mencionaFabrica) {
    count = (historicoMensagens || []).filter(m => {
      const texto = _normalizar(m.conteudo || '');
      return /\b(fabrica|desenvolvimento)\b/.test(texto) && /\b(retorn|encaminh|abert|abrir|acion|acompanhar|aguard)\w*/.test(texto);
    }).length;
    const eventos = (manifesto?.eventosOperacionais || manifesto?.quadroInvestigativo?.eventosOperacionais || []).filter(a => a.tipo === 'encaminhamento_fabrica');
    if (eventos.length) count = Math.max(count, eventos.length);
  }
  if (mencionaReuniao) count = Math.max(count, (historico.match(/\b(meet|videochamada|videoconferencia|chamada via google meet|demonstr)\b/g) || []).length);
  if (count > 0 && count < n) {
    return [{
      codigo: 'UNSUPPORTED_OPERATIONAL_COUNT',
      severidade: 'media',
      detalhe: 'resposta afirmou quantidade operacional maior do que a evidenciada no historico',
      quantidadeAfirmada: n,
      quantidadeEvidenciada: count,
      decisionKind: DECISAO_QG.BLOQUEIO_OBJETIVO,
      categoriaDecisao: DECISAO_QG.BLOQUEIO_OBJETIVO,
      acaoCorretiva: 'remover_contagem_ou_ancorar_na_evidencia_real',
    }];
  }
  return [];
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

function _temReconhecimentoOperacional(texto, regexAcao) {
  const s = _normalizar(texto);
  const match = s.match(regexAcao);
  if (!match || match.index === undefined) return false;
  const ini = Math.max(0, match.index - 120);
  const fim = Math.min(s.length, match.index + match[0].length + 120);
  const janela = s.slice(ini, fim);
  return /\b(ja|foi|realizad|feito|abert|encaminhad|retornad|aguard|acompanhar|acompanhe|pendente|em andamento)\b/i.test(janela);
}

function _temJustificativaTecnicaNova(texto) {
  const s = _normalizar(texto);
  return /\b(nov[ao]s?|mudou|alterou|diferente|apos|depois|reproduz|reproducao|evidencia|erro|log|fonte|print|anexo|validacao|teste|resultado|retorno|confirmacao|campo|rotina)\b[\s\S]{0,120}\b(tecnic|especific|novo|nova|complementar|validar|demonstrar|alinhar|reproduzir|confirmar)\b/i.test(s)
    || /\b(tecnic|especific|novo|nova|complementar|validar|demonstrar|alinhar|reproduzir|confirmar)\b[\s\S]{0,120}\b(nov[ao]s?|mudou|alterou|diferente|apos|depois|reproduz|reproducao|evidencia|erro|log|fonte|print|anexo|validacao|teste|resultado|retorno|confirmacao|campo|rotina)\b/i.test(s);
}

function _avaliarAcaoOperacionalRedundante(textoResposta, historicoMensagens) {
  const historico = _normalizar((historicoMensagens || []).map(m => m.conteudo || '').join('\n'));
  if (!historico.trim()) return [];

  const resposta = _normalizar(textoResposta);
  const acoes = [
    {
      codigo: 'REDUNDANT_OPERATIONAL_MEETING',
      historico: /\b(meet|video\s*conferencia|videoconferencia|videochamada|chamada via google meet)\b[\s\S]{0,120}\b(realizad|demonstrar|verificar|analisarmos|agenda|agendar|marcar|solicitar)\b|\b(realizad|demonstrar|verificar|analisarmos|agenda|agendar|marcar|solicitar)\b[\s\S]{0,120}\b(meet|video\s*conferencia|videoconferencia|videochamada|chamada via google meet)\b/i,
      resposta: /\b(agend|marc|realiz|solicit)\w*[\s\S]{0,80}\b(meet|video\s*conferencia|videoconferencia|videochamada)\b|\b(meet|video\s*conferencia|videoconferencia|videochamada)\b[\s\S]{0,80}\b(agend|marc|realiz|solicit)\w*/i,
      detalhe: 'resposta recomenda reuniao/videoconferencia como proximo passo, mas o historico ja registra essa acao operacional',
      acaoCorretiva: 'reconhecer_reuniao_ja_realizada_ou_solicitada_e_avancar_para_proxima_pendencia',
    },
    {
      codigo: 'REDUNDANT_OPERATIONAL_ESCALATION',
      historico: /\b(fabrica|desenvolvimento|fornecedor)\b[\s\S]{0,120}\b(abert|abrir|retorn|encaminh|acompanhar|aguard)\w*|\b(abert|abrir|retorn|encaminh|acompanhar|aguard)\w*[\s\S]{0,120}\b(fabrica|desenvolvimento|fornecedor)\b/i,
      resposta: /\b(abrir|encaminh|reencaminh|acion|solicit)\w*[\s\S]{0,100}\b(fabrica|desenvolvimento|equipe de desenvolvimento|fornecedor)\b|\bretorn\w*[\s\S]{0,40}\b(?:para|a)\s+(?:a\s+)?\b(fabrica|desenvolvimento|equipe de desenvolvimento|fornecedor)\b|\b(fabrica|desenvolvimento|equipe de desenvolvimento|fornecedor)\b[\s\S]{0,100}\b(abrir|encaminh|reencaminh|acion|solicit)\w*/i,
      detalhe: 'resposta recomenda encaminhamento operacional ja registrado no historico',
      acaoCorretiva: 'distinguir_encaminhamento_em_andamento_de_correcao_concluida_e_orientar_acompanhamento_ou_evidencia_tecnica_faltante',
    },
  ];

  const falhas = [];
  for (const acao of acoes) {
    if (!acao.historico.test(historico)) continue;
    const match = resposta.match(acao.resposta);
    if (!match) continue;
    if (acao.codigo === 'REDUNDANT_OPERATIONAL_MEETING' && _temJustificativaTecnicaNova(resposta)) continue;
    const janela = resposta.slice(Math.max(0, match.index - 80), Math.min(resposta.length, match.index + match[0].length + 80));
    if (/\b(nao|não|evite|sem)\b[\s\S]{0,50}\b(recomende|peca|peça|solicite|agende|abrir|acionar|encaminh|reencaminh|video|reuniao|meet|fabrica|desenvolvimento)\b/i.test(janela)) continue;
    if (_temReconhecimentoOperacional(resposta, acao.resposta)) continue;
    falhas.push({
      codigo: acao.codigo,
      severidade: 'media',
      detalhe: acao.detalhe,
      acaoCorretiva: acao.acaoCorretiva,
    });
  }
  return falhas;
}

function _avaliarEncaminhamentoComoResolucao(textoResposta, historicoMensagens) {
  const historico = _normalizar((historicoMensagens || []).map(m => m.conteudo || '').join('\n'));
  if (!/\b(fabrica|desenvolvimento|fornecedor)\b[\s\S]{0,120}\b(abert|abrir|retorn|encaminh|acompanhar|aguard)\w*|\b(abert|abrir|retorn|encaminh|acompanhar|aguard)\w*[\s\S]{0,120}\b(fabrica|desenvolvimento|fornecedor)\b/i.test(historico)) {
    return [];
  }
  const resposta = _normalizar(textoResposta);
  const trataComoResolvido = /\b(encaminh|retorn|abert|acionad)\w*[\s\S]{0,120}\b(resolvid|solucionad|concluid|corrigid|finalizad)\w*|\b(resolvid|solucionad|concluid|corrigid|finalizad)\w*[\s\S]{0,120}\b(encaminh|retorn|abert|acionad)\w*/i.test(resposta);
  if (!trataComoResolvido) return [];
  const ressalva = /\b(nao|sem|ainda nao|nao comprova|nao significa|nao garante|pendente|aguard)\b[\s\S]{0,80}\b(resolvid|solucionad|concluid|corrigid|finalizad)\w*/i.test(resposta);
  if (ressalva) return [];
  return [{
    codigo: 'OPERATIONAL_ESCALATION_TREATED_AS_RESOLUTION',
    severidade: 'media',
    detalhe: 'resposta interpretou encaminhamento operacional como resolucao/correcao concluida sem confirmacao no historico',
    acaoCorretiva: 'diferenciar_encaminhamento_de_solucao_confirmada',
  }];
}

function _termosRelevantesEvidencia(ev) {
  const texto = _normalizar([ev?.referencia, ev?.resumo, ev?.dominio].filter(Boolean).join(' '));
  const termos = [];
  const candidatos = [
    'contabilidade', 'contabil', 'financeiro', 'contas a pagar', 'titulo', 'fina050',
    'compras', 'pedido de compra', 'workflow', 'aprovacao', 'status',
    'rateio', 'pre nota', 'documento de entrada',
    'contrato agricola', 'saldo', 'devolucao',
  ];
  for (const c of candidatos) {
    if (texto.includes(c)) termos.push(c);
  }
  const codigos = String([ev?.referencia, ev?.resumo].filter(Boolean).join(' ')).match(/\b[A-Z]{2,}[A-Z0-9_]{2,}\b|\b[A-Z]{3,}\d{2,}\b/gi) || [];
  for (const c of codigos.slice(0, 4)) termos.push(_normalizar(c));
  return [...new Set(termos)].filter(t => t.length >= 4);
}

function _respostaPromoveEvidenciaIncidental(textoResposta, manifesto) {
  const quadro = manifesto?.quadroInvestigativo;
  const incidentais = (quadro?.evidencias || []).filter(e => {
    const papeis = e.papeis || [];
    // Mensagens operacionais como "foi anexado log/fonte" podem receber
    // INCIDENTAl por nao serem a causa em si, mas elas apenas descrevem a
    // disponibilidade da evidencia central. Nao devem bloquear uma resposta
    // que usa o log/fonte real selecionado como CENTRAL.
    return papeis.includes('INCIDENTAL') && !papeis.includes('OPERACIONAL') && !papeis.includes('CENTRAL');
  });
  if (!incidentais.length) return [];
  const resposta = _normalizar(textoResposta);
  const reconheceLimite = /\b(incidental|vinculo causal nao demonstrado|sem vinculo causal|nao ha vinculo|nao comprova|hipotese|precisa demonstrar|precisa validar|confirmar a relacao)\b/i.test(resposta);
  const falhas = [];

  for (const ev of incidentais) {
    const termos = _termosRelevantesEvidencia(ev);
    if (!termos.some(t => resposta.includes(t))) continue;
    const mencionaComoCausa = /\b(causa|causado|causando|provavel|deve estar relacionado|esta relacionado|impactando|impedindo|por isso|devido|regulariz|corrig|verificar os titulos|contabiliz)\b/i.test(resposta);
    const temPonteCausal = /\b(ponte causal|relacao direta|vinculo|integra[cç][aã]o|gera o titulo|processa o pedido|no mesmo fluxo|apos a aprovacao|ao atualizar o status|log mostra|stack mostra|fonte mostra|evidencia demonstra)\b/i.test(resposta);
    if (mencionaComoCausa && !temPonteCausal && !reconheceLimite) {
      falhas.push({
        codigo: 'INCIDENTAL_EVIDENCE_PROMOTED_WITHOUT_CAUSAL_BRIDGE',
        severidade: 'media',
        evidencia: ev.referencia || ev.resumo,
        detalhe: 'resposta promoveu evidencia classificada como incidental a causa/proximo passo principal sem demonstrar ponte causal com o problema principal',
        acaoCorretiva: 'tratar_evidencia_incidental_como_lacuna_ou_demonstrar_ponte_causal',
      });
      break;
    }
  }
  return falhas;
}

function _avaliarEstadoOperacionalDoQuadro(textoResposta, manifesto) {
  const quadro = manifesto?.quadroInvestigativo;
  if (!quadro?.estadoOperacional) return [];
  const resposta = _normalizar(textoResposta);
  const falhas = [];
  if (/correcao_aplicada/.test(quadro.estadoOperacional)) {
    const reconheceValidacao = /\b(valid|homolog|teste|reteste|confirm|cliente|producao|aplicad|implantad)\w*/i.test(resposta);
    const reabreSemValidar = /\b(abrir|encaminh|acionar|solicitar)\w*[\s\S]{0,90}\b(fabrica|desenvolvimento|totvs|fornecedor)\b/i.test(resposta)
      && !/\b(acompanhar|validar|confirmar|ja|foi|aplicad|implantad)\b/i.test(resposta);
    if (!reconheceValidacao || reabreSemValidar) {
      falhas.push({
        codigo: 'INVESTIGATIVE_FRAME_OPERATIONAL_STAGE_IGNORED',
        severidade: 'media',
        detalhe: 'quadro indica correcao aplicada/pendente de validacao, mas a resposta nao priorizou validacao ou reabriu encaminhamento como se fosse etapa inicial',
        acaoCorretiva: 'reconhecer_correcao_aplicada_e_priorizar_validacao_do_sintoma_original',
      });
    }
  }
  return falhas;
}

function avaliarResposta({ textoResposta, manifesto, pesquisa, pergunta, houveRetry = false, historicoMensagens = [], indiceReferencias = null, fontesOriginais = [] } = {}) {
  const falhas = [];
  const { alteracoes } = extrairAlteracoes(textoResposta);
  for (const fonte of fontesOriginais) {
    const nome = String(fonte.arquivo).toLowerCase();
    if (fontesOriginais.filter(f => String(f.arquivo).toLowerCase() === nome).length !== 1) continue;
    const doArquivo = alteracoes.filter(a => a.arquivo?.toLowerCase() === nome || (!a.arquivo && fontesOriginais.length === 1));
    const prova = avaliarEvidencias({ arquivo: fonte.arquivo, textoOriginal: fonte.textoOriginal, diagnostico: textoResposta, pedido: pergunta, alteracoes: doArquivo });
    if (prova?.status === 'contradicao') falhas.push({ codigo: 'SOURCE_BEHAVIOR_CONTRADICTION', severidade: 'alta', evidencia: prova.evidencia, detalhe: prova.demonstracao, acaoCorretiva: 'conferir_fluxo_original_e_retirar_defeito_nao_demonstrado' });
  }
  const resposta = String(textoResposta || '');
  const perguntaTexto = String(pergunta || '');
  const selecionados = manifesto?.selecionados || [];
  const omitidos = manifesto?.omitidos || [];
  const analisados = selecionados.filter(e => e.status === 'ANALISADA' || e.status === 'PARCIALMENTE_ANALISADA');
  const anexosAnalisados = analisados.filter(e => e.tipo === 'anexo' || e.tipo === 'imagem');
  const imagensAnalisadas = analisados.filter(e => e.tipo === 'imagem');
  // anexosDisponiveis (nao so anexosAnalisados) — achado real, auditoria
  // 2026-10: a pergunta de investigacao padrao sempre menciona "anexos" (ex.
  // "...com base no historico e nos anexos disponiveis..."), disparando
  // pedeAnexo=true mesmo quando o atendimento NAO TEM nenhum anexo (caso
  // real: chamado so consultivo, so historico textual). Sem anexo nenhum
  // existir, nao ha "anexo nao analisado" para reclamar — a falha so pode
  // ser legitima se havia pelo menos um anexo disponivel no caso.
  const anexosDisponiveis = Number(manifesto?.anexosDisponiveis || 0);
  const pedeAnexo = anexosDisponiveis > 0 && /\b(anexo|arquivo|fonte|log|print|imagem|screenshot|pdf|compare|ver novamente)\b/i.test(perguntaTexto);
  // tipo !== 'mensagem' — achado real, auditoria 2026-10: mensagens de
  // historico cortadas por orcamento de contexto (comportamento ESPERADO do
  // sistema, nao uma falha) tambem carregam score alto quando relevantes
  // (ex. score=100 para mensagem do turno atual) e disparavam esta falha
  // mesmo sem nenhum ANEXO critico de fato omitido.
  const evidenciaCriticaOmitida = omitidos.find(e => e.tipo !== 'mensagem' && (e.score || 0) >= 80 && e.status !== 'NAO_SUPORTADA');
  const paginasComConteudo = _paginasLidasOuReutilizadas(pesquisa);

  // Bastidor de retry so existe no prompt quando HOUVE retry automatico
  // ("A resposta anterior falhou no Quality Gate", "Resposta anterior a
  // reescrever"). Na primeira tentativa de um novo turno humano, "resposta
  // anterior"/"reescrever" referem-se a conversa com o analista. Mencionar o
  // controle interno e vazamento em qualquer tentativa.
  if (/\b(quality gate|controle de rastreabilidade)\b/i.test(resposta)
    || (houveRetry && /\b(resposta anterior|reescrev[ae]r)\b/i.test(resposta))) {
    falhas.push({
      codigo: 'RETRY_CONTEXT_LEAKED',
      severidade: 'media',
      detalhe: 'resposta expôs bastidor de retry/quality gate ao analista',
      acaoCorretiva: 'remover_mencao_a_reescrita_retry_ou_quality_gate',
    });
  }

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
  falhas.push(..._avaliarContradicaoComEvidenciaAusente(resposta, manifesto, perguntaTexto, historicoMensagens));
  falhas.push(..._avaliarCertezaIndevidaComEvidenciaParcial(resposta, manifesto, perguntaTexto, historicoMensagens));
  const referenciasProvenientes = classificarProvenienciaReferencias(resposta, { manifesto, pesquisa, pergunta: perguntaTexto, historicoMensagens, indiceReferencias });
  falhas.push(..._avaliarRastreabilidadeTecnica(resposta, { manifesto, referencias: referenciasProvenientes }));
  falhas.push(...planoRespostaRastreavel.avaliarRespostaContraPlano({
    textoResposta: resposta,
    plano: manifesto?.planoRespostaRastreavel,
  }));
  falhas.push(..._avaliarContagemOperacionalFalsa(resposta, historicoMensagens, manifesto));
  falhas.push(..._avaliarConsistenciaAritmetica(resposta));
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
      severidade: 'baixa',
      detalhe: `chamado tem pendencia de retorno externo (${manifesto.pendenciaConsolidada.responsavel}) nao mencionada na resposta (alerta informativo; nao impede a investigacao interna)`,
      acaoCorretiva: 'mencionar_pendencia_externa_como_atividade_paralela',
      decisionKind: DECISAO_QG.CORRECAO_ESTILO,
      categoriaDecisao: DECISAO_QG.CORRECAO_ESTILO,
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
  const propostaCorrecao = _propostaDeCorrecao(resposta);
  if (propostaCorrecao && !/\b(valid\w*|homologa\w*|teste\w*|reteste\w*|reproduz\w*|compil\w*)\b/i.test(resposta)) {
    falhas.push({
      codigo: 'CORRECTION_WITHOUT_VALIDATION',
      severidade: 'media',
      detalhe: 'resposta propos correcao sem orientar validacao',
      evidencia: propostaCorrecao.trim().slice(0, 500),
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
    // Padrao original (fwwhen/rateio/100,00 etc.) era calibrado so para
    // cenarios de customizacao de tela/rateio — achado real, auditoria
    // 2026-10 (caso 036166): resposta citava codigo de tela curto ("V260416")
    // e status operacional especifico lido do print ("BLOQUEADO/REJEITADO",
    // "vazia (/ /)") que so poderiam vir de leitura real da imagem, mas
    // nenhum batia o padrao antigo (que exige 3+ letras antes dos digitos).
    // Generaliza para: (a) codigo alfanumerico curto de tela/rotina (1+
    // letra + 3+ digitos, ex. V260416, SX2010); (b) status operacional em
    // caixa alta citado como valor lido (BLOQUEADO, REJEITADO, PENDENTE
    // etc.) perto de "status"/"situacao"; (c) campo explicitamente vazio
    // (parenteses com so barra/espaco, ex. "(/ /)", "( )").
    const temCodigoTelaCurto = /\b[a-z]\d{3,}[a-z0-9_]*\b/.test(respostaNormalizada);
    const temStatusLidoConcreto = /\b(status|situac[aã]o|estado)\b[\s\S]{0,40}\b(bloqueado|rejeitado|pendente|aprovado|processado|concluido|cancelado|aberto|fechado)\b/i.test(resposta)
      || /\b(bloqueado|rejeitado|pendente|aprovado|processado|concluido|cancelado)\b[\s\S]{0,40}\b(status|situac[aã]o|estado)\b/i.test(resposta);
    const temCampoVazioLido = /\(\s*\/\s*\/?\s*\)|\(\s*\)\s*(?:\(\s*\))?\s*,?\s*(?:ou\s+)?vazi[ao]/i.test(resposta) && /\bvazi[ao]\b/i.test(resposta) && /\bdata|dt\b|baixa|vencimento|campo/i.test(resposta);
    const temSinalVisualConcreto = /fwwhen|%\s*rateio|perc\s+rateio|valor do rat|nf rateio|modo edicao|valor nao pode ser atribuido|incluir|alterar|100[, ]?00|105[, ]?6|\b[a-z]{3,}\d{2,}[a-z0-9_]*\b/.test(respostaNormalizada)
      || temCodigoTelaCurto || temStatusLidoConcreto || temCampoVazioLido;
    const pedePrintFuturo = /\b(tire|peca|peça|capture|capturar|solicite|traga|anexe|envie)\b[\s\S]{0,80}\b(print|screenshot|tela|imagem)\b/i.test(respostaNormalizada)
      || /\b(print|screenshot|tela|imagem)\b[\s\S]{0,80}\b(apos|após|quando|logo depois|para validar|mostrando)\b/i.test(respostaNormalizada);
    if (!temSinalVisualConcreto && !pedePrintFuturo) {
      falhas.push({
        codigo: 'VISUAL_EVIDENCE_TOO_GENERIC',
        severidade: 'media',
        detalhe: 'resposta cita imagens/prints sem mencionar texto, campo, percentual ou mensagem visivel nos anexos',
        evidencia: imagensAnalisadas.map(e => e.nome || e.id).join('; '),
        acaoCorretiva: 'citar_evidencia_visual_concreta',
      });
    }
  }
  falhas.push(...investigativeDiscipline.avaliarAfirmacoes({
    textoResposta: resposta,
    evidenciasTexto: [
      perguntaTexto,
    ...(analisados || []).map(e => `${e.nome || e.id || ''} ${e.trecho || e.resumo || e.conteudo || ''}`),
      ...paginasComConteudo.map(p => `${p.titulo || ''} ${p.url || ''} ${p.trecho || ''}`),
      pesquisa?.plano ? JSON.stringify(pesquisa.plano) : '',
    ].filter(Boolean).join('\n'),
    manifesto: { ...manifesto, pesquisa },
  }));
  falhas.push(..._avaliarRegressaoInvestigativa(resposta, manifesto));
  falhas.push(..._avaliarRepeticaoDeRespostaAnterior(resposta, historicoMensagens));
  falhas.push(..._avaliarAcaoOperacionalRedundante(resposta, historicoMensagens));
  falhas.push(..._avaliarEncaminhamentoComoResolucao(resposta, historicoMensagens));
  falhas.push(..._respostaPromoveEvidenciaIncidental(resposta, manifesto));
  falhas.push(..._avaliarEstadoOperacionalDoQuadro(resposta, manifesto));
  // Pesquisa externa dispensada de proposito pelo gate de pendencia externa
  // (aguardando cliente/fornecedor) nao e "pesquisa que deveria ter ocorrido".
  const pesquisaDispensadaPorPendencia = !!pesquisa?.plano?.bloqueioPendenciaExterna && pesquisa?.modo !== 'web';
  // Intencao incerta: o chat pergunta ao analista antes de pesquisar. So vale
  // se a resposta de fato pergunta.
  const pesquisaAguardaConfirmacao = !!pesquisa?.plano?.confirmarPedidoPesquisa && pesquisa?.modo !== 'web' && resposta.includes('?');
  if (!pesquisaDispensadaPorPendencia && !pesquisaAguardaConfirmacao &&/pesquis|tdn|totvs|softexpert|documenta[cç][aã]o|fonte oficial/i.test(perguntaTexto)) {
    if (!pesquisa?.configurado) falhas.push({ codigo: 'RESEARCH_REQUIRED_NOT_EXECUTED', legado: 'PESQUISA_NAO_CONFIGURADA', severidade: 'media', acaoCorretiva: 'informar_pesquisa_indisponivel' });
    // Pesquisa realmente executada sem resultado e resposta valida quando o
    // texto declara isso ao analista; dispensada pelo plano continua falha.
    else if (pesquisa?.modo !== 'web' && !(pesquisa?.modo === 'links' && pesquisa?.consultasExecutadas?.length && _declaraPesquisaSemResultado(resposta))) falhas.push({ codigo: 'RESEARCH_CONFIGURED_WITHOUT_RESULTS', legado: 'PESQUISA_CONFIGURADA_SEM_RESULTADO', severidade: 'media', acaoCorretiva: 'executar_pesquisa_solicitada_ou_declarar_limite' });
    else if (!paginasComConteudo.length) {
      const declaraLimitePesquisa = /\b(pesquisa|documenta[cÃ§][aÃ£]o|fonte oficial|pagina|p[aÃ¡]gina)\b[\s\S]{0,120}\b(nao foi possivel|nao consegui|nao acessivel|nao acessada|nao lida|nenhuma pagina foi lida|sem conteudo|sem pagina lida|nao retornou conteudo|links sem leitura|limitacao)\b/i.test(resposta)
        || /\b(nao foi possivel|nao consegui|nao acessivel|nao acessada|nao lida|nenhuma pagina foi lida|sem conteudo|sem pagina lida|nao retornou conteudo|links sem leitura|limitacao)\b[\s\S]{0,120}\b(pesquisa|documenta[cÃ§][aÃ£]o|fonte oficial|pagina|p[aÃ¡]gina)\b/i.test(resposta);
      if (!declaraLimitePesquisa) falhas.push({ codigo: 'RESEARCH_FOUND_BUT_NOT_READ', legado: 'PESQUISA_SEM_PAGINA_LIDA', severidade: 'media', acaoCorretiva: 'tentar_fetch_seguro' });
    }
  }

  const falhasClassificadas = falhas.map(_classificarFalha);
  const deveRetry = !houveRetry && falhasClassificadas.some(f => ['alta', 'media'].includes(f.severidade) && f.decisionKind !== DECISAO_QG.SUSPEITA_SEMANTICA);
  const decisoes = {
    bloqueiosObjetivos: falhasClassificadas.filter(f => f.decisionKind === DECISAO_QG.BLOQUEIO_OBJETIVO).length,
    suspeitasSemanticas: falhasClassificadas.filter(f => f.decisionKind === DECISAO_QG.SUSPEITA_SEMANTICA).length,
    evidenciasInsuficientes: falhasClassificadas.filter(f => f.decisionKind === DECISAO_QG.EVIDENCIA_INSUFICIENTE).length,
    correcoesEstilo: falhasClassificadas.filter(f => f.decisionKind === DECISAO_QG.CORRECAO_ESTILO).length,
  };
  return {
    aprovado: falhasClassificadas.length === 0,
    deveRetry,
    falhas: falhasClassificadas,
    decisoes,
    proveniencia: _resumoProveniencia(referenciasProvenientes),
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

function _termosDasFalhas(gate, codigo) {
  return [...new Set((gate?.falhas || [])
    .filter(f => f.codigo === codigo)
    .flatMap(f => f.termos || f.referencia || [])
    .map(t => String(t || '').trim())
    .filter(Boolean))];
}

function _formatarContratoPRRRetry(manifesto) {
  const prr = manifesto?.planoRespostaRastreavel;
  if (!prr) return '';
  const linhas = ['Organizacao do caso (PRR) para esta reescrita — rastreabilidade, nao lista de conhecimento permitido:'];
  const estado = manifesto?.quadroInvestigativo?.estadoOperacional;
  if (estado) linhas.push(`- Estado operacional atual: ${estado}.`);
  if (prr.proximoPassoRecomendado?.descricao) linhas.push(`- Proximo passo sugerido pelo PRR (ponto de partida, nao limite): ${prr.proximoPassoRecomendado.descricao}`);
  const termos = (prr.termosTecnicosPermitidos || []).slice(0, 18).map(t => {
    const origens = (t.origens || []).map(o => o.origem).filter(Boolean).join('+') || 'sem_origem';
    return `${t.termo} (origem=${origens})`;
  });
  if (termos.length) linhas.push(`- Referencias ja rastreadas no caso: ${termos.join('; ')}.`);
  const lacunas = (prr.lacunasObrigatorias || []).filter(l => l.bloqueiaConclusao).slice(0, 5).map(l => l.texto);
  if (lacunas.length) linhas.push(`- Lacunas que impedem conclusao: ${lacunas.join(' | ')}.`);
  linhas.push('- Mantenha o conteudo tecnico da analise, inclusive hipoteses, rotinas, campos, parametros e tabelas do seu conhecimento que nao constam acima: corrija apenas a ATRIBUICAO de origem e o GRAU DE CERTEZA. Nao remova nem troque por descricao generica.');
  return linhas.join('\n');
}

function _instrucoesDirecionadasPorFalha(gate, manifesto) {
  const codigos = new Set((gate?.falhas || []).map(f => f.codigo));
  const linhas = [];
  if (codigos.has('INTERNAL_IDS_USED_AS_EVIDENCE')) {
    linhas.push('Falha INTERNAL_IDS_USED_AS_EVIDENCE: remova qualquer ID interno do texto final (aud-msg, aud-an, aud-at, aud-ch, UUID, id de execucao). Substitua por conteudo visivel: texto do erro, nome do arquivo, campo, rotina observada ou trecho de log real.');
  }
  if (codigos.has('EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE') || codigos.has('MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE')) {
    const termos = [..._termosDasFalhas(gate, 'EXTERNAL_REFERENCE_PRESENTED_AS_CASE_EVIDENCE'), ..._termosDasFalhas(gate, 'MODEL_KNOWLEDGE_PRESENTED_AS_CASE_EVIDENCE')];
    linhas.push(`Falha de ATRIBUICAO${termos.length ? ` (${termos.join(', ')})` : ''}: essas referencias nao constam nas evidencias do chamado, mas foram apresentadas como se o cliente, o historico, o print ou o log as mostrassem. MANTENHA o conteudo tecnico e corrija so a origem: diga que e conhecimento tecnico seu, orientacao geral, pesquisa externa ou hipotese a validar no ambiente. Nao remova a referencia nem a troque por descricao generica.`);
  }
  if (codigos.has('UNTRACEABLE_TECHNICAL_REFERENCE')) {
    const termos = _termosDasFalhas(gate, 'UNTRACEABLE_TECHNICAL_REFERENCE');
    linhas.push(`Falha de ATRIBUICAO VISUAL${termos.length ? ` (${termos.join(', ')})` : ''}: a resposta diz que isso aparece em print/imagem, mas nao ha leitura verificavel do print. Mantenha a referencia como hipotese tecnica sua (ou peca a leitura/texto do print), sem afirmar que foi observada na imagem.`);
  }
  if (codigos.has('PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE')) {
    const termos = _termosDasFalhas(gate, 'PRR_EXTERNAL_REFERENCE_USED_AS_CAUSE');
    linhas.push(`Falha de CERTEZA${termos.length ? ` (${termos.join(', ')})` : ''}: referencia vinda de pesquisa externa foi afirmada como CAUSA do caso sem ponte causal interna. Mantenha a referencia e a orientacao tecnica; apresente a causa como hipotese a validar e diga qual verificacao a confirmaria.`);
  }
  if (codigos.has('PRR_VISUAL_REFERENCE_USED_AS_CAUSE')) {
    const termos = _termosDasFalhas(gate, 'PRR_VISUAL_REFERENCE_USED_AS_CAUSE');
    linhas.push(`Falha PRR_VISUAL_REFERENCE_USED_AS_CAUSE: termos visuais${termos.length ? ` (${termos.join(', ')})` : ''} podem delimitar o escopo ou mostrar ausencia de vinculo, mas nao podem virar causa/acao principal sem ponte causal.`);
  }
  if (codigos.has('REDUNDANT_OPERATIONAL_ESCALATION')) {
    const estado = manifesto?.quadroInvestigativo?.estadoOperacional;
    linhas.push(`Falha REDUNDANT_OPERATIONAL_ESCALATION: nao recomende abrir, acionar ou reencaminhar Fabrica/desenvolvimento como se fosse novo. Estado atual${estado ? `: ${estado}` : ''}. Oriente acompanhar retorno, pedir evidencia tecnica objetiva, validar ajuste ou registrar pendencia ainda nao comprovada.`);
  }
  if (codigos.has('REDUNDANT_OPERATIONAL_MEETING')) {
    linhas.push('Falha REDUNDANT_OPERATIONAL_MEETING: nao peca nova reuniao/demonstracao quando o historico ja registra reuniao realizada; so solicite nova sessao se houver evidencia tecnica nova e explicita que exija reproducao diferente.');
  }
  if (codigos.has('PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP')) {
    linhas.push('Falha PRR_CONFIRMED_CAUSE_WITH_BLOCKING_GAP: rebaixe causa confirmada para hipotese/lacuna; diga exatamente qual evidencia falta para confirmar.');
  }
  if (codigos.has('OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE')) {
    linhas.push('Falha OVERCONFIDENT_CAUSE_WITH_PARTIAL_SOURCE: ha apenas trecho de fonte ou fonte incompleto. Nao escreva "a causa e", "ponte causal direta" ou "isso resolve" para escopo/declaracao de variavel. Apresente como hipotese provavel, peca o fonte completo, confirme inicializacao/escopo da variavel e indique teste controlado de compilacao/execucao.');
  }
  if (codigos.has('HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE')) {
    linhas.push('Falha HYPOTHESIS_PROMOTED_TO_CONFIRMED_CAUSE: separe fato observado, hipotese e confirmacao. Em SoftExpert Workflow, HTTP 200 confirma apenas recebimento/processamento do callback; atividade parada e aviso de responsavel/papel sustentam hipotese de resolucao de responsavel/regra de transicao, nao causa confirmada. Peca log interno do workflow/auditoria da atividade e configuracao de responsaveis/permissoes para confirmar.');
  }
  if (codigos.has('RESEARCH_FOUND_BUT_NOT_READ')) {
    linhas.push('Falha RESEARCH_FOUND_BUT_NOT_READ: nao afirme que a documentacao oficial foi consultada se nenhuma pagina foi efetivamente lida/reutilizada. Use a pesquisa apenas como limitada/nao conclusiva ou ignore-a e conduza a investigacao pelas evidencias internas.');
  }
  return linhas.join('\n');
}

function montarInstrucaoRetry(gate, contexto = {}) {
  const manifesto = contexto.manifesto || contexto;
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
    _formatarContratoPRRRetry(manifesto),
    _instrucoesDirecionadasPorFalha(gate, manifesto),
    regressao.length ? `Regressao investigativa detectada: ${regressao.map(f => `${f.codigo}${f.itemCodigo ? ` em ${f.itemCodigo}` : ''}${f.evidencia ? ` em ${f.evidencia}` : ''}`).join('; ')}.` : '',
    regressao.length ? 'Use o estado atual do dossie: nao repita teste/evidencia/hipotese/solucao ja encerrados sem justificar explicitamente qual evidencia ou mudanca nova torna a repeticao necessaria.' : '',
    'Refaca a analise usando explicitamente as evidencias selecionadas no manifesto. Cite as evidencias tecnicas que sustentam o diagnostico.',
    'Reescreva como conversa tecnica humana, nao como laudo com template fixo. Evite cabecalhos formais em Markdown como "### Fatos", "### Causa provavel" e "### Proximos passos". Comece pelo ponto que mais muda a analise e va direto ao proximo ajuste/teste de maior valor.',
    'Se houver evidencias suficientes, proponha uma acao tecnica concreta. Nao use "agendar videochamada", "analisar melhor" ou "consultar documentacao" como recomendacao principal quando ja existem prints, logs, parametros, rotinas ou fontes oficiais apontando uma trilha.',
    'A primeira acao tecnica deve atacar a evidencia mais especifica do caso. Se houver uma mensagem de erro concreta (por exemplo modo de edicao, campo nao atribuivel, stack trace ou excecao), priorize essa trilha antes de parametros/documentacao genericos.',
    'Use o Quadro investigativo quando ele existir: respeite problema principal, estado operacional e papeis das evidencias. Nao transforme evidencia INCIDENTAL em causa/proximo passo principal sem demonstrar a ponte causal; se a ponte nao existir, declare a lacuna.',
    'Se o quadro indicar correcao aplicada pendente de validacao, priorize validar o sintoma original e nao recomende abrir/acionar Fabrica, TOTVS ou fornecedor como se isso ainda nao tivesse ocorrido.',
    'Nao cite IDs internos do manifesto como se fossem logs, mensagens ou evidencias do chamado. Cite apenas conteudo visivel, nome de arquivo, campo, mensagem de erro, trecho de log real ou fonte tecnica.',
    'Nao descarte customizacao nem atribua o erro ao produto padrao sem fonte, log ou codigo sustentando essa conclusao. Se nao houver esse material, diga que precisa conferir fonte/gatilho/ponto de entrada.',
    'Quando houver imagens/prints enviados, cite textos, campos, percentuais, mensagens ou estados visiveis nas telas. Nao escreva apenas "as imagens mostram" sem dizer o que foi visto.',
    'Quando houver fontes oficiais lidas ou reutilizadas, use-as como evidencia externa rastreavel e diferencie parametro/documentacao de causa confirmada no ambiente.',
    'Para cada rotina, parametro, modulo, erro ou tabela especifica que voce citar, deixe claro se veio do historico/anexo/log/print, de pesquisa externa, do dossie, ou se e apenas hipotese a validar. Nao atribua ao cliente ou ao historico um termo que veio apenas da pesquisa externa.',
    'Nao use IDs internos do manifesto/runner. Se voce citou aud-msg, UUID, id de anexo ou execucao, substitua pelo conteudo visivel da mensagem/anexo.',
    'Nao afirme quantidades operacionais ("feito 3 vezes", "Fabrica viu X vezes") sem essa contagem explicita no historico.',
    'Se a evidencia necessaria nao estiver disponivel ou nao for suportada, diga isso objetivamente e peca a evidencia especifica que falta.',
    'Se uma causa ou fato tecnico nao estiver sustentado, rebaixe para hipotese explicita e informe a lacuna/proximo passo de maior valor.',
    pesquisaIndisponivel ? 'Pesquisa tecnica externa era necessaria para esta pergunta mas nao pode ser executada (mecanismo de busca indisponivel nesta instalacao). Declare isso explicitamente na resposta ao usuario — nao apresente a causa como se tivesse sido corroborada por fonte externa, e nao finja ter pesquisado.' : '',
  ].filter(Boolean).join('\n');
}

module.exports = { avaliarResposta, montarInstrucaoRetry, classificarProvenienciaReferencias, temFalhaDeIntegridade, ehFalhaDeIntegridade, FALHAS_DE_INTEGRIDADE, _avaliarRegressaoInvestigativa, _similaridadeShingles, _extrairAncorasTecnicas, _propostaDeCorrecao };
