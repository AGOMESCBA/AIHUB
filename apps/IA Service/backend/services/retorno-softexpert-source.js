const agente = require('./agente-local-service');
const importService = require('./import/historical-import-service');
const radarService = require('./radar-service');
const chamadoRepo = require('../repositories/chamado-repository');
const clienteRepo = require('../repositories/cliente-repository');

async function resolverResponsavel({ chamado }) {
  if (!chamado.oidOrigem || !chamado.numero) throw Object.assign(new Error('Chamado sem identificação na origem.'), { status: 409 });
  const rows = await agente.executarSelectNaFonte(chamado.empresaId, chamado.fonteId, {
    sql: `SELECT D.CDUSERANA, P.FGSTATUS AS STATUS_PROCESSO,
      C.CDUSER AS CODIGO_CABECALHO, C.NMUSER AS NOME_CABECALHO, C.FGUSERENABLED AS CABECALHO_HABILITADO,
      S.IDSTRUCT, S.CDUSER AS CODIGO_ATIVIDADE, U.NMUSER AS NOME_ATIVIDADE, U.FGUSERENABLED AS ATIVIDADE_HABILITADO
      FROM DYNITSM D INNER JOIN WFPROCESS P ON P.IDPROCESS = D.IDPROCESS
      LEFT JOIN ADUSER C ON C.CDUSER = D.CDUSERANA
      LEFT JOIN WFSTRUCT S ON S.IDPROCESS = P.IDOBJECT AND S.FGSTATUS = 2
      LEFT JOIN ADUSER U ON U.CDUSER = S.CDUSER
      WHERE D.OID = @oidChamado AND D.IDPROCESS = @numeroChamado AND P.FGWFGROUP = 1`,
    params: { oidChamado: chamado.oidOrigem, numeroChamado: chamado.numero }, limit: 21,
  });
  const fail = () => { throw Object.assign(new Error('Não foi possível confirmar o responsável técnico atual do chamado no SoftExpert.'), { status: 409 }); };
  if (!rows.length || rows.length >= 21 || rows.some((r) => String(r.STATUS_PROCESSO) !== '1')) return fail();
  const header = rows[0];
  if (header.CDUSERANA !== null && header.CDUSERANA !== undefined && String(header.CDUSERANA).trim()) {
    if (!header.CODIGO_CABECALHO || !header.NOME_CABECALHO?.trim() || String(header.CABECALHO_HABILITADO) !== '1') return fail();
    return { codigo: String(header.CODIGO_CABECALHO), nome: header.NOME_CABECALHO.trim(), origem: 'cabecalho' };
  }
  // Sem código persistido no cabeçalho, exige responsável identificado em uma única atividade ativa.
  if (rows.length !== 1 || !header.CODIGO_ATIVIDADE || !header.NOME_ATIVIDADE?.trim() || String(header.ATIVIDADE_HABILITADO) !== '1') return fail();
  return { codigo: String(header.CODIGO_ATIVIDADE), nome: header.NOME_ATIVIDADE.trim(), origem: 'atividade_atual', atividadeId: header.IDSTRUCT };
}

async function resolverOid({ chamado, recordKey }) {
  if (!recordKey || !/^[a-zA-Z0-9_-]{1,80}$/.test(recordKey) || !chamado.oidOrigem) return null;
  // Verificação somente leitura do código devolvido pela API contra o pai correto.
  const rows = await agente.executarSelectNaFonte(chamado.empresaId, chamado.fonteId, {
    sql: 'SELECT OID FROM DYNITSMGRIDREGISTR WHERE OID = @recordKey AND OIDABCA7HP6S55J0LV = @oidChamado',
    params: { recordKey, oidChamado: chamado.oidOrigem }, limit: 2,
  });
  return rows.length === 1 ? String(rows[0].OID) : null;
}

async function sincronizar(chamado) {
  const result = await importService.atualizarChamadosPorIds(chamado.empresaId, chamado.fonteId, [chamado.numero]);
  if (result.erros?.length || result.naoEncontrados?.length) throw new Error('Atualização do chamado pendente.');
  const atual = chamadoRepo.getChamado(chamado.empresaId, chamado.id);
  if (!atual) throw new Error('Chamado ainda indisponível na base local.');
  // Mensagem importada não comprova a alocação do chamado na fila do consultor.
  const responsavel = await resolverResponsavel({ chamado });
  const tecnico = clienteRepo.getTecnicoPorId(chamado.empresaId, atual.tecnicoResponsavelId);
  if (responsavel.origem !== 'cabecalho' || !tecnico || tecnico.sistemaOrigem !== 'softexpert' || String(tecnico.idOrigem) !== responsavel.codigo) {
    throw new Error('Atualização da fila pendente: responsável do cabeçalho não confirmado na base local.');
  }
  const historico = radarService.reconstruirHistoricoDoChamado(chamado.empresaId, atual.id);
  if (!historico.reconstruido && historico.motivo !== 'sem_atendimento') throw new Error('Atualização do histórico local pendente.');
}

module.exports = { resolverResponsavel, resolverOid, sincronizar };
