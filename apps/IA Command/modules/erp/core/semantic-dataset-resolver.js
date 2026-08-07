'use strict';

const { getDB } = require('../../database');

function _norm(valor) {
  return String(valor || '').trim().toLowerCase();
}

function _suboperacaoDaMensagem(mensagem = '') {
  const t = String(mensagem || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\bremessa\b/.test(t)) return 'remessa';
  if (/\btransferencia\b/.test(t)) return 'transferencia';
  if (/\bentrega\s+futura\b|\bnota\s+mae\b/.test(t)) return 'entrega_futura';
  if (/\bmedia|medio|ticket\b/.test(t)) return 'media';
  if (/\bcrescimento|variacao|evolucao|aumento|queda\b/.test(t)) return 'crescimento';
  if (/\bcompar|versus|vs\.?|contra\b/.test(t)) return 'comparativo';
  if (/\bvendedor|representante|consultor\b/.test(t)) return 'vendedor';
  if (/\bproduto|item\b/.test(t)) return 'produto';
  if (/\bcliente\b/.test(t)) return 'cliente';
  if (/\bnota|nf|nfe|nota\s+fiscal\b/.test(t)) return 'notas_saida';
  return 'vendas';
}

function resolverDatasetView({ empresaId, modulo, spec, mensagem, erp } = {}) {
  const moduloNorm = _norm(modulo) || _norm(spec);
  if (!moduloNorm) return null;

  const db = getDB();
  const erpNorm = _norm(erp) || 'protheus';
  const suboperacao = _suboperacaoDaMensagem(mensagem);
  const rows = db.prepare(`
    SELECT *
      FROM datasets
     WHERE empresa_id = ?
       AND tipo = 'view_semantica'
       AND ativo_ia_owner = 1
       AND LOWER(COALESCE(erp, 'protheus')) = ?
       AND LOWER(COALESCE(modulo, '')) = ?
       AND LOWER(COALESCE(spec, modulo, '')) = ?
       AND COALESCE(sql_base, '') <> ''
     ORDER BY
       CASE
         WHEN LOWER(COALESCE(suboperacao, '')) = LOWER(?) THEN 0
         WHEN COALESCE(suboperacao, '') = '' THEN 1
         ELSE 2
       END,
       prioridade DESC,
       atualizado_em DESC
  `).all(Number(empresaId), erpNorm, moduloNorm, moduloNorm, suboperacao);

  const escolhido = rows.find(row => {
    const sub = _norm(row.suboperacao);
    return !sub || sub === _norm(suboperacao);
  });
  if (!escolhido) return null;
  return { dataset: escolhido, suboperacaoDetectada: suboperacao };
}

module.exports = {
  resolverDatasetView,
  _suboperacaoDaMensagem,
};
