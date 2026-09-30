// HistoricalImportService — orquestrador de importação de dados históricos de
// atendimento (chamados/posicionamentos) para a base de conhecimento do IA
// Service. Desenhado para múltiplos adapters de origem (seção 8 do prompt):
// hoje só softexpert-sqlserver está implementado; ProtheusAdapter,
// ServiceNowAdapter etc ficam para o futuro, sem exigir mudança neste
// orquestrador (o adapter só precisa expor listarChamadosPeriodo/
// listarPosicionamentosDoChamado — mesma interface do softexpert-sqlserver-adapter.js).
//
// Fluxo (seção 17/20/46 do prompt):
//   buscar lote de chamados do período
//   → RAW (upsert idempotente por hash)
//   → normalizar CNPJ → localizar/criar cliente
//   → localizar/criar solicitante, técnico responsável
//   → upsert chamado (idempotente por hash)
//   → buscar TODOS os posicionamentos do chamado (sem filtro de data neles)
//   → RAW dos posicionamentos
//   → localizar/criar técnicos dos posicionamentos
//   → upsert posicionamentos
//   → checkpoint (após cada lote) → próximo lote

const { resolverAdapter } = require('./adapters');
const normalizadores = require('./normalizadores');
const clienteRepo = require('../../repositories/cliente-repository');
const chamadoRepo = require('../../repositories/chamado-repository');
const importacaoRepo = require('../../repositories/importacao-repository');
const agenteRepo = require('../../repositories/agente-local-repository');
const atendimentoRepo = require('../../repositories/atendimento-repository');
const radarService = require('../radar-service');

const TAMANHO_LOTE_PADRAO = 500;
const SISTEMA_ORIGEM = 'softexpert';

/**
 * Mapeia uma linha bruta de DYNITSM (colunas exatamente como vêm do SQL
 * Server) para os campos normalizados de `chamados`.
 *
 * VALIDADO CONTRA DADOS REAIS em 2026-09 (amostra de 50 registros, ver
 * cabeçalho de softexpert-sqlserver-adapter.js). Ajustes decididos nessa
 * validação, mantidos aqui de forma isolada (row → objeto) para que
 * qualquer nova divergência descoberta no futuro fique concentrada nesta
 * função, sem tocar no orquestrador:
 *   - titulo: cadeia de fallback TITULOWF → TITULOCHAMADO → TEXTO31
 *     (ordem confirmada explicitamente pelo usuário, 2026-09 — TITULOWF é
 *     o campo preferido quando preenchido, TITULOCHAMADO só é usado se
 *     TITULOWF vier vazio, e TEXTO31 é o último recurso quando nenhum dos
 *     dois existe). Cada candidato passa por textoOuNull individualmente
 *     antes do `??` — string vazia '' do SQL Server não é null/undefined,
 *     então um `??` encadeado direto nos campos brutos não pularia um
 *     campo vazio (só um NULL de verdade).
 *   - assunto/breveDescricao: BREVEDESCRICAO e DESCRICAO01 vieram sempre
 *     vazios na amostra (0/50) — TEXTO31 é o campo de fato preenchido
 *     (43/50) e passa a ser a fonte de breveDescricao também, não só de
 *     assunto. descricao (DESCRICAO01) é mantida mapeada — pode vir a ser
 *     preenchida em chamados fora da amostra — mas sem depender dela.
 *   - descricao: PARAGRAFO3 é o campo REAL de descrição livre do problema
 *     (evidência do usuário, 2026-09: texto em linguagem natural digitado
 *     pelo solicitante, ex. "Não estamos conseguindo acessar o Smart View
 *     onde a tela fica travada..."), não "informações adicionais" como a
 *     validação anterior presumiu por analogia de nome de campo — isso era
 *     uma suposição errada, nunca confirmada contra o dado real do
 *     PARAGRAFO3. TEXTO31 (usado em assunto/breveDescricao) é só um resumo
 *     curto, insuficiente para a IA investigar sozinha. DESCRICAO01 segue
 *     vazio na prática — PARAGRAFO3 é o fallback antes dele, não depois.
 */
