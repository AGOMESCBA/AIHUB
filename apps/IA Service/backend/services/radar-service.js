// Orquestra a fila do analista ("radar") e a abertura de diálogo com a IA a
// partir de um chamado da fila — ponte entre a base histórica importada
// (chamados/posicionamentos) e o chat existente (atendimentos/mensagens).

const consultorService = require('./consultor-service');
const clienteRepo = require('../repositories/cliente-repository');
const chamadoRepo = require('../repositories/chamado-repository');
const atendimentoRepo = require('../repositories/atendimento-repository');
const radarRepo = require('../repositories/radar-repository');
const radarConfigRepo = require('../repositories/radar-config-repository');
const investigacaoService = require('./investigacao-service');
const anexosSoftExpertService = require('./anexos-softexpert-service');

const SISTEMA_ORIGEM_PADRAO = 'softexpert';
const AUTO_REFRESH_PADRAO_SEGUNDOS = 60;
const AUTO_REFRESH_VALORES_VALIDOS = new Set([0, 30, 60, 300, 900]);

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

function _formatarConteudoBruto(chamado, posicionamentos) {
  const linhas = [
    `Chamado SoftExpert #${chamado.numero}`,
    chamado.titulo ? `Título: ${chamado.titulo}` : null,
    chamado.assunto ? `Assunto: ${chamado.assunto}` : null,
    chamado.breveDescricao ? `Descrição: ${chamado.breveDescricao}` : null,
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

/**
 * Reabre o atendimento existente para este chamado (mesma referência
 * externa) ou cria um novo já com o conteúdo do chamado + posicionamentos
 * formatado como primeira mensagem — o analista não precisa copiar/colar
 * nada, o diálogo com a IA já começa com todo o histórico em mãos.
 */
function abrirOuCriarAtendimento(empresaId, chamadoId, { usuarioIdIahub, consultorId } = {}) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  if (!chamadoId) throw new Error('chamadoId é obrigatório.');

  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) throw new Error('Chamado não encontrado.');

  const existente = atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || SISTEMA_ORIGEM_PADRAO,
    referenciaExterna: chamado.numero,
  });
  if (existente) {
    return { atendimento: existente, reaberto: true };
  }

  // Sessão externa já resolve consultorId direto (via token); sessão normal
  // do IA HUB resolve por usuarioIdIahub. No máximo um dos dois é passado.
  let consultor = null;
  if (consultorId) {
    consultor = consultorService.getConsultor(empresaId, consultorId);
  } else if (usuarioIdIahub) {
    ({ consultor } = _resolverTecnicoDoConsultor(empresaId, usuarioIdIahub));
  }
  const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamadoId);
  const conteudoBruto = _formatarConteudoBruto(chamado, posicionamentos);

  const atendimento = atendimentoRepo.criarAtendimentoComPrimeiraMensagem(
    empresaId,
    {
      origem: chamado.sistemaOrigem || SISTEMA_ORIGEM_PADRAO,
      canalEntrada: 'radar',
      referenciaExterna: chamado.numero,
      conteudoBruto,
      criadoPorUsuarioId: usuarioIdIahub ?? null,
      consultorId: consultor?.id ?? null,
    },
    { papel: 'user', conteudo: conteudoBruto, usuarioId: usuarioIdIahub ?? null }
  );

  // Sincroniza anexos do SoftExpert (prints, planilhas, logs já anexados ao
  // chamado na origem) para o armazenamento local ANTES da pré-análise —
  // pedido do usuário, 2026-09: a IA deve ter acesso ao mesmo material que
  // o analista vê, não só ao texto do chamado. Roda em background (nunca
  // atrasa a resposta HTTP de "abrir atendimento"); a pré-análise só começa
  // depois de tentar sincronizar, para já poder correlacionar os anexos
  // desde a primeira resposta da IA.
  const preAnaliseHabilitada = consultor?.preAnaliseAutomatica !== false;
  anexosSoftExpertService.sincronizarAnexosParaAtendimento(empresaId, chamadoId, atendimento.id)
    .catch(err => {
      console.error(`[IA Service] Sincronização de anexos do SoftExpert falhou (chamado ${chamado.numero}):`, err.message);
    })
    .finally(() => {
      // Pré-análise automática ao ABRIR o chamado (pedido do usuário,
      // 2026-09): configurável por consultor (consultores.pre_analise_automatica,
      // default true) — se ligada, a IA já analisa sozinha assim que o
      // consultor seleciona um chamado que ainda não tinha atendimento; se
      // desligada, o chat abre só com o conteúdo bruto do chamado, esperando
      // o consultor perguntar manualmente. Distinto (e adicional) do gatilho
      // já existente na IMPORTAÇÃO (historical-import-service.js), que
      // dispara independente dessa config — os dois pontos de entrada
      // continuam coexistindo. Best-effort: erro aqui nunca derruba a
      // abertura do atendimento, só fica registrado em log.
      if (!preAnaliseHabilitada) return;
      investigacaoService.processarPreAnalise(empresaId, atendimento.id).catch(err => {
        console.error(`[IA Service] Pré-análise automática (abertura no radar) falhou (chamado ${chamado.numero}):`, err.message);
      });
    });

  return { atendimento, reaberto: false };
}

module.exports = { getFila, getFilaPorConsultorId, abrirOuCriarAtendimento, getConfig, salvarConfig };
