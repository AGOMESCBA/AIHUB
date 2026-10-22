'use strict';

/**
 * Gate de pesquisa externa sob PENDÊNCIA EXTERNA (2026-10, decisão do usuário).
 *
 * Princípio (ver memória ia-service-principio-chat-conversacional): o IA
 * Service é um chat conversacional. A situação do chamado (aguardando
 * Cliente/Fornecedor) controla SOMENTE o botão Pesquisar e a pré-análise
 * automática — nunca a conversa nem o raciocínio da IA.
 *
 * Regras:
 *  - Pendência não reconhecida com segurança como externa (vazia, atendente,
 *    desconhecida, divergente do último posicionamento) → comportamento atual
 *    (fail-safe), nenhuma chamada extra ao provider.
 *  - Pré-análise automática e botão "Pesquisar" nunca liberam pesquisa externa
 *    sob pendência externa.
 *  - Mensagem no chat (texto livre): liberada 100% (decisão do usuário,
 *    2026-10-21) — o planejamento normal da pesquisa decide, como em qualquer
 *    chamado. Antes, uma IA classificava o pedido; foi removido.
 *
 * Responsáveis externos: cliente, fornecedor e distribuidor. Valores reais
 * confirmados de ITC.AGUARDANDO: RETORNO - CLIENTE / FORNECEDOR / ATENDENTE;
 * "distribuidor" ainda não apareceu na base, mas foi incluído por decisão
 * explícita do usuário (2026-10) — a view já fatia a duração por distribuidor
 * (dias_dur_dist). Reconhecimento por substring do responsável, então
 * "RETORNO - X" e "AGUARDANDO X" são equivalentes.
 */


const ORIGEM = Object.freeze({
  AUTOMATICO: 'automatico',
  BOTAO: 'botao_pesquisar',
  TEXTO_LIVRE: 'texto_livre',
});


/**
 * Origem EFETIVA da ação. Preferência pela origem explícita enviada pelo
 * cliente e validada; `forcarPesquisa` (flag legada do botão) e `automatico`
 * têm precedência de segurança: nunca podem ser "rebaixados" para texto livre
 * (um cliente não consegue contornar o gate declarando texto_livre).
 */
function resolverOrigemAcao({ origemAcao, automatico = false, forcarPesquisa = false } = {}) {
  if (automatico) return ORIGEM.AUTOMATICO;
  if (forcarPesquisa) return ORIGEM.BOTAO;
  return origemAcao === ORIGEM.BOTAO ? ORIGEM.BOTAO : ORIGEM.TEXTO_LIVRE;
}