function _mapearChamado(row) {
  const cnpjNormalizado = normalizadores.normalizarCnpj(row.CNPJCPF);
  return {
    oidOrigem: normalizadores.textoOuNull(row.OID),
    numero: normalizadores.textoOuNull(row.IDPROCESS),
    dataAberturaBruta: row.DT,
    dataAbertura: normalizadores.dataParaIso(row.DT),
    cnpjBruto: row.CNPJCPF,
    cnpjNormalizado,
    clienteNome: normalizadores.textoOuNull(row.DP),
    solicitanteIdOrigem: normalizadores.textoOuNull(row.CDUSER ?? row.IDUSER),
    solicitanteNome: normalizadores.textoOuNull(row.NMSOLICITANTE),
    solicitanteEmail: normalizadores.textoOuNull(row.EMAIL),
    solicitanteTelefone: normalizadores.textoOuNull(row.TELERAMAL),
    tecnicoIdOrigem: normalizadores.textoOuNull(row.CDUSERANA),
    tecnicoNome: normalizadores.textoOuNull(row.NOMEANALISTARES),
    tecnicoEmail: normalizadores.textoOuNull(row.EMAILANALISTA),
    produto: normalizadores.textoOuNull(row.PRODUTO),
    familia: normalizadores.textoOuNull(row.FAMILIA),
    modulo: normalizadores.textoOuNull(row.MD),
    servico: normalizadores.textoOuNull(row.SERVICOS),
    tipoChamado: normalizadores.textoOuNull(row.TIPODECHAMADO),
    tipoChamadoSe: normalizadores.textoOuNull(row.TIPODECHAMADOSE),
    tipoChamadoFinal: normalizadores.textoOuNull(row.TIPODOCHAMADO),
    natureza: normalizadores.textoOuNull(row.NATUREZADOCHAMAD),
    nivel: normalizadores.textoOuNull(row.NIVELCHAMADO),
    titulo: normalizadores.textoOuNull(row.TITULOWF) ?? normalizadores.textoOuNull(row.TITULOCHAMADO) ?? normalizadores.textoOuNull(row.TEXTO31),
    assunto: normalizadores.textoOuNull(row.TEXTO31),
    breveDescricao: normalizadores.textoOuNull(row.BREVEDESCRICAO ?? row.TEXTO31),
    descricao: normalizadores.textoOuNull(row.PARAGRAFO3) ?? normalizadores.textoOuNull(row.DESCRICAO01),
    informacoesAdicionais: normalizadores.textoOuNull(row.INFO),
    observacoes: normalizadores.textoOuNull(row.OBS),
    sla: normalizadores.textoOuNull(row.IDSLA),
    slaHoras: normalizadores.numeroOuNull(row.SLAHORAS),
    slaStatus: normalizadores.textoOuNull(row.SLASTATUS),
    slaStatusFinal: normalizadores.textoOuNull(row.SLAFINALSTATUS),
    slaInicial: normalizadores.textoOuNull(row.IDSLAINICIAL),
    slaAnterior: normalizadores.textoOuNull(row.IDSLAANTERIOR),
    solucaoAplicada: normalizadores.textoOuNull(row.SOLUCAOAPLICADA),
    avaliacao: normalizadores.textoOuNull(row.AVALIACAO),
    totalHoras: normalizadores.numeroOuNull(row.TOTALHORAS),
    chamadoReferencia: normalizadores.textoOuNull(row.NCHAMADOREF),
    // STATUS_ENCERRAMENTO e SLA_PRAZO vêm calculados pelo próprio SQL
    // (SQL_STATUS_CHAMADO/SQL_SLA_PRAZO em softexpert-sqlserver-adapter.js,
    // via JOIN com WFPROCESS) — não derivam de nenhuma coluna direta de
    // DYNITSM. SLA_PRAZO é cálculo dinâmico (depende do instante da consulta,
    // GETDATE() no SQL Server) — é o critério de fato de "em atraso"/"em
    // dia"/"próxima do vencimento", não slaStatusFinal (que é o desfecho
    // histórico de como o chamado foi encerrado, não seu prazo atual).
    statusEncerramento: normalizadores.textoOuNull(row.STATUS_ENCERRAMENTO),
    slaPrazo: normalizadores.textoOuNull(row.SLA_PRAZO),
    // Data/hora prevista de conclusão (fórmula fornecida pelo usuário,
    // 2026-09, ver SQL_SLA_DATA_PREV_FIM em softexpert-sqlserver-adapter.js)
    // — diferente de SLA_PRAZO (categórico, dinâmico), é uma data/hora fixa
    // calculada no momento da importação.
    slaDataPrevFim: normalizadores.dataParaIso(row.SLA_DATA_PREV_FIM),
    // Kanban — indica que uma atividade de desenvolvimento/codificação foi
    // gerada para este chamado (2026-09, pedido do usuário). ATRIBUTOSKANBA
    // chega como texto livre da origem (ex.: JSON ou string descritiva) —
    // guardado como está, sem tentar parsear estrutura.
    kanbanId: normalizadores.textoOuNull(row.IDKANBAN),
    kanbanKey: normalizadores.textoOuNull(row.KEYKANBAN),
    kanbanAtributos: normalizadores.textoOuNull(row.ATRIBUTOSKANBAN),
    kanbanDataInicio: normalizadores.dataParaIso(row.DATAINICIOKANBA),
    // Duração em dias úteis por fase do atendimento — view ITSM_CHAMADOS,
    // fórmulas fornecidas pelo usuário (2026-09), baseadas em
    // DBO.FN_SE_ITSM_DIASUTEIS. Campos extras, não substituem sla_prazo.
    diasDur: normalizadores.numeroOuNull(row.DIAS_DUR),
    hrDur: normalizadores.numeroOuNull(row.HR_DUR),
    diasDurSup: normalizadores.numeroOuNull(row.DIAS_DUR_SUP),
    diasDurFsw: normalizadores.numeroOuNull(row.DIAS_DUR_FSW),
    diasDurDist: normalizadores.numeroOuNull(row.DIAS_DUR_DIST),
    diasDurCli: normalizadores.numeroOuNull(row.DIAS_DUR_CLI),
    diasDurTicli: normalizadores.numeroOuNull(row.DIAS_DUR_TICLI),
  };
}

