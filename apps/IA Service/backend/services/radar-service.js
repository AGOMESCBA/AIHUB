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
const anexoRepo = require('../repositories/anexo-repository');
const turnoLockService = require('./turno-lock-service');
const { getDB } = require('../database');

const SISTEMA_ORIGEM_PADRAO = 'softexpert';
const AUTO_REFRESH_PADRAO_SEGUNDOS = 14400;
const AUTO_REFRESH_VALORES_VALIDOS = new Set([0, 30, 60, 300, 900, 1800, 3600, 14400]);
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
    const data = p.dataPosicionamento ? _formatarDataHoraPosicionamento(p.dataPosicionamento) : '(sem data)';
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

// Pedido explícito do usuário (2026-10): mostrar data E hora juntas no texto
// da mensagem ("01/10/2026 - 14:32:00"), não só a data — antes só aparecia
// o dia (dataPosicionamentoIso.slice(0, 10)) porque a hora real nunca tinha
// sido capturada da origem (ver HORAATUAL em historical-import-service.js/
// softexpert-sqlserver-adapter.js). dataPosicionamentoIso já vem em UTC
// (epochSegundosParaIso) — toLocaleString teria que escolher um fuso, então
// extrai os componentes do próprio ISO diretamente, sem conversão de fuso
// (mesmo horário "de parede" que veio do SoftExpert).
function _formatarDataHoraPosicionamento(dataPosicionamentoIso) {
  if (!dataPosicionamentoIso) return 'sem data';
  const m = String(dataPosicionamentoIso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return dataPosicionamentoIso.slice(0, 10);
  const [, ano, mes, dia, hh, mm, ss] = m;
  return `${dia}/${mes}/${ano} - ${hh}:${mm}:${ss}`;
}

function _papelPosicionamento(chamado, p, tecnicoResponsavelNome) {
  if (p.tecnicoId) return 'user';
  if (p.usuarioClienteId) return 'customer';
  if (p.tecnicoId && chamado.tecnicoResponsavelId && p.tecnicoId === chamado.tecnicoResponsavelId) return 'user';
  const autor = _normalizarNome(_autorPosicionamento(p));
  const responsavel = _normalizarNome(tecnicoResponsavelNome);
  return responsavel && autor === responsavel ? 'user' : 'customer';
}

function _dataMensagemOrigem(dataOrigem, indice) {
  const base = dataOrigem ? new Date(dataOrigem) : new Date();
  const dataValida = Number.isNaN(base.getTime()) ? new Date() : base;
  dataValida.setSeconds(dataValida.getSeconds() + indice);
  return dataValida.toISOString();
}

function _gravarHistoricoComoMensagens(empresaId, atendimentoId, chamado, posicionamentos, usuarioIdIahub) {
  // chamado.solicitanteId/tecnicoResponsavelId são as únicas referências ao
  // solicitante/técnico presentes no objeto retornado por chamadoRepo.getChamado
  // (sem join) — solicitanteNome/tecnicoResponsavelNome nunca existiram nesse
  // objeto, então resolvidos aqui via join explícito (achado real 2026-10,
  // chamado #035988: nome do solicitante presente e correto na origem/base,
  // mas a mensagem de abertura sempre caía no fallback "não identificado"
  // porque lia um campo que nunca foi populado neste fluxo).
  const solicitante = clienteRepo.getUsuarioClientePorId(empresaId, chamado.solicitanteId);
  const tecnicoResponsavel = clienteRepo.getTecnicoPorId(empresaId, chamado.tecnicoResponsavelId);

  let indice = 0;
  const abertura = _textoAberturaChamado(chamado);
  if (abertura) {
    mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
      papel: 'customer',
      conteudo: `Abertura do chamado por ${solicitante?.nome || 'solicitante não identificado'}\n\n${abertura}`,
      usuarioId: null,
      criadoEm: _dataMensagemOrigem(chamado.dataAbertura, indice++),
      origemSistema: 'softexpert',
      origemReferencia: `chamado:${chamado.id}`,
      origemData: chamado.dataAbertura ?? null,
      origemAutor: solicitante?.nome || null,
    });
  }

  for (const p of posicionamentos) {
    const autor = _autorPosicionamento(p);
    const papel = _papelPosicionamento(chamado, p, tecnicoResponsavel?.nome);
    mensagemRepo.salvarMensagem(empresaId, atendimentoId, {
      papel,
      conteudo: _textoPosicionamento(p),
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
  // Transação única: nunca fica um chat sem o histórico importado (ou com ele
  // pela metade) se o processo cair entre a remoção e a regravação.
  getDB().transaction(() => {
    mensagemRepo.removerHistoricoImportado(empresaId, atendimentoId);
    _gravarHistoricoComoMensagens(empresaId, atendimentoId, chamado, posicionamentos, usuarioIdIahub);
  })();
}

function _atendimentoDoChamado(empresaId, chamado) {
  return atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || SISTEMA_ORIGEM_PADRAO,
    referenciaExterna: chamado.numero,
  });
}

