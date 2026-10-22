'use strict';

// IDs explícitos: a operação nunca interpreta seleção vazia como "apagar tudo".
module.exports = function excluirLote(db, empresaId, ids, origem) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) {
    const error = new Error('Selecione ao menos um registro válido.');
    error.status = 400;
    throw error;
  }
  const unicos = [...new Set(ids)];
  const scope = origem ? ' AND origem = ?' : '';
  const buscar = db.prepare(`SELECT id FROM protheus_company_tree WHERE id = ? AND empresa_id = ?${scope}`);
  const apagar = db.prepare(`DELETE FROM protheus_company_tree WHERE id = ? AND empresa_id = ?${scope}`);
  return db.transaction(() => {
    const parametros = id => origem ? [id, empresaId, origem] : [id, empresaId];
    for (const id of unicos) {
      if (!buscar.get(...parametros(id))) {
        const error = new Error('A seleção contém registros indisponíveis. Atualize a grade e selecione novamente.');
        error.status = 409;
        throw error;
      }
    }
    let excluidos = 0;
    for (const id of unicos) excluidos += apagar.run(...parametros(id)).changes;
    return excluidos;
  })();
};
