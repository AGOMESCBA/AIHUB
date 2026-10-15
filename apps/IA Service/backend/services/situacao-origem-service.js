'use strict';

/**
 * Situação atual de UM chamado para o gate de pesquisa externa — lida do
 * snapshot compartilhado (situacao-snapshot-service), nunca de uma consulta
 * própria: o mesmo serviço alimenta o Refresh e o gate, com cache por
 * empresa+fonte (TTL ~60 s) e single-flight.
 *
 * Por que existe: a importação incremental filtra por data de ABERTURA, então
 * o aguardando_consolidado local de chamados antigos congela. O gate não pode
 * decidir (nos dois sentidos) com esse valor sem confirmar.
 *
 * Nunca lança e nunca grava. Chamado ausente do snapshot, snapshot truncado
 * ou falha da origem → { ok:false }: o chamador mantém o valor local e
 * registra na trilha (ausência NÃO é prova de encerramento).
 */

const snapshotService = require('./situacao-snapshot-service');

async function consultarSituacaoAtual(empresaId, chamado, { obterSnapshot = snapshotService.obterSnapshot } = {}) {
  try {
    if (!chamado?.fonteId || !chamado?.numero) return { ok: false, motivo: 'chamado_sem_fonte' };
    const snap = await obterSnapshot(empresaId, chamado.fonteId);
    if (!snap?.ok) return { ok: false, motivo: `snapshot_indisponivel: ${snap?.erro || 'sem detalhe'}` };
    const item = snap.mapa.get(String(chamado.numero));
    if (!item) {
      return { ok: false, motivo: snap.truncado ? 'snapshot_truncado_chamado_nao_listado' : 'ausente_do_snapshot' };
    }
    return {
      ok: true,
      aguardando: item.aguardando ?? null,
      snapshotOrigem: snap.origem,
      snapshotIdadeMs: snap.idadeMs ?? null,
    };
  } catch (err) {
    return { ok: false, motivo: `falha_consulta_snapshot: ${err.message}` };
  }
}

module.exports = { consultarSituacaoAtual };
