// Orquestra a fila do analista ("radar") e a análise assistida com IA a
// partir de um chamado da fila — ponte entre a base histórica importada
// (chamados/posicionamentos) e o chat existente (atendimentos/mensagens).

const consultorService = require('./consultor-service');
const clienteRepo = require('../repositories/cliente-repository');
const chamadoRepo = require('../repositories/chamado-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const mensagemRepo = require('../repositories/mensagem-repository');
const radarRepo = require('../repositories/radar-repository');
const radarConfigRepo = require('../repositories/radar-config-repository');
const investigacaoService = require('./investigacao-service');
const anexosSoftExpertService = require('./anexos-softexpert-service');

const SISTEMA_ORIGEM_PADRAO = 'softexpert';
const AUTO_REFRESH_PADRAO_SEGUNDOS = 60;
const AUTO_REFRESH_VALORES_VALIDOS = new Set([0, 30, 60, 300, 900]);
const preAnalisesEmAndamento = new Set();

function getConfig(empresaId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const config = radarConfigRepo.getConfig(empresaId);
  return config || { empresaId, autoRefreshSegundos: AUTO_REFRESH_PADRAO_SEGUNDOS };
}

function salvarConfig(empresaId, { autoRefreshSegundos }) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const valor = Number(autoRefreshSegundos);
  if (!AUTO_REFRESH_VALORES_VALIDOS.has(valor)) {
    throw new Error(`autoRefreshSegundos inválido: ${autoRefreshSegundos}. Valores aceitos: ${[...AUTO_REFRESH_VALORES_VALIDOS].join(', ')}.`);
  }
  return radarConfigRepo.salvarConfig(empresaId, { autoRefreshSegundos: valor });
}

/**
 * Resolve o `tecnicos.id` do consultor logado, cruzando
 * `consultores.id_softexpert` com `tecnicos.id_origem` (sistema_origem
 * 'softexpert'). Retorna `null` quando não há vínculo suficiente — quem
 * chama decide se isso vira "fila vazia com aviso" (nunca erro).
 */
function _resolverTecnicoDoConsultor(empresaId, usuarioIdIahub) {
  const consultor = consultorService.getConsultorPorUsuario(empresaId, usuarioIdIahub);
  return _resolverTecnicoDoConsultorResolvido(empresaId, consultor);
}

/**
 * Mesma resolução acima, mas a partir de um `consultor` já carregado — usado
 * pela sessão externa (login por telefone), que já resolve o consultor pelo
 * `consultorId` gravado no token, sem precisar do `usuarioIdIahub`.
 */
function _resolverTecnicoDoConsultorResolvido(empresaId, consultor) {
  if (!consultor || !consultor.idSoftexpert) return { consultor, tecnico: null };
  const tecnico = clienteRepo.getTecnicoPorOrigem(empresaId, SISTEMA_ORIGEM_PADRAO, consultor.idSoftexpert);
  return { consultor, tecnico };
}

/**
 * `apenasMinha`: filtra pela fila do consultor logado (via vínculo
 * id_softexpert → tecnicos.id_origem); sem isso, retorna a fila geral da
 * empresa. `filtroSla`: 'todos' | 'em_atraso' | 'em_dia' (decisão do
 * usuário — ver radar-repository.js).
 */
function getFila(empresaId, usuarioIdIahub, { apenasMinha = false, filtroSla = 'todos', limite } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');

  if (!apenasMinha) {
    return { chamados: radarRepo.listarFila(empresaId, { filtroSla, limite }), avisoSemVinculo: false };
  }

  if (!usuarioIdIahub) throw new Error('usuarioIdIahub é obrigatório para filtrar "minha fila".');
  const { tecnico } = _resolverTecnicoDoConsultor(empresaId, usuarioIdIahub);
  if (!tecnico) {
    // Consultor sem id_softexpert vinculado, ou vinculado a um id_origem que
    // ainda não apareceu em nenhuma importação — fila vazia, nunca erro
    // (comportamento acordado no plano da Frente B).
    return { chamados: [], avisoSemVinculo: true };
  }

  return { chamados: radarRepo.listarFila(empresaId, { tecnicoId: tecnico.id, filtroSla, limite }), avisoSemVinculo: false };
}