/**
 * TENTATIVA DE FALLBACK REVERTIDA (2026-09): chegou a herdar tecnicoIdOrigem
 * do chamado pai quando o posicionamento não tinha CDUSERANA próprio. Piloto
 * real (34 chamados/118 posicionamentos) mostrou um problema pior do que o
 * esperado: quando só CDUSERANA faltava mas ANALISTAJ2A (nome) do próprio
 * posicionamento estava preenchido, o registro final ficava com tecnico_id
 * de uma pessoa (o responsável do chamado) e tecnico_nome_origem de outra
 * (quem de fato fez o posicionamento) — pior que não vincular. Revertido a
 * pedido do usuário: CDUSERANA nulo volta a significar "sem técnico
 * identificado" (inconsistência 'posicionamento_sem_tecnico' registrada).
 */
function _mapearPosicionamento(row) {
  return {
    oidOrigem: normalizadores.textoOuNull(row.OID),
    dataPosicionamentoBruta: row.DATAATUAL,
    dataPosicionamento: normalizadores.dataParaIso(row.DATAATUAL),
    tecnicoIdOrigem: normalizadores.textoOuNull(row.CDUSERANA),
    tecnicoNomeOrigem: normalizadores.textoOuNull(row.ANALISTAJ2A),
    situacao: normalizadores.textoOuNull(row.SITUACAOCHAMADO),
    tipo: normalizadores.textoOuNull(row.TIPOPOSICIONAME),
    motivo: normalizadores.textoOuNull(row.MOTIVOAPONTAMEN),
    assunto: normalizadores.textoOuNull(row.ASSUNTO),
    descricao: normalizadores.textoOuNull(row.DESCRICAO),
    resultado: normalizadores.textoOuNull(row.RESULTADO),
    horaInicio: normalizadores.textoOuNull(row.HORAINI),
    horaFim: normalizadores.textoOuNull(row.HORAFIM),
    horaIntervalo: normalizadores.textoOuNull(row.HORAINT),
    totalHoras: normalizadores.numeroOuNull(row.HORATOTALNUM),
    // BUG CORRIGIDO em 2026-09: AGUARDANRETORNO é texto categórico, não
    // numérico — o mapeamento antigo fazia !!Number(row.AGUARDANRETORNO), que
    // sempre resultava em `false` para QUALQUER valor de texto (Number('RETORNO
    // - ATENDENTE') é NaN, !!NaN é false). Confirmado nos 539 posicionamentos
    // já importados antes da correção: 100% gravados como aguardando_retorno=0.
    // Valores reais confirmados via SELECT DISTINCT contra a origem (2026-09):
    // 'RETORNO - ATENDENTE' (39058), 'RETORNO - CLIENTE' (16124), 'Retorno
    // Analista' (427), 'Retorno do Cliente' (297), 'Retorno Cliente' (27),
    // 'CRM - DOC044' (8). Decisão explícita do usuário: só o valor exato
    // 'RETORNO - ATENDENTE' sinaliza "aguardando o analista agir" (fila do
    // radar) — as variantes de "cliente" são o oposto, e 'Retorno Analista'
    // (grafia alternativa, possivelmente de outro fluxo) foi deliberadamente
    // deixado fora por precaução.
    aguardandoRetorno: row.AGUARDANRETORNO === null || row.AGUARDANRETORNO === undefined ? null : row.AGUARDANRETORNO === 'RETORNO - ATENDENTE',
    // Texto categórico ORIGINAL preservado (migration v22, 2026-09, pedido
    // do usuário) — aguardandoRetorno acima é um booleano derivado só para
    // a regra da fila (radar-repository.js), mas colapsa 'RETORNO - CLIENTE'
    // e variantes em `false`, perdendo QUEM exatamente o chamado está
    // aguardando. situacaoRetorno guarda o valor bruto para exibição no
    // cabeçalho do chat (ver preencherCabecalho em radar.html).
    situacaoRetorno: normalizadores.textoOuNull(row.AGUARDANRETORNO),
    oidArquivo1: normalizadores.textoOuNull(row.OIDARQUIVO1),
    oidArquivo2: normalizadores.textoOuNull(row.OIDARQUIVO2),
  };
}

