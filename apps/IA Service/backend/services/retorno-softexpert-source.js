const agente = require('./agente-local-service');
const importService = require('./import/historical-import-service');
const radarService = require('./radar-service');
const chamadoRepo = require('../repositories/chamado-repository');

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
  const historico = radarService.reconstruirHistoricoDoChamado(chamado.empresaId, atual.id);
  if (!historico.reconstruido && historico.motivo !== 'sem_atendimento') throw new Error('Atualização do histórico local pendente.');
}

module.exports = { resolverOid, sincronizar };