/**
 * Mesmo comportamento de getFila, mas para sessão externa (login por
 * telefone) — o token já resolve `consultorId` diretamente, sem precisar
 * passar por `usuarioIdIahub`/getConsultorPorUsuario. "Minha fila" é sempre
 * true aqui: sessão externa é por definição um consultor específico, não
 * faz sentido pedir a fila geral da empresa nesse modo.
 */
function getFilaPorConsultorId(empresaId, consultorId, { filtroSla = 'todos', limite } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!consultorId) throw new Error('consultorId é obrigatório.');

  const consultor = consultorService.getConsultor(empresaId, consultorId);
  const { tecnico } = _resolverTecnicoDoConsultorResolvido(empresaId, consultor);
  if (!tecnico) {
    return { chamados: [], avisoSemVinculo: true };
  }
  return { chamados: radarRepo.listarFila(empresaId, { tecnicoId: tecnico.id, filtroSla, limite }), avisoSemVinculo: false };
}

function getRiscoSla(empresaId, { filtroRisco = 'todos', limite } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  return radarRepo.listarRiscoSla(empresaId, { filtroRisco, limite });
}

function getRiscoSlaPorConsultorId(empresaId, consultorId, { filtroRisco = 'todos', limite } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!consultorId) throw new Error('consultorId é obrigatório.');

  const consultor = consultorService.getConsultor(empresaId, consultorId);
  const { tecnico } = _resolverTecnicoDoConsultorResolvido(empresaId, consultor);
  if (!tecnico) return { consultores: [], chamados: [], avisoSemVinculo: true };
  const resultado = radarRepo.listarRiscoSla(empresaId, { tecnicoId: tecnico.id, filtroRisco, limite });
  return { ...resultado, avisoSemVinculo: false };
}

function getRiscoSlaUsuario(empresaId, usuarioIdIahub, { apenasMinha = false, filtroRisco = 'todos', limite } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!apenasMinha) return { ...getRiscoSla(empresaId, { filtroRisco, limite }), avisoSemVinculo: false };

  if (!usuarioIdIahub) throw new Error('usuarioIdIahub é obrigatório para filtrar "minha fila".');
  const { tecnico } = _resolverTecnicoDoConsultor(empresaId, usuarioIdIahub);
  if (!tecnico) return { consultores: [], chamados: [], avisoSemVinculo: true };
  const resultado = radarRepo.listarRiscoSla(empresaId, { tecnicoId: tecnico.id, filtroRisco, limite });
  return { ...resultado, avisoSemVinculo: false };
}

function _formatarConteudoBruto(chamado, posicionamentos) {
  const linhas = [
    `Chamado SoftExpert #${chamado.numero}`,
    chamado.produto ? `Produto: ${chamado.produto}` : null,
    chamado.familia ? `Família: ${chamado.familia}` : null,
    chamado.modulo ? `Módulo: ${chamado.modulo}` : null,
    chamado.servico ? `Serviço: ${chamado.servico}` : null,
    chamado.tipoChamadoFinal || chamado.tipoChamado ? `Tipo: ${chamado.tipoChamadoFinal || chamado.tipoChamado}` : null,
    chamado.natureza ? `Natureza: ${chamado.natureza}` : null,
    chamado.nivel ? `Nível: ${chamado.nivel}` : null,
    chamado.titulo ? `Título: ${chamado.titulo}` : null,
    chamado.assunto ? `Assunto: ${chamado.assunto}` : null,
    chamado.breveDescricao ? `Resumo: ${chamado.breveDescricao}` : null,
    chamado.descricao ? `Descrição completa: ${chamado.descricao}` : null,
    chamado.informacoesAdicionais ? `Informações adicionais: ${chamado.informacoesAdicionais}` : null,
    chamado.observacoes ? `Observações: ${chamado.observacoes}` : null,
    chamado.solucaoAplicada ? `Solução aplicada registrada: ${chamado.solucaoAplicada}` : null,
    chamado.slaPrazo ? `Prazo (SLA): ${chamado.slaPrazo}` : null,
    chamado.statusEncerramento ? `Status: ${chamado.statusEncerramento}` : null,
    '',
    'Posicionamentos:',
  ].filter(l => l !== null);

  for (const p of posicionamentos) {
    const data = p.dataPosicionamento ? p.dataPosicionamento.slice(0, 10) : '(sem data)';
    const autor = p.tecnicoNomeOrigem || 'Analista não identificado';
    const texto = p.descricao || p.assunto || '(sem descrição)';
    linhas.push(`- [${data}] ${autor}: ${texto}`);
  }

  return linhas.join('\n');
}