/**
 * Processa um único chamado (RAW + normalização + upsert de cliente/
 * solicitante/técnico/chamado + todos os posicionamentos). Isolado numa
 * função própria para que um erro num chamado não aborte o lote inteiro
 * (seção 20 do prompt) — o chamador (executarLote) captura exceções daqui.
 */
async function _processarChamado(empresaId, fonte, adapter, importacaoId, rowBruta) {
  const c = _mapearChamado(rowBruta);
  const inconsistencias = [];

  if (!c.oidOrigem) throw new Error('Chamado sem OID — registro descartado (RAW não pôde ser indexado por chave).');

  // RAW sempre gravado primeiro, mesmo que a normalização abaixo encontre
  // problemas — nunca perder o dado original por causa de uma inconsistência
  // de negócio (seção 15 do prompt).
  importacaoRepo.upsertRaw(empresaId, {
    fonteId: fonte.id, sistemaOrigem: SISTEMA_ORIGEM, tabelaOrigem: 'DYNITSM',
    oidOrigem: c.oidOrigem, dados: rowBruta, importacaoId,
  });

  if (!c.numero) {
    inconsistencias.push({ tipo: 'campo_obrigatorio_ausente', detalhe: 'IDPROCESS (numero) ausente' });
  }

  let clienteId = null;
  if (!c.cnpjNormalizado) {
    inconsistencias.push({ tipo: 'cnpj_ausente', detalhe: `CNPJCPF bruto: ${JSON.stringify(c.cnpjBruto)}` });
  } else if (!normalizadores.cnpjPareceValido(c.cnpjNormalizado)) {
    inconsistencias.push({ tipo: 'cnpj_invalido', detalhe: `CNPJ normalizado não parece válido: ${c.cnpjNormalizado}` });
  } else {
    const { cliente } = clienteRepo.upsertCliente(empresaId, { cnpj: c.cnpjNormalizado, nome: c.clienteNome });
    clienteId = cliente.id;
  }

  let solicitanteId = null;
  if (!c.solicitanteIdOrigem && !c.solicitanteNome) {
    inconsistencias.push({ tipo: 'chamado_sem_solicitante', detalhe: 'CDUSER/IDUSER e NMSOLICITANTE ausentes' });
  } else if (clienteId) {
    if (normalizadores.pareceConterEmail(c.solicitanteNome)) {
      inconsistencias.push({ tipo: 'nome_solicitante_contem_email', detalhe: c.solicitanteNome });
    }
    const { usuario } = clienteRepo.upsertUsuarioCliente(empresaId, {
      clienteId, sistemaOrigem: SISTEMA_ORIGEM, idOrigem: c.solicitanteIdOrigem,
      nome: c.solicitanteNome, email: c.solicitanteEmail, telefone: c.solicitanteTelefone,
    });
    solicitanteId = usuario.id;
  }

  let tecnicoResponsavelId = null;
  if (!c.tecnicoIdOrigem) {
    inconsistencias.push({ tipo: 'tecnico_sem_identificacao', detalhe: 'CDUSERANA ausente no chamado' });
  } else {
    const { tecnico } = clienteRepo.upsertTecnico(empresaId, {
      sistemaOrigem: SISTEMA_ORIGEM, idOrigem: c.tecnicoIdOrigem, nome: c.tecnicoNome, email: c.tecnicoEmail,
    });
    tecnicoResponsavelId = tecnico.id;
  }

  const { chamado, resultado } = chamadoRepo.upsertChamado(empresaId, {
    fonteId: fonte.id, sistemaOrigem: SISTEMA_ORIGEM, oidOrigem: c.oidOrigem, numero: c.numero || c.oidOrigem,
    clienteId, solicitanteId, tecnicoResponsavelId, dataAbertura: c.dataAbertura,
    produto: c.produto, familia: c.familia, modulo: c.modulo, servico: c.servico,
    tipoChamado: c.tipoChamado, tipoChamadoSe: c.tipoChamadoSe, tipoChamadoFinal: c.tipoChamadoFinal,
    natureza: c.natureza, nivel: c.nivel,
    titulo: c.titulo, assunto: c.assunto, breveDescricao: c.breveDescricao, descricao: c.descricao,
    informacoesAdicionais: c.informacoesAdicionais, observacoes: c.observacoes,
    sla: c.sla, slaHoras: c.slaHoras, slaStatus: c.slaStatus, slaStatusFinal: c.slaStatusFinal,
    slaInicial: c.slaInicial, slaAnterior: c.slaAnterior,
    solucaoAplicada: c.solucaoAplicada, avaliacao: c.avaliacao, totalHoras: c.totalHoras,
    chamadoReferencia: c.chamadoReferencia,
    statusEncerramento: c.statusEncerramento, slaPrazo: c.slaPrazo,
  });

  if (!c.dataAbertura && c.dataAberturaBruta) {
    inconsistencias.push({ tipo: 'data_abertura_nao_reconhecida', detalhe: `DT bruto: ${JSON.stringify(c.dataAberturaBruta)}` });
  }

  // Posicionamentos: TODOS os do chamado, sem filtrar por data (seção 46 do prompt).
  const posicionamentosBrutos = await adapter.listarPosicionamentosDoChamado(empresaId, fonte, c.numero || c.oidOrigem);
  let posInseridos = 0, posAtualizados = 0, posSemAlteracao = 0;

  for (const rowPos of posicionamentosBrutos) {
    const p = _mapearPosicionamento(rowPos);
    if (!p.oidOrigem) {
      inconsistencias.push({ tipo: 'posicionamento_sem_chamado_correspondente', detalhe: 'Posicionamento sem OID, descartado da indexação por chave' });
      continue;
    }

    importacaoRepo.upsertRaw(empresaId, {
      fonteId: fonte.id, sistemaOrigem: SISTEMA_ORIGEM, tabelaOrigem: 'DYNITSMGRIDREGISTR',
      oidOrigem: p.oidOrigem, dados: rowPos, importacaoId,
    });

    let tecnicoPosId = null;
    if (!p.tecnicoIdOrigem) {
      inconsistencias.push({ tipo: 'posicionamento_sem_tecnico', detalhe: `Posicionamento OID ${p.oidOrigem}` });
    } else {
      const { tecnico } = clienteRepo.upsertTecnico(empresaId, {
        sistemaOrigem: SISTEMA_ORIGEM, idOrigem: p.tecnicoIdOrigem, nome: p.tecnicoNomeOrigem,
      });
      tecnicoPosId = tecnico.id;
    }

    const { resultado: resultadoPos } = chamadoRepo.upsertPosicionamento(empresaId, {
      fonteId: fonte.id, oidOrigem: p.oidOrigem, chamadoId: chamado.id, dataPosicionamento: p.dataPosicionamento,
      tecnicoId: tecnicoPosId, tecnicoNomeOrigem: p.tecnicoNomeOrigem,
      situacao: p.situacao, tipo: p.tipo, motivo: p.motivo, assunto: p.assunto, descricao: p.descricao, resultado: p.resultado,
      horaInicio: p.horaInicio, horaFim: p.horaFim, horaIntervalo: p.horaIntervalo, totalHoras: p.totalHoras,
      aguardandoRetorno: p.aguardandoRetorno, oidArquivo1: p.oidArquivo1, oidArquivo2: p.oidArquivo2,
    });

    if (resultadoPos === 'inserido') posInseridos++;
    else if (resultadoPos === 'atualizado') posAtualizados++;
    else posSemAlteracao++;
  }

  await _dispararPreAnaliseSePrimeiroContato(empresaId, chamado);

  return {
    resultado, inconsistencias, chamadoId: chamado.id,
    posicionamentos: { total: posicionamentosBrutos.length, inseridos: posInseridos, atualizados: posAtualizados, semAlteracao: posSemAlteracao },
  };
}