/**
 * true quando o chamado tem um turno de IA (ou pré-análise) em andamento. O
 * Refresh NÃO modifica chamados ocupados (tentará de novo no próximo ciclo).
 */
function chamadoOcupadoPorNumero(empresaId, numero, sistemaOrigem = SISTEMA_ORIGEM_PADRAO) {
  const chamado = chamadoRepo.getChamadoPorNumero(empresaId, numero, sistemaOrigem);
  if (!chamado) return false;
  const atendimento = _atendimentoDoChamado(empresaId, chamado);
  if (!atendimento) return false;
  return turnoLockService.estaProcessando(empresaId, atendimento.id) || preAnalisesEmAndamento.has(atendimento.id);
}

/**
 * Reconstrói as mensagens IMPORTADAS (abertura + posicionamentos) de um chamado
 * já existente no chat, a partir dos posicionamentos locais atualizados.
 * Preserva mensagens do analista, respostas da IA, anexos, dossiê e trilha
 * (removerHistoricoImportado só apaga o que veio da origem). Roda numa única
 * transação e sob o lock de turno do atendimento: sem duplicação nem leitura
 * parcial, e nunca durante um turno de IA.
 */
function reconstruirHistoricoDoChamado(empresaId, chamadoId) {
  if (!empresaId) throw new Error('empresaId é obrigatório.');
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) return { reconstruido: false, motivo: 'chamado_nao_encontrado' };
  const atendimento = _atendimentoDoChamado(empresaId, chamado);
  if (!atendimento) return { reconstruido: false, motivo: 'sem_atendimento' };
  if (preAnalisesEmAndamento.has(atendimento.id)) return { reconstruido: false, motivo: 'pre_analise_em_andamento' };
  if (!turnoLockService.tentarAdquirir(empresaId, atendimento.id)) return { reconstruido: false, motivo: 'turno_em_andamento' };
  try {
    const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamadoId);
    getDB().transaction(() => {
      _sincronizarHistoricoImportado(empresaId, atendimento.id, chamado, posicionamentos, null);
    })();
    return { reconstruido: true, atendimentoId: atendimento.id, mensagensImportadas: posicionamentos.length + 1 };
  } finally {
    turnoLockService.liberar(empresaId, atendimento.id);
  }
}

/**
 * true quando o chat do chamado tem menos/mais mensagens importadas do que a
 * base tem de posicionamentos (ex.: a importação por janela trouxe
 * posicionamentos novos, mas o chat só reconstrói ao selecionar).
 */