function _normalizarNome(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function _textoAberturaChamado(chamado) {
  return [
    chamado.descricao || chamado.breveDescricao || chamado.assunto || chamado.titulo,
    chamado.informacoesAdicionais ? `Informações adicionais: ${chamado.informacoesAdicionais}` : null,
    chamado.observacoes ? `Observações: ${chamado.observacoes}` : null,
  ].filter(Boolean).join('\n\n');
}

function _textoPosicionamento(p) {
  const partes = [];
  if (p.assunto) partes.push(p.assunto);
  if (p.descricao && p.descricao !== p.assunto) partes.push(p.descricao);
  if (p.resultado && p.resultado !== p.descricao && p.resultado !== p.assunto) partes.push(p.resultado);
  return partes.filter(Boolean).join('\n\n') || '(sem texto)';
}

function _autorPosicionamento(p) {
  return p.tecnicoNomeOrigem || 'Autor não identificado';
}

function _papelPosicionamento(chamado, p) {
  if (p.tecnicoId) return 'user';
  if (p.usuarioClienteId) return 'customer';
  if (p.tecnicoId && chamado.tecnicoResponsavelId && p.tecnicoId === chamado.tecnicoResponsavelId) return 'user';
  const autor = _normalizarNome(_autorPosicionamento(p));
  const responsavel = _normalizarNome(chamado.tecnicoResponsavelNome);
  return responsavel && autor === responsavel ? 'user' : 'customer';
}

function _dataMensagemOrigem(dataOrigem, indice) {
  const base = dataOrigem ? new Date(dataOrigem) : new Date();
  const dataValida = Number.isNaN(base.getTime()) ? new Date() : base;
  dataValida.setSeconds(dataValida.getSeconds() + indice);
  return dataValida.toISOString();
}

function _gravarHistoricoComoMensagens(empresaId, atendimentoId, chamado, posicionamentos, usuarioIdIahub) {
  let indice = 0;
  const abertura = _textoAberturaChamado(chamado);
  if (abertura) {
    mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
      papel: 'customer',
      conteudo: `Abertura do chamado por ${chamado.solicitanteNome || 'solicitante não identificado'}\n\n${abertura}`,
      usuarioId: null,
      criadoEm: _dataMensagemOrigem(chamado.dataAbertura, indice++),
      origemSistema: 'softexpert',
      origemReferencia: `chamado:${chamado.id}`,
      origemData: chamado.dataAbertura ?? null,
      origemAutor: chamado.solicitanteNome || null,
    });
  }

  for (const p of posicionamentos) {
    const data = p.dataPosicionamento ? p.dataPosicionamento.slice(0, 10) : 'sem data';
    const autor = _autorPosicionamento(p);
    const papel = _papelPosicionamento(chamado, p);
    mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
      papel,
      conteudo: `[${data}] ${autor}\n\n${_textoPosicionamento(p)}`,
      usuarioId: papel === 'user' ? (usuarioIdIahub ?? null) : null,
      criadoEm: _dataMensagemOrigem(p.dataPosicionamento, indice++),
      origemSistema: 'softexpert',
      origemReferencia: `posicionamento:${p.id}`,
      origemData: p.dataPosicionamento ?? null,
      origemAutor: autor,
    });
  }
}

function _sincronizarHistoricoImportado(empresaId, atendimentoId, chamado, posicionamentos, usuarioIdIahub) {
  mensagemRepo.removerHistoricoImportado(empresaId, atendimentoId);
  _gravarHistoricoComoMensagens(empresaId, atendimentoId, chamado, posicionamentos, usuarioIdIahub);
}

function buscarRelacionados(empresaId, chamadoId, { limite = 8 } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');
  return {
    chamados: chamadoRepo.listarChamadosRelacionados(empresaId, chamadoId, { limite }),
  };
}

function _resolverConsultorDaAbertura(empresaId, { usuarioIdIahub, consultorId } = {}) {
  if (consultorId) return consultorService.getConsultor(empresaId, consultorId);
  if (usuarioIdIahub) {
    const { consultor } = _resolverTecnicoDoConsultor(empresaId, usuarioIdIahub);
    return consultor;
  }
  return null;
}