/**
 * Pré-análise automática (decisão do usuário, 2026-09): dispara a IA sozinha
 * quando um chamado ENTRA NA FILA do radar pela primeira vez — sinal correto
 * é "este chamado ainda não tem atendimento no IA Service" (não "tem
 * exatamente 1 posicionamento na origem", critério anterior que falhava para
 * chamados que já chegam com histórico prévio: um chamado pode ter sido
 * escalado de analista A para B ANTES mesmo de ser importado pela primeira
 * vez, entrando já com 2+ posicionamentos — nesse caso a regra antiga nunca
 * disparava, mesmo ele estando genuinamente "aguardando atendente" agora e
 * nunca tendo passado por nenhuma pré-análise. Corrigido em 2026-09 após
 * confirmar o caso real do chamado #036583.). Segue disparando só quando o
 * ÚLTIMO posicionamento está aguardando_retorno=true (mesmo critério de
 * entrada na fila do radar-repository.js) — chamados que já têm atendimento
 * NUNCA disparam de novo aqui (evita repetir a pré-análise a cada
 * reimportação/sincronização do mesmo chamado).
 *
 * Best-effort: qualquer falha (IA fora do ar, sem chave configurada, etc.)
 * é logada e NUNCA propaga — a importação não pode falhar por causa disso.
 *
 * NOTA (2026-09): iniciarAnalise já dispara sincronização de anexos quando
 * cria um atendimento novo. A pré-análise da IA fica controlada pela
 * preferência do consultor ao abrir a análise no Radar; a importação não deve
 * gerar resposta automática sem um consultor associado.
 */