function historicoImportadoDesatualizado(empresaId, chamadoId) {
  const chamado = chamadoRepo.getChamado(empresaId, chamadoId);
  if (!chamado) return false;
  const atendimento = _atendimentoDoChamado(empresaId, chamado);
  if (!atendimento) return false;
  const esperadas = chamadoRepo.contarPosicionamentosDoChamado(empresaId, chamadoId) + (_textoAberturaChamado(chamado) ? 1 : 0);
  return mensagemRepo.contarMensagensImportadas(empresaId, atendimento.id) !== esperadas;
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

/**
 * Decide (de forma SINCRONA e atomica, sem await no meio) se a pre-analise
 * deve disparar, e ja marca o lock antes de retornar -- fecha a janela de
 * corrida real encontrada em producao (2026-10, chamado #035988): duas
 * requisicoes POST /iniciar-analise quase simultaneas (ex. duplo-clique)
 * cada uma lia "ja tem resposta da IA?" do banco ANTES de qualquer uma ter
 * disparado, as duas viam "nao" e as duas disparavam -- o guard antigo so
 * era marcado DEPOIS dessa leitura, tarde demais para proteger a decisao em
 * si. Agora a leitura de jaTemRespostaIa e a marcacao do lock acontecem na
 * MESMA chamada sincrona desta funcao: como JS de um processo Node roda a
 * parte sincrona de uma funcao sem interrupcao por outra requisicao
 * concorrente, a segunda chamada so ve o lock ja marcado pela primeira,
 * nunca as duas decidindo "nao tem resposta ainda" ao mesmo tempo.
 */
function _tentarDispararPreAnaliseEmBackground(empresaId, chamado, atendimento, { chamadoId, preAnaliseHabilitada, verificarRespostaExistente }) {
  if (preAnalisesEmAndamento.has(atendimento.id)) return false;
  if (verificarRespostaExistente) {
    const mensagens = mensagemRepo.listarMensagens(empresaId, atendimento.id, { limite: 500 });
    if (mensagens.some(m => m.papel === 'assistant')) return false;
  }
  if (!preAnaliseHabilitada) return false;

  preAnalisesEmAndamento.add(atendimento.id);
  anexosSoftExpertService.sincronizarAnexosParaAtendimento(empresaId, chamadoId, atendimento.id)
    .catch(err => {
      console.error(`[IA Service] Sincronização de anexos do SoftExpert falhou (chamado ${chamado.numero}):`, err.message);
      return [];
    })
    .then(() => {
      // sincronizarAnexosParaAtendimento devolve só os anexos BAIXADOS NESTA
      // execução (filtra os já sincronizados antes, para não duplicar
      // download/extração) — usar esse retorno como anexoIds da IA fazia a
      // pré-análise esquecer qualquer anexo já baixado em uma tentativa
      // anterior (ex.: reabertura do chamado, ou anexo já visto no modal),
      // mesmo com o conteúdo pronto no banco (bug real reportado pelo
      // usuário, 2026-10: log de erro anexado na abertura nunca chegou à
      // IA porque já tinha sido sincronizado antes da pré-análise rodar).
      // Busca TODOS os anexos já no atendimento, não só os novos.
      const todosAnexos = anexoRepo.listarAnexos(empresaId, atendimento.id);
      const anexoIds = todosAnexos.map(a => a.id).filter(Boolean);
      investigacaoService.processarPreAnalise(empresaId, atendimento.id, { anexoIds }).catch(err => {
        console.error(`[IA Service] Pré-análise automática (abertura no radar) falhou (chamado ${chamado.numero}):`, err.message);
        // Rede de segurança (bug real, 2026-10: chamado #036475): quando a
        // falha acontece ANTES do próprio processarTurno conseguir gravar sua
        // mensagem de erro (ex. exceção síncrona bem no início, como
        // getAtendimento ou qualquer passo antes do try de pesquisa técnica),
        // nenhuma mensagem nem execução fica registrada — o guard
        // verificarRespostaExistente (acima) nunca encontra nada, e CADA
        // reabertura do chamado dispara uma nova tentativa, reiniciando o
        // indicador "Aguardando pré-análise..." no frontend indefinidamente,
        // mesmo sem nenhuma resposta nova de fato. Grava aqui um fallback
        // mínimo só se processarPreAnalise não deixou NENHUM rastro, para que
        // a próxima reabertura veja "já tem resposta" e pare de tentar.
        try {
          const jaRegistrouAlgo = mensagemRepo.listarMensagens(empresaId, atendimento.id, { limite: 500 })
            .some(m => m.papel === 'assistant');
          if (!jaRegistrouAlgo) {
            mensagemRepo.salvarMensagem(empresaId, atendimento.id, {
              papel: 'assistant',
              conteudo: `Não foi possível concluir a pré-análise automática no momento: ${err.message}`,
              usuarioId: null,
              diagnostico: { erroInfraestrutura: true },
            });
          }
        } catch (gravarErr) {
          console.error('[IA Service] Falha ao gravar fallback da pré-análise automática:', gravarErr.message);
        }
      });
    })
    .finally(() => {
      preAnalisesEmAndamento.delete(atendimento.id);
    });
  return true;
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

  const consultor = _resolverConsultorDaAbertura(empresaId, { usuarioIdIahub, consultorId });
  const preAnaliseLigada = _preAnaliseHabilitada(consultor, preAnaliseAutomatica);
  const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamadoId);

  // Busca-ou-cria ATÔMICO (atendimento-repository.buscarOuCriarAtendimentoPorReferencia)
  // — corrige condição de corrida real encontrada em produção (2026-10):
  // esta função roda tanto pelo clique manual do analista quanto pela
  // sincronização de fundo da fila (radar-refresh-service), e as duas podiam
  // rodar quase ao mesmo tempo para o mesmo chamado. Antes, getAtendimentoPorReferencia
  // + criarAtendimento em dois passos separados deixava uma janela onde
  // ambas as chamadas viam "não existe" e criavam DOIS atendimentos — a
  // pré-análise da IA disparada por uma delas gravava a resposta num
  // atendimento que a tela podia nunca mais voltar a consultar (reproduzido
  // deterministicamente). A busca+criação agora acontece dentro de uma única
  // transação SQLite (serializada pelo próprio better-sqlite3), eliminando a
  // janela de corrida.
  const { atendimento, criado } = atendimentoRepo.buscarOuCriarAtendimentoPorReferencia(empresaId, {
    origem: chamado.sistemaOrigem || SISTEMA_ORIGEM_PADRAO,
    referenciaExterna: chamado.numero,
  }, {
    canalEntrada: 'radar',
    conteudoBruto: _formatarConteudoBruto(chamado, posicionamentos),
    criadoPorUsuarioId: usuarioIdIahub ?? null,
    consultorId: consultor?.id ?? null,
  });

  if (!criado) {
    _sincronizarHistoricoImportado(empresaId, atendimento.id, chamado, posicionamentos, usuarioIdIahub);
    // verificarRespostaExistente:true -- a checagem de "ja tem resposta da
    // IA?" acontece DENTRO da secao sincrona protegida pelo lock (nao mais
    // antes de chama-la), fechando a janela de corrida de duas requisicoes
    // concorrentes (ver comentario de _tentarDispararPreAnaliseEmBackground).
    const preAnaliseDisparada = _tentarDispararPreAnaliseEmBackground(empresaId, chamado, atendimento, {
      chamadoId, preAnaliseHabilitada: preAnaliseLigada, verificarRespostaExistente: true,
    });
    return { atendimento, reaberto: true, preAnaliseDisparada };
  }

  _gravarHistoricoComoMensagens(empresaId, atendimento.id, chamado, posicionamentos, usuarioIdIahub);

  // Sincroniza anexos do SoftExpert (prints, planilhas, logs já anexados ao
  // chamado na origem) para o armazenamento local ANTES da pré-análise —
  // pedido do usuário, 2026-09: a IA deve ter acesso ao mesmo material que
  // o analista vê, não só ao texto do chamado. Roda em background (nunca
  // atrasa a resposta HTTP de "iniciar análise"); a pré-análise só começa
  // depois de tentar sincronizar, para já poder correlacionar os anexos
  // desde a primeira resposta da IA.
  // verificarRespostaExistente:false -- atendimento RECÉM-CRIADO nesta
  // mesma chamada (criado=true), nunca pode ter resposta de IA ainda.
  const preAnaliseDisparada = _tentarDispararPreAnaliseEmBackground(empresaId, chamado, atendimento, {
    chamadoId, preAnaliseHabilitada: preAnaliseLigada, verificarRespostaExistente: false,
  });

  return { atendimento, reaberto: false, preAnaliseDisparada };
}

module.exports = {
  getFila,
  getFilaPorConsultorId,
  getRiscoSla,
  getRiscoSlaUsuario,
  getRiscoSlaPorConsultorId,
  iniciarAnalise,
  chamadoOcupadoPorNumero,
  historicoImportadoDesatualizado,
  reconstruirHistoricoDoChamado,
  abrirOuCriarAtendimento: iniciarAnalise,
  buscarRelacionados,
  getConfig,
  salvarConfig,
};