function _preAnaliseHabilitada(consultor, preAnaliseAutomatica) {
  return preAnaliseAutomatica !== undefined
    ? !!preAnaliseAutomatica
    : !!consultor && consultor.preAnaliseAutomatica !== false;
}

function _dispararPreAnaliseEmBackground(empresaId, chamado, atendimento, { chamadoId, preAnaliseHabilitada }) {
  if (preAnalisesEmAndamento.has(atendimento.id)) return;
  preAnalisesEmAndamento.add(atendimento.id);
  anexosSoftExpertService.sincronizarAnexosParaAtendimento(empresaId, chamadoId, atendimento.id)
    .catch(err => {
      console.error(`[IA Service] Sincronização de anexos do SoftExpert falhou (chamado ${chamado.numero}):`, err.message);
      return [];
    })
    .then((anexosSincronizados = []) => {
      if (!preAnaliseHabilitada) return;
      const anexoIds = anexosSincronizados.map(a => a.id).filter(Boolean);
      investigacaoService.processarPreAnalise(empresaId, atendimento.id, { anexoIds }).catch(err => {
        console.error(`[IA Service] Pré-análise automática (abertura no radar) falhou (chamado ${chamado.numero}):`, err.message);
      });
    })
    .finally(() => {
      preAnalisesEmAndamento.delete(atendimento.id);
    });
}

/**
 * Inicia/reabre a análise assistida por IA para um chamado já existente no
 * SoftExpert. Não abre chamado na origem: cria apenas a sessão interna de
 * conversa/investigação do Radar, com conteúdo do chamado + posicionamentos
 * formatados como primeira mensagem.
 */
function iniciarAnalise(empresaId, chamadoId, { usuarioIdIahub, consultorId, preAnaliseAutomatica } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');

  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw new Error('Chamado não encontrado.');

  const existente = atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || SISTEMA_ORIGEM_PADRAO,
    referenciaExterna: chamado.numero,
  });
  const consultor = _resolverConsultorDaAbertura(empresaId, { usuarioIdIahub, consultorId });
  const preAnaliseLigada = _preAnaliseHabilitada(consultor, preAnaliseAutomatica);

  if (existente) {
    const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamadoId);
    _sincronizarHistoricoImportado(empresaId, existente.id, chamado, posicionamentos, usuarioIdIahub);
    const mensagens = mensagemRepo.listarMensagens(empresaId, existente.id, { limite: 500 });
    const jaTemRespostaIa = mensagens.some(m => m.papel === 'assistant');
    if (preAnaliseLigada && !jaTemRespostaIa) {
      _dispararPreAnaliseEmBackground(empresaId, chamado, existente, { chamadoId, preAnaliseHabilitada: true });
    }
    return { atendimento: existente, reaberto: true };
  }

  const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamadoId);
  const conteudoBruto = _formatarConteudoBruto(chamado, posicionamentos);

  const atendimento = atendimentoRepo.criarAtendimento(empresaId, {
    origem: chamado.sistemaOrigem || SISTEMA_ORIGEM_PADRAO,
    canalEntrada: 'radar',
    referenciaExterna: chamado.numero,
    conteudoBruto,
    criadoPorUsuarioId: usuarioIdIahub ?? null,
    consultorId: consultor?.id ?? null,
  });
  _gravarHistoricoComoMensagens(empresaId, atendimento.id, chamado, posicionamentos, usuarioIdIahub);

  // Sincroniza anexos do SoftExpert (prints, planilhas, logs já anexados ao
  // chamado na origem) para o armazenamento local ANTES da pré-análise —
  // pedido do usuário, 2026-09: a IA deve ter acesso ao mesmo material que
  // o analista vê, não só ao texto do chamado. Roda em background (nunca
  // atrasa a resposta HTTP de "iniciar análise"); a pré-análise só começa
  // depois de tentar sincronizar, para já poder correlacionar os anexos
  // desde a primeira resposta da IA.
  _dispararPreAnaliseEmBackground(empresaId, chamado, atendimento, { chamadoId, preAnaliseHabilitada: preAnaliseLigada });

  return { atendimento, reaberto: false };
}

module.exports = {
  getFila,
  getFilaPorConsultorId,
  getRiscoSla,
  getRiscoSlaUsuario,
  getRiscoSlaPorConsultorId,
  iniciarAnalise,
  abrirOuCriarAtendimento: iniciarAnalise,
  buscarRelacionados,
  getConfig,
  salvarConfig,
};