async function _dispararPreAnaliseSePrimeiroContato(empresaId, chamado) {
  try {
    const jaTemAtendimento = atendimentoRepo.getAtendimentoPorReferencia(empresaId, {
      origem: chamado.sistemaOrigem || 'softexpert',
      referenciaExterna: chamado.numero,
    });
    if (jaTemAtendimento) return; // já passou por isso antes — nunca dispara de novo

    const posicionamentos = chamadoRepo.listarPosicionamentosDoChamado(empresaId, chamado.id);
    if (!posicionamentos.length) return; // sem posicionamento nenhum ainda (Primeiro Atendimento) — não deve aparecer na fila
    const ultimo = posicionamentos[posicionamentos.length - 1];
    if (!ultimo.aguardandoRetorno) return; // só quando o chamado está de fato aguardando o atendente agora

    // Cria o atendimento — sincronização de anexos + pré-análise já disparam
    // sozinhas dentro de iniciarAnalise (ambas em background).
    radarService.iniciarAnalise(empresaId, chamado.id, { preAnaliseAutomatica: false });
  } catch (err) {
    console.error(`[IA Service] Falha ao avaliar pré-análise automática (chamado ${chamado.numero}):`, err.message);
  }
}

/**
 * Executa a importação completa (full load) de um período, em lotes,
 * atualizando checkpoint após cada lote para permitir retomada segura
 * (seção 18 do prompt). Se `importacaoExistenteId` for passado, retoma a
 * partir do checkpoint salvo em vez de começar do zero.
 */