function _normalizar(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

/**
 * Classifica a pendência do chamado a partir de `aguardandoConsolidado`
 * (ITC.AGUARDANDO), a fonte oficial da situação atual (decisão do usuário,
 * migration v39). Defasagem do valor local é tratada em avaliarPendencia
 * (confirmação ao vivo na origem), não por comparação com posicionamentos.
 */
function classificarPendencia(chamado, posicionamentos = []) {
  const bruto = chamado?.aguardandoConsolidado || null;
  const v = _normalizar(bruto);
  if (!v) return { externa: false, responsavel: null, motivo: 'sem_situacao_consolidada', valor: bruto };

  let responsavel = null;
  if (v.includes('fornecedor')) responsavel = 'fornecedor';
  else if (v.includes('distribuidor')) responsavel = 'distribuidor';
  else if (v.includes('cliente')) responsavel = 'cliente';
  else if (v.includes('atendente')) responsavel = 'atendente';

  if (!responsavel) return { externa: false, responsavel: null, motivo: 'situacao_nao_reconhecida', valor: bruto };
  if (responsavel === 'atendente') return { externa: false, responsavel, motivo: 'aguardando_atendente', valor: bruto };

  // NÃO compara com posicionamentos.aguardando_retorno: homologação real
  // (2026-10) mostrou que ele tem semântica diferente do consolidado — em 52
  // de 52 chamados com RETORNO - CLIENTE/FORNECEDOR o último posicionamento
  // tem aguardando_retorno=1 (o campo por posicionamento reflete o trâmite
  // daquele registro, não a situação atual do chamado). Usá-lo como "prova de
  // divergência" desligava o gate em 100% dos casos. A situação atual vem do
  // consolidado (ITSM_CHAMADOS.AGUARDANDO), confirmado na origem ao vivo.
  return { externa: true, responsavel, motivo: 'pendencia_externa_reconhecida', valor: bruto };
}

/**
 * Classifica a pendência usando a situação MAIS RECENTE disponível: SEMPRE
 * confirma no snapshot compartilhado (nos dois sentidos — local ATENDENTE com
 * a origem já em CLIENTE/FORNECEDOR também é corrigido). O snapshot é cacheado
 * (TTL ~60 s, single-flight), então o custo normal é uma leitura em memória.
 * Snapshot indisponível/ausente → mantém o valor local, marcado como não
 * confirmado na origem (trilha). Ausência no snapshot não prova encerramento.
 */
async function avaliarPendencia({ chamado, posicionamentos = [], consultarSituacaoOrigem }) { // posicionamentos: reservado, não usado na decisão
  const local = classificarPendencia(chamado, posicionamentos);
  if (typeof consultarSituacaoOrigem !== 'function') return { ...local, fonteSituacao: 'local_nao_confirmada_na_origem' };
  const o = await consultarSituacaoOrigem();
  if (!o?.ok) return { ...local, fonteSituacao: 'local_nao_confirmada_na_origem', motivoConsultaOrigem: o?.motivo || null };
  if (_normalizar(o.aguardando) === _normalizar(local.valor)) return { ...local, fonteSituacao: 'origem_confirmou' };
  const atual = classificarPendencia({ ...chamado, aguardandoConsolidado: o.aguardando }, posicionamentos);
  return { ...atual, fonteSituacao: 'origem_divergiu_do_local', situacaoLocal: local.valor, situacaoOrigem: o.aguardando };
}

/**
 * Decide se a pesquisa externa está liberada neste turno.
 * `chamarIA(systemPrompt, userPrompt, opts)` é injetado (testável, sem
 * acoplamento ao provider). Nunca lança: qualquer falha → não pesquisa.
 */
async function decidirPesquisaExterna({ pendencia, origemAcao, texto, historico, chamarIA }) {
  if (!pendencia?.externa) {
    return { liberada: true, motivo: pendencia?.motivo || 'sem_pendencia_externa', origemAcao, pendencia, chamadaIA: false };
  }
  const base = { pendencia, origemAcao, chamadaIA: false };
  if (origemAcao === ORIGEM.AUTOMATICO) {
    return { ...base, liberada: false, motivo: `pre_analise_automatica_sem_pesquisa_externa: aguardando ${pendencia.responsavel}` };
  }
  if (origemAcao === ORIGEM.BOTAO) {
    return { ...base, liberada: false, motivo: `botao_pesquisar_nao_autoriza_sob_pendencia_externa: aguardando ${pendencia.responsavel}` };
  }
  // Mensagem no chat: liberada 100% (decisão do usuário, 2026-10-21). A
  // situação do chamado não restringe a conversa; o planejamento normal da
  // pesquisa decide, como em qualquer chamado.
  return { ...base, liberada: true, motivo: `chat_liberado_sob_pendencia_externa: aguardando ${pendencia.responsavel}` };
}

/**
 * Instrução anexada ao contexto de pesquisa do prompt quando a pesquisa
 * externa foi dispensada. NÃO é um texto de resposta: orienta o raciocínio e
 * deixa a forma da resposta para a IA (chat conversacional).
 */
function instrucaoParaPrompt(decisao) {
  const quem = decisao?.pendencia?.responsavel || 'terceiro';
  const linhas = [
    `Pesquisa externa NÃO executada neste turno: o chamado aguarda retorno de ${quem} (pendência externa).`,
    'Continue a conversa normalmente: use o histórico, as evidências do chamado e seu conhecimento técnico; separe o que é evidência do chamado do que é hipótese; responda exatamente o que o analista perguntou.',
    'Não repita avisos burocráticos: mencione que não houve consulta externa só quando isso for relevante para a pergunta e se ainda não tiver dito na conversa.',
  ];
  if (decisao?.origemAcao === ORIGEM.BOTAO) {
    linhas.push('O analista acionou o botão Pesquisar, que não autoriza pesquisa externa nesta situação: apresente de forma objetiva a situação atual do chamado (o que já foi feito, quem deve responder e o que falta), diga que nenhuma pesquisa externa foi executada e que, se quiser investigar fontes externas, basta pedir na conversa.');
  } else if (decisao?.duvida) {
    // Na duvida, o chat pergunta ao analista (decisao do usuario, 2026-10).
    linhas.push('Não ficou claro se o analista quer pesquisa externa: responda o que for possível com o histórico e pergunte, em uma frase objetiva, se ele quer que a pesquisa externa seja feita.');
  } else if (decisao?.origemAcao === ORIGEM.AUTOMATICO) {
    linhas.push('Esta é uma análise automática: resuma a situação e a pendência com base no histórico, sem pesquisa externa.');
  }
  return linhas.join('\n');
}

module.exports = {
  ORIGEM,
  resolverOrigemAcao,
  classificarPendencia,
  avaliarPendencia,
  decidirPesquisaExterna,
  instrucaoParaPrompt,
};
