'use strict';

const DEFINICOES = {
  produto: {
    tipo: 'produto',
    rotuloTipo: 'produto',
    tabelaBase: 'SB1',
    codigoCampo: 'B1_COD',
    nomeCampos: ['B1_DESC', 'B1_COD'],
    joinHint: 'SB2.B2_COD = SB1.B1_COD',
  },
  grupo_produto: {
    tipo: 'grupo_produto',
    rotuloTipo: 'grupo de produto',
    tabelaBase: 'SBM',
    codigoCampo: 'BM_GRUPO',
    nomeCampos: ['BM_DESC', 'BM_GRUPO'],
    joinHint: 'SB1.B1_GRUPO = SBM.BM_GRUPO',
  },
};

const TIPOS_POR_CONTEXTO = ['produto', 'grupo_produto'];

function tiposParaTermo(termo) {
  const tipo = String(termo?.tipo_sugerido || termo?.tipo || '').trim();
  return DEFINICOES[tipo] && ['explicito', 'filtro_estruturado'].includes(termo?.origem)
    ? [tipo]
    : TIPOS_POR_CONTEXTO;
}

module.exports = { DEFINICOES, TIPOS_POR_CONTEXTO, tiposParaTermo };