async function executarFullLoad(empresaId, fonteId, { periodoInicio, periodoFim, tamanhoLote = TAMANHO_LOTE_PADRAO, importacaoExistenteId } = {}) {
  if (!periodoInicio || !periodoFim) throw new Error('periodoInicio e periodoFim são obrigatórios (formato YYYYMMDD).');
  const fonte = agenteRepo.getFonte(empresaId, fonteId);
  if (!fonte) throw new Error('Fonte histórica não encontrada.');
  const adapter = resolverAdapter(fonte.adapter);

  let importacao = importacaoExistenteId
    ? importacaoRepo.getImportacao(empresaId, importacaoExistenteId)
    : importacaoRepo.criarImportacao(empresaId, { fonteId, tipo: 'full', periodoInicio, periodoFim });

  if (!importacao) throw new Error('Importação não encontrada para retomada.');

  const offsetInicial = importacao.checkpoint?.offset || 0;
  importacao = importacaoRepo.atualizarImportacao(empresaId, importacao.id, {
    status: 'executando',
    inicioEm: importacao.inicioEm || new Date().toISOString(),
  });

  let offset = offsetInicial;
  let contadores = {
    registrosLidos: importacao.registrosLidos, registrosInseridos: importacao.registrosInseridos,
    registrosAtualizados: importacao.registrosAtualizados, registrosIgnorados: importacao.registrosIgnorados,
    registrosErro: importacao.registrosErro,
    posicionamentosLidos: importacao.posicionamentosLidos, posicionamentosInseridos: importacao.posicionamentosInseridos,
    posicionamentosAtualizados: importacao.posicionamentosAtualizados,
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const lote = await adapter.listarChamadosPeriodo(empresaId, fonte, { inicio: periodoInicio, fim: periodoFim }, { offset, limit: tamanhoLote });
      if (!lote.length) break;

      for (const rowBruta of lote) {
        contadores.registrosLidos++;
        try {
          const resultadoChamado = await _processarChamado(empresaId, fonte, adapter, importacao.id, rowBruta);

          if (resultadoChamado.resultado === 'inserido') contadores.registrosInseridos++;
          else if (resultadoChamado.resultado === 'atualizado') contadores.registrosAtualizados++;
          else contadores.registrosIgnorados++;

          contadores.posicionamentosLidos += resultadoChamado.posicionamentos.total;
          contadores.posicionamentosInseridos += resultadoChamado.posicionamentos.inseridos;
          contadores.posicionamentosAtualizados += resultadoChamado.posicionamentos.atualizados;

          for (const inc of resultadoChamado.inconsistencias) {
            importacaoRepo.registrarInconsistencia(empresaId, {
              importacaoId: importacao.id, tipoEntidade: 'chamado', oidOrigem: rowBruta.OID,
              tipoInconsistencia: inc.tipo, detalhe: inc.detalhe,
            });
          }
        } catch (err) {
          // Erro em um registro isolado não aborta o lote (seção 20 do prompt).
          contadores.registrosErro++;
          importacaoRepo.registrarInconsistencia(empresaId, {
            importacaoId: importacao.id, tipoEntidade: 'chamado', oidOrigem: rowBruta?.OID ?? null,
            tipoInconsistencia: 'erro_processamento', detalhe: err.message,
          });
        }
      }

      offset += lote.length;
      importacaoRepo.atualizarImportacao(empresaId, importacao.id, {
        ...contadores,
        checkpoint: { offset, ultimoLoteEm: new Date().toISOString() },
      });

      if (lote.length < tamanhoLote) break; // último lote, incompleto → fim da origem
    }

    importacaoRepo.atualizarImportacao(empresaId, importacao.id, {
      ...contadores, status: 'concluido', terminoEm: new Date().toISOString(),
    });
  } catch (err) {
    importacaoRepo.atualizarImportacao(empresaId, importacao.id, {
      ...contadores, status: 'falhou', mensagemErro: err.message, terminoEm: new Date().toISOString(),
    });
    throw err;
  }

  return importacaoRepo.getImportacao(empresaId, importacao.id);
}

module.exports = {
  TAMANHO_LOTE_PADRAO,
  _mapearChamado, _mapearPosicionamento, _processarChamado, // exportados para teste unitário do mapeamento
  executarFullLoad,
};
